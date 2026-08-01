from __future__ import annotations

import json
from pathlib import Path

from math_kangaroo_trainer.cli import main
from math_kangaroo_trainer.corpus.audit import import_question
from math_kangaroo_trainer.corpus.duplicates import exact_duplicate_groups
from math_kangaroo_trainer.corpus.source_adapter import CompleteBankAdapter
from math_kangaroo_trainer.domain.items import learner_safe_payload


def test_exact_duplicates_require_real_text_or_exact_asset(synthetic_bank: Path) -> None:
    adapter = CompleteBankAdapter(synthetic_bank)
    items = tuple(
        import_question(question, asset_path=adapter.asset_path(question))
        for question in adapter.iter_questions()
    )
    paths = {item.source.item_id: adapter.asset_path(item.source) for item in items}
    groups = exact_duplicate_groups(items, asset_paths=paths)
    signatures = {(group.signature_type, group.item_ids) for group in groups}
    assert ("normalized_text", ("invented-020", "invented-021")) in signatures
    assert ("exact_asset", ("invented-010", "invented-011")) in signatures
    assert all(len(group.item_ids) >= 2 for group in groups)


def test_learner_safe_shape_cannot_emit_protected_fields(synthetic_bank: Path) -> None:
    adapter = CompleteBankAdapter(synthetic_bank)
    question = next(adapter.iter_questions())
    item = import_question(question, asset_path=adapter.asset_path(question))
    payload = learner_safe_payload(item)
    forbidden = {"official_answer", "answer", "answer_status", "solution"}

    def keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                yield key
                yield from keys(child)
        elif isinstance(value, list):
            for child in value:
                yield from keys(child)

    assert forbidden.isdisjoint(keys(payload))
    assert "protected" not in payload


def test_every_exact_duplicate_candidate_is_forced_into_the_gold_sample(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "duplicate-derived-audit"
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
                "13",
            ]
        )
        == 0
    )
    report = json.loads((output / "quality-report.json").read_text())
    candidate_ids = {
        item_id
        for group in report["exact_duplicates"]["groups"]
        for item_id in group["item_ids"]
    }
    sampled_ids = {
        json.loads(line)["item_id"]
        for line in (output / "review-queue.jsonl").read_text().splitlines()
    }
    assert candidate_ids == {
        "invented-010",
        "invented-011",
        "invented-020",
        "invented-021",
    }
    assert candidate_ids <= sampled_ids
