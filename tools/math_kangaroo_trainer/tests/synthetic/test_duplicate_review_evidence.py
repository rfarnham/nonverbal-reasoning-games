from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from pydantic import ValidationError

from math_kangaroo_trainer.cli import main
from math_kangaroo_trainer.domain.reviews import DuplicateGoldReview
from math_kangaroo_trainer.storage import AuditRepository


def test_duplicate_reviews_are_signature_bound_and_append_only(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "duplicate-review-evidence"
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
            "23",
        ]
    ) == 0
    audit_db = output / "stage0-audit.sqlite3"
    payload = json.loads(
        (output / "duplicate-review-template.jsonl").read_text().splitlines()[0]
    )
    payload.update(
        {
            "reviewer_id": " duplicate-reviewer-a ",
            "decision": "confirmed",
            "notes": "initial synthetic adjudication",
            "reviewed_at": "2026-08-01T12:00:00+00:00",
        }
    )
    initial = DuplicateGoldReview.model_validate(payload)
    assert initial.reviewer_id == "duplicate-reviewer-a"

    with pytest.raises(ValidationError, match="unsupported duplicate-review schema"):
        DuplicateGoldReview.model_validate(
            {**payload, "schema_version": "duplicate-review.obsolete"}
        )
    with pytest.raises(ValidationError, match="explicit timezone"):
        DuplicateGoldReview.model_validate(
            {**payload, "reviewed_at": "2026-08-01T12:00:00"}
        )

    repository = AuditRepository(audit_db)
    try:
        wrong_signature = DuplicateGoldReview.model_validate(
            {**payload, "signature": "0" * 64}
        )
        with pytest.raises(ValueError, match="signature does not match"):
            repository.import_duplicate_reviews((wrong_signature,))

        assert repository.import_duplicate_reviews((initial,)) == 1
        assert repository.import_duplicate_reviews((initial,)) == 0
        correction = DuplicateGoldReview.model_validate(
            {
                **payload,
                "decision": "rejected",
                "notes": "later correction retains the first event",
                "reviewed_at": "2026-08-01T13:00:00+00:00",
            }
        )
        assert repository.import_duplicate_reviews((correction,)) == 1
        assert repository.duplicate_review_history_count(initial.run_id) == 2
        group = next(
            group
            for group in repository.duplicate_review_evidence(initial.run_id)
            if group["group_id"] == initial.group_id
        )
        assert len(group["reviews"]) == 1
        assert group["reviews"][0]["decision"] == "rejected"

        conflicting = DuplicateGoldReview.model_validate(
            {**correction.model_dump(mode="json"), "notes": "same instant conflict"}
        )
        with pytest.raises(ValueError, match="cannot share reviewed_at"):
            repository.import_duplicate_reviews((conflicting,))
        historical_conflict = DuplicateGoldReview.model_validate(
            {**initial.model_dump(mode="json"), "notes": "older instant conflict"}
        )
        with pytest.raises(ValueError, match="cannot share reviewed_at"):
            repository.import_duplicate_reviews((historical_conflict,))
    finally:
        repository.close()

    with sqlite3.connect(audit_db) as connection:
        decisions = connection.execute(
            """
            SELECT decision
            FROM duplicate_review_history
            WHERE run_id = ? AND group_id = ?
            ORDER BY reviewed_at
            """,
            (initial.run_id, initial.group_id),
        ).fetchall()
    assert [row[0] for row in decisions] == ["confirmed", "rejected"]
