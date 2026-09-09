"""Extract the authoritative, source-preserving category registry from the supplied bundle.

This is intentionally a metadata-only extractor. It never reads question rows as
playable content and never writes to Firebase or a release artifact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path


ARCHIVE_SHA256 = "7afd1423925b68e11f3f0cab5253879154763994272203b1a4df8007f9cd31ec"
ENTRY_PREFIX = "huroof_everything_bundle/huroof_questions_md/"
ENTRY_PATTERN = re.compile(r"^" + re.escape(ENTRY_PREFIX) + r"(\d{3})-.+\.md$")
ID_PATTERN = re.compile(r"^\s*-\s*\*\*Category ID:\*\*\s*`?((?:tahadani|huroof)-\d{3})`?\s*$", re.MULTILINE)
TITLE_PATTERN = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def extract(bundle: Path) -> dict[str, object]:
    payload = bundle.read_bytes()
    actual_archive_hash = sha256_bytes(payload)
    if actual_archive_hash != ARCHIVE_SHA256:
        raise ValueError(f"Unexpected archive SHA-256: {actual_archive_hash}")

    entries: list[dict[str, object]] = []
    with zipfile.ZipFile(bundle) as archive:
        for info in sorted(archive.infolist(), key=lambda item: item.filename):
            match = ENTRY_PATTERN.match(info.filename)
            if not match:
                continue
            raw = archive.read(info)
            text = raw.decode("utf-8")
            title = TITLE_PATTERN.search(text)
            category_id = ID_PATTERN.search(text)
            if not title or not category_id:
                raise ValueError(f"Missing H1 or Category ID in {info.filename}")
            index = match.group(1)
            source_id = category_id.group(1)
            expected_id = f"tahadani-{index}" if int(index) <= 62 else f"huroof-{index}"
            if source_id != expected_id:
                raise ValueError(f"Source ID mismatch in {info.filename}: {source_id} != {expected_id}")
            entries.append({
                "sourceIndex": index,
                "sourceCategoryId": source_id,
                "sourceTitleAr": title.group(1),
                "sourceFile": info.filename,
                "sourceFileSha256": sha256_bytes(raw),
                "declaredMode": "unclassified",
                "runtimeCategoryId": source_id if int(index) <= 62 else None,
                "runtimeMapping": "explicit_legacy_identity" if int(index) <= 62 else "source_only_no_runtime_target",
            })

    expected_indexes = [f"{value:03d}" for value in range(1, 101)]
    if [entry["sourceIndex"] for entry in entries] != expected_indexes:
        raise ValueError("Registry does not contain exactly one ordered entry for indexes 001–100")
    if len({entry["sourceCategoryId"] for entry in entries}) != 100:
        raise ValueError("Registry contains duplicate source category IDs")
    return {
        "schemaVersion": "huroof-source-category-registry-v1",
        "provenance": {
            "bundleFile": bundle.name,
            "bundleSha256": actual_archive_hash,
            "entryPrefix": ENTRY_PREFIX,
            "entryCount": len(entries),
            "authority": "outer_direct_markdown_category_headers",
        },
        "categories": entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, default=Path("huroof_everything_available_bundle.zip"))
    parser.add_argument("--output", type=Path, default=Path("content/source-catalog/huroof-everything-v1.json"))
    args = parser.parse_args()
    registry = extract(args.bundle)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"entries": len(registry["categories"]), "bundleSha256": registry["provenance"]["bundleSha256"], "output": args.output.as_posix()}))


if __name__ == "__main__":
    main()
