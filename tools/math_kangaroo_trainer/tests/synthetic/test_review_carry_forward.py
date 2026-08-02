from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from math_kangaroo_trainer import cli as cli_module
from math_kangaroo_trainer.cli import main
from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.domain.reviews import DuplicateGoldReview, GoldReview
from math_kangaroo_trainer.storage import AuditRepository


def _alternate_ontology(tmp_path: Path) -> Path:
    document = json.loads(default_ontology_path().read_text(encoding="utf-8"))
    document["ontology_version"] = "0.1.0-proposed.carry-forward-test"
    path = tmp_path / "carry-forward-ontology.json"
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return path


def _build_reviewed_run_pair(
    synthetic_bank: Path, tmp_path: Path
) -> tuple[Path, Path, str, str, GoldReview, DuplicateGoldReview]:
    output = tmp_path / "carry-forward-audit"
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
                "73",
            ]
        )
        == 0
    )
    source_run_id = json.loads(
        (output / "quality-report.json").read_text(encoding="utf-8")
    )["run"]["run_id"]
    item_payload = json.loads(
        (output / "review-template.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    item_payload.update(
        {
            "reviewer_id": "reviewer-a",
            "question_boundary_verified": True,
            "choices_verified": True,
            "answer_key_verified": True,
            "diagram_verified": True,
            "source_metadata_verified": True,
            "disposition": "faithful",
            "notes": "reviewed before ontology publication",
            "reviewed_at": "2026-08-02T10:00:00-07:00",
        }
    )
    item_review = GoldReview.model_validate(item_payload)
    duplicate_payload = json.loads(
        (output / "duplicate-review-template.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
    )
    duplicate_payload.update(
        {
            "reviewer_id": "reviewer-a",
            "decision": "confirmed",
            "notes": "same question in two grade papers",
            "reviewed_at": "2026-08-02T10:05:00-07:00",
        }
    )
    duplicate_review = DuplicateGoldReview.model_validate(duplicate_payload)
    audit_db = output / "stage0-audit.sqlite3"
    repository = AuditRepository(audit_db)
    try:
        assert repository.import_reviews((item_review,)) == 1
        assert repository.import_duplicate_reviews((duplicate_review,)) == 1
    finally:
        repository.close()

    ontology = _alternate_ontology(tmp_path)
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
                "73",
                "--ontology",
                str(ontology),
            ]
        )
        == 0
    )
    target_run_id = json.loads(
        (output / "quality-report.json").read_text(encoding="utf-8")
    )["run"]["run_id"]
    assert source_run_id != target_run_id
    return (
        output,
        ontology,
        source_run_id,
        target_run_id,
        item_review,
        duplicate_review,
    )


def test_carry_forward_is_dry_run_first_atomic_and_idempotent(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    (
        output,
        ontology,
        source_run_id,
        target_run_id,
        item_review,
        duplicate_review,
    ) = _build_reviewed_run_pair(synthetic_bank, tmp_path)
    audit_db = output / "stage0-audit.sqlite3"
    dry_audit = tmp_path / "carry-forward-dry-run.json"
    base_args = [
        "stage0",
        "carry-forward-reviews",
        "--audit-db",
        str(audit_db),
        "--source-run-id",
        source_run_id,
        "--target-run-id",
        target_run_id,
        "--output",
        str(output),
        "--ontology",
        str(ontology),
    ]
    assert main([*base_args, "--audit-output", str(dry_audit)]) == 0
    dry_result = json.loads(dry_audit.read_text(encoding="utf-8"))
    assert dry_result["mode"] == "dry_run"
    assert dry_result["counts"]["item_reviews_eligible"] == 1
    assert dry_result["counts"]["duplicate_reviews_eligible"] == 1
    assert dry_result["target_quality_report"]["regenerated"] is False

    repository = AuditRepository(audit_db)
    try:
        assert repository.current_item_reviews(target_run_id) == []
        assert repository.current_duplicate_reviews(target_run_id) == []
        assert (
            repository.review_carry_forward_provenance(
                source_run_id=source_run_id, target_run_id=target_run_id
            )
            == []
        )
    finally:
        repository.close()

    apply_audit = tmp_path / "carry-forward-applied.json"
    assert main([*base_args, "--audit-output", str(apply_audit), "--apply"]) == 0
    applied = json.loads(apply_audit.read_text(encoding="utf-8"))
    assert applied["mode"] == "applied"
    assert applied["target_quality_report"]["regenerated"] is True
    assert applied["counts"]["item_reviews_eligible"] == 1
    assert applied["counts"]["duplicate_reviews_eligible"] == 1
    regenerated_report = json.loads(
        (output / "quality-report.json").read_text(encoding="utf-8")
    )
    assert regenerated_report["run"]["run_id"] == target_run_id
    assert regenerated_report["gold_review"]["review_state_counts"] == {
        "pending": 99,
        "singly_reviewed": 1,
    }

    repository = AuditRepository(audit_db)
    try:
        item = repository.current_item_reviews(target_run_id)[0]
        for field in (
            "content_version",
            "reviewer_slot",
            "reviewer_id",
            "question_boundary_verified",
            "choices_verified",
            "answer_key_verified",
            "diagram_verified",
            "source_metadata_verified",
            "disposition",
            "notes",
            "reviewed_at",
            "schema_version",
        ):
            expected = item_review.model_dump(mode="json")[field]
            if field.endswith("_verified"):
                expected = int(expected)
            if field == "reviewed_at":
                expected = "2026-08-02T17:00:00+00:00"
            assert item[field] == expected
        duplicate = repository.current_duplicate_reviews(target_run_id)[0]
        assert duplicate["reviewer_slot"] == duplicate_review.reviewer_slot
        assert duplicate["reviewer_id"] == duplicate_review.reviewer_id
        assert duplicate["decision"] == duplicate_review.decision.value
        assert duplicate["notes"] == duplicate_review.notes
        assert duplicate["reviewed_at"] == "2026-08-02T17:05:00+00:00"

        provenance = repository.review_carry_forward_provenance(
            source_run_id=source_run_id, target_run_id=target_run_id
        )
        assert len(provenance) == 2
        assert {row["evidence_kind"] for row in provenance} == {
            "item_review",
            "duplicate_review",
        }
        assert all(row["source_run_id"] == source_run_id for row in provenance)
        assert all(row["target_run_id"] == target_run_id for row in provenance)
        duplicate_provenance = next(
            row for row in provenance if row["evidence_kind"] == "duplicate_review"
        )
        assert duplicate_provenance["match"]["signature_type"] in {
            "exact_asset",
            "normalized_text",
        }
        assert len(duplicate_provenance["match"]["members"]) == 2
    finally:
        repository.close()

    idempotent_audit = tmp_path / "carry-forward-idempotent.json"
    assert main([*base_args, "--audit-output", str(idempotent_audit), "--apply"]) == 0
    idempotent = json.loads(idempotent_audit.read_text(encoding="utf-8"))
    assert idempotent["counts"]["item_reviews_eligible"] == 0
    assert idempotent["counts"]["duplicate_reviews_eligible"] == 0
    assert idempotent["counts"]["item_reviews_already_carried"] == 1
    assert idempotent["counts"]["duplicate_reviews_already_carried"] == 1

    with sqlite3.connect(audit_db) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM review_carry_forward_events"
            ).fetchone()[0]
            == 2
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM gold_review_history WHERE run_id = ?",
                (target_run_id,),
            ).fetchone()[0]
            == 1
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM duplicate_review_history WHERE run_id = ?",
                (target_run_id,),
            ).fetchone()[0]
            == 1
        )


def test_carry_forward_skips_content_and_duplicate_member_mismatches(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    (
        output,
        _,
        source_run_id,
        target_run_id,
        item_review,
        duplicate_review,
    ) = _build_reviewed_run_pair(synthetic_bank, tmp_path)
    audit_db = output / "stage0-audit.sqlite3"
    with sqlite3.connect(audit_db) as connection:
        connection.execute(
            "UPDATE audit_items SET content_version = ? "
            "WHERE run_id = ? AND item_id = ?",
            ("sha256:" + "f" * 64, target_run_id, item_review.item_id),
        )
        target_group_id = connection.execute(
            "SELECT group_id FROM duplicate_groups "
            "WHERE run_id = ? AND signature = ?",
            (target_run_id, duplicate_review.signature),
        ).fetchone()[0]
        duplicate_member = connection.execute(
            "SELECT item_id FROM duplicate_group_members WHERE group_id = ? "
            "ORDER BY item_id LIMIT 1",
            (target_group_id,),
        ).fetchone()[0]
        connection.execute(
            "UPDATE audit_items SET content_version = ? "
            "WHERE run_id = ? AND item_id = ?",
            ("sha256:" + "e" * 64, target_run_id, duplicate_member),
        )

    repository = AuditRepository(audit_db)
    try:
        result = repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
        )
        assert result["can_apply"] is True
        assert result["counts"]["item_reviews_skipped"] == 1
        assert result["item_reviews"]["skipped"][0]["reason"] == (
            "target_content_version_mismatch"
        )
        assert result["counts"]["duplicate_reviews_skipped"] == 1
        assert result["duplicate_reviews"]["skipped"][0]["reason"] == (
            "target_duplicate_member_content_mismatch"
        )
    finally:
        repository.close()


def test_carry_forward_rejects_same_run_stale_and_occupied_evidence(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    (
        output,
        _,
        source_run_id,
        target_run_id,
        item_review,
        _,
    ) = _build_reviewed_run_pair(synthetic_bank, tmp_path)
    audit_db = output / "stage0-audit.sqlite3"
    repository = AuditRepository(audit_db)
    try:
        with pytest.raises(ValueError, match="must be different"):
            repository.carry_forward_reviews(
                source_run_id=source_run_id, target_run_id=source_run_id
            )

        occupied = GoldReview.model_validate(
            {
                **item_review.model_dump(mode="json"),
                "run_id": target_run_id,
                "reviewer_id": "independent-target-reviewer",
                "notes": "target slot was reviewed independently",
                "reviewed_at": "2026-08-02T18:00:00+00:00",
            }
        )
        assert repository.import_reviews((occupied,)) == 1
        blocked = repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
            apply=True,
        )
        assert blocked["mode"] == "blocked"
        assert blocked["can_apply"] is False
        assert any(
            blocker["reason"] == "occupied_target_item_review"
            for blocker in blocked["blockers"]
        )
        assert repository.current_duplicate_reviews(target_run_id) == []
        assert (
            repository.review_carry_forward_provenance(
                source_run_id=source_run_id, target_run_id=target_run_id
            )
            == []
        )
    finally:
        repository.close()

    with sqlite3.connect(audit_db) as connection:
        connection.execute(
            "DELETE FROM gold_review_history WHERE run_id = ? AND item_id = ?",
            (source_run_id, item_review.item_id),
        )
    repository = AuditRepository(audit_db)
    try:
        stale = repository.carry_forward_reviews(
            source_run_id=source_run_id, target_run_id=target_run_id
        )
        assert any(
            blocker["reason"] == "missing_or_stale_source_item_history"
            for blocker in stale["blockers"]
        )
    finally:
        repository.close()


def test_carry_forward_verifies_target_history_and_preserves_later_corrections(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    (
        output,
        _,
        source_run_id,
        target_run_id,
        item_review,
        duplicate_review,
    ) = _build_reviewed_run_pair(synthetic_bank, tmp_path)
    audit_db = output / "stage0-audit.sqlite3"
    repository = AuditRepository(audit_db)
    try:
        applied = repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
            apply=True,
        )
        assert applied["can_apply"] is True
        target_item = repository.current_item_reviews(target_run_id)[0]
        target_duplicate = repository.current_duplicate_reviews(target_run_id)[0]
        item_correction = GoldReview.model_validate(
            {
                **target_item,
                "disposition": "needs_review",
                "notes": "later target-only correction",
                "reviewed_at": "2026-08-02T19:00:00+00:00",
            }
        )
        duplicate_correction = DuplicateGoldReview.model_validate(
            {
                **target_duplicate,
                "decision": "rejected",
                "notes": "later target-only correction",
                "reviewed_at": "2026-08-02T19:05:00+00:00",
            }
        )
        assert repository.import_reviews((item_correction,)) == 1
        assert repository.import_duplicate_reviews((duplicate_correction,)) == 1

        idempotent = repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
        )
        assert idempotent["can_apply"] is True
        assert idempotent["counts"]["item_reviews_already_carried"] == 1
        assert idempotent["counts"]["duplicate_reviews_already_carried"] == 1
        assert repository.current_item_reviews(target_run_id)[0]["notes"] == (
            "later target-only correction"
        )
        assert repository.current_duplicate_reviews(target_run_id)[0]["notes"] == (
            "later target-only correction"
        )

        provenance = repository.review_carry_forward_provenance(
            source_run_id=source_run_id, target_run_id=target_run_id
        )
        item_target_event_id = next(
            row["target_review_event_id"]
            for row in provenance
            if row["evidence_kind"] == "item_review"
        )
        duplicate_target_event_id = next(
            row["target_review_event_id"]
            for row in provenance
            if row["evidence_kind"] == "duplicate_review"
        )
    finally:
        repository.close()

    with sqlite3.connect(audit_db) as connection:
        connection.execute(
            "DELETE FROM gold_review_history WHERE review_event_id = ?",
            (item_target_event_id,),
        )
        connection.execute(
            "DELETE FROM duplicate_review_history WHERE review_event_id = ?",
            (duplicate_target_event_id,),
        )
    repository = AuditRepository(audit_db)
    try:
        damaged = repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
        )
        assert damaged["can_apply"] is False
        assert {blocker["reason"] for blocker in damaged["blockers"]} >= {
            "missing_or_stale_target_item_carry_history",
            "missing_or_stale_target_duplicate_carry_history",
        }
    finally:
        repository.close()


def test_carry_forward_supports_monotonic_source_revision_chains(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    (
        output,
        _,
        source_run_id,
        target_run_id,
        item_review,
        duplicate_review,
    ) = _build_reviewed_run_pair(synthetic_bank, tmp_path)
    audit_db = output / "stage0-audit.sqlite3"
    repository = AuditRepository(audit_db)
    try:
        assert repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
            apply=True,
        )["can_apply"]
        item_revision = GoldReview.model_validate(
            {
                **item_review.model_dump(mode="json"),
                "disposition": "needs_review",
                "notes": "source correction after first carry",
                "reviewed_at": "2026-08-02T20:00:00+00:00",
            }
        )
        duplicate_revision = DuplicateGoldReview.model_validate(
            {
                **duplicate_review.model_dump(mode="json"),
                "decision": "rejected",
                "notes": "source correction after first carry",
                "reviewed_at": "2026-08-02T20:05:00+00:00",
            }
        )
        assert repository.import_reviews((item_revision,)) == 1
        assert repository.import_duplicate_reviews((duplicate_revision,)) == 1

        revision_plan = repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
        )
        assert revision_plan["can_apply"] is True
        assert revision_plan["counts"]["item_reviews_eligible"] == 1
        assert revision_plan["counts"]["duplicate_reviews_eligible"] == 1
        assert repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
            apply=True,
        )["can_apply"]

        assert repository.current_item_reviews(target_run_id)[0]["notes"] == (
            "source correction after first carry"
        )
        assert repository.current_duplicate_reviews(target_run_id)[0]["notes"] == (
            "source correction after first carry"
        )
        provenance = repository.review_carry_forward_provenance(
            source_run_id=source_run_id, target_run_id=target_run_id
        )
        assert len(provenance) == 4
        idempotent = repository.carry_forward_reviews(
            source_run_id=source_run_id,
            target_run_id=target_run_id,
        )
        assert idempotent["counts"]["item_reviews_already_carried"] == 1
        assert idempotent["counts"]["duplicate_reviews_already_carried"] == 1
    finally:
        repository.close()


def test_cli_prevalidates_ontology_and_rolls_back_on_report_failure(
    synthetic_bank: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output, ontology, source_run_id, target_run_id, _, _ = _build_reviewed_run_pair(
        synthetic_bank, tmp_path
    )
    audit_db = output / "stage0-audit.sqlite3"
    base_args = [
        "stage0",
        "carry-forward-reviews",
        "--audit-db",
        str(audit_db),
        "--source-run-id",
        source_run_id,
        "--target-run-id",
        target_run_id,
        "--output",
        str(output),
        "--apply",
    ]
    with pytest.raises(SystemExit) as wrong_ontology:
        main(base_args)
    assert wrong_ontology.value.code == 2

    repository = AuditRepository(audit_db)
    try:
        assert repository.current_item_reviews(target_run_id) == []
        assert repository.current_duplicate_reviews(target_run_id) == []
    finally:
        repository.close()

    def fail_report_write(*_: object, **__: object) -> None:
        raise RuntimeError("synthetic report write failure")

    monkeypatch.setattr(cli_module, "write_quality_reports", fail_report_write)
    with pytest.raises(SystemExit) as report_failure:
        main([*base_args, "--ontology", str(ontology)])
    assert report_failure.value.code == 2

    repository = AuditRepository(audit_db)
    try:
        assert repository.current_item_reviews(target_run_id) == []
        assert repository.current_duplicate_reviews(target_run_id) == []
        assert repository.review_history_count(target_run_id) == 0
        assert repository.duplicate_review_history_count(target_run_id) == 0
        assert (
            repository.review_carry_forward_provenance(
                source_run_id=source_run_id, target_run_id=target_run_id
            )
            == []
        )
    finally:
        repository.close()


def test_report_publish_failure_restores_files_and_rolls_back_evidence(
    synthetic_bank: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output, ontology, source_run_id, target_run_id, _, _ = _build_reviewed_run_pair(
        synthetic_bank, tmp_path
    )
    audit_db = output / "stage0-audit.sqlite3"
    report_before = (output / "quality-report.json").read_bytes()
    summary_before = (output / "quality-summary.md").read_bytes()
    real_replace = Path.replace

    def fail_second_staged_replace(source: Path, target: Path) -> Path:
        if source.parent.name == "staged" and source.name == "quality-summary.md":
            raise OSError("synthetic second report replacement failure")
        return real_replace(source, target)

    monkeypatch.setattr(Path, "replace", fail_second_staged_replace)
    with pytest.raises(SystemExit) as failure:
        main(
            [
                "stage0",
                "carry-forward-reviews",
                "--audit-db",
                str(audit_db),
                "--source-run-id",
                source_run_id,
                "--target-run-id",
                target_run_id,
                "--output",
                str(output),
                "--ontology",
                str(ontology),
                "--apply",
            ]
        )
    assert failure.value.code == 2
    assert (output / "quality-report.json").read_bytes() == report_before
    assert (output / "quality-summary.md").read_bytes() == summary_before

    repository = AuditRepository(audit_db)
    try:
        assert repository.current_item_reviews(target_run_id) == []
        assert repository.current_duplicate_reviews(target_run_id) == []
        assert repository.review_history_count(target_run_id) == 0
        assert repository.duplicate_review_history_count(target_run_id) == 0
        assert (
            repository.review_carry_forward_provenance(
                source_run_id=source_run_id, target_run_id=target_run_id
            )
            == []
        )
    finally:
        repository.close()


def test_transaction_failure_after_publish_restores_reports(
    synthetic_bank: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output, ontology, source_run_id, target_run_id, _, _ = _build_reviewed_run_pair(
        synthetic_bank, tmp_path
    )
    audit_db = output / "stage0-audit.sqlite3"
    report_before = (output / "quality-report.json").read_bytes()
    summary_before = (output / "quality-summary.md").read_bytes()
    real_carry = AuditRepository.carry_forward_reviews

    def fail_before_transaction_commit(self: AuditRepository, **kwargs: object):
        callback = kwargs.get("before_commit")

        def publish_then_fail(repository: AuditRepository) -> None:
            assert callable(callback)
            callback(repository)
            raise RuntimeError("synthetic transaction commit failure")

        return real_carry(
            self,
            source_run_id=str(kwargs["source_run_id"]),
            target_run_id=str(kwargs["target_run_id"]),
            apply=bool(kwargs.get("apply")),
            before_commit=publish_then_fail,
        )

    monkeypatch.setattr(
        AuditRepository, "carry_forward_reviews", fail_before_transaction_commit
    )
    with pytest.raises(SystemExit) as failure:
        main(
            [
                "stage0",
                "carry-forward-reviews",
                "--audit-db",
                str(audit_db),
                "--source-run-id",
                source_run_id,
                "--target-run-id",
                target_run_id,
                "--output",
                str(output),
                "--ontology",
                str(ontology),
                "--apply",
            ]
        )
    assert failure.value.code == 2
    assert (output / "quality-report.json").read_bytes() == report_before
    assert (output / "quality-summary.md").read_bytes() == summary_before

    repository = AuditRepository(audit_db)
    try:
        assert repository.current_item_reviews(target_run_id) == []
        assert repository.current_duplicate_reviews(target_run_id) == []
        assert (
            repository.review_carry_forward_provenance(
                source_run_id=source_run_id, target_run_id=target_run_id
            )
            == []
        )
    finally:
        repository.close()
