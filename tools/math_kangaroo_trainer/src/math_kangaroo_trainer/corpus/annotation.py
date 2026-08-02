"""Deterministic, provider-neutral Stage 1 annotation orchestration.

Only invented fixtures may cross the provider boundary.  Real-corpus execution
remains unconditionally closed until this module has a typed gate that binds an
immutable Stage 0 evidence record, rather than accepting caller-supplied status
strings or booleans.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from math_kangaroo_trainer.domain.annotations import (
    AnnotationBundle,
    AnnotationPass,
    CognitiveAnnotationOutput,
    CriticOutput,
    IndependentSolveOutput,
    PassProvenance,
    VerificationOutput,
    canonical_sha256,
    derive_answer_agreement,
)
from math_kangaroo_trainer.domain.items import (
    AnswerType,
    LearnerSafeItem,
    ProtectedAnswer,
)
from math_kangaroo_trainer.domain.skills import OntologyDocument


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ExecutionScope(StrEnum):
    SYNTHETIC = "synthetic"
    REAL_CORPUS = "real_corpus"


class Stage1BlockedError(RuntimeError):
    """Raised before a provider sees unapproved real-corpus evidence."""


class AnnotationAssetEvidence(StrictFrozenModel):
    item_id: str = Field(min_length=1)
    asset_id: str = Field(min_length=1)
    asset_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    modality: str = Field(min_length=1)
    media_type: str = Field(pattern=r"^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$")
    content_base64: str = Field(min_length=1)
    restrained_description: str | None = None

    @model_validator(mode="after")
    def content_matches_declared_digest(self) -> "AnnotationAssetEvidence":
        try:
            content = base64.b64decode(self.content_base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("asset content_base64 must be valid base64") from error
        if not content:
            raise ValueError("annotation asset content cannot be empty")
        if hashlib.sha256(content).hexdigest() != self.asset_sha256:
            raise ValueError("annotation asset bytes do not match asset_sha256")
        return self

    @property
    def is_visual(self) -> bool:
        modality = self.modality.casefold()
        return self.media_type.startswith("image/") or any(
            marker in modality for marker in ("image", "diagram", "visual", "mixed")
        )


class AnnotationItem(StrictFrozenModel):
    learner: LearnerSafeItem
    protected_answer: ProtectedAnswer
    assets: tuple[AnnotationAssetEvidence, ...] = ()

    @model_validator(mode="after")
    def protected_and_safe_records_match(self) -> "AnnotationItem":
        if self.protected_answer.item_id != self.learner.item_id:
            raise ValueError("protected answer and learner-safe item IDs differ")
        if self.protected_answer.content_version != self.learner.content_version:
            raise ValueError(
                "protected answer and learner-safe content versions differ"
            )
        learner_assets = set(self.learner.asset_ids)
        supplied_assets = {asset.asset_id for asset in self.assets}
        if len(supplied_assets) != len(self.assets):
            raise ValueError("annotation asset IDs must be unique")
        if supplied_assets != learner_assets:
            raise ValueError("annotation evidence must cover every learner-safe asset")
        wrong_scope = [
            asset.asset_id
            for asset in self.assets
            if asset.item_id != self.learner.item_id
        ]
        if wrong_scope:
            raise ValueError(
                "annotation assets must be question-scoped to the learner-safe item: "
                f"{sorted(wrong_scope)}"
            )
        return self

    @property
    def source_review_triggers(self) -> tuple[str, ...]:
        triggers: set[str] = set()
        if any(asset.is_visual for asset in self.assets):
            triggers.add("VISUAL_ASSET_REQUIRES_HUMAN_REVIEW")
        return tuple(sorted(triggers))


class AnnotationSourceEvidence(StrictFrozenModel):
    """Immutable learner-safe source and verified question-scoped assets."""

    item: LearnerSafeItem
    assets: tuple[AnnotationAssetEvidence, ...]

    @property
    def evidence_sha256(self) -> str:
        return canonical_sha256(self)


class Stage1Gate(StrictFrozenModel):
    execution_scope: ExecutionScope

    @property
    def ready(self) -> bool:
        return self.execution_scope is ExecutionScope.SYNTHETIC

    @property
    def blockers(self) -> tuple[str, ...]:
        if self.execution_scope is ExecutionScope.REAL_CORPUS:
            return ("REAL_CORPUS_TYPED_EVIDENCE_GATE_NOT_IMPLEMENTED",)
        return ()


class AnnotationRunConfig(StrictFrozenModel):
    annotation_run_id: str = Field(min_length=1)
    annotation_schema_version: str = Field(min_length=1)
    provider_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    prompt_versions: dict[AnnotationPass, str]
    pass_schema_versions: dict[AnnotationPass, str]
    gate: Stage1Gate

    @model_validator(mode="after")
    def every_pass_is_versioned(self) -> "AnnotationRunConfig":
        expected = set(AnnotationPass)
        if set(self.prompt_versions) != expected:
            raise ValueError("every annotation pass needs a prompt version")
        if set(self.pass_schema_versions) != expected:
            raise ValueError("every annotation pass needs a schema version")
        if any(not value.strip() for value in self.prompt_versions.values()):
            raise ValueError("prompt versions cannot be blank")
        if any(not value.strip() for value in self.pass_schema_versions.values()):
            raise ValueError("pass schema versions cannot be blank")
        return self


class AnnotationPassRequest(StrictFrozenModel):
    pass_name: AnnotationPass
    input_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    cache_key: str = Field(pattern=r"^[0-9a-f]{64}$")
    payload_json: str = Field(min_length=2)

    @field_validator("payload_json")
    @classmethod
    def payload_is_canonical_json_object(cls, value: str) -> str:
        try:
            payload = json.loads(value)
        except json.JSONDecodeError as error:
            raise ValueError("payload_json must contain valid JSON") from error
        if not isinstance(payload, dict):
            raise ValueError("annotation pass payload must be a JSON object")
        canonical = _canonical_json(payload)
        if value != canonical:
            raise ValueError("payload_json must use the canonical JSON representation")
        return value

    @property
    def payload(self) -> dict[str, Any]:
        """Return a fresh copy so a provider cannot mutate the audited request."""

        payload = json.loads(self.payload_json)
        assert isinstance(payload, dict)
        return payload


class AnnotationAuditRecord(StrictFrozenModel):
    """One immutable audit entry for a provider or cache validation attempt."""

    record_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    audit_sequence: int = Field(ge=1)
    annotation_run_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    pass_name: AnnotationPass
    source: Literal["provider", "cache"]
    input_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    cache_key: str = Field(pattern=r"^[0-9a-f]{64}$")
    raw_output_json: str
    raw_output_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    normalized_output_json: str | None = None
    normalized_output_sha256: str | None = Field(
        default=None, pattern=r"^[0-9a-f]{64}$"
    )
    validation_errors: tuple[str, ...] = ()
    recorded_at: datetime

    @model_validator(mode="after")
    def checksums_and_result_are_consistent(self) -> "AnnotationAuditRecord":
        if self.recorded_at.tzinfo is None or self.recorded_at.utcoffset() is None:
            raise ValueError("audit recorded_at requires a timezone")
        if _text_sha256(self.raw_output_json) != self.raw_output_sha256:
            raise ValueError("raw output checksum does not match raw_output_json")
        if (self.normalized_output_json is None) != (
            self.normalized_output_sha256 is None
        ):
            raise ValueError(
                "normalized output and normalized output checksum must appear together"
            )
        if (
            self.normalized_output_json is not None
            and _text_sha256(self.normalized_output_json)
            != self.normalized_output_sha256
        ):
            raise ValueError(
                "normalized output checksum does not match normalized_output_json"
            )
        if self.validation_errors and self.normalized_output_json is not None:
            raise ValueError("invalid output cannot also have a normalized output")
        if not self.validation_errors and self.normalized_output_json is None:
            raise ValueError("a successful audit record requires normalized output")
        return self


class AnnotationAuditLog(Protocol):
    """Append-only audit boundary for private offline annotation evidence."""

    def append(self, record: AnnotationAuditRecord) -> None: ...


class InMemoryAnnotationAuditLog:
    """Append-only synthetic audit log; records are exposed as a frozen tuple."""

    def __init__(self) -> None:
        self._records: tuple[AnnotationAuditRecord, ...] = ()

    @property
    def records(self) -> tuple[AnnotationAuditRecord, ...]:
        return self._records

    def append(self, record: AnnotationAuditRecord) -> None:
        self._records = (*self._records, record)


class AnnotationProvider(Protocol):
    """Offline provider boundary; implementations return schema payloads only."""

    def generate(self, request: AnnotationPassRequest) -> Mapping[str, Any]: ...


class AnnotationCache(Protocol):
    def get(self, cache_key: str) -> Mapping[str, Any] | None: ...

    def put(self, cache_key: str, value: Mapping[str, Any]) -> None: ...


class InMemoryAnnotationCache:
    """Small deterministic cache used by synthetic tests and local dry runs."""

    def __init__(self) -> None:
        self._values: dict[str, dict[str, Any]] = {}

    def get(self, cache_key: str) -> Mapping[str, Any] | None:
        value = self._values.get(cache_key)
        return None if value is None else dict(value)

    def put(self, cache_key: str, value: Mapping[str, Any]) -> None:
        self._values.setdefault(cache_key, dict(value))


OutputT = TypeVar("OutputT", bound=BaseModel)


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _validation_error_text(error: Exception) -> str:
    return f"{type(error).__name__}: {error}"


def _official_answer_set(
    protected_answer: ProtectedAnswer,
    answer_type: AnswerType,
) -> tuple[str, ...]:
    """Normalize protected answer evidence using a deterministic grammar."""

    raw = protected_answer.official_answer
    if answer_type in {AnswerType.VOID, AnswerType.UNKNOWN} and raw is None:
        return ()
    if raw is None or not raw.strip():
        if answer_type is AnswerType.SINGLE_CHOICE:
            raise ValueError("single-choice annotation requires one protected answer")
        return ()
    stripped = raw.strip()
    if answer_type is AnswerType.SINGLE_CHOICE:
        return (stripped,)

    if stripped.startswith("["):
        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError as error:
            raise ValueError(
                "multiple-choice protected answer JSON is invalid"
            ) from error
        if not isinstance(decoded, list) or not all(
            isinstance(answer, str) for answer in decoded
        ):
            raise ValueError(
                "multiple-choice protected answer JSON must be a string list"
            )
        answers = tuple(answer.strip() for answer in decoded)
    else:
        answers = tuple(
            answer.strip() for answer in stripped.replace(";", ",").split(",")
        )
    if any(not answer for answer in answers):
        raise ValueError("protected answer set cannot contain blank answers")
    if len(set(answers)) != len(answers):
        raise ValueError("protected answer set cannot contain duplicate answers")
    return answers


def _non_mastery_vocabularies(
    ontology: OntologyDocument,
) -> dict[str, set[str]]:
    extra = ontology.model_extra or {}
    raw = extra.get("non_mastery_tag_vocabularies", {})
    if not isinstance(raw, dict):
        return {}
    vocabularies: dict[str, set[str]] = {}
    for facet, entries in raw.items():
        if not isinstance(entries, list):
            continue
        vocabularies[str(facet)] = {
            str(entry["tag_id"])
            for entry in entries
            if isinstance(entry, dict) and isinstance(entry.get("tag_id"), str)
        }
    return vocabularies


class AnnotationOrchestrator:
    def __init__(
        self,
        *,
        provider: AnnotationProvider,
        cache: AnnotationCache,
        ontology: OntologyDocument,
        ontology_sha256: str,
        config: AnnotationRunConfig,
        audit_log: AnnotationAuditLog | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if len(ontology_sha256) != 64 or any(
            character not in "0123456789abcdef" for character in ontology_sha256
        ):
            raise ValueError("ontology_sha256 must be a full SHA-256 digest")
        self.provider = provider
        self.cache = cache
        self.audit_log = audit_log or InMemoryAnnotationAuditLog()
        self.ontology = ontology
        self.ontology_sha256 = ontology_sha256
        self.config = config
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._audit_sequence = 0

    def annotate(self, item: AnnotationItem) -> AnnotationBundle:
        if not self.config.gate.ready:
            blockers = ", ".join(self.config.gate.blockers)
            raise Stage1BlockedError(
                f"real-corpus Stage 1 annotation is blocked: {blockers}"
            )

        official_answers = _official_answer_set(
            item.protected_answer,
            item.learner.answer_type,
        )
        source_evidence = AnnotationSourceEvidence(
            item=item.learner,
            assets=item.assets,
        )
        source_payload = {
            "learner_safe_source": source_evidence.model_dump(mode="json"),
            "learner_safe_source_sha256": source_evidence.evidence_sha256,
        }
        pass_a_payload = {
            **source_payload,
            "instructions": {
                "answer_key_visible": False,
                "purpose": "independent_solve",
            },
        }
        self._assert_answer_key_absent(pass_a_payload)
        independent = self._run_pass(
            AnnotationPass.INDEPENDENT_SOLVE,
            pass_a_payload,
            IndependentSolveOutput,
            item,
        )

        pass_b_payload = {
            **source_payload,
            "independent_solve": independent.model_dump(mode="json"),
            "protected_answer": item.protected_answer.model_dump(mode="json"),
            "instructions": {"purpose": "verify_against_official_evidence"},
        }
        trusted_verification_fields: dict[str, Any] = {
            "answer_type": item.learner.answer_type.value,
            "answer_agreement": derive_answer_agreement(
                answer_type=item.learner.answer_type,
                independent_answers=independent.candidate_answers,
                official_answers=official_answers,
            ),
            "independent_answers": list(independent.candidate_answers),
            "official_answers": list(official_answers),
            "official_answer_status": item.protected_answer.answer_status,
        }
        verification = self._run_pass(
            AnnotationPass.VERIFICATION,
            pass_b_payload,
            VerificationOutput,
            item,
            trusted_output_fields=trusted_verification_fields,
        )

        vocabulary = _non_mastery_vocabularies(self.ontology)
        pass_c_payload = {
            **source_payload,
            "independent_solve": independent.model_dump(mode="json"),
            "verification": verification.model_dump(mode="json"),
            "ontology": {
                "ontology_version": self.ontology.ontology_version,
                "allowed_skill_ids": sorted(
                    skill.skill_id for skill in self.ontology.skills
                ),
                "allowed_representation_tags": sorted(
                    vocabulary.get("representation", set())
                ),
                "allowed_cognitive_demand_tags": sorted(
                    vocabulary.get("cognitive_demand", set())
                ),
                "allowed_nuisance_load_tags": sorted(
                    vocabulary.get("nuisance_load", set())
                ),
                "new_skills_must_enter_proposal_queue": True,
                "prerequisites_are_proposals_only": True,
            },
            "choices": list(item.learner.choices),
        }
        cognitive = self._run_pass(
            AnnotationPass.COGNITIVE,
            pass_c_payload,
            CognitiveAnnotationOutput,
            item,
            output_validator=self._validate_cognitive_vocabulary,
        )

        pass_d_payload = {
            **source_payload,
            "independent_solve": independent.model_dump(mode="json"),
            "verification": verification.model_dump(mode="json"),
            "cognitive": cognitive.model_dump(mode="json"),
            "critic_targets": [
                "overtagging",
                "expert_only_paths",
                "hidden_visual_assumptions",
                "alternate_solutions",
                "false_distractor_diagnoses",
            ],
        }
        critic = self._run_pass(
            AnnotationPass.CRITIC,
            pass_d_payload,
            CriticOutput,
            item,
        )

        proposed = AnnotationBundle(
            item_id=item.learner.item_id,
            content_version=item.learner.content_version,
            ontology_version=self.ontology.ontology_version,
            ontology_sha256=self.ontology_sha256,
            annotation_schema_version=self.config.annotation_schema_version,
            status="needs_review",
            source_review_triggers=item.source_review_triggers,
            independent_solve=independent,
            verification=verification,
            cognitive=cognitive,
            critic=critic,
        )
        status = "needs_review" if proposed.mandatory_review_triggers else "proposed"
        if status == proposed.status:
            return proposed
        return AnnotationBundle.model_validate(
            {**proposed.model_dump(mode="json"), "status": status}
        )

    def _run_pass(
        self,
        pass_name: AnnotationPass,
        payload: dict[str, Any],
        output_type: type[OutputT],
        item: AnnotationItem,
        *,
        trusted_output_fields: Mapping[str, Any] | None = None,
        output_validator: Callable[[OutputT], None] | None = None,
    ) -> OutputT:
        trusted_fields = dict(trusted_output_fields or {})
        input_sha256 = canonical_sha256(payload)
        cache_key = canonical_sha256(
            {
                "annotation_run_id": self.config.annotation_run_id,
                "provider_id": self.config.provider_id,
                "model_id": self.config.model_id,
                "prompt_version": self.config.prompt_versions[pass_name],
                "schema_version": self.config.pass_schema_versions[pass_name],
                "pass_name": pass_name.value,
                "item_id": item.learner.item_id,
                "content_version": item.learner.content_version,
                "input_sha256": input_sha256,
            }
        )
        request = AnnotationPassRequest(
            pass_name=pass_name,
            input_sha256=input_sha256,
            cache_key=cache_key,
            payload_json=_canonical_json(payload),
        )
        cached = self.cache.get(cache_key)
        if cached is not None:
            cached_output = dict(cached)
            try:
                _canonical_json(cached_output)
            except (TypeError, ValueError) as error:
                contract_error = ValueError(
                    "cached annotation output must be JSON-safe"
                )
                self._append_audit(
                    source="cache",
                    pass_name=pass_name,
                    request=request,
                    item=item,
                    raw_output=cached_output,
                    normalized_output=None,
                    validation_errors=(
                        _validation_error_text(contract_error),
                        _validation_error_text(error),
                    ),
                )
                raise contract_error from error
            mismatched_trusted_fields = [
                field_name
                for field_name, trusted_value in trusted_fields.items()
                if cached_output.get(field_name) != trusted_value
            ]
            if mismatched_trusted_fields:
                error = ValueError(
                    "cached output does not match trusted verification fields: "
                    f"{sorted(mismatched_trusted_fields)}"
                )
                self._append_audit(
                    source="cache",
                    pass_name=pass_name,
                    request=request,
                    item=item,
                    raw_output=cached_output,
                    normalized_output=None,
                    validation_errors=(_validation_error_text(error),),
                )
                raise error
            return self._validate_and_audit_output(
                source="cache",
                pass_name=pass_name,
                request=request,
                item=item,
                raw_output=cached_output,
                normalized_candidate=cached_output,
                output_type=output_type,
                output_validator=output_validator,
            )

        try:
            raw_output = dict(self.provider.generate(request))
        except Exception as error:
            self._append_audit(
                source="provider",
                pass_name=pass_name,
                request=request,
                item=item,
                raw_output={},
                normalized_output=None,
                validation_errors=(_validation_error_text(error),),
            )
            raise
        try:
            _canonical_json(raw_output)
        except (TypeError, ValueError) as error:
            contract_error = ValueError("provider annotation output must be JSON-safe")
            self._append_audit(
                source="provider",
                pass_name=pass_name,
                request=request,
                item=item,
                raw_output=raw_output,
                normalized_output=None,
                validation_errors=(
                    _validation_error_text(contract_error),
                    _validation_error_text(error),
                ),
            )
            raise contract_error from error
        reserved = {"provenance", *trusted_fields}
        overlap = reserved & set(raw_output)
        if overlap:
            error = ValueError(
                "providers may not choose trusted verification/provenance fields: "
                f"{sorted(overlap)}"
            )
            self._append_audit(
                source="provider",
                pass_name=pass_name,
                request=request,
                item=item,
                raw_output=raw_output,
                normalized_output=None,
                validation_errors=(_validation_error_text(error),),
            )
            raise error
        generated_at = self._now()
        provenance = PassProvenance(
            annotation_run_id=self.config.annotation_run_id,
            item_id=item.learner.item_id,
            content_version=item.learner.content_version,
            pass_name=pass_name,
            provider_id=self.config.provider_id,
            model_id=self.config.model_id,
            prompt_version=self.config.prompt_versions[pass_name],
            schema_version=self.config.pass_schema_versions[pass_name],
            input_sha256=input_sha256,
            generated_at=generated_at,
        )
        normalized_candidate = {
            "provenance": provenance.model_dump(mode="json"),
            **raw_output,
            **trusted_fields,
        }
        output = self._validate_and_audit_output(
            source="provider",
            pass_name=pass_name,
            request=request,
            item=item,
            raw_output=raw_output,
            normalized_candidate=normalized_candidate,
            output_type=output_type,
            output_validator=output_validator,
        )
        self.cache.put(cache_key, output.model_dump(mode="json"))
        return output

    def _validate_and_audit_output(
        self,
        *,
        source: Literal["provider", "cache"],
        pass_name: AnnotationPass,
        request: AnnotationPassRequest,
        item: AnnotationItem,
        raw_output: Mapping[str, Any],
        normalized_candidate: Mapping[str, Any],
        output_type: type[OutputT],
        output_validator: Callable[[OutputT], None] | None,
    ) -> OutputT:
        try:
            output = output_type.model_validate(normalized_candidate)
            if output_validator is not None:
                output_validator(output)
        except Exception as error:
            self._append_audit(
                source=source,
                pass_name=pass_name,
                request=request,
                item=item,
                raw_output=raw_output,
                normalized_output=None,
                validation_errors=(_validation_error_text(error),),
            )
            raise
        self._append_audit(
            source=source,
            pass_name=pass_name,
            request=request,
            item=item,
            raw_output=raw_output,
            normalized_output=output.model_dump(mode="json"),
            validation_errors=(),
        )
        return output

    def _append_audit(
        self,
        *,
        source: Literal["provider", "cache"],
        pass_name: AnnotationPass,
        request: AnnotationPassRequest,
        item: AnnotationItem,
        raw_output: Mapping[str, Any],
        normalized_output: Mapping[str, Any] | None,
        validation_errors: tuple[str, ...],
    ) -> None:
        recorded_at = self._now()
        try:
            raw_json = _canonical_json(raw_output)
        except (TypeError, ValueError) as error:
            raw_json = _canonical_json(
                {
                    "unserializable_provider_output_repr": repr(raw_output),
                    "serialization_error": _validation_error_text(error),
                }
            )
            if not validation_errors:
                validation_errors = (_validation_error_text(error),)
                normalized_output = None
        normalized_json = (
            None if normalized_output is None else _canonical_json(normalized_output)
        )
        raw_sha256 = _text_sha256(raw_json)
        normalized_sha256 = (
            None if normalized_json is None else _text_sha256(normalized_json)
        )
        self._audit_sequence += 1
        record_identity = {
            "audit_sequence": self._audit_sequence,
            "annotation_run_id": self.config.annotation_run_id,
            "item_id": item.learner.item_id,
            "content_version": item.learner.content_version,
            "pass_name": pass_name.value,
            "source": source,
            "input_sha256": request.input_sha256,
            "cache_key": request.cache_key,
            "raw_output_sha256": raw_sha256,
            "normalized_output_sha256": normalized_sha256,
            "validation_errors": list(validation_errors),
            "recorded_at": recorded_at.isoformat(),
        }
        self.audit_log.append(
            AnnotationAuditRecord(
                record_id=canonical_sha256(record_identity),
                audit_sequence=self._audit_sequence,
                annotation_run_id=self.config.annotation_run_id,
                item_id=item.learner.item_id,
                content_version=item.learner.content_version,
                pass_name=pass_name,
                source=source,
                input_sha256=request.input_sha256,
                cache_key=request.cache_key,
                raw_output_json=raw_json,
                raw_output_sha256=raw_sha256,
                normalized_output_json=normalized_json,
                normalized_output_sha256=normalized_sha256,
                validation_errors=validation_errors,
                recorded_at=recorded_at,
            )
        )

    def _now(self) -> datetime:
        value = self.clock()
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("annotation clock must return a timezone-aware datetime")
        return value

    @staticmethod
    def _assert_answer_key_absent(payload: Mapping[str, Any]) -> None:
        banned = {
            "official_answer",
            "official_answers",
            "protected_answer",
            "answer_key",
            "correct_answer",
        }

        def walk(value: Any) -> None:
            if isinstance(value, Mapping):
                overlap = banned & {str(key) for key in value}
                if overlap:
                    raise ValueError(
                        f"independent solve payload leaked answer evidence: {sorted(overlap)}"
                    )
                for nested in value.values():
                    walk(nested)
            elif isinstance(value, (list, tuple)):
                for nested in value:
                    walk(nested)

        walk(payload)

    def _validate_cognitive_vocabulary(self, output: CognitiveAnnotationOutput) -> None:
        known_skills = {skill.skill_id for skill in self.ontology.skills}
        attributed = {link.skill_id for link in output.skill_attributions}
        unknown_attributions = attributed - known_skills
        if unknown_attributions:
            raise ValueError(
                "new skills must enter the proposal queue, not the Q-matrix: "
                f"{sorted(unknown_attributions)}"
            )
        for proposal in output.prerequisite_proposals:
            unknown = {
                proposal.from_skill_id,
                proposal.to_skill_id,
            } - known_skills
            if unknown:
                raise ValueError(
                    "prerequisite proposals may reference only existing skills: "
                    f"{sorted(unknown)}"
                )
        proposed_ids = {
            proposal.proposed_skill_id for proposal in output.proposed_skills
        }
        overlap = proposed_ids & known_skills
        if overlap:
            raise ValueError(f"proposed skill IDs already exist: {sorted(overlap)}")

        vocabularies = _non_mastery_vocabularies(self.ontology)
        checks = (
            (
                "representation",
                {tag.tag_id for tag in output.representation_tags},
            ),
            (
                "cognitive_demand",
                {tag.tag_id for tag in output.cognitive_demand_tags},
            ),
            (
                "nuisance_load",
                {tag.tag_id for tag in output.nuisance_loads},
            ),
        )
        for facet, assigned in checks:
            unknown = assigned - vocabularies.get(facet, set())
            if unknown:
                raise ValueError(
                    f"unknown {facet} tag IDs must enter a proposal queue: "
                    f"{sorted(unknown)}"
                )
