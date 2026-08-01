from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from math_kangaroo_trainer.cli import main
from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.domain.skills import gold_set_checksum


EXTRACTION_STATUSES = (
    "indexed_complete_text",
    "indexed_visual_or_partial_text",
    "text-layer-verified",
    "text_layer_extracted",
    "ocr_extracted",
    "ocr-verified",
    "partial_visual_dependency",
    "manual_recovery_complete_text",
    "manual_visual_transcription",
    "manual_recovery_visual_or_partial_text",
    "manual_boundary_correction_complete_text",
    "manual_boundary_correction_visual_or_partial_text",
)
LANGUAGES = ("English and Greek", "English", "en", "de", "lt")
SOURCE_FAMILIES = ("Cyprus", "Pakistan", "Austria", "Canada", "Lithuania")
YEARS = (2001, 2008, 2016, 2022)
GRADES = ("1-2", "3-4", "5-6")
SECTIONS = ("3-point", "4-point", "5-point", "single", "A", "B")
CHOICE_COUNTS = (0, 2, 3, 4, 5)


def _schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE questions (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_label TEXT NOT NULL,
          source_family TEXT NOT NULL,
          corpus_group TEXT NOT NULL,
          year INTEGER NOT NULL,
          grade TEXT NOT NULL,
          paper_part TEXT NOT NULL,
          section TEXT,
          competition_level TEXT,
          question INTEGER NOT NULL,
          page INTEGER NOT NULL,
          end_page INTEGER NOT NULL,
          language TEXT NOT NULL,
          prompt_text TEXT NOT NULL,
          options_json TEXT NOT NULL,
          option_count INTEGER NOT NULL,
          english_prompt_text TEXT NOT NULL,
          english_options_json TEXT NOT NULL,
          english_helper_needed INTEGER NOT NULL,
          english_prompt_status TEXT NOT NULL,
          english_options_status TEXT NOT NULL,
          translation_source_language TEXT,
          translation_method TEXT,
          translation_review_status TEXT,
          translation_notes TEXT,
          extraction_status TEXT NOT NULL,
          visual_verified INTEGER NOT NULL,
          answer TEXT,
          answer_status TEXT NOT NULL,
          answer_source_label TEXT,
          answer_source_file TEXT,
          answer_source_url TEXT,
          answer_notes TEXT,
          notes TEXT,
          source_pdf_url TEXT,
          source_archive_url TEXT,
          source_pdf_sha256 TEXT NOT NULL,
          image TEXT NOT NULL,
          image_width INTEGER NOT NULL,
          image_height INTEGER NOT NULL,
          image_bytes INTEGER NOT NULL,
          crop_status TEXT NOT NULL,
          crop_top_points REAL NOT NULL,
          crop_bottom_points REAL,
          source_page_link TEXT NOT NULL,
          answer_source_link TEXT
        );
        CREATE TABLE sources (
          source TEXT PRIMARY KEY,
          source_family TEXT NOT NULL,
          source_label TEXT NOT NULL,
          years_json TEXT NOT NULL,
          grades_json TEXT NOT NULL,
          question_count INTEGER NOT NULL,
          page_count INTEGER NOT NULL,
          bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          official_pdf_url TEXT,
          official_archive_url TEXT,
          manifest_notes TEXT,
          pdf_link TEXT NOT NULL
        );
        """
    )


def build_synthetic_bank(root: Path, *, size: int = 120) -> Path:
    data_dir = root / "data"
    assets_dir = root / "report" / "assets" / "questions"
    data_dir.mkdir(parents=True)
    assets_dir.mkdir(parents=True)
    database = data_dir / "questions.sqlite3"
    with sqlite3.connect(database) as connection:
        _schema(connection)
        source_records: dict[str, dict[str, object]] = {}
        for index in range(size):
            item_id = f"invented-{index:03d}"
            choice_count = CHOICE_COUNTS[index % len(CHOICE_COUNTS)]
            choices = [f"choice {number} for item {index}" for number in range(choice_count)]
            prompt = f"Invented prompt {index}: count the imaginary tokens."
            if index in {20, 21}:
                prompt = "Invented duplicate prompt: arrange the imaginary tokens."
                choices = ["one", "two", "three", "four", "five"]
                choice_count = 5
            if index == 0:
                answer_status, answer = "official-void", None
            elif index == 1:
                answer_status, answer = "official-multiple", "A,C"
            elif index == 2:
                answer_status, answer = "unverified-no-published-key", None
            else:
                answer_status = "official-verified"
                answer = "A" if choice_count else "B"
            source_family = SOURCE_FAMILIES[index % len(SOURCE_FAMILIES)]
            language = LANGUAGES[index % len(LANGUAGES)]
            extraction = EXTRACTION_STATUSES[index % len(EXTRACTION_STATUSES)]
            asset_id = f"assets/questions/{item_id}.webp"
            asset_bytes = (
                b"same-invented-image" if index in {10, 11} else f"image-{index}".encode()
            )
            (root / "report" / asset_id).write_bytes(asset_bytes)
            source_name = f"{source_family.lower()}-{index % 7}.pdf"
            source_path = f"originals/{source_name}"
            source_pdf = root / "report" / "sources" / source_name
            source_pdf.parent.mkdir(parents=True, exist_ok=True)
            source_pdf_bytes = f"invented-pdf-{source_name}".encode()
            source_pdf.write_bytes(source_pdf_bytes)
            checksum = hashlib.sha256(source_pdf_bytes).hexdigest()
            source_record = source_records.setdefault(
                source_path,
                {
                    "source_family": source_family,
                    "years": set(),
                    "grades": set(),
                    "count": 0,
                    "bytes": len(source_pdf_bytes),
                    "sha256": checksum,
                    "pdf_link": f"sources/{source_name}",
                },
            )
            source_record["years"].add(YEARS[index % len(YEARS)])
            source_record["grades"].add(GRADES[index % len(GRADES)])
            source_record["count"] += 1
            values = (
                    item_id,
                    source_path,
                    f"Invented source {source_family}",
                    source_family,
                    source_family,
                    YEARS[index % len(YEARS)],
                    GRADES[index % len(GRADES)],
                    "single",
                    SECTIONS[index % len(SECTIONS)],
                    "",
                    index + 1,
                    index // 20 + 1,
                    index // 20 + 2 if index % 19 == 0 else index // 20 + 1,
                    language,
                    prompt,
                    json.dumps(choices),
                    choice_count,
                    f"English helper for item {index}" if index % 17 == 0 else "",
                    json.dumps(choices if index % 17 == 0 else []),
                    int(index % 17 == 0),
                    "translated" if index % 17 == 0 else "not-needed",
                    "translated" if index % 17 == 0 else "not-needed",
                    language if index % 17 == 0 else None,
                    "invented-human-review" if index % 17 == 0 else None,
                    "translated" if index % 17 == 0 else None,
                    "Invented translation note" if index % 17 == 0 else None,
                    extraction,
                    1,
                    answer,
                    answer_status,
                    "invented answer key",
                    "invented-answers.pdf",
                    "https://invalid.example.test/answers",
                    (
                        "Invented nonstandard answer note"
                        if answer_status != "official-verified"
                        else None
                    ),
                    (
                        "Prompt depends on an invented illustration."
                        if index % 11 == 0
                        else "Invented prompt and choices were visually verified."
                    ),
                    "https://invalid.example.test/questions.pdf",
                    "https://invalid.example.test/archive",
                    checksum,
                    asset_id,
                    100,
                    80,
                    len(asset_bytes),
                    "indexed",
                    float(index * 10),
                    float(index * 10 + 8),
                    f"questions.pdf#page={index // 20 + 1}",
                    "answers.pdf#page=1",
                )
            connection.execute(
                f"INSERT INTO questions VALUES ({','.join('?' for _ in values)})",
                values,
            )
        for source_path, record in source_records.items():
            connection.execute(
                "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    source_path,
                    record["source_family"],
                    f"Invented source {record['source_family']}",
                    json.dumps(sorted(record["years"])),
                    json.dumps(sorted(record["grades"])),
                    record["count"],
                    10,
                    record["bytes"],
                    record["sha256"],
                    "https://invalid.example.test/questions.pdf",
                    "https://invalid.example.test/archive",
                    "Invented source document for tests only.",
                    record["pdf_link"],
                ),
            )
    return database


@pytest.fixture()
def synthetic_bank(tmp_path: Path) -> Path:
    return build_synthetic_bank(tmp_path / "synthetic-bank")


@pytest.fixture()
def approved_ontology(tmp_path: Path, synthetic_bank: Path) -> Path:
    """Create explicit, synthetic two-person approval evidence for gate tests."""

    evidence_output = tmp_path / "ontology-evidence-audit"
    assert main(
        [
            "stage0",
            "build",
            "--source",
            str(synthetic_bank),
            "--output",
            str(evidence_output),
            "--sample-size",
            "100",
            "--seed",
            "7",
        ]
    ) == 0
    queue = [
        json.loads(line)
        for line in (evidence_output / "review-queue.jsonl").read_text().splitlines()
    ]
    item_content_versions = {
        record["item_id"]: record["content_version"] for record in queue
    }
    example_ids = list(item_content_versions)[:2]
    evidence_report = json.loads(
        (evidence_output / "quality-report.json").read_text(encoding="utf-8")
    )
    gold_checksum = gold_set_checksum(item_content_versions)

    document = json.loads(default_ontology_path().read_text(encoding="utf-8"))
    document.update(
        {
            "ontology_version": "0.1.0-approved.synthetic-test",
            "status": "approved",
            "review": {
                "state": "approved",
                "reviewers": [
                    "synthetic-ontology-reviewer-a",
                    "synthetic-ontology-reviewer-b",
                ],
                "reviewed_at": "2026-08-01T10:00:00+00:00",
                "approved_at": "2026-08-01T11:00:00+00:00",
            },
        }
    )
    document.setdefault("provenance", {})["gold_set_evidence"] = [
        {
            "evidence_id": "invented-stage0-gold-evidence",
            "gold_set_sha256": gold_checksum,
            "source_sha256": evidence_report["source"]["source_sha256"],
            "sample_item_content_versions": item_content_versions,
            "reviewers": [
                "synthetic-ontology-reviewer-a",
                "synthetic-ontology-reviewer-b",
            ],
            "reviewed_at": "2026-08-01T10:00:00+00:00",
        }
    ]
    skill_boundaries = {}
    for skill in document["skills"]:
        skill["status"] = "approved"
        skill["reviewers"] = [
            "synthetic-ontology-reviewer-a",
            "synthetic-ontology-reviewer-b",
        ]
        skill["positive_example_item_ids"] = [example_ids[0]]
        skill["negative_example_item_ids"] = [example_ids[1]]
        skill_boundaries[skill["skill_id"]] = {
            "positive_item_ids": [example_ids[0]],
            "negative_item_ids": [example_ids[1]],
        }
    document["provenance"]["item_annotation_evidence"] = [
        {
            "evidence_id": "invented-ontology-boundary-evidence",
            "gold_set_sha256": gold_checksum,
            "skill_boundaries": skill_boundaries,
            "item_content_versions": {
                item_id: item_content_versions[item_id] for item_id in example_ids
            },
            "reviewers": [
                "synthetic-ontology-reviewer-a",
                "synthetic-ontology-reviewer-b",
            ],
            "reviewed_at": "2026-08-01T10:30:00+00:00",
        }
    ]
    for relation in document["relations"]:
        relation["status"] = "approved"
        relation["reviewers"] = [
            "synthetic-ontology-reviewer-a",
            "synthetic-ontology-reviewer-b",
        ]

    path = tmp_path / "approved-ontology.synthetic.json"
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return path
