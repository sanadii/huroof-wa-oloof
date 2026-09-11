import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

module_path = Path(__file__).parents[1] / "scripts" / "t17-goal-media.py"
spec = importlib.util.spec_from_file_location("t17_goal_media", module_path)
assert spec and spec.loader
media = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = media
spec.loader.exec_module(media)


def package(root: Path):
    root.mkdir()
    assets = [{"mediaId": f"goal-quiz-2026:{i:03d}:{variant}", "sha256": f"{i:064x}", "localFile": f"assets/{i:064x}.mp4"} for i in range(1, 100) for variant in ("blur", "clean")]
    questions = []
    for i in range(1, 100):
        source = {"id": f"goal-quiz-2026-{i:03d}", "category_id": "goals-2026", "category_title": "من سجل الهدف؟", "source_package": "fixture", "source_record_id": f"goal-{i:03d}", "mode": "trivia", "question": "من سجل هذا الهدف؟", "answer": f"لاعب {i}", "accepted_answers": [f"لاعب {i}", f"Player {i}"], "source_content_sha256": f"{i:064x}"}
        questions.append({"id": source["id"], "categoryId": "goals-2026", "headerAr": "من سجل الهدف؟", "promptAr": "من سجل هذا الهدف؟", "canonicalAnswer": f"لاعب {i}", "acceptedAnswers": source["accepted_answers"], "modality": "video", "status": "draft", "readOnly": True, "sourceMode": "trivia", "stagingState": "unsupported_mode:video", "media": {"type": "video", "promptMediaId": f"goal-quiz-2026:{i:03d}:blur", "answerMediaId": f"goal-quiz-2026:{i:03d}:clean"}, "importSource": source})
    registry = {"assetCount": 198, "manifestSha256": "registry", "assets": assets}
    document = {"questions": questions, "manifestSha256": "questions"}
    (root / "media-registry.json").write_text(json.dumps(registry), encoding="utf-8")
    (root / "questions.json").write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")


class ImportTests(unittest.TestCase):
    def test_private_alias_input_requires_a_complete_reviewed_goal_map(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            aliases = root / "aliases.json"
            aliases.write_text(json.dumps({"schemaVersion": 1, "package": "goal-quiz-2026", "aliases": [{"goal": 1, "arabicName": "لاعب اختبار"}]}), encoding="utf-8")
            with self.assertRaises(media.T17Error):
                media.load_arabic_aliases(aliases)
            aliases.write_text(json.dumps({"schemaVersion": 1, "package": "goal-quiz-2026", "aliases": [{"goal": value, "arabicName": f"لاعب {value}"} for value in range(1, 100)]}, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(media.load_arabic_aliases(aliases)[99], "لاعب 99")

    def test_dry_apply_rerun_preserves_existing_rows_and_timestamps(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); pkg = root / "package"; package(pkg)
            db_path = root / "db.sqlite"; report = root / "report"
            db = sqlite3.connect(db_path)
            db.execute("CREATE TABLE local_admin_drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)")
            db.execute("INSERT INTO local_admin_drafts VALUES (?,?,?)", ("user-row", '{"kept":true}', "2000-01-01T00:00:00Z")); db.commit(); db.close()
            dry = media.import_questions(pkg, db_path, report, False)
            self.assertEqual(dry["insertCount"], 99); self.assertEqual(dry["baseline"]["count"], 1)
            applied = media.import_questions(pkg, db_path, report, True)
            self.assertEqual(applied["insertCount"], 99); self.assertTrue((report / "local-admin-drafts-before.sqlite").is_file())
            db = sqlite3.connect(db_path); self.assertEqual(db.execute("SELECT COUNT(*) FROM local_admin_drafts").fetchone()[0], 100)
            self.assertEqual(db.execute("SELECT data,updated_at FROM local_admin_drafts WHERE id='user-row'").fetchone(), ('{"kept":true}', "2000-01-01T00:00:00Z")); db.close()
            rerun = media.import_questions(pkg, db_path, report, True)
            self.assertEqual(rerun["insertCount"], 0); self.assertEqual(rerun["alreadyPresentCount"], 99)

    def test_conflicting_stable_id_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); pkg = root / "package"; package(pkg); db_path = root / "db.sqlite"
            db = sqlite3.connect(db_path); db.execute("CREATE TABLE local_admin_drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)")
            db.execute("INSERT INTO local_admin_drafts VALUES (?,?,?)", ("goal-quiz-2026-001", "{}", "old")); db.commit(); db.close()
            with self.assertRaises(media.T17Error): media.import_questions(pkg, db_path, root / "report", False)
