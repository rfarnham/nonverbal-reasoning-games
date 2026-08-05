from __future__ import annotations

from math_kangaroo_trainer.curriculum.recommendations import (
    CandidateEvidence,
    RecommendationContext,
    preview_recommendations,
)


def candidate(item_id: str, **updates: object) -> CandidateEvidence:
    values: dict[str, object] = {
        "item_id": item_id,
        "content_version": f"sha256:{item_id}",
        "grade_band": "3-4",
        "published_point_tier": 4,
        "skill_ids": ("cnt_parity",),
        "representation_ids": ("rep_story_text",),
        "question_type": "word_problem",
        "parser_ready": True,
        "answer_ready": True,
        "playable_choices_ready": True,
    }
    values.update(updates)
    return CandidateEvidence.model_validate(values)


def context(**updates: object) -> RecommendationContext:
    values: dict[str, object] = {
        "target_skill_id": "cnt_parity",
        "grade_band": "3-4",
        "mastery": 0.55,
        "uncertainty": 0.7,
        "mode": "practice",
        "seed": 17,
    }
    values.update(updates)
    return RecommendationContext.model_validate(values)


def test_preview_is_reproducible_explainable_and_non_authoritative() -> None:
    candidates = [candidate("a"), candidate("b", published_point_tier=3)]
    first = preview_recommendations(context(), candidates)
    second = preview_recommendations(context(), list(reversed(candidates)))
    assert first == second
    assert first.authoritative is False
    assert first.learner_model_used is False
    assert first.slate
    assert "PROPOSAL_ONLY_Q_MATRIX" in first.warnings
    assert "learnability" in first.slate[0].components
    assert "approximate_selection_propensity" not in first.slate[0].model_dump()


def test_hard_eligibility_gates_are_not_hidden_in_score() -> None:
    result = preview_recommendations(
        context(),
        [
            candidate("wrong-grade", grade_band="5-6"),
            candidate("no-answer", answer_ready=False),
            candidate("no-skill", skill_ids=("cnt_area",)),
            candidate("eligible"),
        ],
    )
    reasons = {entry.item_id: set(entry.reasons) for entry in result.excluded}
    assert "GRADE_BAND_MISMATCH" in reasons["wrong-grade"]
    assert "AUTHORITATIVE_SINGLE_ANSWER_REQUIRED" in reasons["no-answer"]
    assert "TARGET_SKILL_NOT_MAPPED" in reasons["no-skill"]


def test_reviewed_only_returns_content_gap_instead_of_substituting_similarity() -> None:
    result = preview_recommendations(
        context(evidence_mode="reviewed_only"),
        [candidate("proposal")],
    )
    assert result.content_gap is True
    assert "CONTENT_GAP" in result.warnings
    assert not result.slate
    assert result.content_gap_reason
    assert result.excluded[0].reasons == ("CURRICULUM_APPROVAL_REQUIRED",)


def test_recent_items_and_families_are_excluded() -> None:
    result = preview_recommendations(
        context(recent_item_ids=("same-item",), target_item_id="target-item"),
        [
            candidate("same-item"),
            candidate("same-family", same_family_as_recent=True),
            candidate(
                "same-exact-duplicate",
                same_exact_duplicate_group_as_recent=True,
            ),
            candidate("target-item"),
        ],
    )
    reasons = {entry.item_id: set(entry.reasons) for entry in result.excluded}
    assert "RECENT_ITEM_REPEAT" in reasons["same-item"]
    assert "RECENT_FAMILY_REPEAT" in reasons["same-family"]
    assert "RECENT_EXACT_DUPLICATE_GROUP" in reasons["same-exact-duplicate"]
    assert "TARGET_ITEM_REPEAT" in reasons["target-item"]


def test_teacher_disposition_and_required_assets_are_hard_gates() -> None:
    result = preview_recommendations(
        context(),
        [
            candidate(
                "needs-correction",
                classification_source="teacher",
                teacher_disposition="needs_review",
            ),
            candidate(
                "excluded",
                classification_source="teacher",
                teacher_disposition="rejected",
            ),
            candidate("missing-asset", required_asset_ready=False),
            candidate("eligible"),
        ],
    )
    reasons = {entry.item_id: set(entry.reasons) for entry in result.excluded}
    assert "TEACHER_REVIEW_NEEDS_CORRECTION" in reasons["needs-correction"]
    assert "TEACHER_REVIEW_EXCLUDED" in reasons["excluded"]
    assert "REQUIRED_ASSET_INCOMPLETE" in reasons["missing-asset"]
    assert [entry.item_id for entry in result.slate] == ["eligible"]


def test_teacher_classification_provenance_is_not_curriculum_approval() -> None:
    teacher_only = candidate(
        "teacher-only",
        classification_source="teacher",
        teacher_disposition="faithful",
    )
    proposal_preview = preview_recommendations(context(), [teacher_only])
    selected = proposal_preview.slate[0]
    assert selected.classification_source == "teacher"
    assert selected.curriculum_approved is False
    assert selected.evidence_status == "teacher_classification"
    assert "TEACHER_CLASSIFICATION" in selected.reasons
    assert "CURRICULUM_APPROVED" not in selected.reasons

    approved = candidate(
        "approved",
        classification_source="teacher",
        curriculum_approved=True,
        teacher_disposition="faithful",
    )
    reviewed_preview = preview_recommendations(
        context(evidence_mode="reviewed_only"),
        [teacher_only, approved],
    )
    assert [entry.item_id for entry in reviewed_preview.slate] == ["approved"]
    assert reviewed_preview.slate[0].evidence_status == "curriculum_approved"
    assert reviewed_preview.slate[0].curriculum_approved is True
    excluded = {entry.item_id: entry.reasons for entry in reviewed_preview.excluded}
    assert excluded["teacher-only"] == ("CURRICULUM_APPROVAL_REQUIRED",)


def test_diversity_constraint_returns_honest_short_slate() -> None:
    result = preview_recommendations(
        context(slate_size=5),
        [candidate(f"same-{index}") for index in range(5)],
    )
    assert len(result.slate) == 2
    assert "SLATE_SHORT_DIVERSITY_CONSTRAINT" in result.warnings
    assert len({entry.item_id for entry in result.slate}) == 2


def test_slate_never_repeats_family_or_exact_duplicate_group() -> None:
    candidates = [
        candidate(
            "family-a-1",
            family_id="family-a",
            representation_ids=("rep-a",),
            question_type="type-a",
        ),
        candidate(
            "family-a-2",
            family_id="family-a",
            representation_ids=("rep-b",),
            question_type="type-b",
        ),
        candidate(
            "duplicate-1",
            exact_duplicate_group_ids=("duplicate-group",),
            representation_ids=("rep-c",),
            question_type="type-c",
        ),
        candidate(
            "duplicate-2",
            exact_duplicate_group_ids=("duplicate-group",),
            representation_ids=("rep-d",),
            question_type="type-d",
        ),
        candidate(
            "independent",
            family_id="family-b",
            exact_duplicate_group_ids=("other-duplicate-group",),
            representation_ids=("rep-e",),
            question_type="type-e",
        ),
    ]
    by_id = {entry.item_id: entry for entry in candidates}

    result = preview_recommendations(context(slate_size=5), candidates)

    selected = [by_id[entry.item_id] for entry in result.slate]
    selected_families = [entry.family_id for entry in selected if entry.family_id]
    selected_duplicate_groups = [
        group_id for entry in selected for group_id in entry.exact_duplicate_group_ids
    ]
    assert len(result.slate) == 3
    assert len(selected_families) == len(set(selected_families))
    assert len(selected_duplicate_groups) == len(set(selected_duplicate_groups))
    assert "SLATE_SHORT_DIVERSITY_CONSTRAINT" in result.warnings


def test_transfer_and_remediation_prefer_different_surface_distances() -> None:
    candidates = [
        candidate("near", target_surface_similarity=0.82),
        candidate("far", target_surface_similarity=0.25),
    ]
    remediation = preview_recommendations(context(mode="remediation"), candidates)
    transfer = preview_recommendations(context(mode="transfer"), candidates)
    assert remediation.slate[0].item_id == "near"
    assert transfer.slate[0].item_id == "far"
