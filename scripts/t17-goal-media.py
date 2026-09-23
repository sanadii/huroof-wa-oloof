#!/usr/bin/env python3
"""Prepare and locally import the private T17 goal-video question package.

The exporter never changes source clips.  Its destination is intentionally ignored
because the media, question answers, source provenance, and import receipts are
private preparation evidence.  The importer only ever inserts the stable 99 draft
IDs; it refuses to overwrite a user row or a different earlier import.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


CATEGORY_ID = "goals-2026"
CATEGORY_TITLE_AR = "من سجل الهدف؟"
SOURCE_PACKAGE = "goal-clips-2026-single-shot"
PROMPT_AR = "من سجل هذا الهدف؟"
MAX_BYTES = 1_000_000
TARGET_BYTES = 500_000
SOURCE_ROOT = Path("resources/100-best-goals-2026-clips/single-shot")
DESTINATION = Path("content/question-media/goal-quiz-2026")
ALIASES_PATH = Path("content/question-media/goal-quiz-2026-input/arabic-aliases.json")


class T17Error(ValueError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def write_json_new_or_equal(path: Path, value: Any) -> None:
    encoded = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists():
        if path.read_text(encoding="utf-8") != encoded:
            raise T17Error(f"refusing to overwrite different evidence: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(encoded, encoding="utf-8")


@dataclass(frozen=True)
class SourceGoal:
    goal: int
    caption: str
    start: float
    end: float
    duration: float
    filename: str
    arabic_name: str


def load_arabic_aliases(path: Path) -> dict[int, str]:
    """Loads reviewed private aliases without placing answer payloads in source control."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise T17Error(f"reviewed Arabic alias input is unavailable: {path}") from error
    aliases = document.get("aliases") if isinstance(document, dict) else None
    if not isinstance(document, dict) or document.get("schemaVersion") != 1 or document.get("package") != "goal-quiz-2026" or not isinstance(aliases, list):
        raise T17Error("Arabic alias input has an invalid schema")
    result: dict[int, str] = {}
    for index, value in enumerate(aliases, 1):
        if not isinstance(value, dict) or not isinstance(value.get("goal"), int) or not isinstance(value.get("arabicName"), str):
            raise T17Error(f"Arabic alias row {index} is invalid")
        goal, name = value["goal"], value["arabicName"].strip()
        if goal < 1 or goal > 99 or not name or goal in result:
            raise T17Error(f"Arabic alias row {index} has an invalid goal or name")
        result[goal] = name
    if sorted(result) != list(range(1, 100)):
        raise T17Error("Arabic alias input must contain exactly one reviewed alias for every goal")
    return result


def load_sources(root: Path, aliases_path: Path = ALIASES_PATH) -> list[SourceGoal]:
    raw = json.loads((root / "clips.json").read_text(encoding="utf-8"))
    aliases = load_arabic_aliases(aliases_path.resolve())
    if not isinstance(raw, list) or len(raw) != 99:
        raise T17Error("expected exactly 99 source clips")
    result: list[SourceGoal] = []
    for expected, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            raise T17Error(f"source record {expected} is invalid")
        goal, caption, filename = item.get("goal"), item.get("player_caption"), item.get("file")
        start, end, duration = item.get("start_seconds"), item.get("end_seconds"), item.get("duration_seconds")
        if goal != expected or not all(isinstance(x, str) and x for x in (caption, filename)):
            raise T17Error(f"source identity invalid at goal {expected}")
        if not all(isinstance(x, (float, int)) for x in (start, end, duration)) or abs((float(end) - float(start)) - float(duration)) > .01:
            raise T17Error(f"source timing invalid at goal {expected}")
        source = (root / filename).resolve()
        if source.parent != root.resolve() or source.suffix.lower() != ".mp4" or not source.is_file():
            raise T17Error(f"source clip escapes root or is missing: {filename}")
        result.append(SourceGoal(expected, caption, float(start), float(end), float(duration), filename, aliases[expected]))
    return result


def probe(path: Path) -> dict[str, Any]:
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,pix_fmt,width,height", "-of", "json", str(path)],
        capture_output=True, text=True, check=False,
    )
    if completed.returncode:
        raise T17Error(f"ffprobe failed for {path}: {completed.stderr.strip()}")
    return json.loads(completed.stdout)


def decode(path: Path) -> None:
    completed = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path), "-f", "null", "-"], capture_output=True, text=True, check=False)
    if completed.returncode:
        raise T17Error(f"full decode failed for {path}: {completed.stderr.strip()}")


def validate_video(path: Path, goal: SourceGoal, variant: str) -> dict[str, Any]:
    data = probe(path)
    streams = data.get("streams", [])
    video = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio = [stream for stream in streams if stream.get("codec_type") == "audio"]
    duration = float(data.get("format", {}).get("duration", 0))
    if len(video) != 1 or audio:
        raise T17Error(f"{variant} goal {goal.goal}: expected one muted video stream")
    stream = video[0]
    if stream.get("codec_name") != "h264" or stream.get("pix_fmt") != "yuv420p":
        raise T17Error(f"{variant} goal {goal.goal}: expected H.264 yuv420p")
    if stream.get("width") != 854 or not isinstance(stream.get("height"), int) or stream["height"] % 2:
        raise T17Error(f"{variant} goal {goal.goal}: invalid resized dimensions")
    if abs(duration - goal.duration) > .15:
        raise T17Error(f"{variant} goal {goal.goal}: duration drift {duration} vs {goal.duration}")
    size = path.stat().st_size
    if size > MAX_BYTES:
        raise T17Error(f"{variant} goal {goal.goal}: exceeds 1 MB ceiling ({size})")
    decode(path)
    return {"durationSeconds": round(duration, 3), "width": stream["width"], "height": stream["height"], "bytes": size, "sha256": sha256_file(path), "fullDecode": "passed"}


def ffmpeg_export(source: Path, output: Path, variant: str) -> None:
    effect = "gblur=sigma=2.5:steps=2," if variant == "blur" else ""
    filter_graph = f"crop=1280:560:0:50,{effect}scale=854:-2:flags=lanczos,setsar=1,format=yuv420p"
    completed = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-map", "0:v:0", "-an", "-vf", filter_graph,
         "-c:v", "libx264", "-preset", "fast", "-crf", "32", "-maxrate", "1400k", "-bufsize", "2800k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)],
        capture_output=True, text=True, check=False,
    )
    if completed.returncode:
        raise T17Error(f"ffmpeg failed for {source.name}/{variant}: {completed.stderr.strip()}")


def export_one(goal: SourceGoal, root: Path, destination: Path, temp: Path) -> tuple[int, list[dict[str, Any]]]:
    source = (root / goal.filename).resolve()
    entries: list[dict[str, Any]] = []
    source_sha = sha256_file(source)
    for variant in ("blur", "clean"):
        work = temp / f"{goal.goal:03d}-{variant}.mp4"
        ffmpeg_export(source, work, variant)
        check = validate_video(work, goal, variant)
        target = destination / "assets" / f"{check['sha256']}.mp4"
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if sha256_file(target) != check["sha256"]:
                raise T17Error(f"refusing to overwrite different asset: {target}")
            work.unlink()
        else:
            work.replace(target)
        entries.append({
            "mediaId": f"goal-quiz-2026:{goal.goal:03d}:{variant}", "variant": variant, "contentType": "video/mp4",
            "privateObject": f"question-media/goal-quiz-2026/assets/{check['sha256']}.mp4", "localFile": f"assets/{check['sha256']}.mp4",
            "source": {"clipsJson": "resources/100-best-goals-2026-clips/single-shot/clips.json", "sourceFile": goal.filename,
                       "sourceSha256": source_sha, "goal": goal.goal, "startSeconds": goal.start, "endSeconds": goal.end,
                       "captionEnglish": goal.caption}, **check,
        })
    return goal.goal, entries


def build_questions(goals: Iterable[SourceGoal], assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {asset["mediaId"]: asset for asset in assets}
    questions = []
    for goal in goals:
        blur, clean = (by_id[f"goal-quiz-2026:{goal.goal:03d}:{variant}"] for variant in ("blur", "clean"))
        source_content_sha = sha256_bytes(canonical_json({"goal": goal.goal, "caption": goal.caption, "arabic": goal.arabic_name, "start": goal.start, "end": goal.end, "blur": blur["sha256"], "clean": clean["sha256"]}))
        source = {"id": f"goal-quiz-2026-{goal.goal:03d}", "category_id": CATEGORY_ID, "category_title": CATEGORY_TITLE_AR,
                  "source_package": SOURCE_PACKAGE, "source_record_id": f"goal-{goal.goal:03d}", "mode": "trivia", "question": PROMPT_AR,
                  "answer": goal.arabic_name, "accepted_answers": [goal.arabic_name, goal.caption], "source_content_sha256": source_content_sha,
                  "source_caption_english": goal.caption, "source_timing": {"startSeconds": goal.start, "endSeconds": goal.end}}
        questions.append({"id": source["id"], "categoryId": CATEGORY_ID, "headerAr": CATEGORY_TITLE_AR, "promptAr": PROMPT_AR,
                          "canonicalAnswer": goal.arabic_name, "acceptedAnswers": source["accepted_answers"], "modality": "video",
                          "status": "draft", "readOnly": True, "sourceMode": "trivia", "stagingState": "unsupported_mode:video",
                          "answerAliases": [{"locale": "ar", "value": goal.arabic_name, "review": "caption-grounded-transliteration"},
                                            {"locale": "en", "value": goal.caption, "review": "exact-source-caption"}],
                          "media": {"type": "video", "promptMediaId": blur["mediaId"], "promptSha256": blur["sha256"],
                                    "answerMediaId": clean["mediaId"], "answerSha256": clean["sha256"]},
                          "importSource": source})
    return questions


def export_package(source_root: Path = SOURCE_ROOT, destination: Path = DESTINATION, workers: int = 3, aliases_path: Path = ALIASES_PATH) -> dict[str, Any]:
    goals = load_sources(source_root.resolve(), aliases_path)
    destination = destination.resolve()
    work_root = destination / ".work"
    work_root.mkdir(parents=True, exist_ok=True)
    # Stage on the destination volume: Path.replace is then atomic on Windows.
    with tempfile.TemporaryDirectory(prefix="t17-goal-media-", dir=work_root) as temp_name:
        temp = Path(temp_name)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            exported = list(pool.map(lambda goal: export_one(goal, source_root.resolve(), destination, temp), goals))
    if not any(work_root.iterdir()):
        work_root.rmdir()
    exported.sort(key=lambda item: item[0])
    assets = [asset for _, pair in exported for asset in pair]
    if len(assets) != 198 or len({asset["mediaId"] for asset in assets}) != 198 or len({asset["sha256"] for asset in assets}) != 198:
        raise T17Error("asset output is not a one-to-one 99x2 package")
    questions = build_questions(goals, assets)
    registry = {"schemaVersion": 1, "visibility": "private-prepared-not-uploaded", "package": "goal-quiz-2026", "assetCount": 198,
                "variants": ["blur", "clean"], "filter": {"crop": "1280:560:0:50", "blur": "gblur=sigma=2.5:steps=2 before resize", "resize": "854:-2", "audio": "muted", "faststart": True},
                "assets": assets}
    registry["manifestSha256"] = sha256_bytes(canonical_json(registry))
    question_manifest = {"schemaVersion": 1, "package": "goal-quiz-2026", "category": {"id": CATEGORY_ID, "titleAr": CATEGORY_TITLE_AR},
                         "questionCount": len(questions), "questions": questions}
    question_manifest["manifestSha256"] = sha256_bytes(canonical_json(question_manifest))
    write_json_new_or_equal(destination / "media-registry.json", registry)
    write_json_new_or_equal(destination / "questions.json", question_manifest)
    return {"registry": registry, "questions": question_manifest}


def verify_question_manifest_identity(source_root: Path, package: Path, aliases_path: Path) -> dict[str, Any]:
    """Checks the private alias input reproduces the accepted question manifest without re-encoding media."""
    registry = json.loads((package / "media-registry.json").read_text(encoding="utf-8"))
    stored = json.loads((package / "questions.json").read_text(encoding="utf-8"))
    assets = registry.get("assets")
    if not isinstance(assets, list) or registry.get("assetCount") != 198:
        raise T17Error("media registry is not a complete goal package")
    goals = load_sources(source_root.resolve(), aliases_path)
    questions = build_questions(goals, assets)
    expected = {"schemaVersion": 1, "package": "goal-quiz-2026", "category": {"id": CATEGORY_ID, "titleAr": CATEGORY_TITLE_AR},
                "questionCount": len(questions), "questions": questions}
    expected["manifestSha256"] = sha256_bytes(canonical_json(expected))
    if canonical_json(expected) != canonical_json(stored):
        raise T17Error("private aliases do not reproduce the accepted question manifest")
    return {"package": str(package), "questionCount": len(questions), "manifestSha256": expected["manifestSha256"], "identity": "passed"}


def snapshot_rows(connection: sqlite3.Connection) -> dict[str, Any]:
    rows = connection.execute("SELECT id,data,updated_at FROM local_admin_drafts ORDER BY id").fetchall()
    raw = [{"id": row[0], "data": row[1], "updated_at": row[2]} for row in rows]
    return {"count": len(raw), "digest": sha256_bytes(canonical_json(raw)), "rows": raw}


def row_data(question: dict[str, Any]) -> str:
    # The input package is deterministic.  Never add an import-time timestamp that
    # would convert an idempotent rerun into an accidental update.
    return json.dumps(question, ensure_ascii=False, separators=(",", ":"))


def import_questions(package: Path, db_path: Path, report_dir: Path, apply: bool) -> dict[str, Any]:
    question_doc = json.loads((package / "questions.json").read_text(encoding="utf-8"))
    registry = json.loads((package / "media-registry.json").read_text(encoding="utf-8"))
    questions = question_doc.get("questions")
    if not isinstance(questions, list) or len(questions) != 99 or registry.get("assetCount") != 198:
        raise T17Error("package does not contain the expected 99 questions / 198 assets")
    ids = [question.get("id") for question in questions]
    if ids != [f"goal-quiz-2026-{number:03d}" for number in range(1, 100)]:
        raise T17Error("question IDs are not the stable goal-quiz-2026 sequence")
    db_path = db_path.resolve()
    if not db_path.is_file():
        raise T17Error(f"SQLite target missing: {db_path}")
    connection = sqlite3.connect(f"file:{db_path.as_posix()}?mode={'rw' if apply else 'ro'}", uri=True, isolation_level=None)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise T17Error(f"SQLite integrity check failed: {integrity}")
        baseline = snapshot_rows(connection)
        existing = {row["id"]: row for row in baseline["rows"]}
        inserts, already = [], []
        for question in questions:
            expected = row_data(question)
            prior = existing.get(question["id"])
            if prior is None:
                inserts.append((question["id"], expected))
            elif prior["data"] == expected:
                already.append(question["id"])
            else:
                raise T17Error(f"existing ID conflicts with private goal import: {question['id']}")
        report = {"schemaVersion": 1, "runKind": "apply" if apply else "dry-run", "targetDb": str(db_path), "package": str(package.resolve()),
                  "packageQuestionManifestSha256": question_doc.get("manifestSha256"), "packageRegistryManifestSha256": registry.get("manifestSha256"),
                  "baseline": {"count": baseline["count"], "digest": baseline["digest"]}, "integrity": integrity,
                  "insertCount": len(inserts), "alreadyPresentCount": len(already), "stableIds": ids,
                  "rollback": {"onlyIfDataSha256Matches": {question_id: sha256_bytes(data.encode("utf-8")) for question_id, data in inserts}}}
        if not apply:
            report["after"] = report["baseline"]
            return report
        report_dir = report_dir.resolve(); report_dir.mkdir(parents=True, exist_ok=True)
        if not inserts:
            # An apply rerun is a read-only verification.  It neither creates a
            # second backup nor touches the inserted records' timestamps.
            report["after"] = report["baseline"]
            return report
        backup = report_dir / "local-admin-drafts-before.sqlite"
        if backup.exists():
            raise T17Error(f"refusing to overwrite backup: {backup}")
        destination = sqlite3.connect(str(backup))
        try:
            connection.backup(destination)
        finally:
            destination.close()
        backup_integrity = sqlite3.connect(f"file:{backup.as_posix()}?mode=ro", uri=True)
        try:
            if backup_integrity.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise T17Error("safe SQLite backup integrity check failed")
        finally:
            backup_integrity.close()
        report["backup"] = {"path": str(backup), "sha256": sha256_file(backup)}
        write_json_new_or_equal(report_dir / "BACKUP-MANIFEST.json", {
            "schemaVersion": 1, "targetDb": str(db_path), "package": str(package.resolve()),
            "baseline": report["baseline"], "backup": report["backup"], "integrity": "ok",
        })
        connection.execute("BEGIN IMMEDIATE")
        try:
            fresh = snapshot_rows(connection)
            if fresh["digest"] != baseline["digest"]:
                raise T17Error("target changed after backup; refusing import")
            now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            connection.executemany("INSERT INTO local_admin_drafts(id,data,updated_at) VALUES (?,?,?)", [(question_id, data, now) for question_id, data in inserts])
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
        after = snapshot_rows(connection)
        before_by_id = {row["id"]: row for row in baseline["rows"]}
        after_by_id = {row["id"]: row for row in after["rows"]}
        if any(after_by_id.get(row_id) != row for row_id, row in before_by_id.items()):
            raise T17Error("pre-existing local_admin_drafts bytes or timestamps changed")
        if after["count"] != baseline["count"] + len(inserts):
            raise T17Error("unexpected SQLite insert count")
        report["after"] = {"count": after["count"], "digest": after["digest"]}
        return report
    finally:
        connection.close()


def create_contact_sheets(package: Path, report_dir: Path) -> list[str]:
    sys.path.insert(0, str(Path(".agent-runtime/video-tools").resolve()))
    import cv2  # type: ignore
    from PIL import Image, ImageDraw  # type: ignore
    questions = json.loads((package / "questions.json").read_text(encoding="utf-8"))["questions"]
    registry = {entry["mediaId"]: entry for entry in json.loads((package / "media-registry.json").read_text(encoding="utf-8"))["assets"]}
    report_dir.mkdir(parents=True, exist_ok=True); paths = []
    for page, chunk_start in enumerate(range(0, 99, 25), 1):
        sheet = Image.new("RGB", (1600, 1250), "#10151d"); draw = ImageDraw.Draw(sheet)
        for offset, question in enumerate(questions[chunk_start:chunk_start + 25]):
            media = registry[question["media"]["promptMediaId"]]
            capture = cv2.VideoCapture(str(package / media["localFile"])); ok, frame = capture.read(); capture.release()
            if not ok: raise T17Error(f"contact-sheet read failed: {media['mediaId']}")
            thumbnail = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).resize((320, 140))
            x, y = offset % 5 * 320, offset // 5 * 250; sheet.paste(thumbnail, (x, y))
            draw.text((x + 4, y + 146), f"{chunk_start + offset + 1:03d}  blur", fill="white")
            draw.text((x + 4, y + 166), f"{media['durationSeconds']:.2f}s  {media['bytes'] // 1024} KB", fill="#b8c2d0")
        target = report_dir / f"goal-media-contact-sheet-{page}.jpg"; sheet.save(target, quality=90); paths.append(str(target))
    return paths


def validate_package(package: Path, report_dir: Path) -> dict[str, Any]:
    package = package.resolve(); report_dir = report_dir.resolve()
    goals = load_sources(SOURCE_ROOT.resolve())
    registry = json.loads((package / "media-registry.json").read_text(encoding="utf-8"))
    questions = json.loads((package / "questions.json").read_text(encoding="utf-8"))
    assets = registry.get("assets")
    if not isinstance(assets, list) or len(assets) != 198 or questions.get("questionCount") != 99:
        raise T17Error("invalid private package cardinality")
    by_goal = {goal.goal: goal for goal in goals}; checked = []
    for asset in assets:
        if not isinstance(asset, dict) or asset.get("variant") not in {"blur", "clean"}:
            raise T17Error("invalid asset variant")
        source = asset.get("source")
        if not isinstance(source, dict) or source.get("goal") not in by_goal:
            raise T17Error("asset lacks known goal provenance")
        relative = asset.get("localFile")
        if not isinstance(relative, str): raise T17Error("asset lacks local file")
        path = (package / relative).resolve()
        if path.parent != (package / "assets").resolve() or not path.is_file() or path.is_symlink():
            raise T17Error(f"unsafe or missing private asset: {relative}")
        value = validate_video(path, by_goal[source["goal"]], asset["variant"])
        if value["sha256"] != asset.get("sha256") or value["bytes"] != asset.get("bytes"):
            raise T17Error(f"asset bytes changed since registry: {asset.get('mediaId')}")
        checked.append({"mediaId": asset["mediaId"], "goal": source["goal"], "variant": asset["variant"], **value})
    pairs = {goal: [entry for entry in checked if entry["goal"] == goal] for goal in range(1, 100)}
    if any(len(pair) != 2 or abs(pair[0]["durationSeconds"] - pair[1]["durationSeconds"]) > .01 for pair in pairs.values()):
        raise T17Error("blur/clean timing pairs are incomplete or drifted")
    result = {"schemaVersion": 1, "package": str(package), "checks": {"assetCount": len(checked), "fullDecode": "passed",
              "codec": "h264", "pixelFormat": "yuv420p", "audio": "absent/muted", "timingPairs": "99 passed",
              "captionRemoval": "root-inspected representative contact sheets spanning all 99 goals"},
              "size": {"totalBytes": sum(entry["bytes"] for entry in checked), "largestBytes": max(entry["bytes"] for entry in checked),
                       "overTarget500KB": sum(entry["bytes"] >= TARGET_BYTES for entry in checked), "overMaximum1MB": sum(entry["bytes"] > MAX_BYTES for entry in checked)},
              "assets": checked}
    write_json_new_or_equal(report_dir / "MEDIA-VALIDATION-REPORT.json", result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export"); export.add_argument("--source-root", type=Path, default=SOURCE_ROOT); export.add_argument("--destination", type=Path, default=DESTINATION); export.add_argument("--workers", type=int, default=3); export.add_argument("--aliases", type=Path, default=ALIASES_PATH)
    contact = sub.add_parser("contact-sheets"); contact.add_argument("--package", type=Path, default=DESTINATION); contact.add_argument("--report-dir", type=Path, default=Path("output/t17-media"))
    validate = sub.add_parser("validate"); validate.add_argument("--package", type=Path, default=DESTINATION); validate.add_argument("--report-dir", type=Path, default=Path("output/t17-media"))
    identity = sub.add_parser("verify-question-manifest"); identity.add_argument("--source-root", type=Path, default=SOURCE_ROOT); identity.add_argument("--package", type=Path, default=DESTINATION); identity.add_argument("--aliases", type=Path, default=ALIASES_PATH)
    importer = sub.add_parser("import-drafts"); importer.add_argument("--package", type=Path, default=DESTINATION); importer.add_argument("--db", type=Path, required=True); importer.add_argument("--report-dir", type=Path, required=True); importer.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "export":
            value = export_package(args.source_root, args.destination, args.workers, args.aliases)
            print(json.dumps({"ok": True, "assets": value["registry"]["assetCount"], "questions": value["questions"]["questionCount"], "destination": str(args.destination)}, ensure_ascii=False))
        elif args.command == "contact-sheets":
            print(json.dumps({"ok": True, "sheets": create_contact_sheets(args.package, args.report_dir)}, ensure_ascii=False))
        elif args.command == "validate":
            value = validate_package(args.package, args.report_dir)
            print(json.dumps({"ok": True, **value["checks"], **value["size"]}, ensure_ascii=False))
        elif args.command == "verify-question-manifest":
            print(json.dumps({"ok": True, **verify_question_manifest_identity(args.source_root, args.package, args.aliases)}, ensure_ascii=False))
        else:
            value = import_questions(args.package, args.db, args.report_dir, args.apply)
            target = args.report_dir / (
                "RERUN-REPORT.json" if args.apply and value["insertCount"] == 0 else "IMPORT-REPORT.json" if args.apply else
                "RERUN-DRY-RUN-REPORT.json" if value["insertCount"] == 0 else "DRY-RUN-REPORT.json"
            )
            write_json_new_or_equal(target, value)
            print(json.dumps({"ok": True, "report": str(target), "insertCount": value["insertCount"], "alreadyPresentCount": value["alreadyPresentCount"]}, ensure_ascii=False))
    except (OSError, sqlite3.Error, subprocess.SubprocessError, T17Error) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
