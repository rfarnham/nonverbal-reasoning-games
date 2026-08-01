from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from math_kangaroo_trainer.cli import _require_private_output, main
from math_kangaroo_trainer.corpus.audit import import_question
from math_kangaroo_trainer.corpus.audit import modality
from math_kangaroo_trainer.corpus.sampling import (
    coverage_summary,
    select_stratified_sample,
)
from math_kangaroo_trainer.corpus.source_adapter import CompleteBankAdapter
from math_kangaroo_trainer.corpus.source_adapter import SourceSchemaError
from math_kangaroo_trainer.storage import migrate_audit_database


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def imported_items(database: Path):
    adapter = CompleteBankAdapter(database)
    return adapter, tuple(
        import_question(question, asset_path=adapter.asset_path(question))
        for question in adapter.iter_questions()
    )


def test_source_adapter_is_lossless_and_read_only(synthetic_bank: Path) -> None:
    before = digest(synthetic_bank)
    adapter = CompleteBankAdapter(synthetic_bank)
    adapter.validate()
    assert adapter.count() == 120
    questions = tuple(adapter.iter_questions())
    assert len(questions) == 120
    assert questions[20].choices == ("one", "two", "three", "four", "five")
    with adapter.connect() as connection, pytest.raises(sqlite3.OperationalError):
        connection.execute("UPDATE questions SET year = 2099")
    assert digest(synthetic_bank) == before


def test_source_database_cannot_be_mistaken_for_a_derived_store(
    synthetic_bank: Path,
) -> None:
    before = digest(synthetic_bank)
    with pytest.raises(ValueError, match="not a derived Stage 0 audit store"):
        migrate_audit_database(synthetic_bank, allow_create=True)
    assert digest(synthetic_bank) == before


def test_asset_references_cannot_escape_the_configured_root(
    synthetic_bank: Path,
) -> None:
    adapter = CompleteBankAdapter(synthetic_bank)
    question = next(adapter.iter_questions()).model_copy(
        update={"asset_id": "../../outside.webp"}
    )
    with pytest.raises(SourceSchemaError, match="escapes"):
        adapter.asset_path(question)


def test_sampling_is_deterministic_coverage_first_and_bounded(
    synthetic_bank: Path,
) -> None:
    _, items = imported_items(synthetic_bank)
    first = select_stratified_sample(items, sample_size=100, seed=42)
    second = select_stratified_sample(reversed(items), sample_size=100, seed=42)
    assert [item.source.item_id for item in first] == [
        item.source.item_id for item in second
    ]
    assert {item.protected.answer_status for item in first} >= {
        "official-void",
        "official-multiple",
    }
    coverage = coverage_summary(items, first)
    assert all(
        counts["sample"] > 0
        for dimension in coverage.values()
        for counts in dimension.values()
    )
    with pytest.raises(ValueError, match="between 100 and 200"):
        select_stratified_sample(items, sample_size=99, seed=42)
    with pytest.raises(ValueError, match="exceed population"):
        select_stratified_sample(items, sample_size=121, seed=42)


def test_malformed_option_payloads_are_auditable_warnings_not_adapter_aborts(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    # These two records are mandatory boundary cases, so their warnings must
    # remain visible in the sampled quality report as well as on the adapter.
    with sqlite3.connect(synthetic_bank) as connection:
        connection.execute(
            "UPDATE questions SET options_json = ? WHERE id = ?",
            ("{not-valid-json", "invented-000"),
        )
        connection.execute(
            "UPDATE questions SET option_count = ? WHERE id = ?",
            (5, "invented-001"),
        )

    adapter = CompleteBankAdapter(synthetic_bank)
    questions = {question.item_id: question for question in adapter.iter_questions()}
    assert "OPTIONS_JSON_INVALID_JSON" in questions[
        "invented-000"
    ].adapter_warning_codes
    assert "OPTION_COUNT_MISMATCH" in questions[
        "invented-001"
    ].adapter_warning_codes

    output = tmp_path / "malformed-derived-audit"
    assert (
        main(
            [
                "stage0",
                "build",
                "--source",
                str(synthetic_bank),
                "--output",
                str(output),
                "--sample-size",
                "100",
                "--seed",
                "9",
            ]
        )
        == 0
    )
    report = json.loads((output / "quality-report.json").read_text())
    assert report["parser"]["warning_counts"]["OPTIONS_JSON_INVALID_JSON"] == 1
    assert report["parser"]["warning_counts"]["OPTION_COUNT_MISMATCH"] >= 1


def test_asset_mutation_changes_the_deterministic_audit_run_identity(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    first_output = tmp_path / "first-derived-audit"
    second_output = tmp_path / "second-derived-audit"
    common = [
        "--source",
        str(synthetic_bank),
        "--sample-size",
        "100",
        "--seed",
        "11",
    ]
    assert main(["stage0", "build", *common, "--output", str(first_output)]) == 0
    first = json.loads((first_output / "quality-report.json").read_text())

    adapter = CompleteBankAdapter(synthetic_bank)
    question = next(
        question
        for question in adapter.iter_questions()
        if question.item_id == "invented-119"
    )
    adapter.asset_path(question).write_bytes(b"mutated-invented-image")

    assert main(["stage0", "build", *common, "--output", str(second_output)]) == 0
    second = json.loads((second_output / "quality-report.json").read_text())
    assert first["run"]["run_id"] != second["run"]["run_id"]
    assert (
        first["run"]["versions"]["corpus_snapshot_sha256"]
        != second["run"]["versions"]["corpus_snapshot_sha256"]
    )


def test_invalid_numeric_text_boolean_and_source_manifest_fields_are_explicit(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    with sqlite3.connect(synthetic_bank) as connection:
        connection.execute(
            """
            UPDATE questions
            SET year = ?, end_page = ?, grade = ?,
                english_helper_needed = ?, visual_verified = ?
            WHERE id = ?
            """,
            ("not-a-year", 0, "", "unexpected", "false", "invented-003"),
        )
        connection.execute(
            "UPDATE sources SET page_count = ? WHERE source = ?",
            ("not-a-page-count", "originals/cyprus-3.pdf"),
        )

    adapter = CompleteBankAdapter(synthetic_bank)
    questions, sources = adapter.snapshot()
    question = next(row for row in questions if row.item_id == "invented-003")
    assert {
        "YEAR_INVALID",
        "END_PAGE_INVALID",
        "GRADE_INVALID",
        "ENGLISH_HELPER_NEEDED_INVALID",
        "VISUAL_VERIFIED_NONCANONICAL",
    } <= set(question.adapter_warning_codes)
    assert {"year", "end_page", "grade"} <= set(question.adapter_field_errors)
    source = next(
        row for row in sources if row.source_path == "originals/cyprus-3.pdf"
    )
    assert "SOURCE_PAGE_COUNT_INVALID" in source.warning_codes

    output = tmp_path / "malformed-fields-audit"
    assert main(
        [
            "stage0",
            "build",
            "--source",
            str(synthetic_bank),
            "--output",
            str(output),
            "--sample-size",
            "100",
            "--seed",
            "29",
        ]
    ) == 0
    report = json.loads((output / "quality-report.json").read_text())
    assert report["exit_criterion"]["status"] == "FAIL"
    assert report["source"]["integrity_warning_counts"][
        "SOURCE_PAGE_COUNT_INVALID"
    ] == 1
    sampled = {
        json.loads(line)["item_id"]
        for line in (output / "review-queue.jsonl").read_text().splitlines()
    }
    assert "invented-003" in sampled


def test_whole_corpus_source_findings_gate_even_when_item_is_unsampled(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    baseline_output = tmp_path / "baseline-audit"
    assert main(
        [
            "stage0",
            "build",
            "--source",
            str(synthetic_bank),
            "--output",
            str(baseline_output),
            "--sample-size",
            "100",
            "--seed",
            "31",
        ]
    ) == 0
    sampled = {
        json.loads(line)["item_id"]
        for line in (baseline_output / "review-queue.jsonl").read_text().splitlines()
    }
    with sqlite3.connect(synthetic_bank) as connection:
        all_ids = [row[0] for row in connection.execute("SELECT id FROM questions")]
        unsampled_id = next(item_id for item_id in all_ids if item_id not in sampled)
        connection.execute(
            "UPDATE questions SET source = ? WHERE id = ?",
            ("originals/orphan-source.pdf", unsampled_id),
        )

    output = tmp_path / "orphan-source-audit"
    assert main(
        [
            "stage0",
            "build",
            "--source",
            str(synthetic_bank),
            "--output",
            str(output),
            "--sample-size",
            "100",
            "--seed",
            "31",
        ]
    ) == 0
    new_sample = {
        json.loads(line)["item_id"]
        for line in (output / "review-queue.jsonl").read_text().splitlines()
    }
    assert unsampled_id not in new_sample
    report = json.loads((output / "quality-report.json").read_text())
    assert report["source"]["integrity_warning_counts"][
        "SOURCE_DOCUMENT_NOT_IN_INVENTORY"
    ] == 1
    assert report["exit_criterion"]["source_integrity_passed"] is False
    assert report["exit_criterion"]["status"] == "FAIL"


def test_missing_population_finding_evidence_cannot_promote_a_legacy_run(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "legacy-evidence-audit"
    assert main(
        [
            "stage0",
            "build",
            "--source",
            str(synthetic_bank),
            "--output",
            str(output),
            "--sample-size",
            "100",
        ]
    ) == 0
    audit_db = output / "stage0-audit.sqlite3"
    with sqlite3.connect(audit_db) as connection:
        connection.execute("UPDATE audit_runs SET population_findings_json = '{}' ")
    assert main(
        [
            "stage0",
            "report",
            "--audit-db",
            str(audit_db),
            "--output",
            str(output),
        ]
    ) == 0
    report = json.loads((output / "quality-report.json").read_text())
    assert report["source"]["integrity_warning_counts"][
        "SOURCE_POPULATION_AUDIT_MISSING"
    ] == 1
    assert report["exit_criterion"]["status"] == "FAIL"


def test_clean_build_reports_are_byte_deterministic(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    outputs = [tmp_path / "deterministic-a", tmp_path / "deterministic-b"]
    for output in outputs:
        assert main(
            [
                "stage0",
                "build",
                "--source",
                str(synthetic_bank),
                "--output",
                str(output),
                "--sample-size",
                "100",
                "--seed",
                "37",
            ]
        ) == 0
    for filename in ("quality-report.json", "quality-summary.md"):
        assert (outputs[0] / filename).read_bytes() == (
            outputs[1] / filename
        ).read_bytes()


def test_possible_diagram_language_uses_the_conservative_middle_state(
    synthetic_bank: Path,
) -> None:
    adapter = CompleteBankAdapter(synthetic_bank)
    question = next(adapter.iter_questions())
    possible = question.model_copy(
        update={
            "stem_markdown": "Which picture completes the pattern?",
            "english_stem": "",
            "source_notes": None,
            "extraction_status": "indexed_complete_text",
            "option_count": 5,
        }
    )
    assert modality(possible) == "diagram_review_required"
    definite = possible.model_copy(
        update={"source_notes": "Answer choices are image-only and graphical."}
    )
    assert modality(definite) == "diagram_dependent"


def test_private_output_guard_uses_the_target_even_from_outside_the_repository(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = tmp_path / "invented-repository"
    (repository / ".git").mkdir(parents=True)
    outside = tmp_path / "outside-working-directory"
    outside.mkdir()
    monkeypatch.chdir(outside)

    with pytest.raises(ValueError, match="must stay below work"):
        _require_private_output(repository / "public-audit")
    _require_private_output(repository / "work" / "private-audit")
