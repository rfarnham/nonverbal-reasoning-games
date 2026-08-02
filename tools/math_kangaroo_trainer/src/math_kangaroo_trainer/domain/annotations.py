"""Schema-constrained, private Stage 1 annotation contracts.

These models describe *proposals*.  They do not approve a Q-matrix, a
prerequisite, a misconception, an item family, or a calibration value.  The
real corpus remains behind the Stage 0 evidence gate; the contracts are usable
with synthetic fixtures while that review is pending.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from math_kangaroo_trainer.domain.items import AnswerType


CONTENT_VERSION_PATTERN = r"^sha256:[0-9a-f]{64}$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AnnotationPass(StrEnum):
    INDEPENDENT_SOLVE = "independent_solve"
    VERIFICATION = "verification"
    COGNITIVE = "cognitive"
    CRITIC = "critic"


class CombinationMode(StrEnum):
    COMPENSATORY = "compensatory"
    CONJUNCTIVE = "conjunctive"


class SkillRole(StrEnum):
    REQUIRED = "required"
    SUPPORTING = "supporting"
    INCIDENTAL = "incidental"


class ErrorClass(StrEnum):
    READING_INTERPRETATION = "reading_or_interpretation"
    INFORMATION_SELECTION = "relevant_information_selection"
    REPRESENTATION = "representation_or_diagram_interpretation"
    STRATEGY_SELECTION = "strategy_selection"
    CONCEPTUAL = "conceptual_misconception"
    PROCEDURE = "procedure_execution"
    ARITHMETIC_SLIP = "arithmetic_slip"
    IMPULSIVE_GUESS = "impulsive_guess"
    INTERRUPTION = "interruption_or_loss_of_task_state"
    UNKNOWN = "unknown"


class PassProvenance(StrictFrozenModel):
    annotation_run_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=CONTENT_VERSION_PATTERN)
    pass_name: AnnotationPass
    provider_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    prompt_version: str = Field(min_length=1)
    schema_version: str = Field(min_length=1)
    input_sha256: str = Field(pattern=SHA256_PATTERN)
    generated_at: datetime

    @field_validator("generated_at")
    @classmethod
    def generated_at_is_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("generated_at requires a timezone")
        return value


class InformationUse(StrictFrozenModel):
    evidence_id: str = Field(min_length=1)
    kind: Literal["stem", "choice", "diagram", "asset"]
    description: str = Field(min_length=1)
    source_reference: str | None = None


class SolutionStep(StrictFrozenModel):
    step_id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    evidence_ids: tuple[str, ...] = ()

    @field_validator("evidence_ids")
    @classmethod
    def evidence_ids_are_unique(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not evidence_id.strip() for evidence_id in value):
            raise ValueError("evidence IDs cannot be blank")
        if len(set(value)) != len(value):
            raise ValueError("evidence IDs must be unique within a step")
        return value


class SolutionPath(StrictFrozenModel):
    path_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    minimum_grade: int = Field(ge=1, le=12)
    maximum_grade: int = Field(ge=1, le=12)
    canonical: bool
    confidence: float = Field(ge=0, le=1)
    ordered_steps: tuple[SolutionStep, ...] = Field(min_length=1)
    combination_mode: CombinationMode

    @model_validator(mode="after")
    def path_is_well_formed(self) -> "SolutionPath":
        if self.maximum_grade < self.minimum_grade:
            raise ValueError("maximum_grade cannot precede minimum_grade")
        step_ids = [step.step_id for step in self.ordered_steps]
        if len(step_ids) != len(set(step_ids)):
            raise ValueError(f"{self.path_id}: solution step IDs must be unique")
        return self


class IndependentSolveOutput(StrictFrozenModel):
    provenance: PassProvenance
    candidate_answers: tuple[str, ...] = Field(min_length=1)
    solution_paths: tuple[SolutionPath, ...] = Field(min_length=1)
    used_information: tuple[InformationUse, ...] = Field(min_length=1)
    ambiguity_flags: tuple[str, ...] = ()
    missing_asset_flags: tuple[str, ...] = ()

    @model_validator(mode="after")
    def independent_solve_is_consistent(self) -> "IndependentSolveOutput":
        if self.provenance.pass_name is not AnnotationPass.INDEPENDENT_SOLVE:
            raise ValueError("independent solve output has the wrong pass provenance")
        if any(not answer.strip() for answer in self.candidate_answers):
            raise ValueError("candidate answers cannot be blank")
        if any(answer != answer.strip() for answer in self.candidate_answers):
            raise ValueError(
                "candidate answers must use canonical surrounding whitespace"
            )
        if len(set(self.candidate_answers)) != len(self.candidate_answers):
            raise ValueError("candidate answers must be unique")
        path_ids = [path.path_id for path in self.solution_paths]
        if len(path_ids) != len(set(path_ids)):
            raise ValueError("solution path IDs must be unique")
        evidence_ids = [evidence.evidence_id for evidence in self.used_information]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("used-information IDs must be unique")
        known_evidence = set(evidence_ids)
        for path in self.solution_paths:
            for step in path.ordered_steps:
                unknown = set(step.evidence_ids) - known_evidence
                if unknown:
                    raise ValueError(
                        f"{path.path_id}/{step.step_id}: unknown evidence IDs {sorted(unknown)}"
                    )
        return self


class PathVerification(StrictFrozenModel):
    path_id: str = Field(min_length=1)
    valid: bool | None
    grade_appropriate: bool | None
    issue_codes: tuple[str, ...] = ()
    explanation: str = Field(min_length=1)


class VerificationOutput(StrictFrozenModel):
    """Protected verification result; never use as learner-safe content."""

    provenance: PassProvenance
    answer_type: AnswerType
    answer_agreement: Literal["matches", "disagrees", "unverifiable"]
    independent_answers: tuple[str, ...] = Field(min_length=1)
    official_answers: tuple[str, ...] = ()
    official_answer_status: str = Field(min_length=1)
    path_verifications: tuple[PathVerification, ...] = Field(min_length=1)
    blocking_flags: tuple[str, ...] = ()

    @model_validator(mode="after")
    def verification_is_consistent(self) -> "VerificationOutput":
        if self.provenance.pass_name is not AnnotationPass.VERIFICATION:
            raise ValueError("verification output has the wrong pass provenance")
        path_ids = [review.path_id for review in self.path_verifications]
        if len(path_ids) != len(set(path_ids)):
            raise ValueError("each solution path may be verified only once")
        for field_name, answers in (
            ("independent_answers", self.independent_answers),
            ("official_answers", self.official_answers),
        ):
            if any(
                not answer.strip() or answer != answer.strip() for answer in answers
            ):
                raise ValueError(
                    f"{field_name} must contain canonical nonblank answers"
                )
            if len(set(answers)) != len(answers):
                raise ValueError(f"{field_name} must not contain duplicate answers")
        if (
            self.answer_type is AnswerType.SINGLE_CHOICE
            and len(self.official_answers) != 1
        ):
            raise ValueError(
                "single-choice verification requires exactly one official answer"
            )
        expected_agreement = derive_answer_agreement(
            answer_type=self.answer_type,
            independent_answers=self.independent_answers,
            official_answers=self.official_answers,
        )
        if self.answer_agreement != expected_agreement:
            raise ValueError(
                "answer_agreement must be derived from exact independent and official "
                "answer sets"
            )
        return self


class SkillAttribution(StrictFrozenModel):
    path_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    role: SkillRole
    weight: float = Field(gt=0, le=1)
    annotation_confidence: float = Field(ge=0, le=1)
    review_status: Literal["proposed"] = "proposed"
    evidence_step_ids: tuple[str, ...] = Field(min_length=1)


class TagAssignment(StrictFrozenModel):
    tag_id: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    evidence_ids: tuple[str, ...] = Field(min_length=1)


class NuisanceLoad(StrictFrozenModel):
    tag_id: str = Field(min_length=1)
    level: Literal["low", "medium", "high"]
    confidence: float = Field(ge=0, le=1)
    evidence_ids: tuple[str, ...] = Field(min_length=1)


class PrerequisiteProposal(StrictFrozenModel):
    from_skill_id: str = Field(min_length=1)
    to_skill_id: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    evidence_step_ids: tuple[str, ...] = Field(min_length=1)
    review_status: Literal["proposed"] = "proposed"

    @model_validator(mode="after")
    def no_self_prerequisite(self) -> "PrerequisiteProposal":
        if self.from_skill_id == self.to_skill_id:
            raise ValueError("a skill cannot be its own prerequisite")
        return self


class DistractorDiagnosis(StrictFrozenModel):
    choice_id: str = Field(min_length=1)
    candidate_misconception_id: str | None = None
    diagnostic_strength: float = Field(ge=0, le=1)
    error_class: ErrorClass
    explanation: str = Field(min_length=1)
    review_status: Literal["proposed"] = "proposed"

    @model_validator(mode="after")
    def unknown_is_not_overclaimed(self) -> "DistractorDiagnosis":
        if self.error_class is ErrorClass.UNKNOWN and self.candidate_misconception_id:
            raise ValueError("an unknown distractor cannot name a misconception")
        if self.candidate_misconception_id is None and self.diagnostic_strength > 0:
            raise ValueError(
                "diagnostic strength must be zero when no misconception is proposed"
            )
        return self


class FamilyCandidate(StrictFrozenModel):
    other_item_id: str = Field(min_length=1)
    relation: Literal[
        "translation",
        "structure_variant",
        "diagram_variant",
        "template_variant",
    ]
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(min_length=1)


class DifficultyTimePriorCandidate(StrictFrozenModel):
    broad_tier: Literal["easy", "medium", "hard", "unknown"]
    difficulty_mean: float = Field(ge=-8, le=8)
    difficulty_variance: float = Field(gt=0, le=64)
    expected_active_time_seconds: float = Field(gt=0, le=7200)
    log_time_variance: float = Field(gt=0, le=16)
    provenance: Literal["weak_llm_candidate"] = "weak_llm_candidate"


class SkillProposal(StrictFrozenModel):
    proposed_skill_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    facet: Literal["mathematical_content", "reasoning_move", "procedure"]
    description: str = Field(min_length=1)
    reason_existing_skills_do_not_fit: str = Field(min_length=1)
    evidence_step_ids: tuple[str, ...] = Field(min_length=1)


class CognitiveAnnotationOutput(StrictFrozenModel):
    provenance: PassProvenance
    solution_paths: tuple[SolutionPath, ...] = Field(min_length=1)
    skill_attributions: tuple[SkillAttribution, ...] = Field(min_length=1)
    representation_tags: tuple[TagAssignment, ...] = Field(min_length=1)
    cognitive_demand_tags: tuple[TagAssignment, ...] = Field(min_length=1)
    nuisance_loads: tuple[NuisanceLoad, ...] = ()
    prerequisite_proposals: tuple[PrerequisiteProposal, ...] = ()
    distractor_diagnoses: tuple[DistractorDiagnosis, ...] = ()
    family_candidates: tuple[FamilyCandidate, ...] = ()
    difficulty_time_prior: DifficultyTimePriorCandidate
    proposed_skills: tuple[SkillProposal, ...] = ()
    review_flags: tuple[str, ...] = ()

    @model_validator(mode="after")
    def cognitive_annotation_is_consistent(self) -> "CognitiveAnnotationOutput":
        if self.provenance.pass_name is not AnnotationPass.COGNITIVE:
            raise ValueError("cognitive output has the wrong pass provenance")
        paths = {path.path_id: path for path in self.solution_paths}
        if len(paths) != len(self.solution_paths):
            raise ValueError("cognitive solution path IDs must be unique")
        step_ids_by_path = {
            path_id: {step.step_id for step in path.ordered_steps}
            for path_id, path in paths.items()
        }
        required_by_path = {path_id: 0 for path_id in paths}
        for attribution in self.skill_attributions:
            if attribution.path_id not in paths:
                raise ValueError(
                    f"skill attribution references unknown path {attribution.path_id}"
                )
            unknown_steps = (
                set(attribution.evidence_step_ids)
                - step_ids_by_path[attribution.path_id]
            )
            if unknown_steps:
                raise ValueError(
                    f"{attribution.path_id}/{attribution.skill_id}: unknown evidence "
                    f"steps {sorted(unknown_steps)}"
                )
            if attribution.role is SkillRole.REQUIRED:
                required_by_path[attribution.path_id] += 1
        missing_required = [
            path_id for path_id, count in required_by_path.items() if count == 0
        ]
        if missing_required:
            raise ValueError(
                f"every path needs a required skill attribution: {missing_required}"
            )
        proposed_ids = [proposal.proposed_skill_id for proposal in self.proposed_skills]
        if len(proposed_ids) != len(set(proposed_ids)):
            raise ValueError("proposed skill IDs must be unique")
        return self


class CriticIssue(StrictFrozenModel):
    code: str = Field(min_length=1)
    severity: Literal["warning", "blocking"]
    explanation: str = Field(min_length=1)
    path_id: str | None = None
    skill_id: str | None = None
    choice_id: str | None = None


class CriticOutput(StrictFrozenModel):
    provenance: PassProvenance
    disposition: Literal["ready_for_human_review", "needs_revision", "rejected"]
    issues: tuple[CriticIssue, ...] = ()
    overtagged_skill_ids: tuple[str, ...] = ()
    expert_only_path_ids: tuple[str, ...] = ()
    alternate_solution_missing: bool = False
    hidden_visual_assumption: bool = False
    false_distractor_choice_ids: tuple[str, ...] = ()
    mandatory_review_triggers: tuple[str, ...] = ()

    @model_validator(mode="after")
    def critic_is_consistent(self) -> "CriticOutput":
        if self.provenance.pass_name is not AnnotationPass.CRITIC:
            raise ValueError("critic output has the wrong pass provenance")
        if any(issue.severity == "blocking" for issue in self.issues) and (
            self.disposition == "ready_for_human_review"
        ):
            raise ValueError("blocking critic issues require revision or rejection")
        return self


class AnnotationBundle(StrictFrozenModel):
    """Private multi-pass proposal bound to one immutable item version."""

    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=CONTENT_VERSION_PATTERN)
    ontology_version: str = Field(min_length=1)
    ontology_sha256: str = Field(pattern=SHA256_PATTERN)
    annotation_schema_version: str = Field(min_length=1)
    status: Literal["proposed", "needs_review"]
    source_review_triggers: tuple[str, ...] = ()
    independent_solve: IndependentSolveOutput
    verification: VerificationOutput
    cognitive: CognitiveAnnotationOutput
    critic: CriticOutput

    @model_validator(mode="after")
    def passes_bind_to_one_item(self) -> "AnnotationBundle":
        passes = (
            self.independent_solve,
            self.verification,
            self.cognitive,
            self.critic,
        )
        for output in passes:
            if output.provenance.item_id != self.item_id:
                raise ValueError("every annotation pass must reference the bundle item")
            if output.provenance.content_version != self.content_version:
                raise ValueError(
                    "every annotation pass must reference the bundle content version"
                )
        independent_paths = {
            path.path_id for path in self.independent_solve.solution_paths
        }
        verified_paths = {path.path_id for path in self.verification.path_verifications}
        cognitive_paths = {path.path_id for path in self.cognitive.solution_paths}
        if verified_paths != independent_paths:
            raise ValueError(
                "verification must cover every independently proposed path"
            )
        if cognitive_paths != independent_paths:
            raise ValueError(
                "cognitive annotation must preserve the independently verified paths"
            )
        independent_by_id = {
            path.path_id: path for path in self.independent_solve.solution_paths
        }
        cognitive_by_id = {path.path_id: path for path in self.cognitive.solution_paths}
        if cognitive_by_id != independent_by_id:
            raise ValueError(
                "cognitive annotation cannot rewrite independently verified paths"
            )
        if set(self.verification.independent_answers) != set(
            self.independent_solve.candidate_answers
        ):
            raise ValueError(
                "verification must preserve the independent candidate answers"
            )
        if any(not trigger.strip() for trigger in self.source_review_triggers):
            raise ValueError("source review triggers cannot be blank")
        if len(set(self.source_review_triggers)) != len(self.source_review_triggers):
            raise ValueError("source review triggers must be unique")
        if self.status == "proposed" and self.mandatory_review_triggers:
            raise ValueError("mandatory review triggers require needs_review status")
        return self

    @property
    def mandatory_review_triggers(self) -> tuple[str, ...]:
        triggers: set[str] = set(self.source_review_triggers)
        triggers.update(self.independent_solve.ambiguity_flags)
        triggers.update(self.independent_solve.missing_asset_flags)
        triggers.update(self.verification.blocking_flags)
        triggers.update(self.cognitive.review_flags)
        triggers.update(self.critic.mandatory_review_triggers)
        if self.verification.answer_agreement != "matches":
            triggers.add("ANSWER_DISAGREEMENT_OR_UNVERIFIABLE")
        if any(
            review.valid is not True for review in self.verification.path_verifications
        ):
            triggers.add("SOLUTION_PATH_NOT_VERIFIED")
        if any(
            review.grade_appropriate is not True
            for review in self.verification.path_verifications
        ):
            triggers.add("SOLUTION_PATH_GRADE_APPROPRIATENESS_UNVERIFIED")
        if self.cognitive.proposed_skills:
            triggers.add("NEW_SKILL_PROPOSED")
        if self.cognitive.prerequisite_proposals:
            triggers.add("UNREVIEWED_PREREQUISITE_PROPOSED")
        if self.critic.disposition != "ready_for_human_review":
            triggers.add("CRITIC_REVISION_REQUIRED")
        if self.critic.hidden_visual_assumption:
            triggers.add("HIDDEN_VISUAL_ASSUMPTION")
        if self.critic.alternate_solution_missing:
            triggers.add("ALTERNATE_SOLUTION_MISSING")
        if self.critic.issues:
            triggers.add("CRITIC_ISSUES_PRESENT")
        if self.critic.overtagged_skill_ids:
            triggers.add("CRITIC_OVERTAGGING_FOUND")
        if self.critic.expert_only_path_ids:
            triggers.add("CRITIC_EXPERT_ONLY_PATH_FOUND")
        if self.critic.false_distractor_choice_ids:
            triggers.add("CRITIC_FALSE_DISTRACTOR_DIAGNOSIS_FOUND")
        return tuple(sorted(triggers))


def derive_answer_agreement(
    *,
    answer_type: AnswerType,
    independent_answers: tuple[str, ...],
    official_answers: tuple[str, ...],
) -> Literal["matches", "disagrees", "unverifiable"]:
    """Derive protected agreement using exact answer-set semantics.

    This is trusted pipeline logic, not an annotator judgment.  A partial
    overlap never counts as a match.
    """

    if answer_type in {AnswerType.UNKNOWN, AnswerType.VOID} or not official_answers:
        return "unverifiable"
    if set(independent_answers) == set(official_answers):
        return "matches"
    return "disagrees"


def canonical_sha256(value: BaseModel | Mapping[str, Any] | list[Any]) -> str:
    """Hash a model payload using one deterministic JSON representation."""

    payload: Any
    if isinstance(value, BaseModel):
        payload = value.model_dump(mode="json")
    else:
        payload = value
    encoded = json.dumps(
        payload,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
