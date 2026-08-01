from __future__ import annotations

import hashlib
import json
from pathlib import Path

from math_kangaroo_trainer.cli import main


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_stage0(source: Path, output: Path, *, ontology: Path | None = None) -> Path:
    arguments = [
        "stage0",
        "build",
        "--source",
        str(source),
        "--output",
        str(output),
        "--sample-size",
        "100",
        "--seed",
        "7",
    ]
    if ontology is not None:
        arguments.extend(("--ontology", str(ontology)))
    assert main(arguments) == 0
    return output / "stage0-audit.sqlite3"


def complete_item_reviews(
    audit_db: Path, output: Path, *, ontology: Path | None = None
) -> None:
    completed = output / "completed-reviews.jsonl"
    records = []
    for line in (output / "review-template.jsonl").read_text().splitlines():
        record = json.loads(line)
        record.update(
            {
                "reviewer_id": f"item-reviewer-{record['reviewer_slot']}",
                "question_boundary_verified": True,
                "choices_verified": True,
                "answer_key_verified": True,
                "diagram_verified": True,
                "source_metadata_verified": True,
                "disposition": "faithful",
                "reviewed_at": "2026-08-01T12:00:00+00:00",
            }
        )
        records.append(record)
    completed.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n",
        encoding="utf-8",
    )
    arguments = [
        "stage0",
        "import-reviews",
        "--audit-db",
        str(audit_db),
        "--input",
        str(completed),
        "--output",
        str(output),
    ]
    if ontology is not None:
        arguments.extend(("--ontology", str(ontology)))
    assert main(arguments) == 0


def complete_duplicate_reviews(
    audit_db: Path, output: Path, *, ontology: Path | None = None
) -> None:
    completed = output / "completed-duplicate-reviews.jsonl"
    records = []
    template = output / "duplicate-review-template.jsonl"
    assert template.is_file()
    for line in template.read_text().splitlines():
        record = json.loads(line)
        record.update(
            {
                "reviewer_id": f"duplicate-reviewer-{record['reviewer_slot']}",
                "decision": "confirmed",
                "reviewed_at": "2026-08-01T12:30:00+00:00",
            }
        )
        records.append(record)
    assert records
    completed.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n",
        encoding="utf-8",
    )
    arguments = [
        "stage0",
        "import-duplicate-reviews",
        "--audit-db",
        str(audit_db),
        "--input",
        str(completed),
        "--output",
        str(output),
    ]
    if ontology is not None:
        arguments.extend(("--ontology", str(ontology)))
    assert main(arguments) == 0


def load_report(output: Path) -> dict:
    return json.loads((output / "quality-report.json").read_text())


def test_proposed_ontology_cannot_pass_after_all_human_reviews(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "derived-audit"
    before = sha256(synthetic_bank)
    audit_db = build_stage0(synthetic_bank, output)
    assert sha256(synthetic_bank) == before
    assert audit_db.is_file() and audit_db != synthetic_bank

    report = load_report(output)
    assert report["exit_criterion"]["status"] == "PENDING_REVIEW"
    assert report["sample"]["size"] == 100
    assert report["sample"]["coverage_complete"] is True
    assert report["source"]["private_path_redacted"] is True
    assert report["content_gaps"]["counts"]["OFFICIAL_SOLUTION_NOT_AVAILABLE"] == 100
    assert report["content_gaps"]["counts"]["PUBLISHED_POINT_TIER_UNKNOWN"] > 0
    serialized_report = json.dumps(report)
    assert "Invented prompt" not in serialized_report
    assert "official_answer" not in serialized_report

    complete_item_reviews(audit_db, output)
    complete_duplicate_reviews(audit_db, output)
    pending = load_report(output)
    assert pending["gold_review"]["faithful_parsing_rate"] == 1.0
    assert pending["exit_criterion"]["full_double_review_complete"] is True
    assert pending["exit_criterion"]["ontology_review_complete"] is False
    assert pending["exit_criterion"]["status"] == "PENDING_ONTOLOGY_REVIEW"
    assert "ontology" in pending["exit_criterion"]["reason"].lower()


def test_approved_ontology_with_gold_evidence_reaches_pass(
    synthetic_bank: Path, approved_ontology: Path, tmp_path: Path
) -> None:
    output = tmp_path / "approved-derived-audit"
    audit_db = build_stage0(synthetic_bank, output, ontology=approved_ontology)
    complete_item_reviews(audit_db, output, ontology=approved_ontology)
    complete_duplicate_reviews(audit_db, output, ontology=approved_ontology)

    report = load_report(output)
    assert report["ontology"]["review_ready"] is True
    assert report["exit_criterion"]["ontology_matches_run"] is True
    assert report["exit_criterion"]["status"] == "PASS"
    assert report["gold_review"]["faithful_parsing_rate"] == 1.0
    summary = (output / "quality-summary.md").read_text()
    assert "**Exit status: `PASS`**" in summary
    assert "100 / 100" in summary
