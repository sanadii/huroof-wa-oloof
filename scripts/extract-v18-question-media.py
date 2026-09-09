#!/usr/bin/env python3
"""Extract the immutable v18 image-question assets without trusting archive paths.

This is deliberately a local preparation step. It never uploads, serves, or copies
images into public/ or dist/.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import posixpath
import struct
import sys
import zipfile
from pathlib import Path
from typing import Any

EXPECTED_ZIP_SHA256 = "7afd1423925b68e11f3f0cab5253879154763994272203b1a4df8007f9cd31ec"
NESTED_ARCHIVE = "huroof_next20_v18_draft_patch.zip"
QUESTION_FILE = "huroof_next20_v18/data/questions.jsonl"
ASSET_PREFIX = "huroof_next20_v18/assets/"
EXPECTED_CATEGORIES = ("011", "012", "014", "061")


class MediaImportError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_member(name: str) -> str:
    normalized = posixpath.normpath(name.replace("\\", "/"))
    if not name or normalized in (".", "..") or normalized.startswith("../") or normalized.startswith("/") or ":" in normalized.split("/")[0]:
        raise MediaImportError(f"unsafe archive path: {name!r}")
    return normalized


def png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise MediaImportError("asset is not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    if not width or not height or width > 20000 or height > 20000:
        raise MediaImportError("invalid PNG dimensions")
    # Zip CRC only establishes transport integrity. Require the terminal IEND
    # marker too so a PNG header alone cannot enter the private manifest.
    if b"IEND" not in data[-32:]:
        raise MediaImportError("truncated PNG")
    return width, height


def read_member(archive: zipfile.ZipFile, name: str) -> bytes:
    normalized = safe_member(name)
    try:
        info = archive.getinfo(normalized)
    except KeyError as error:
        raise MediaImportError(f"missing archive member: {normalized}") from error
    # The one nested archive is about 15 MB; individual PNGs remain bounded.
    if info.is_dir() or info.file_size > 32 * 1024 * 1024:
        raise MediaImportError(f"invalid asset member: {normalized}")
    return archive.read(info)


def neutral_alt(value: Any) -> str:
    # Source descriptions can disclose an answer. Gameplay labels are invariant.
    return "صورة السؤال"


def build_manifest(bundle: Path, destination: Path, write: bool) -> dict[str, Any]:
    bundle_bytes = bundle.read_bytes()
    actual_bundle_sha = sha256(bundle_bytes)
    if actual_bundle_sha != EXPECTED_ZIP_SHA256:
        raise MediaImportError(f"bundle checksum mismatch: {actual_bundle_sha}")
    with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as outer:
        nested_candidates = [safe_member(info.filename) for info in outer.infolist() if not info.is_dir() and safe_member(info.filename).endswith(NESTED_ARCHIVE)]
        if len(nested_candidates) != 1:
            raise MediaImportError(f"expected one v18 nested archive, found {len(nested_candidates)}")
        nested_bytes = read_member(outer, nested_candidates[0])
    with zipfile.ZipFile(io.BytesIO(nested_bytes)) as archive:
        question_bytes = read_member(archive, QUESTION_FILE)
        records = []
        seen_asset_ids: set[str] = set()
        seen_paths: set[str] = set()
        for line_no, raw_line in enumerate(question_bytes.decode("utf-8").splitlines(), 1):
            if not raw_line.strip():
                continue
            try:
                question = json.loads(raw_line)
            except json.JSONDecodeError as error:
                raise MediaImportError(f"invalid question JSONL at line {line_no}") from error
            media = question.get("media")
            if not isinstance(media, dict):
                continue
            source_path, expected_sha = media.get("path"), media.get("sha256")
            category = str(question.get("category") or question.get("category_id") or question.get("source_category") or "").removeprefix("tahadani-").zfill(3)
            # v18 diagrams/lineups omit asset_id. Their source question ID is the
            # stable source-assigned identity; never invent an answer-derived ID.
            asset_id = media.get("asset_id") or question.get("id")
            if category not in EXPECTED_CATEGORIES or not all(isinstance(value, str) and value for value in (asset_id, source_path, expected_sha)) or not asset_id.startswith("v18-"):
                raise MediaImportError(f"invalid image reference at question line {line_no}")
            safe_path = safe_member(source_path)
            # The JSONL stores paths relative to the v18 payload; archive names
            # include that payload root. Accept only these two exact forms.
            archive_path = safe_path if safe_path.startswith(ASSET_PREFIX) else safe_member(f"huroof_next20_v18/{safe_path}")
            if not archive_path.startswith(ASSET_PREFIX) or not archive_path.endswith(".png"):
                raise MediaImportError(f"non-playable media path at line {line_no}: {safe_path}")
            if asset_id in seen_asset_ids or archive_path in seen_paths:
                raise MediaImportError(f"duplicate media identity at line {line_no}")
            seen_asset_ids.add(asset_id); seen_paths.add(archive_path)
            payload = read_member(archive, archive_path)
            actual_sha = sha256(payload)
            if actual_sha != expected_sha.lower():
                raise MediaImportError(f"asset checksum mismatch: {asset_id}")
            width, height = png_dimensions(payload)
            filename = f"{actual_sha}.png"
            record = {
                "mediaId": asset_id,
                "assetSha256": actual_sha,
                "sourceCategory": category,
                "mediaType": media.get("media_type") if isinstance(media.get("media_type"), str) else "image/png",
                "rights": media.get("rights") if isinstance(media.get("rights"), str) else "unspecified",
                "modification": media.get("modification") if isinstance(media.get("modification"), str) else "unspecified",
                "altAr": neutral_alt(media.get("alt_ar") or media.get("alt")),
                "width": width,
                "height": height,
                "privateObject": f"question-media/v18/{actual_sha}.png",
                "localFile": f"originals/{filename}",
                "sourceArchiveMember": archive_path,
            }
            records.append((record, payload))
        if len(records) != 240:
            raise MediaImportError(f"expected 240 image records, found {len(records)}")
        counts = {category: sum(1 for record, _ in records if record["sourceCategory"] == category) for category in EXPECTED_CATEGORIES}
        if any(count != 60 for count in counts.values()):
            raise MediaImportError(f"unexpected category counts: {counts}")
        manifest = {
            "schemaVersion": 1,
            "visibility": "private-prepared-not-uploaded",
            "bundleSha256": actual_bundle_sha,
            "nestedArchiveSha256": sha256(nested_bytes),
            "sourceQuestionFile": QUESTION_FILE,
            "assetCount": len(records),
            "categoryCounts": counts,
            "assets": [record for record, _ in sorted(records, key=lambda item: item[0]["mediaId"])],
            "excluded": {"reviewSheets": 10, "preview": 1, "blueprints": 60, "reason": "not question media referenced by v18 questions.jsonl"},
        }
        manifest["manifestSha256"] = sha256(json.dumps(manifest, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        if write:
            destination.mkdir(parents=True, exist_ok=True)
            originals = destination / "originals"
            originals.mkdir(exist_ok=True)
            for record, payload in records:
                target = destination / record["localFile"]
                if target.exists() and target.read_bytes() != payload:
                    raise MediaImportError(f"refusing to overwrite different private asset: {target}")
                target.write_bytes(payload)
            (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, default=Path("huroof_everything_available_bundle.zip"))
    parser.add_argument("--destination", type=Path, default=Path("content/question-media/v18-private-240"))
    parser.add_argument("--check", action="store_true", help="validate only; do not write private originals")
    args = parser.parse_args()
    try:
        manifest = build_manifest(args.bundle, args.destination, not args.check)
    except (OSError, zipfile.BadZipFile, MediaImportError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "assetCount": manifest["assetCount"], "manifestSha256": manifest["manifestSha256"], "destination": str(args.destination), "wrote": not args.check}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
