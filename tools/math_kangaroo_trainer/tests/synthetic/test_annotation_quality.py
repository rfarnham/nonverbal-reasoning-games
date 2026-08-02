from __future__ import annotations

from datetime import datetime, timezone

import pytest

from math_kangaroo_trainer.domain.annotations import AnnotationPass, ErrorClass
from math_kangaroo_trainer.quality.annotation import (
    AnnotationCandidateProvenance,
    AnnotationEvaluationContext,
    AnnotationQualityCandidate,
    AnnotationQualityThresholds,
    DistractorQualityEvidence,
    GoldAnnotation,
    SolutionPathQualityEvidence,
    evaluate_annotation_quality,
    write_annotation_quality_reports,
)


VERSION_A = "sha256:" + "a" * 64
VERSION_B = "sha256:" + "b" * 64
REVIEWED_AT = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)
PATH_HASH_A = "1" * 64
PATH_HASH_B = "2" * 64


def provenance(
    *,
    run_id: str = "synthetic-annotation-run",
    provider_id: str = "offline-test-provider",
    model_id: str = "invented-model",
    prompt_suffix: str = "v1",
) -> AnnotationCandidateProvenance:
    return AnnotationCandidateProvenance(
        annotation_run_id=run_id,
        provider_id=provider_id,
        model_id=model_id,
        prompt_versions=tuple(
            (pass_name, f"{pass_name.value}.{prompt_suffix}")
            for pass_name in AnnotationPass
        ),
        pass_schema_versions=tuple(
            (pass_name, f"{pass_name.value}.schema.v1") for pass_name in AnnotationPass
        ),
        annotation_schema_version="annotation-bundle.synthetic.v1",
        ontology_version="ontology.synthetic.v1",
        ontology_sha256="f" * 64,
    )


def path_evidence(
    path_id: str,
    content_sha256: str,
    *,
    valid: bool = True,
    grade_appropriate: bool = True,
) -> SolutionPathQualityEvidence:
    return SolutionPathQualityEvidence(
        path_id=path_id,
        content_sha256=content_sha256,
        valid=valid,
        grade_appropriate=grade_appropriate,
    )


def distractor(choice_id: str, misconception_id: str) -> DistractorQualityEvidence:
    return DistractorQualityEvidence(
        choice_id=choice_id,
        misconception_id=misconception_id,
        error_class=ErrorClass.CONCEPTUAL,
    )


def synthetic_context() -> AnnotationEvaluationContext:
    return AnnotationEvaluationContext(
        execution_scope="synthetic",
        stage0_status="PENDING_REVIEW",
        ontology_review_ready=False,
        gold_set_id="invented-gold-set",
    )


def thresholds(*, minimum: int = 2) -> AnnotationQualityThresholds:
    return AnnotationQualityThresholds(
        version="synthetic-thresholds.v1",
        minimum_matched_gold_items=minimum,
        answer_agreement=0.9,
        primary_skill_precision=0.9,
        primary_skill_recall=0.9,
        solution_path_precision=0.9,
        prerequisite_precision=0.9,
        distractor_precision=0.9,
        family_precision=0.9,
        family_recall=0.9,
        difficulty_rank_correlation=0.9,
    )


def candidates() -> tuple[AnnotationQualityCandidate, ...]:
    return (
        AnnotationQualityCandidate(
            item_id="synthetic-a",
            content_version=VERSION_A,
            provenance=provenance(),
            candidate_answers=("A",),
            required_skill_ids=("skill-a",),
            solution_path_evidence=(path_evidence("path-a", PATH_HASH_A),),
            prerequisite_pairs=(("prerequisite-a", "skill-a"),),
            distractor_evidence=(distractor("B", "misconception-a"),),
            family_item_ids=("synthetic-b",),
            stratum_ids=("grade-1", "points-3"),
            difficulty_score=-1.0,
        ),
        AnnotationQualityCandidate(
            item_id="synthetic-b",
            content_version=VERSION_B,
            provenance=provenance(),
            candidate_answers=("C",),
            required_skill_ids=("skill-b",),
            solution_path_evidence=(path_evidence("path-b", PATH_HASH_B),),
            prerequisite_pairs=(("prerequisite-b", "skill-b"),),
            distractor_evidence=(distractor("D", "misconception-b"),),
            family_item_ids=("synthetic-a",),
            stratum_ids=("grade-2", "points-4"),
            difficulty_score=1.0,
        ),
    )


def gold() -> tuple[GoldAnnotation, ...]:
    return (
        GoldAnnotation(
            evidence_id="gold-synthetic-a",
            schema_version="gold-annotation.synthetic.v1",
            item_id="synthetic-a",
            content_version=VERSION_A,
            accepted_answers=("A",),
            primary_skill_ids=("skill-a",),
            solution_path_evidence=(path_evidence("path-a", PATH_HASH_A),),
            accepted_prerequisite_pairs=(("prerequisite-a", "skill-a"),),
            distractor_evidence=(distractor("B", "misconception-a"),),
            family_item_ids=("synthetic-b",),
            stratum_ids=("grade-1", "points-3"),
            difficulty_rank=1,
            reviewers=("reviewer-one", "reviewer-two"),
            reviewed_at=REVIEWED_AT,
        ),
        GoldAnnotation(
            evidence_id="gold-synthetic-b",
            schema_version="gold-annotation.synthetic.v1",
            item_id="synthetic-b",
            content_version=VERSION_B,
            accepted_answers=("C",),
            primary_skill_ids=("skill-b",),
            solution_path_evidence=(path_evidence("path-b", PATH_HASH_B),),
            accepted_prerequisite_pairs=(("prerequisite-b", "skill-b"),),
            distractor_evidence=(distractor("D", "misconception-b"),),
            family_item_ids=("synthetic-a",),
            stratum_ids=("grade-2", "points-4"),
            difficulty_rank=2,
            reviewers=("reviewer-one", "reviewer-two"),
            reviewed_at=REVIEWED_AT,
        ),
    )


def test_quality_report_passes_only_with_matched_independent_gold() -> None:
    report = evaluate_annotation_quality(
        candidates(), gold(), context=synthetic_context(), thresholds=thresholds()
    )

    assert report["status"] == "SYNTHETIC_METRICS_PASS"
    assert report["acceptance_authorized"] is False
    assert report["counts"]["matched_current_content_items"] == 2
    assert report["counts"]["stale_content_matches"] == 0
    assert all(metric["status"] == "PASS" for metric in report["metrics"].values())


def test_stale_content_is_excluded_and_cannot_satisfy_minimum_gold() -> None:
    stale_gold = list(gold())
    stale_gold[1] = stale_gold[1].model_copy(
        update={"content_version": "sha256:" + "c" * 64}
    )

    report = evaluate_annotation_quality(
        candidates(),
        stale_gold,
        context=synthetic_context(),
        thresholds=thresholds(),
    )

    assert report["status"] == "SYNTHETIC_INCOMPLETE_COVERAGE"
    assert report["counts"]["matched_current_content_items"] == 1
    assert report["counts"]["stale_content_matches"] == 1


def test_failed_claim_precision_remains_explicit() -> None:
    bad = list(candidates())
    bad[0] = bad[0].model_copy(
        update={
            "required_skill_ids": ("wrong-skill",),
            "prerequisite_pairs": (("wrong", "wrong-skill"),),
            "distractor_evidence": (distractor("A", "wrong-misconception"),),
            "family_item_ids": ("unrelated",),
        }
    )

    report = evaluate_annotation_quality(
        bad, gold(), context=synthetic_context(), thresholds=thresholds()
    )

    assert report["status"] == "SYNTHETIC_METRICS_NEED_REVIEW"
    assert "primary_skill_precision" in report["failed_metrics"]
    assert "prerequisite_precision" in report["failed_metrics"]
    assert "distractor_precision" in report["failed_metrics"]
    assert "family_precision" in report["failed_metrics"]


def test_answer_agreement_requires_the_exact_answer_set() -> None:
    overlapping = list(candidates())
    overlapping[0] = overlapping[0].model_copy(update={"candidate_answers": ("A", "B")})

    report = evaluate_annotation_quality(
        overlapping, gold(), context=synthetic_context(), thresholds=thresholds()
    )

    assert report["metrics"]["answer_agreement"]["value"] == 0.5
    assert report["metrics"]["answer_agreement"]["status"] == "FAIL"
    assert report["status"] == "SYNTHETIC_METRICS_NEED_REVIEW"


@pytest.mark.parametrize(
    "changed_path",
    (
        path_evidence("path-a", "3" * 64),
        path_evidence("path-a", PATH_HASH_A, valid=False),
        path_evidence("path-a", PATH_HASH_A, grade_appropriate=False),
        SolutionPathQualityEvidence(
            path_id="path-a",
            content_sha256=PATH_HASH_A,
            valid=None,
            grade_appropriate=True,
        ),
    ),
)
def test_solution_path_metric_compares_content_and_review_evidence(
    changed_path: SolutionPathQualityEvidence,
) -> None:
    changed = list(candidates())
    changed[0] = changed[0].model_copy(
        update={"solution_path_evidence": (changed_path,)}
    )

    report = evaluate_annotation_quality(
        changed, gold(), context=synthetic_context(), thresholds=thresholds()
    )

    assert report["metrics"]["solution_path_precision"]["value"] == 0.5
    assert report["metrics"]["solution_path_precision"]["status"] == "FAIL"


@pytest.mark.parametrize(
    "changed_distractor",
    (
        distractor("B", "different-misconception"),
        DistractorQualityEvidence(
            choice_id="B",
            misconception_id="misconception-a",
            error_class=ErrorClass.STRATEGY_SELECTION,
        ),
    ),
)
def test_distractor_metric_compares_choice_misconception_and_error_class(
    changed_distractor: DistractorQualityEvidence,
) -> None:
    changed = list(candidates())
    changed[0] = changed[0].model_copy(
        update={"distractor_evidence": (changed_distractor,)}
    )

    report = evaluate_annotation_quality(
        changed, gold(), context=synthetic_context(), thresholds=thresholds()
    )

    assert report["metrics"]["distractor_precision"]["value"] == 0.5
    assert report["metrics"]["distractor_precision"]["status"] == "FAIL"


def test_mixed_candidate_runs_are_blocked_even_when_metrics_pass() -> None:
    mixed = list(candidates())
    mixed[1] = mixed[1].model_copy(
        update={"provenance": provenance(run_id="different-run")}
    )

    report = evaluate_annotation_quality(
        mixed, gold(), context=synthetic_context(), thresholds=thresholds()
    )

    assert report["status"] == "SYNTHETIC_PROVENANCE_BLOCKED"
    assert report["candidate_provenance_coherent"] is False
    assert report["candidate_provenance_sha256"] is None
    assert all(metric["status"] == "PASS" for metric in report["metrics"].values())


def test_candidate_manifest_checksum_binds_candidate_content() -> None:
    original = evaluate_annotation_quality(
        candidates(), gold(), context=synthetic_context(), thresholds=thresholds()
    )
    changed = list(candidates())
    changed[0] = changed[0].model_copy(update={"difficulty_score": -2.0})
    revised = evaluate_annotation_quality(
        changed, gold(), context=synthetic_context(), thresholds=thresholds()
    )

    assert len(original["candidate_manifest_sha256"]) == 64
    assert original["candidate_manifest_sha256"] != revised["candidate_manifest_sha256"]


def test_unmatched_candidate_blocks_complete_coverage() -> None:
    report = evaluate_annotation_quality(
        candidates(),
        gold()[:1],
        context=synthetic_context(),
        thresholds=thresholds(minimum=1),
    )

    assert report["status"] == "SYNTHETIC_INCOMPLETE_COVERAGE"
    assert report["counts"]["unmatched_candidate_items"] == 1


def test_mismatched_strata_block_complete_coverage() -> None:
    mismatched_gold = list(gold())
    mismatched_gold[0] = mismatched_gold[0].model_copy(
        update={"stratum_ids": ("grade-9", "points-3")}
    )

    report = evaluate_annotation_quality(
        candidates(),
        mismatched_gold,
        context=synthetic_context(),
        thresholds=thresholds(),
    )

    assert report["status"] == "SYNTHETIC_INCOMPLETE_COVERAGE"
    assert report["counts"]["stratum_metadata_mismatches"] == 1


def test_gold_requires_two_distinct_reviewers() -> None:
    with pytest.raises(ValueError, match="independent reviewers"):
        GoldAnnotation(
            evidence_id="gold-synthetic-a",
            schema_version="gold-annotation.synthetic.v1",
            item_id="synthetic-a",
            content_version=VERSION_A,
            accepted_answers=("A",),
            primary_skill_ids=("skill-a",),
            solution_path_evidence=(path_evidence("path-a", PATH_HASH_A),),
            difficulty_rank=1,
            reviewers=("same-reviewer", "same-reviewer"),
            reviewed_at=REVIEWED_AT,
        )


def test_quality_reports_are_private_summaries(tmp_path) -> None:
    report = evaluate_annotation_quality(
        candidates(), gold(), context=synthetic_context(), thresholds=thresholds()
    )

    write_annotation_quality_reports(report, tmp_path)

    machine = (tmp_path / "stage1-quality-report.json").read_text(encoding="utf-8")
    summary = (tmp_path / "stage1-quality-summary.md").read_text(encoding="utf-8")
    assert '"status": "SYNTHETIC_METRICS_PASS"' in machine
    assert "Stage 1 annotation quality summary" in summary
    assert "question text" in summary
    assert "synthetic-a" not in machine
    assert "synthetic-a" not in summary
    assert "invented-gold-set" not in machine
    assert "invented-gold-set" not in summary
    assert "synthetic-annotation-run" not in machine
    assert "offline-test-provider" not in machine
    assert "gold_set_id" not in report
    assert len(report["gold_set_ref_sha256"]) == 64


def test_real_corpus_report_is_blocked_even_if_caller_claims_stage0_passed() -> None:
    report = evaluate_annotation_quality(
        candidates(),
        gold(),
        context=AnnotationEvaluationContext(
            execution_scope="real_corpus",
            stage0_status="PASS",
            ontology_review_ready=True,
            gold_set_id="invented-real-gate-check",
        ),
        thresholds=thresholds(),
    )

    assert report["status"] == "BLOCKED_STAGE0"
    assert report["acceptance_authorized"] is False
    assert report["metrics"]["answer_agreement"]["status"] == "PASS"


def test_stage0_status_metadata_rejects_arbitrary_caller_text() -> None:
    with pytest.raises(ValueError):
        AnnotationEvaluationContext(
            execution_scope="real_corpus",
            stage0_status="secret caller payload",  # type: ignore[arg-type]
            ontology_review_ready=True,
            gold_set_id="invented-real-gate-check",
        )
