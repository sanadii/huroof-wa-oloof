import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("bundle_intake", Path(__file__).parents[1] / "scripts" / "bundle-question-intake-parser.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class BundleQuestionIntakeParserTest(unittest.TestCase):
    def test_markdown_samples_and_delimited_authoring_are_accounted_and_preserve_revisions(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle = Path(folder) / "bundle.zip"
            with zipfile.ZipFile(bundle, "w") as archive:
                archive.writestr("SAMPLE_20.md", "## بطاقة\n`v17-tahadani-004-021`\n\nسؤال؟\n\n<details><summary>الإجابة</summary>\n\n**جواب**\n\n</details>")
                archive.writestr("authoring/004.psv", "200|سؤال؟|جواب|بديل|SRC\n")
                archive.writestr("authoring/016.charades", "200|أسد\n")
            planner = MODULE.Planner(bundle); planner.scan_zip(bundle.name, bundle.read_bytes())
            self.assertEqual(planner.issues, [])
            self.assertEqual(len(planner.questions), 3)
            self.assertEqual(len(planner.occurrences), 3)
            documents = planner.documents()
            self.assertTrue(any("/occurrences/" in document["path"] for document in documents))
            psv = next(record for record in planner.questions.values() if record["raw"].get("sourceFormat") == "psv")
            self.assertEqual(psv["raw"]["rawColumns"], ["200", "سؤال؟", "جواب", "بديل", "SRC"])

    def test_mixed_sample_cards_preserve_hidden_acting_targets_and_flag_unknown_labels(self):
        text = "## Trivia\n`v17-tahadani-004-001`\nQuestion\n<details><summary>الإجابة</summary>\nجواب\n</details>\n## Acting\n`v17-tahadani-016-001`\nAct this\n<details><summary>الهدف المخفي</summary>\nأسد\n</details>\n## Unknown\n`v17-tahadani-016-002`\n<details><summary>Unknown label</summary>\nOther\n</details>"
        rows, _ = MODULE.markdown_records(text, "SAMPLE_20.md")
        self.assertEqual([row[0] for row in rows], ["question", "question", "unsupported-markdown-heading"])
        self.assertEqual(rows[1][1]["answerText"], "أسد")
        self.assertNotIn("## Acting", rows[1][1]["questionText"])

    def test_distinct_raw_review_and_media_revisions_do_not_collapse(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle = Path(folder) / "bundle.zip"; bundle.write_bytes(b"fixture")
            planner = MODULE.Planner(bundle)
            planner.add_record("question", {"id": "q", "question": "س", "answer": "ج", "image": "a.png"}, "a.zip", "a.jsonl", "a" * 64, 1, "Needs Review")
            planner.add_record("question", {"id": "q", "question": "س", "answer": "ج", "image": "b.png"}, "b.zip", "b.jsonl", "b" * 64, 1, "rejected")
            self.assertEqual(len(planner.questions), 2)
            self.assertEqual(len(planner.occurrences), 2)
            self.assertEqual({record["approval"] for record in planner.questions.values()}, {"unreviewed", "rejected"})


if __name__ == "__main__":
    unittest.main()
