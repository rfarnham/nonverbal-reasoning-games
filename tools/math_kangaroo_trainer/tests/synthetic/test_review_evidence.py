from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from pydantic import ValidationError

from math_kangaroo_trainer.cli import main
from math_kangaroo_trainer.domain.reviews import GoldReview
from math_kangaroo_trainer.storage import AuditRepository


def valid_review_payload(output: Path) -> dict:
    payload = json.loads(
        (output / "review-template.jsonl").read_text().splitlines()[0]
    )
    payload.update(
        {
            "reviewer_id": "synthetic-corpus-reviewer-a",
            "question_boundary_verified": True,
            "choices_verified": True,
            "answer_key_verified": True,
            "diagram_verified": True,
            "source_metadata_verified": True,
            "disposition": "faithful",
            "notes": "initial synthetic review",
            "reviewed_at": "2026-08-01T12:00:00+00:00",
        }
    )
    return payload


def test_review_evidence_is_version_bound_and_corrections_are_append_only(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "review-evidence-derived-audit"
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
                "17",
            ]
        )
        == 0
    )
    audit_db = output / "stage0-audit.sqlite3"
    payload = valid_review_payload(output)

    wrong_schema = {**payload, "schema_version": "gold-review.obsolete"}
    with pytest.raises(ValidationError, match="unsupported review schema"):
        GoldReview.model_validate(wrong_schema)

    missing_timezone = {**payload, "reviewed_at": "2026-08-01T12:00:00"}
    with pytest.raises(ValidationError, match="explicit timezone"):
        GoldReview.model_validate(missing_timezone)

    initial = GoldReview.model_validate(payload)
    repository = AuditRepository(audit_db)
    try:
        wrong_content = GoldReview.model_validate(
            {**payload, "content_version": "sha256:" + "0" * 64}
        )
        with pytest.raises(ValueError, match="content version does not match"):
            repository.import_reviews((wrong_content,))

        assert repository.import_reviews((initial,)) == 1
        assert repository.import_reviews((initial,)) == 0

        correction_payload = {
            **payload,
            "disposition": "needs_review",
            "notes": "later correction keeps the first event",
            "reviewed_at": "2026-08-01T13:00:00+00:00",
        }
        correction = GoldReview.model_validate(correction_payload)
        assert repository.import_reviews((correction,)) == 1
        assert repository.review_history_count(initial.run_id) == 2

        evidence = next(
            row
            for row in repository.review_evidence(initial.run_id)
            if row["item_id"] == initial.item_id
        )
        assert len(evidence["reviews"]) == 1
        assert evidence["reviews"][0]["disposition"] == "needs_review"

        same_timestamp_conflict = GoldReview.model_validate(
            {**correction_payload, "notes": "conflicting payload at the same instant"}
        )
        with pytest.raises(ValueError, match="cannot share reviewed_at"):
            repository.import_reviews((same_timestamp_conflict,))
        historical_timestamp_conflict = GoldReview.model_validate(
            {**payload, "notes": "conflict with an older retained event"}
        )
        with pytest.raises(ValueError, match="cannot share reviewed_at"):
            repository.import_reviews((historical_timestamp_conflict,))
        assert repository.review_history_count(initial.run_id) == 2
    finally:
        repository.close()

    with sqlite3.connect(audit_db) as connection:
        history = connection.execute(
            """
            SELECT disposition, payload_json
            FROM gold_review_history
            WHERE run_id = ? AND item_id = ?
            ORDER BY reviewed_at
            """,
            (initial.run_id, initial.item_id),
        ).fetchall()
    assert [row[0] for row in history] == ["faithful", "needs_review"]
    assert len({row[1] for row in history}) == 2


def test_reviewer_identity_is_trimmed_and_blank_identity_is_rejected(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "reviewer-identity-derived-audit"
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
    payload = valid_review_payload(output)
    normalized = GoldReview.model_validate({**payload, "reviewer_id": " reviewer-a "})
    assert normalized.reviewer_id == "reviewer-a"
    with pytest.raises(ValidationError, match="cannot be blank"):
        GoldReview.model_validate({**payload, "reviewer_id": "   "})
