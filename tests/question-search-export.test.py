"""Exporter invariants. Run: python3 tests/question-search-export.test.py."""

import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from PIL import Image

SPEC = importlib.util.spec_from_file_location("question_search_export", Path(__file__).resolve().parents[1] / "scripts/export-question-search.py")
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.previous_root = exporter.ROOT
        exporter.ROOT = self.root

    def tearDown(self):
        exporter.ROOT = self.previous_root
        self.tmp.cleanup()

    def fixture_bank(self):
        bank = self.root / "bank"
        (bank / "data").mkdir(parents=True)
        (bank / "report/assets").mkdir(parents=True)
        Image.new("RGB", (40, 20), "white").save(bank / "report/assets/q.png")
        with sqlite3.connect(bank / "data/questions.sqlite3") as connection:
            connection.execute("CREATE TABLE questions (id TEXT, prompt_text TEXT, english_prompt_text TEXT, options_json TEXT, english_options_json TEXT, answer TEXT, answer_status TEXT, source_label TEXT, source_family TEXT, year INTEGER, grade TEXT, question INTEGER, language TEXT, image TEXT)")
            connection.execute("INSERT INTO questions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                "q1", "Zwei Kreise", "Two circles", '["eins", "zwei"]', '["one", "two"]', "", "unverified-no-published-key",
                "Example contributor@example.org", "Example", 2026, "1-2", 1, "de", "assets/q.png"))
        return bank

    def test_dhash_direction_and_padding(self):
        image = Image.new("L", (9, 8))
        image.putdata([255 - x * 24 for _ in range(8) for x in range(9)])
        path = self.root / "descending.png"
        image.save(path)
        record, asset = exporter.image_record(path)
        self.assertEqual(record["dhash"], "ffffffffffffffff")
        self.assertEqual(record["path"], f"assets/{record['hash']}.bin")
        self.assertEqual(asset["sha256"], record["hash"])
        image.putdata([x * 24 for _ in range(8) for x in range(9)])
        image.save(path)
        self.assertEqual(exporter.image_record(path)[0]["dhash"], "0000000000000000")

    def test_families_do_not_merge_different_diagrams_or_numbers(self):
        first = exporter.family_id("How many circles?", "image-a", "a")
        self.assertNotEqual(first, exporter.family_id("How many circles?", "image-b", "b"))
        self.assertEqual(first, exporter.family_id("  HOW many circles?  ", "image-a", "b"))
        self.assertNotEqual(exporter.family_id("Find 13", "image-a", "a"), exporter.family_id("Find 31", "image-a", "b"))

    def test_output_must_be_private_work_directory(self):
        with self.assertRaisesRegex(ValueError, "ignored work"):
            exporter.export_corpus(self.root, self.root / "bank", self.root / "public/search")

    def test_full_export_preserves_unknown_answers_and_versions_images(self):
        bank = self.fixture_bank()
        before = (bank / "data/questions.sqlite3").read_bytes()
        output = self.root / "work/build"
        first = exporter.export_corpus(self.root, bank, output, created_at="2026-01-01T00:00:00Z")
        corpus = json.loads((output / "corpus.json").read_text())
        question = corpus["questions"][0]
        self.assertIsNone(question["answer"])
        self.assertEqual(question["answerStatus"], "unverified-no-published-key")
        self.assertEqual(question["options"], ["one", "two"])
        self.assertEqual(question["originalOptions"], ["eins", "zwei"])
        self.assertNotIn("contributor@example.org", (output / "corpus.json").read_text())
        self.assertNotIn(str(bank), (output / "corpus.json").read_text())
        self.assertEqual(question["annotationStatus"], "unannotated")
        second = exporter.export_corpus(self.root, bank, output)
        self.assertEqual(first["version"], second["version"])
        Image.new("RGB", (40, 20), "black").save(bank / "report/assets/q.png")
        third = exporter.export_corpus(self.root, bank, output)
        self.assertNotEqual(first["version"], third["version"])
        self.assertEqual(before, (bank / "data/questions.sqlite3").read_bytes())

    def test_reviewed_annotation_overrides_need_evidence_and_known_ids(self):
        path = self.root / "annotations.jsonl"
        path.write_text(json.dumps({"id": "q1", "annotationStatus": "human-reviewed", "evidence": []}))
        with self.assertRaisesRegex(ValueError, "evidence"):
            exporter.load_overrides(path, {"q1"}, {"topics": {}, "strategies": {}})
        path.write_text(json.dumps({"id": "missing", "annotationStatus": "human-reviewed", "evidence": ["Original reviewed"]}))
        with self.assertRaisesRegex(ValueError, "unknown"):
            exporter.load_overrides(path, {"q1"}, {"topics": {}, "strategies": {}})

    def test_empty_translated_option_array_keeps_original_options(self):
        bank = self.fixture_bank()
        with sqlite3.connect(bank / "data/questions.sqlite3") as connection:
            connection.execute("UPDATE questions SET english_options_json = '[]'")
        output = self.root / "work/build"
        exporter.export_corpus(self.root, bank, output)
        corpus = json.loads((output / "corpus.json").read_text())
        self.assertEqual(corpus["questions"][0]["options"], ["eins", "zwei"])

    def test_image_mismatch_downgrades_reviewed_placement(self):
        annotation = exporter.annotation_for("q1", "circles", "new-image", {"NUM.quantities": {"label": "Counting", "definition": "Count objects"}}, {}, {}, {
            "q1": {"primaryTopic": "NUM.quantities", "strategies": [], "assetSha256": "old-image", "provenance": "reviewed plan"}})
        self.assertEqual(annotation["annotationStatus"], "agent-reviewed-source-variant")
        self.assertTrue(any("image differs" in value for value in annotation["evidence"]))


if __name__ == "__main__":
    unittest.main()
