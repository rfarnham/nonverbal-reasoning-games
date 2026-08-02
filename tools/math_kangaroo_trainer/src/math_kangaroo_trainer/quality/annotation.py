"""Gold-set metrics for proposed Stage 1 annotations.

The evaluator is corpus-agnostic and can be exercised entirely with invented
fixtures.  It reports synthetic metric evidence only.  Real-corpus acceptance
remains blocked until this evaluator is bound to immutable Stage 0 evidence.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from math import sqrt
from pathlib import Path
from typing import Any, Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from math_kangaroo_trainer.domain.annotations import (
    AnnotationBundle,
    AnnotationPass,
    ErrorClass,
    SkillRole,
    canonical_sha256,
)
from math_kangaroo_trainer.versions import (
    ANNOTATION_CANDIDATE_MANIFEST_VERSION,
    ANNOTATION_QUALITY_REPORT_VERSION,
    ANNOTATION_QUALITY_THRESHOLDS_VERSION,
)


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AnnotationCandidateProvenance(StrictFrozenModel):
    """One immutable multi-pass annotation configuration.

    A four-pass run legitimately has one prompt and output-schema version per
    pass.  Keeping those complete manifests here prevents a quality cohort
    from silently mixing runs or changing one pass configuration midstream.
    """

    annotation_run_id: str = Field(min_length=1)
    provider_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    prompt_versions: tuple[tuple[AnnotationPass, str], ...] = Field(min_length=4)
    pass_schema_versions: tuple[tuple[AnnotationPass, str], ...] = Field(min_length=4)
    annotation_schema_version: str = Field(min_length=1)
    ontology_version: str = Field(min_length=1)
    ontology_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("prompt_versions", "pass_schema_versions")
    @classmethod
    def manifests_have_canonical_order(
        cls, value: tuple[tuple[AnnotationPass, str], ...]
    ) -> tuple[tuple[AnnotationPass, str], ...]:
        return tuple(sorted(value, key=lambda entry: entry[0].value))

    @model_validator(mode="after")
    def every_pass_has_one_version(self) -> "AnnotationCandidateProvenance":
        expected = set(AnnotationPass)
        for label, entries in (
            ("prompt", self.prompt_versions),
            ("pass schema", self.pass_schema_versions),
        ):
            pass_names = [pass_name for pass_name, _ in entries]
            versions = [version for _, version in entries]
            if set(pass_names) != expected or len(pass_names) != len(expected):
                raise ValueError(
                    f"{label} manifest must version every pass exactly once"
                )
            if any(not version.strip() for version in versions):
                raise ValueError(f"{label} versions cannot be blank")
        return self


class SolutionPathQualityEvidence(StrictFrozenModel):
    path_id: str = Field(min_length=1)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    valid: bool | None
    grade_appropriate: bool | None


class DistractorQualityEvidence(StrictFrozenModel):
    choice_id: str = Field(min_length=1)
    misconception_id: str = Field(min_length=1)
    error_class: ErrorClass

    @model_validator(mode="after")
    def diagnostic_evidence_cannot_be_unknown(self) -> "DistractorQualityEvidence":
        if self.error_class is ErrorClass.UNKNOWN:
            raise ValueError(
                "diagnostic distractor evidence cannot use unknown error class"
            )
        return self


class AnnotationQualityCandidate(StrictFrozenModel):
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    provenance: AnnotationCandidateProvenance
    candidate_answers: tuple[str, ...] = Field(min_length=1)
    required_skill_ids: tuple[str, ...] = Field(min_length=1)
    solution_path_evidence: tuple[SolutionPathQualityEvidence, ...] = Field(
        min_length=1
    )
    prerequisite_pairs: tuple[tuple[str, str], ...] = ()
    distractor_evidence: tuple[DistractorQualityEvidence, ...] = ()
    family_item_ids: tuple[str, ...] = ()
    stratum_ids: tuple[str, ...] = ()
    difficulty_score: float = Field(ge=-8, le=8)

    @model_validator(mode="after")
    def candidate_evidence_is_unambiguous(self) -> "AnnotationQualityCandidate":
        if any(not answer.strip() for answer in self.candidate_answers):
            raise ValueError("candidate answers cannot be blank")
        if len(set(self.candidate_answers)) != len(self.candidate_answers):
            raise ValueError("candidate answers must be unique")
        path_ids = [evidence.path_id for evidence in self.solution_path_evidence]
        if len(set(path_ids)) != len(path_ids):
            raise ValueError("candidate solution-path evidence must be unique by path")
        choices = [evidence.choice_id for evidence in self.distractor_evidence]
        if len(set(choices)) != len(choices):
            raise ValueError("candidate distractor evidence must be unique by choice")
        if any(not stratum.strip() for stratum in self.stratum_ids):
            raise ValueError("candidate strata cannot be blank")
        if len(set(self.stratum_ids)) != len(self.stratum_ids):
            raise ValueError("candidate strata must be unique")
        return self

    @classmethod
    def from_bundle(
        cls, bundle: AnnotationBundle, *, stratum_ids: Iterable[str] = ()
    ) -> "AnnotationQualityCandidate":
        outputs = (
            bundle.independent_solve,
            bundle.verification,
            bundle.cognitive,
            bundle.critic,
        )
        pass_provenance = tuple(output.provenance for output in outputs)
        cohort_fields = (
            "annotation_run_id",
            "provider_id",
            "model_id",
        )
        for field_name in cohort_fields:
            if len({getattr(value, field_name) for value in pass_provenance}) != 1:
                raise ValueError(
                    f"annotation bundle mixes {field_name.replace('_', ' ')} values"
                )
        provenance = AnnotationCandidateProvenance(
            annotation_run_id=pass_provenance[0].annotation_run_id,
            provider_id=pass_provenance[0].provider_id,
            model_id=pass_provenance[0].model_id,
            prompt_versions=tuple(
                sorted(
                    (
                        (value.pass_name, value.prompt_version)
                        for value in pass_provenance
                    ),
                    key=lambda entry: entry[0].value,
                )
            ),
            pass_schema_versions=tuple(
                sorted(
                    (
                        (value.pass_name, value.schema_version)
                        for value in pass_provenance
                    ),
                    key=lambda entry: entry[0].value,
                )
            ),
            annotation_schema_version=bundle.annotation_schema_version,
            ontology_version=bundle.ontology_version,
            ontology_sha256=bundle.ontology_sha256,
        )
        verification_by_path = {
            review.path_id: review for review in bundle.verification.path_verifications
        }
        return cls(
            item_id=bundle.item_id,
            content_version=bundle.content_version,
            provenance=provenance,
            candidate_answers=bundle.independent_solve.candidate_answers,
            required_skill_ids=tuple(
                sorted(
                    {
                        attribution.skill_id
                        for attribution in bundle.cognitive.skill_attributions
                        if attribution.role is SkillRole.REQUIRED
                    }
                )
            ),
            solution_path_evidence=tuple(
                SolutionPathQualityEvidence(
                    path_id=path.path_id,
                    content_sha256=canonical_sha256(path),
                    valid=verification_by_path[path.path_id].valid,
                    grade_appropriate=verification_by_path[
                        path.path_id
                    ].grade_appropriate,
                )
                for path in sorted(
                    bundle.independent_solve.solution_paths,
                    key=lambda value: value.path_id,
                )
            ),
            prerequisite_pairs=tuple(
                sorted(
                    {
                        (proposal.from_skill_id, proposal.to_skill_id)
                        for proposal in bundle.cognitive.prerequisite_proposals
                    }
                )
            ),
            distractor_evidence=tuple(
                sorted(
                    (
                        DistractorQualityEvidence(
                            choice_id=diagnosis.choice_id,
                            misconception_id=diagnosis.candidate_misconception_id,
                            error_class=diagnosis.error_class,
                        )
                        for diagnosis in bundle.cognitive.distractor_diagnoses
                        if diagnosis.candidate_misconception_id is not None
                        and diagnosis.diagnostic_strength > 0
                    ),
                    key=lambda value: value.choice_id,
                )
            ),
            family_item_ids=tuple(
                sorted(
                    {
                        candidate.other_item_id
                        for candidate in bundle.cognitive.family_candidates
                    }
                )
            ),
            stratum_ids=tuple(sorted(stratum_ids)),
            difficulty_score=bundle.cognitive.difficulty_time_prior.difficulty_mean,
        )


class GoldAnnotation(StrictFrozenModel):
    evidence_id: str = Field(min_length=1)
    schema_version: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    accepted_answers: tuple[str, ...] = Field(min_length=1)
    primary_skill_ids: tuple[str, ...] = Field(min_length=1)
    solution_path_evidence: tuple[SolutionPathQualityEvidence, ...] = Field(
        min_length=1
    )
    accepted_prerequisite_pairs: tuple[tuple[str, str], ...] = ()
    distractor_evidence: tuple[DistractorQualityEvidence, ...] = ()
    family_item_ids: tuple[str, ...] = ()
    stratum_ids: tuple[str, ...] = ()
    difficulty_rank: int = Field(ge=1)
    reviewers: tuple[str, ...] = Field(min_length=2)
    reviewed_at: datetime

    @model_validator(mode="after")
    def gold_is_independently_reviewed(self) -> "GoldAnnotation":
        normalized = [reviewer.strip() for reviewer in self.reviewers]
        if any(not reviewer for reviewer in normalized):
            raise ValueError("gold reviewer identities cannot be blank")
        if len(set(normalized)) < 2:
            raise ValueError("gold annotations need two independent reviewers")
        if self.reviewed_at.tzinfo is None or self.reviewed_at.utcoffset() is None:
            raise ValueError("gold annotation reviewed_at requires a timezone")
        if any(not answer.strip() for answer in self.accepted_answers):
            raise ValueError("gold answers cannot be blank")
        if len(set(self.accepted_answers)) != len(self.accepted_answers):
            raise ValueError("gold answers must be unique")
        path_ids = [evidence.path_id for evidence in self.solution_path_evidence]
        if len(set(path_ids)) != len(path_ids):
            raise ValueError("gold solution-path evidence must be unique by path")
        if any(
            evidence.valid is None or evidence.grade_appropriate is None
            for evidence in self.solution_path_evidence
        ):
            raise ValueError(
                "gold solution-path evidence needs reviewed validity and grade fit"
            )
        choices = [evidence.choice_id for evidence in self.distractor_evidence]
        if len(set(choices)) != len(choices):
            raise ValueError("gold distractor evidence must be unique by choice")
        if any(not stratum.strip() for stratum in self.stratum_ids):
            raise ValueError("gold strata cannot be blank")
        if len(set(self.stratum_ids)) != len(self.stratum_ids):
            raise ValueError("gold strata must be unique")
        return self


class AnnotationQualityThresholds(StrictFrozenModel):
    version: str = Field(min_length=1)
    minimum_matched_gold_items: int = Field(ge=1)
    answer_agreement: float = Field(ge=0, le=1)
    primary_skill_precision: float = Field(ge=0, le=1)
    primary_skill_recall: float = Field(ge=0, le=1)
    solution_path_precision: float = Field(ge=0, le=1)
    prerequisite_precision: float = Field(ge=0, le=1)
    distractor_precision: float = Field(ge=0, le=1)
    family_precision: float = Field(ge=0, le=1)
    family_recall: float = Field(ge=0, le=1)
    difficulty_rank_correlation: float = Field(ge=-1, le=1)


DEFAULT_ANNOTATION_THRESHOLDS = AnnotationQualityThresholds(
    version=ANNOTATION_QUALITY_THRESHOLDS_VERSION,
    minimum_matched_gold_items=100,
    answer_agreement=0.98,
    primary_skill_precision=0.90,
    primary_skill_recall=0.80,
    solution_path_precision=0.95,
    prerequisite_precision=0.95,
    distractor_precision=0.90,
    family_precision=0.90,
    family_recall=0.80,
    difficulty_rank_correlation=0.60,
)


class AnnotationEvaluationContext(StrictFrozenModel):
    execution_scope: Literal["synthetic", "real_corpus"]
    stage0_status: Literal[
        "FAIL",
        "PENDING_REVIEW",
        "PENDING_DUPLICATE_REVIEW",
        "PENDING_ONTOLOGY_REVIEW",
        "PASS",
    ]
    ontology_review_ready: bool
    gold_set_id: str = Field(min_length=1)


def _precision_recall(
    predicted: set[tuple[Any, ...]], truth: set[tuple[Any, ...]]
) -> tuple[float | None, float | None]:
    true_positive = len(predicted & truth)
    precision = true_positive / len(predicted) if predicted else None
    recall = true_positive / len(truth) if truth else None
    return precision, recall


def _average_ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        end = position + 1
        while end < len(order) and values[order[end]] == values[order[position]]:
            end += 1
        average = (position + 1 + end) / 2
        for offset in range(position, end):
            ranks[order[offset]] = average
        position = end
    return ranks


def _pearson(left: list[float], right: list[float]) -> float | None:
    if len(left) < 2 or len(left) != len(right):
        return None
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum(
        (left_value - left_mean) * (right_value - right_mean)
        for left_value, right_value in zip(left, right, strict=True)
    )
    left_variance = sum((value - left_mean) ** 2 for value in left)
    right_variance = sum((value - right_mean) ** 2 for value in right)
    denominator = sqrt(left_variance * right_variance)
    return numerator / denominator if denominator else None


def _spearman(left: list[float], right: list[float]) -> float | None:
    return _pearson(_average_ranks(left), _average_ranks(right))


def _threshold_result(
    metric: float | None, threshold: float
) -> dict[str, float | str | None]:
    if metric is None:
        return {"value": None, "threshold": threshold, "status": "NOT_MEASURABLE"}
    return {
        "value": metric,
        "threshold": threshold,
        "status": "PASS" if metric >= threshold else "FAIL",
    }


def _manifest_sha256(values: list[dict[str, Any]]) -> str:
    return hashlib.sha256(
        json.dumps(
            values,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _opaque_reference(value: str, *, namespace: str) -> str:
    return hashlib.sha256(f"{namespace}\0{value}".encode("utf-8")).hexdigest()


def evaluate_annotation_quality(
    candidates: Iterable[AnnotationQualityCandidate],
    gold_annotations: Iterable[GoldAnnotation],
    *,
    context: AnnotationEvaluationContext,
    thresholds: AnnotationQualityThresholds = DEFAULT_ANNOTATION_THRESHOLDS,
) -> dict[str, Any]:
    candidate_list = list(candidates)
    gold_list = list(gold_annotations)
    candidate_keys = [
        (candidate.item_id, candidate.content_version) for candidate in candidate_list
    ]
    gold_keys = [(gold.item_id, gold.content_version) for gold in gold_list]
    if len(candidate_keys) != len(set(candidate_keys)):
        raise ValueError("annotation quality candidates must be unique by item version")
    if len(gold_keys) != len(set(gold_keys)):
        raise ValueError("gold annotations must be unique by item version")
    if len({candidate.item_id for candidate in candidate_list}) != len(candidate_list):
        raise ValueError(
            "only one annotation candidate version per item may be evaluated"
        )
    if len({gold.item_id for gold in gold_list}) != len(gold_list):
        raise ValueError("only one gold annotation version per item may be evaluated")

    candidate_by_item = {candidate.item_id: candidate for candidate in candidate_list}
    gold_by_item = {gold.item_id: gold for gold in gold_list}
    matched: list[tuple[AnnotationQualityCandidate, GoldAnnotation]] = []
    stale_count = 0
    for item_id in sorted(set(candidate_by_item) & set(gold_by_item)):
        candidate = candidate_by_item[item_id]
        gold = gold_by_item[item_id]
        if candidate.content_version != gold.content_version:
            stale_count += 1
            continue
        matched.append((candidate, gold))

    answer_matches = sum(
        set(candidate.candidate_answers) == set(gold.accepted_answers)
        for candidate, gold in matched
    )
    answer_agreement = answer_matches / len(matched) if matched else None

    predicted_skills = {
        (candidate.item_id, skill_id)
        for candidate, _ in matched
        for skill_id in candidate.required_skill_ids
    }
    gold_skills = {
        (gold.item_id, skill_id)
        for _, gold in matched
        for skill_id in gold.primary_skill_ids
    }
    skill_precision, skill_recall = _precision_recall(predicted_skills, gold_skills)

    predicted_paths = {
        (
            candidate.item_id,
            evidence.path_id,
            evidence.content_sha256,
            evidence.valid,
            evidence.grade_appropriate,
        )
        for candidate, _ in matched
        for evidence in candidate.solution_path_evidence
    }
    gold_paths = {
        (
            gold.item_id,
            evidence.path_id,
            evidence.content_sha256,
            evidence.valid,
            evidence.grade_appropriate,
        )
        for _, gold in matched
        for evidence in gold.solution_path_evidence
    }
    path_precision, _ = _precision_recall(predicted_paths, gold_paths)

    predicted_prerequisites = {
        (candidate.item_id, *pair)
        for candidate, _ in matched
        for pair in candidate.prerequisite_pairs
    }
    gold_prerequisites = {
        (gold.item_id, *pair)
        for _, gold in matched
        for pair in gold.accepted_prerequisite_pairs
    }
    prerequisite_precision, _ = _precision_recall(
        predicted_prerequisites, gold_prerequisites
    )

    predicted_distractors = {
        (
            candidate.item_id,
            evidence.choice_id,
            evidence.misconception_id,
            evidence.error_class.value,
        )
        for candidate, _ in matched
        for evidence in candidate.distractor_evidence
    }
    gold_distractors = {
        (
            gold.item_id,
            evidence.choice_id,
            evidence.misconception_id,
            evidence.error_class.value,
        )
        for _, gold in matched
        for evidence in gold.distractor_evidence
    }
    distractor_precision, _ = _precision_recall(predicted_distractors, gold_distractors)

    predicted_families = {
        (candidate.item_id, family_id)
        for candidate, _ in matched
        for family_id in candidate.family_item_ids
    }
    gold_families = {
        (gold.item_id, family_id)
        for _, gold in matched
        for family_id in gold.family_item_ids
    }
    family_precision, family_recall = _precision_recall(
        predicted_families, gold_families
    )

    difficulty_correlation = _spearman(
        [candidate.difficulty_score for candidate, _ in matched],
        [float(gold.difficulty_rank) for _, gold in matched],
    )

    metric_values = {
        "answer_agreement": answer_agreement,
        "primary_skill_precision": skill_precision,
        "primary_skill_recall": skill_recall,
        "solution_path_precision": path_precision,
        "prerequisite_precision": prerequisite_precision,
        "distractor_precision": distractor_precision,
        "family_precision": family_precision,
        "family_recall": family_recall,
        "difficulty_rank_correlation": difficulty_correlation,
    }
    threshold_values = thresholds.model_dump(mode="json")
    metrics = {
        name: _threshold_result(value, float(threshold_values[name]))
        for name, value in metric_values.items()
    }
    failures = sorted(
        name for name, result in metrics.items() if result["status"] == "FAIL"
    )
    not_measurable = sorted(
        name for name, result in metrics.items() if result["status"] == "NOT_MEASURABLE"
    )

    unmatched_candidate_count = len(set(candidate_by_item) - set(gold_by_item))
    unmatched_gold_count = len(set(gold_by_item) - set(candidate_by_item))
    stratum_mismatch_count = sum(
        set(candidate.stratum_ids) != set(gold_annotation.stratum_ids)
        for candidate, gold_annotation in matched
    )
    incomplete_coverage = any(
        (
            stale_count,
            unmatched_candidate_count,
            unmatched_gold_count,
            stratum_mismatch_count,
        )
    )

    candidate_provenance_hashes = {
        canonical_sha256(candidate.provenance) for candidate in candidate_list
    }
    candidate_provenance_coherent = len(candidate_provenance_hashes) <= 1

    # This is deliberately unconditional.  A caller-provided string saying
    # Stage 0 passed is not evidence.  A later version must verify and bind the
    # immutable Stage 0 report, reviewed ontology, and candidate run artifacts.
    if context.execution_scope == "real_corpus":
        status = "BLOCKED_STAGE0"
        reason = (
            "Real-corpus quality acceptance is disabled until the evaluator "
            "verifies and binds immutable Stage 0 and ontology evidence."
        )
    elif not candidate_provenance_coherent:
        status = "SYNTHETIC_PROVENANCE_BLOCKED"
        reason = (
            "Synthetic candidate cohort mixes annotation run, provider, model, "
            "prompt, schema, or ontology provenance."
        )
    elif incomplete_coverage:
        status = "SYNTHETIC_INCOMPLETE_COVERAGE"
        reason = (
            "Synthetic metric evidence requires one current, stratum-matched gold "
            "annotation for every candidate and no unmatched gold items."
        )
    elif len(matched) < thresholds.minimum_matched_gold_items:
        status = "SYNTHETIC_INSUFFICIENT_GOLD"
        reason = (
            f"Synthetic evidence has {len(matched)} matched gold item(s); "
            f"{thresholds.minimum_matched_gold_items} required."
        )
    elif failures or not_measurable:
        status = "SYNTHETIC_METRICS_NEED_REVIEW"
        reason = (
            "One or more required synthetic Stage 1 metrics failed or were not "
            "measurable."
        )
    else:
        status = "SYNTHETIC_METRICS_PASS"
        reason = (
            "All versioned synthetic Stage 1 metric thresholds were met. This "
            "does not authorize real-corpus Stage 1 acceptance."
        )

    gold_manifest = [
        gold_annotation.model_dump(mode="json")
        for gold_annotation in sorted(
            gold_list, key=lambda value: (value.item_id, value.content_version)
        )
    ]
    gold_set_sha256 = _manifest_sha256(gold_manifest)
    candidate_manifest = [
        candidate.model_dump(mode="json")
        for candidate in sorted(
            candidate_list, key=lambda value: (value.item_id, value.content_version)
        )
    ]
    strata_manifest = [
        {
            "item_id": candidate.item_id,
            "content_version": candidate.content_version,
            "candidate_strata": sorted(candidate.stratum_ids),
            "gold_strata": sorted(gold_annotation.stratum_ids),
        }
        for candidate, gold_annotation in matched
    ]

    return {
        "schema_version": ANNOTATION_QUALITY_REPORT_VERSION,
        "execution_scope": context.execution_scope,
        "stage0_status": context.stage0_status,
        "ontology_review_ready": context.ontology_review_ready,
        "acceptance_authorized": False,
        "gold_set_ref_sha256": _opaque_reference(
            context.gold_set_id, namespace="stage1-gold-set-ref.v1"
        ),
        "gold_set_sha256": gold_set_sha256,
        "candidate_manifest_version": ANNOTATION_CANDIDATE_MANIFEST_VERSION,
        "candidate_manifest_sha256": _manifest_sha256(candidate_manifest),
        "candidate_provenance_coherent": candidate_provenance_coherent,
        "candidate_provenance_sha256": (
            next(iter(candidate_provenance_hashes))
            if len(candidate_provenance_hashes) == 1
            else None
        ),
        "strata_manifest_sha256": _manifest_sha256(strata_manifest),
        "threshold_version": thresholds.version,
        "gold_schema_versions": sorted({gold.schema_version for gold in gold_list}),
        "status": status,
        "reason": reason,
        "counts": {
            "candidate_items": len(candidate_list),
            "gold_items": len(gold_list),
            "matched_current_content_items": len(matched),
            "stale_content_matches": stale_count,
            "unmatched_candidate_items": unmatched_candidate_count,
            "unmatched_gold_items": unmatched_gold_count,
            "stratum_metadata_mismatches": stratum_mismatch_count,
        },
        "metrics": metrics,
        "failed_metrics": failures,
        "not_measurable_metrics": not_measurable,
    }


def render_annotation_quality_markdown(report: dict[str, Any]) -> str:
    metric_rows = "\n".join(
        "| {name} | {value} | {threshold:.3f} | {status} |".format(
            name=name.replace("_", " ").title(),
            value=(
                "Not measurable"
                if result["value"] is None
                else f"{float(result['value']):.3f}"
            ),
            threshold=float(result["threshold"]),
            status=result["status"],
        )
        for name, result in report["metrics"].items()
    )
    counts = report["counts"]
    return f"""# Math Kangaroo Stage 1 annotation quality summary

**Exit status: `{report['status']}`**

{report['reason']}

## Evidence coverage

| Measure | Value |
| --- | ---: |
| Candidate items | {counts['candidate_items']} |
| Independently reviewed gold items | {counts['gold_items']} |
| Current-content matches | {counts['matched_current_content_items']} |
| Stale content matches excluded | {counts['stale_content_matches']} |
| Candidate items without gold evidence | {counts['unmatched_candidate_items']} |
| Gold items without a candidate | {counts['unmatched_gold_items']} |
| Stratum metadata mismatches | {counts['stratum_metadata_mismatches']} |

## Versioned metrics

Threshold configuration: `{report['threshold_version']}`

| Metric | Value | Threshold | Status |
| --- | ---: | ---: | --- |
{metric_rows}

This report evaluates synthetic metrics only and never authorizes real-corpus
acceptance. It contains no question text, answer key, source path, raw gold-set
identifier, learner data, or model prompt/output payload.
"""


def write_annotation_quality_reports(report: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "stage1-quality-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "stage1-quality-summary.md").write_text(
        render_annotation_quality_markdown(report),
        encoding="utf-8",
    )
