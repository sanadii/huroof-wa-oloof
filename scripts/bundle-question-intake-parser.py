#!/usr/bin/env python3
"""Safe, deterministic intake planner for the local Huroof bundle.

It reads ZIP members in memory (never extracts or executes them) and writes a
Firestore-document JSONL plan plus a reconciliation report.  It is deliberately
an intake tool: it assigns no approval and has no game/release side effects.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

SCHEMA = "bundle-question-intake-v1"
MAX_MEMBER_BYTES = 32 * 1024 * 1024
MAX_NESTED_DEPTH = 4
QUESTION_KEYS = ("question", "question_ar", "prompt", "prompt_ar", "text", "clue")
ANSWER_KEYS = ("answer", "answer_ar", "canonical_answer", "accepted_answers", "acceptedAnswers")
BLUEPRINT_KEYS = ("image_brief", "imageBrief", "visual_brief")


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value: Any) -> str:
    text = value if isinstance(value, str) else canonical(value)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def safe_name(name: str) -> bool:
    normalized = name.replace("\\", "/")
    return not (normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized) or ".." in normalized.split("/"))


def as_review_state(value: Any) -> str:
    text = str(value or "unreviewed").strip()
    return text[:200] or "unreviewed"


def find_media(value: Any, found: set[str] | None = None) -> list[str]:
    if found is None: found = set()
    if isinstance(value, dict):
        for key, child in value.items():
            lowered = key.lower()
            if any(token in lowered for token in ("media", "image", "asset", "audio", "video")):
                if isinstance(child, str): found.add(child)
                elif isinstance(child, list):
                    found.update(str(item) for item in child if isinstance(item, (str, int, float)))
            find_media(child, found)
    elif isinstance(value, list):
        for child in value: find_media(child, found)
    return sorted(found)[:200]


def categories(value: Any, entry: str) -> list[str]:
    out: set[str] = set(re.findall(r"(?:tahadani|huroof)-\d{3}", entry, flags=re.I))
    authoring_match = re.search(r"/(?:authoring/)?(\d{3})\.(?:psv|charades)$", entry, re.I)
    if authoring_match: out.add(f"source-file-category:{authoring_match.group(1)}")
    if isinstance(value, dict):
        for key in ("category_id", "categoryId", "category", "category_ids", "categoryIds"):
            item = value.get(key)
            if isinstance(item, str) and item.strip(): out.add(item.strip())
            elif isinstance(item, list): out.update(str(part).strip() for part in item if str(part).strip())
    return sorted(out)


def review_from(value: Any, fallback: str) -> str:
    if isinstance(value, dict):
        for key in ("review_status", "reviewStatus", "approval_status", "approvalStatus", "state", "status"):
            if key in value: return as_review_state(value[key])
    return as_review_state(fallback)


def approval_from(source_state: str) -> str:
    """Keep explicit legacy rejection; editorial wording never becomes approval."""
    state = source_state.casefold()
    return "rejected" if "reject" in state or "مرفوض" in state else "unreviewed"


def object_kind(value: dict[str, Any]) -> str | None:
    keys = {str(key) for key in value}
    has_question = any(key in keys for key in QUESTION_KEYS)
    has_answer = any(key in keys for key in ANSWER_KEYS)
    has_blueprint = any(key in keys for key in BLUEPRINT_KEYS)
    if has_question or (has_answer and not has_blueprint): return "question"
    if has_answer and has_blueprint: return "blueprint"
    return None


def markdown_records(text: str, entry: str) -> tuple[list[tuple[str, Any, str]], str]:
    category_match = re.search(r"(?:Category ID|معرّف الفئة)\s*:\*?\*?\s*`?([^`\n]+)", text, re.I)
    review_match = re.search(r"(?:Review status|الحالة)\s*:\*?\*?\s*([^\n]+)", text, re.I)
    category_id = category_match.group(1).strip() if category_match else None
    review = as_review_state(review_match.group(1).strip() if review_match else "unreviewed")
    # `##` sample cards and `###` category cards both carry actual source records.
    matches = list(re.finditer(r"^#{2,3}\s+(.+?)\s*$", text, re.M))
    records: list[tuple[str, Any, str]] = []
    for index, match in enumerate(matches):
        section = text[match.start(): matches[index + 1].start() if index + 1 < len(matches) else len(text)].strip()
        # A third-level heading without a question/answer field is a structural heading, not a silently skipped question.
        if not re.search(r"(?:\*\*(?:السؤال|الإجابة)\s*:?\*\*|<summary>\s*(?:الإجابة|الكلمة/العبارة|الهدف المخفي)\b[^<]*</summary>)", section, re.I):
            # Only question-shaped headings without an answer are mismatches.  Ordinary
            # Markdown headings in notes/readmes are accounted for by file classification.
            if re.match(r"(?:Q\d+|v\d+-)", match.group(1).strip(), re.I) or re.search(r"<summary>", section, re.I):
                records.append(("unsupported-markdown-heading", {"heading": match.group(1).strip(), "rawText": section}, review))
            continue
        heading = match.group(1).strip()
        prompt_match = re.search(r"\*\*السؤال\s*:\*\*\s*(.+?)(?=\n\s*-\s*\*\*الإجابة|$)", section, re.S)
        if prompt_match:
            question_text = re.sub(r"\s+", " ", prompt_match.group(1)).strip()
        else:
            before_answer = re.split(r"<details>\s*<summary>\s*(?:الإجابة|الكلمة/العبارة|الهدف المخفي)", section, maxsplit=1, flags=re.I)[0]
            question_text = re.sub(r"\s+", " ", re.sub(r"^#{2,3}.*?\n|!\[[^\]]*\]\([^)]*\)", "", before_answer, flags=re.M)).strip()
        answer_match = re.search(r"(?:\*\*الإجابة\s*:\*\*\s*|<summary>\s*(?:الإجابة|الكلمة/العبارة|الهدف المخفي)\b[^<]*</summary>\s*)(?:\*\*)?(.+?)(?:\*\*)?(?:\n\s*(?:إجابات|صيغ)|\n\s*</details>|$)", section, re.S | re.I)
        answer_text = re.sub(r"\s+", " ", answer_match.group(1)).strip(" |*") if answer_match else ""
        key_match = re.search(r"v\d+-(?:tahadani|huroof)-\d+-\d+", section, re.I)
        raw = {"heading": heading, "rawText": section, "categoryId": category_id, "questionText": question_text, "answerText": answer_text, "recordKey": key_match.group(0) if key_match else heading}
        records.append(("question", raw, review))
    return records, review


def json_candidates(value: Any) -> Iterable[tuple[str, dict[str, Any]]]:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                kind = object_kind(item)
                if kind: yield kind, item
            # Nested arrays/objects can hold question arrays under a named key.
            if isinstance(item, (list, dict)) and not object_kind(item) if isinstance(item, dict) else True:
                yield from json_candidates(item)
    elif isinstance(value, dict):
        kind = object_kind(value)
        if kind: yield kind, value
        for key, child in value.items():
            if key.lower() in {"questions", "items", "cards", "data", "records"} and isinstance(child, (list, dict)):
                yield from json_candidates(child)


def delimited_records(text: str, entry: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip(): continue
        fields = [field.strip() for field in line.split("|")]
        if Path(entry).suffix.lower() == ".charades":
            if len(fields) != 2 or not fields[0] or not fields[1]: raise ValueError(f"malformed charades row {line_number}")
            records.append({"sourceFormat": "charades", "row": line_number, "difficulty": fields[0], "phrase": fields[1], "answer": fields[1], "recordKey": f"{Path(entry).stem}:{line_number}"})
        else:
            if len(fields) not in (3, 4, 5) or not fields[0] or not fields[1] or not fields[2]: raise ValueError(f"malformed PSV row {line_number}")
            difficulty, *body = fields
            if len(body) == 4:
                facet, question, answers, source_reference = None, body[0], body[1], body[3]
                accepted_field = body[2]
            elif len(body) == 3:
                if "v18" in entry:
                    facet, question, answers, source_reference, accepted_field = None, body[0], body[1], None, body[2]
                else:
                    facet, question, answers, source_reference, accepted_field = body[0], body[1], body[2], None, ""
            else:
                facet, question, answers, source_reference, accepted_field = None, body[0], body[1], None, ""
            accepted = [part.strip() for part in answers.split(";") if part.strip()]
            accepted.extend(part.strip() for part in accepted_field.split(";") if part.strip() and part.strip() not in accepted)
            if not accepted: raise ValueError(f"PSV row has no answer {line_number}")
            records.append({"sourceFormat": "psv", "row": line_number, "rawColumns": fields, "difficulty": difficulty, "facet": facet, "question": question, "answer": accepted[0], "accepted_answers": accepted, "sourceReference": source_reference, "recordKey": f"{Path(entry).stem}:{line_number}"})
    return records


class Planner:
    def __init__(self, bundle: Path):
        self.bundle = bundle
        self.bundle_sha = sha_bytes(bundle.read_bytes())
        self.questions: dict[str, dict[str, Any]] = {}
        self.blueprints: dict[str, dict[str, Any]] = {}
        self.occurrences: dict[str, dict[str, Any]] = {}
        self.files: dict[str, dict[str, Any]] = {}
        self.issues: list[dict[str, Any]] = []
        self.classifications: Counter[str] = Counter()

    def issue(self, code: str, archive: str, entry: str, detail: str) -> None:
        self.issues.append({"code": code, "archive": archive, "entry": entry, "detail": detail})

    def add_record(self, kind: str, raw: Any, archive: str, entry: str, file_sha: str, position: int, review: str) -> None:
        cat = categories(raw, entry)
        if isinstance(raw, dict):
            key = raw.get("recordKey") or raw.get("id") or raw.get("question_id") or raw.get("questionId") or ""
            question_text = raw.get("questionText") or next((raw.get(field) for field in QUESTION_KEYS if raw.get(field) is not None), "")
            answer_text = raw.get("answerText") or next((raw.get(field) for field in ANSWER_KEYS if raw.get(field) is not None), "")
            accepted = raw.get("accepted_answers") or raw.get("acceptedAnswers") or raw.get("accepted") or []
        else:
            key, question_text, answer_text, accepted = "", "", "", []
        # This diagnostic semantic shape is useful for reconciliation only.  It is not
        # the record identity because it would collapse distinct historical revisions.
        semantic = {"kind": kind, "key": key, "questionText": question_text, "answerText": answer_text, "acceptedAnswers": accepted, "sourceCategoryIdentifiers": cat, "approval": approval_from(review)}
        # The immutable record identity includes every source payload field and review
        # state, but deliberately excludes archive/file path so byte-identical mirrors
        # collapse while distinct revisions remain separate documents.
        content_hash = digest({"kind": kind, "raw": raw, "sourceCategoryIdentifiers": cat, "sourceReviewState": review, "approval": approval_from(review)})
        occurrence = {"archive": archive, "entry": entry, "fileSha256": file_sha, "position": position, "contentHash": content_hash}
        occurrence_hash = digest(occurrence)
        target = self.questions if kind == "question" else self.blueprints
        target[content_hash] = {
            "schemaVersion": SCHEMA, "bundleSha256": self.bundle_sha, "contentHash": content_hash,
            "recordKind": kind, "raw": raw, "rawCanonicalSha256": digest(raw),
            "sourceCategoryIdentifiers": cat, "sourceReviewState": review, "mediaRefs": find_media(raw), "semantic": semantic,
            "approval": approval_from(review), "inert": True,
        }
        self.occurrences[occurrence_hash] = {
            "schemaVersion": SCHEMA, "bundleSha256": self.bundle_sha, "occurrenceHash": occurrence_hash,
            "contentHash": content_hash, "archive": archive, "entry": entry, "fileSha256": file_sha,
            "position": position, "sourceReviewState": review, "mediaRefs": find_media(raw),
        }

    def process_file(self, archive: str, entry: str, data: bytes) -> None:
        file_sha = sha_bytes(data)
        file_ref_hash = digest({"archive": archive, "entry": entry, "fileSha256": file_sha})
        suffix = Path(entry).suffix.lower()
        classification = "non-question-artifact"
        record_count = 0
        try:
            if suffix == ".md":
                text = data.decode("utf-8-sig")
                records, review = markdown_records(text, entry)
                for position, (kind, raw, state) in enumerate(records, 1):
                    if kind == "question": self.add_record(kind, raw, archive, entry, file_sha, position, state); record_count += 1
                    else: self.issue(kind, archive, entry, raw["heading"])
                classification = "markdown-questions" if record_count else "markdown-nonquestion"
            elif suffix in {".psv", ".charades"}:
                for position, parsed in enumerate(delimited_records(data.decode("utf-8-sig"), entry), 1):
                    self.add_record("question", parsed, archive, entry, file_sha, position, "unreviewed"); record_count += 1
                classification = f"{suffix[1:]}-questions"
            elif suffix == ".jsonl":
                classification = "jsonl"
                for position, line in enumerate(data.decode("utf-8-sig").splitlines(), 1):
                    if not line.strip(): continue
                    parsed = json.loads(line)
                    if not isinstance(parsed, dict):
                        self.issue("jsonl-row-not-object", archive, entry, f"line {position}"); continue
                    kind = object_kind(parsed)
                    if not kind:
                        self.issue("jsonl-row-unclassified", archive, entry, f"line {position}"); continue
                    self.add_record(kind, parsed, archive, entry, file_sha, position, review_from(parsed, "unreviewed")); record_count += 1
                classification += "-questions" if record_count else "-unclassified"
            elif suffix == ".json":
                parsed = json.loads(data.decode("utf-8-sig"))
                candidates = list(json_candidates(parsed))
                for position, (kind, item) in enumerate(candidates, 1):
                    self.add_record(kind, item, archive, entry, file_sha, position, review_from(item, "unreviewed")); record_count += 1
                classification = "json-questions" if record_count else "json-nonquestion"
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            classification = "parse-error"
            self.issue("parse-error", archive, entry, str(error))
        except ValueError as error:
            classification = "parse-error"
            self.issue("parse-error", archive, entry, str(error))
        marker_sensitive = suffix in {".psv", ".charades"} or "sample" in Path(entry).name.casefold() or "/categories/" in entry
        if marker_sensitive and record_count == 0:
            try: marker_text = data.decode("utf-8-sig")
            except UnicodeDecodeError: marker_text = ""
            if re.search(r"(?:<summary>\s*(?:الإجابة|الكلمة/العبارة|الهدف المخفي)|\*\*الإجابة|\|[^|\n]+\|[^|\n]+)", marker_text, re.I): self.issue("question-marker-unclassified", archive, entry, "question/answer marker without parsed source record")
        self.classifications[classification] += 1
        self.files[file_ref_hash] = {"schemaVersion": SCHEMA, "bundleSha256": self.bundle_sha, "fileRefHash": file_ref_hash, "archive": archive, "entry": entry, "fileSha256": file_sha, "byteLength": len(data), "classification": classification, "recordCount": record_count}

    def scan_zip(self, archive_label: str, payload: bytes, depth: int = 0) -> None:
        if depth > MAX_NESTED_DEPTH: self.issue("nested-archive-depth-exceeded", archive_label, "", str(depth)); return
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                for info in archive.infolist():
                    if info.is_dir(): continue
                    if not safe_name(info.filename): self.issue("unsafe-archive-path", archive_label, info.filename, "rejected"); continue
                    if info.file_size > MAX_MEMBER_BYTES: self.issue("member-size-limit", archive_label, info.filename, str(info.file_size)); continue
                    data = archive.read(info)
                    if info.filename.lower().endswith(".zip"):
                        self.scan_zip(f"{archive_label}!/{info.filename}", data, depth + 1)
                    else:
                        self.process_file(archive_label, info.filename, data)
        except zipfile.BadZipFile as error:
            self.issue("invalid-zip", archive_label, "", str(error))

    def documents(self) -> list[dict[str, Any]]:
        prefix = f"questionImports/{self.bundle_sha}"
        docs: list[dict[str, Any]] = []
        for content_hash, record in sorted(self.questions.items()):
            docs.append({"path": f"{prefix}/questions/{content_hash}", "data": record})
        for content_hash, record in sorted(self.blueprints.items()):
            docs.append({"path": f"{prefix}/blueprints/{content_hash}", "data": record})
        for occurrence_hash, record in sorted(self.occurrences.items()):
            docs.append({"path": f"{prefix}/occurrences/{occurrence_hash}", "data": record})
        for file_ref_hash, record in sorted(self.files.items()):
            docs.append({"path": f"{prefix}/sourceFiles/{file_ref_hash}", "data": record})
        return docs


def write_plan(planner: Planner, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    docs = planner.documents()
    plan_path = output / "bundle-question-import.documents.jsonl"
    with plan_path.open("w", encoding="utf-8", newline="\n") as handle:
        for document in docs: handle.write(canonical(document) + "\n")
    documents_sha = sha_bytes(plan_path.read_bytes())
    report = {
        "schemaVersion": SCHEMA, "bundle": str(planner.bundle.resolve()), "bundleSha256": planner.bundle_sha,
        "documentsPath": plan_path.name, "documentsSha256": documents_sha, "documentCount": len(docs),
        "questionCount": len(planner.questions), "blueprintCount": len(planner.blueprints), "occurrenceCount": len(planner.occurrences), "sourceFileCount": len(planner.files),
        "classifications": dict(sorted(planner.classifications.items())), "issues": sorted(planner.issues, key=canonical),
        "contentRootSha256": digest({"questions": sorted(planner.questions), "blueprints": sorted(planner.blueprints), "occurrences": sorted(planner.occurrences), "files": sorted(planner.files)}),
        "productionWrite": False,
    }
    (output / "bundle-question-import.report.json").write_text(canonical(report) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.bundle.is_file(): raise SystemExit(f"bundle is not a file: {args.bundle}")
    planner = Planner(args.bundle)
    planner.scan_zip(args.bundle.name, args.bundle.read_bytes())
    write_plan(planner, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
