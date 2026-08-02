from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone

import pytest

from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.corpus.annotation import (
    AnnotationAssetEvidence,
    AnnotationItem,
    AnnotationOrchestrator,
    AnnotationPassRequest,
    AnnotationRunConfig,
    ExecutionScope,
    InMemoryAnnotationAuditLog,
    InMemoryAnnotationCache,
    Stage1BlockedError,
    Stage1Gate,
)
from math_kangaroo_trainer.domain.annotations import AnnotationPass
from math_kangaroo_trainer.domain.items import (
    AnswerType,
    ItemStatus,
    LearnerSafeItem,
    ProtectedAnswer,
)
from math_kangaroo_trainer.domain.skills import load_ontology, ontology_checksum


CONTENT_VERSION = "sha256:" + "a" * 64
NOW = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)
ASSET_BYTES = b"invented text-only asset content"
ASSET_SHA256 = hashlib.sha256(ASSET_BYTES).hexdigest()
ASSET_BASE64 = base64.b64encode(ASSET_BYTES).decode("ascii")


def annotation_item() -> AnnotationItem:
    learner = LearnerSafeItem(
        item_id="synthetic-annotation-item",
        content_version=CONTENT_VERSION,
        source_collection="invented-fixture",
        source_file_id="synthetic-source",
        source_checksum="b" * 64,
        year=2026,
        contest_track_or_grade_band="1-2",
        question_number=1,
        published_point_value_or_tier=3,
        language="en",
        stem_markdown="Sam has two red counters and adds one more.",
        choices=("2", "3", "4", "5"),
        answer_type=AnswerType.SINGLE_CHOICE,
        asset_ids=("synthetic-asset",),
        family_id=None,
        minimum_grade_prerequisites=(),
        status=ItemStatus.PARSED,
        license_or_use_status="synthetic-test-only",
        schema_version="corpus-item.test.v1",
    )
    protected = ProtectedAnswer(
        item_id=learner.item_id,
        content_version=learner.content_version,
        official_answer="B",
        answer_status="official-verified",
        answer_source_label="invented key",
    )
    return AnnotationItem(
        learner=learner,
        protected_answer=protected,
        assets=(
            AnnotationAssetEvidence(
                item_id=learner.item_id,
                asset_id="synthetic-asset",
                asset_sha256=ASSET_SHA256,
                modality="text_extractable",
                media_type="text/plain",
                content_base64=ASSET_BASE64,
                restrained_description="Three flat counters.",
            ),
        ),
    )


class SyntheticProvider:
    def __init__(
        self,
        *,
        candidate_answers: tuple[str, ...] = ("B",),
        skill_id: str = "cnt_counting_cardinality",
        grade_appropriate: bool | None = True,
        critic_overrides: dict[str, object] | None = None,
    ) -> None:
        self.candidate_answers = candidate_answers
        self.skill_id = skill_id
        self.grade_appropriate = grade_appropriate
        self.critic_overrides = critic_overrides or {}
        self.requests: list[AnnotationPassRequest] = []

    @staticmethod
    def path() -> dict[str, object]:
        return {
            "path_id": "path-count",
            "name": "Count the combined set",
            "minimum_grade": 1,
            "maximum_grade": 2,
            "canonical": True,
            "confidence": 0.95,
            "ordered_steps": [
                {
                    "step_id": "step-count",
                    "description": "Count all three counters once.",
                    "evidence_ids": ["stem-counter"],
                }
            ],
            "combination_mode": "conjunctive",
        }

    def generate(self, request: AnnotationPassRequest) -> dict[str, object]:
        self.requests.append(request)
        if request.pass_name is AnnotationPass.INDEPENDENT_SOLVE:
            return {
                "candidate_answers": list(self.candidate_answers),
                "solution_paths": [self.path()],
                "used_information": [
                    {
                        "evidence_id": "stem-counter",
                        "kind": "stem",
                        "description": "Two counters plus one counter.",
                    }
                ],
                "ambiguity_flags": [],
                "missing_asset_flags": [],
            }
        if request.pass_name is AnnotationPass.VERIFICATION:
            return {
                "path_verifications": [
                    {
                        "path_id": "path-count",
                        "valid": True,
                        "grade_appropriate": self.grade_appropriate,
                        "issue_codes": [],
                        "explanation": "The count is complete and age appropriate.",
                    }
                ],
                "blocking_flags": [],
            }
        if request.pass_name is AnnotationPass.COGNITIVE:
            return {
                "solution_paths": [self.path()],
                "skill_attributions": [
                    {
                        "path_id": "path-count",
                        "skill_id": self.skill_id,
                        "role": "required",
                        "weight": 1.0,
                        "annotation_confidence": 0.9,
                        "review_status": "proposed",
                        "evidence_step_ids": ["step-count"],
                    }
                ],
                "representation_tags": [
                    {
                        "tag_id": "rep_story_text",
                        "confidence": 0.9,
                        "evidence_ids": ["stem-counter"],
                    }
                ],
                "cognitive_demand_tags": [
                    {
                        "tag_id": "demand_direct_application",
                        "confidence": 0.9,
                        "evidence_ids": ["step-count"],
                    }
                ],
                "nuisance_loads": [
                    {
                        "tag_id": "load_reading",
                        "level": "low",
                        "confidence": 0.8,
                        "evidence_ids": ["stem-counter"],
                    }
                ],
                "prerequisite_proposals": [],
                "distractor_diagnoses": [
                    {
                        "choice_id": "A",
                        "candidate_misconception_id": None,
                        "diagnostic_strength": 0,
                        "error_class": "unknown",
                        "explanation": "No defensible error process is established.",
                        "review_status": "proposed",
                    }
                ],
                "family_candidates": [],
                "difficulty_time_prior": {
                    "broad_tier": "easy",
                    "difficulty_mean": -0.8,
                    "difficulty_variance": 4.0,
                    "expected_active_time_seconds": 35,
                    "log_time_variance": 1.2,
                    "provenance": "weak_llm_candidate",
                },
                "proposed_skills": [],
                "review_flags": [],
            }
        output: dict[str, object] = {
            "disposition": "ready_for_human_review",
            "issues": [],
            "overtagged_skill_ids": [],
            "expert_only_path_ids": [],
            "alternate_solution_missing": False,
            "hidden_visual_assumption": False,
            "false_distractor_choice_ids": [],
            "mandatory_review_triggers": [],
        }
        output.update(self.critic_overrides)
        return output


def run_config(gate: Stage1Gate) -> AnnotationRunConfig:
    versions = {annotation_pass: "test.v1" for annotation_pass in AnnotationPass}
    return AnnotationRunConfig(
        annotation_run_id="synthetic-annotation-run",
        annotation_schema_version="annotation-bundle.test.v1",
        provider_id="invented-provider",
        model_id="invented-model",
        prompt_versions=versions,
        pass_schema_versions=versions,
        gate=gate,
    )


def orchestrator(
    provider: SyntheticProvider,
    *,
    gate: Stage1Gate | None = None,
    cache: InMemoryAnnotationCache | None = None,
    audit_log: InMemoryAnnotationAuditLog | None = None,
) -> AnnotationOrchestrator:
    ontology_path = default_ontology_path()
    ontology = load_ontology(ontology_path)
    return AnnotationOrchestrator(
        provider=provider,
        cache=cache or InMemoryAnnotationCache(),
        ontology=ontology,
        ontology_sha256=ontology_checksum(ontology_path),
        config=run_config(
            gate
            or Stage1Gate(
                execution_scope=ExecutionScope.SYNTHETIC,
            )
        ),
        audit_log=audit_log,
        clock=lambda: NOW,
    )


def test_synthetic_multi_pass_contract_is_versioned_cached_and_answer_blind() -> None:
    provider = SyntheticProvider()
    cache = InMemoryAnnotationCache()
    runner = orchestrator(provider, cache=cache)

    first = runner.annotate(annotation_item())
    second = runner.annotate(annotation_item())

    assert first == second
    assert first.status == "proposed"
    assert first.mandatory_review_triggers == ()
    assert len(provider.requests) == 4
    assert [request.pass_name for request in provider.requests] == list(AnnotationPass)
    independent_payload = provider.requests[0].payload
    encoded = json.dumps(independent_payload, sort_keys=True)
    assert "official_answer" not in encoded
    assert "protected_answer" not in encoded
    assert independent_payload["instructions"]["answer_key_visible"] is False
    source_hashes = {
        request.payload["learner_safe_source_sha256"] for request in provider.requests
    }
    assert len(source_hashes) == 1
    assert all(
        "learner_safe_source" in request.payload for request in provider.requests
    )
    assert all(
        request.payload["learner_safe_source"]["assets"][0]["content_base64"]
        == ASSET_BASE64
        for request in provider.requests
    )
    assert all(
        output.provenance.generated_at == NOW
        for output in (
            first.independent_solve,
            first.verification,
            first.cognitive,
            first.critic,
        )
    )
    mutated = provider.requests[0].payload
    mutated["learner_safe_source"]["item"]["stem_markdown"] = "tampered"
    assert (
        provider.requests[0].payload["learner_safe_source"]["item"]["stem_markdown"]
        != "tampered"
    )


def test_real_corpus_is_blocked_before_provider_sees_item() -> None:
    provider = SyntheticProvider()
    runner = orchestrator(
        provider,
        gate=Stage1Gate(
            execution_scope=ExecutionScope.REAL_CORPUS,
        ),
    )

    with pytest.raises(
        Stage1BlockedError, match="REAL_CORPUS_TYPED_EVIDENCE_GATE_NOT_IMPLEMENTED"
    ):
        runner.annotate(annotation_item())
    assert provider.requests == []


def test_answer_disagreement_routes_bundle_to_human_review() -> None:
    bundle = orchestrator(SyntheticProvider(candidate_answers=("A",))).annotate(
        annotation_item()
    )

    assert bundle.status == "needs_review"
    assert "ANSWER_DISAGREEMENT_OR_UNVERIFIABLE" in (bundle.mandatory_review_triggers)


def test_new_skill_cannot_enter_q_matrix_without_proposal_review() -> None:
    runner = orchestrator(SyntheticProvider(skill_id="invented_new_skill"))

    with pytest.raises(ValueError, match="proposal queue"):
        runner.annotate(annotation_item())


def test_callers_cannot_self_assert_a_real_corpus_pass() -> None:
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        Stage1Gate.model_validate(
            {
                "execution_scope": "real_corpus",
                "stage0_status": "PASS",
                "ontology_review_ready": True,
            }
        )


def test_pass_b_trusted_answer_fields_cannot_be_forged_by_provider() -> None:
    class ForgedVerificationProvider(SyntheticProvider):
        def generate(self, request: AnnotationPassRequest) -> dict[str, object]:
            output = super().generate(request)
            if request.pass_name is AnnotationPass.VERIFICATION:
                output["answer_agreement"] = "matches"
                output["official_answers"] = ["A"]
                output["official_answer_status"] = "provider-approved"
            return output

    audit_log = InMemoryAnnotationAuditLog()
    runner = orchestrator(ForgedVerificationProvider(), audit_log=audit_log)

    with pytest.raises(ValueError, match="trusted verification"):
        runner.annotate(annotation_item())

    rejected = audit_log.records[-1]
    assert rejected.pass_name is AnnotationPass.VERIFICATION
    assert rejected.normalized_output_json is None
    assert rejected.validation_errors
    assert '"official_answers":["A"]' in rejected.raw_output_json


def test_pass_b_uses_exact_answer_sets_and_protected_status() -> None:
    bundle = orchestrator(SyntheticProvider(candidate_answers=("B", "C"))).annotate(
        annotation_item()
    )

    assert bundle.verification.independent_answers == ("B", "C")
    assert bundle.verification.official_answers == ("B",)
    assert bundle.verification.official_answer_status == "official-verified"
    assert bundle.verification.answer_agreement == "disagrees"
    assert "ANSWER_DISAGREEMENT_OR_UNVERIFIABLE" in (bundle.mandatory_review_triggers)


def test_single_choice_requires_exactly_one_protected_answer_before_calls() -> None:
    item = annotation_item()
    missing_answer = AnnotationItem(
        learner=item.learner,
        protected_answer=item.protected_answer.model_copy(
            update={"official_answer": None}
        ),
        assets=item.assets,
    )
    provider = SyntheticProvider()

    with pytest.raises(ValueError, match="requires one protected answer"):
        orchestrator(provider).annotate(missing_answer)
    assert provider.requests == []


def test_asset_bytes_digest_and_question_scope_are_enforced() -> None:
    base = annotation_item()
    asset_data = base.assets[0].model_dump(mode="python")

    with pytest.raises(ValueError, match="do not match asset_sha256"):
        AnnotationAssetEvidence.model_validate({**asset_data, "asset_sha256": "0" * 64})
    with pytest.raises(ValueError, match="valid base64"):
        AnnotationAssetEvidence.model_validate(
            {**asset_data, "content_base64": "not base64!"}
        )

    wrong_scope = base.assets[0].model_copy(update={"item_id": "another-item"})
    with pytest.raises(ValueError, match="question-scoped"):
        AnnotationItem(
            learner=base.learner,
            protected_answer=base.protected_answer,
            assets=(wrong_scope,),
        )


def test_visual_source_adds_a_deterministic_review_trigger() -> None:
    base = annotation_item()
    visual_asset = base.assets[0].model_copy(
        update={"modality": "diagram", "media_type": "image/png"}
    )
    visual_item = AnnotationItem(
        learner=base.learner,
        protected_answer=base.protected_answer,
        assets=(visual_asset,),
    )

    bundle = orchestrator(SyntheticProvider()).annotate(visual_item)

    assert bundle.status == "needs_review"
    assert bundle.source_review_triggers == ("VISUAL_ASSET_REQUIRES_HUMAN_REVIEW",)
    assert "VISUAL_ASSET_REQUIRES_HUMAN_REVIEW" in (bundle.mandatory_review_triggers)


def test_provider_review_status_is_proposal_only_and_failure_is_audited() -> None:
    class ProviderApprovalAttempt(SyntheticProvider):
        def generate(self, request: AnnotationPassRequest) -> dict[str, object]:
            output = super().generate(request)
            if request.pass_name is AnnotationPass.COGNITIVE:
                attribution = output["skill_attributions"][0]
                assert isinstance(attribution, dict)
                attribution["review_status"] = "approved"
            return output

    audit_log = InMemoryAnnotationAuditLog()
    runner = orchestrator(ProviderApprovalAttempt(), audit_log=audit_log)

    with pytest.raises(ValueError, match="Input should be 'proposed'"):
        runner.annotate(annotation_item())

    rejected = audit_log.records[-1]
    assert rejected.pass_name is AnnotationPass.COGNITIVE
    assert rejected.normalized_output_json is None
    assert rejected.validation_errors


def test_adverse_grade_and_critic_fields_force_review_without_provider_trigger() -> (
    None
):
    grade_bundle = orchestrator(SyntheticProvider(grade_appropriate=False)).annotate(
        annotation_item()
    )
    assert "SOLUTION_PATH_GRADE_APPROPRIATENESS_UNVERIFIED" in (
        grade_bundle.mandatory_review_triggers
    )

    critic_bundle = orchestrator(
        SyntheticProvider(
            critic_overrides={
                "overtagged_skill_ids": ["cnt_counting_cardinality"],
                "expert_only_path_ids": ["path-count"],
                "false_distractor_choice_ids": ["A"],
            }
        )
    ).annotate(annotation_item())
    assert {
        "CRITIC_OVERTAGGING_FOUND",
        "CRITIC_EXPERT_ONLY_PATH_FOUND",
        "CRITIC_FALSE_DISTRACTOR_DIAGNOSIS_FOUND",
    }.issubset(critic_bundle.mandatory_review_triggers)
    assert critic_bundle.status == "needs_review"


def test_append_only_audit_retains_raw_normalized_errors_and_checksums() -> None:
    audit_log = InMemoryAnnotationAuditLog()
    runner = orchestrator(SyntheticProvider(), audit_log=audit_log)

    runner.annotate(annotation_item())
    first_records = audit_log.records
    runner.annotate(annotation_item())

    assert len(first_records) == 4
    assert len(audit_log.records) == 8
    assert [record.source for record in audit_log.records[:4]] == ["provider"] * 4
    assert [record.source for record in audit_log.records[4:]] == ["cache"] * 4
    assert len({record.record_id for record in audit_log.records}) == 8
    for record in audit_log.records:
        assert (
            hashlib.sha256(record.raw_output_json.encode("utf-8")).hexdigest()
            == record.raw_output_sha256
        )
        assert record.normalized_output_json is not None
        assert (
            hashlib.sha256(record.normalized_output_json.encode("utf-8")).hexdigest()
            == record.normalized_output_sha256
        )
        assert record.validation_errors == ()

    verification_record = first_records[1]
    raw_verification = json.loads(verification_record.raw_output_json)
    normalized_verification = json.loads(
        verification_record.normalized_output_json or "{}"
    )
    assert "official_answers" not in raw_verification
    assert normalized_verification["official_answers"] == ["B"]
    assert normalized_verification["official_answer_status"] == "official-verified"
    assert normalized_verification["answer_agreement"] == "matches"
