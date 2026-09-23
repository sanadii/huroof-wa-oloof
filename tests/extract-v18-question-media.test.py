import io
import json
import importlib.util
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

module_path = Path(__file__).parents[1] / "scripts" / "extract-v18-question-media.py"
spec = importlib.util.spec_from_file_location("extract_v18_question_media", module_path)
assert spec and spec.loader
media = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = media
spec.loader.exec_module(media)


class ArchiveSafetyTest(unittest.TestCase):
    def test_rejects_traversal(self):
        with self.assertRaises(media.MediaImportError):
            media.safe_member("../../public/leak.png")

    def test_rejects_non_png_and_invalid_dimensions(self):
        with self.assertRaises(media.MediaImportError):
            media.png_dimensions(b"not a png")
        self.assertEqual(media.neutral_alt("answer: قمر"), "صورة السؤال")

    def test_real_bundle_check_is_private_and_deterministic(self):
        root = Path(__file__).parents[1]
        first = media.build_manifest(root / "huroof_everything_available_bundle.zip", root / "tmp" / "ignored-media-output", False)
        second = media.build_manifest(root / "huroof_everything_available_bundle.zip", root / "tmp" / "ignored-media-output", False)
        self.assertEqual(first["assetCount"], 240)
        self.assertEqual(first["categoryCounts"], {"011": 60, "012": 60, "014": 60, "061": 60})
        self.assertEqual(first["manifestSha256"], second["manifestSha256"])
        self.assertEqual(first["assets"][0]["altAr"], "صورة السؤال")
        self.assertTrue(all("public" not in item["localFile"] for item in first["assets"]))


if __name__ == "__main__":
    unittest.main()
