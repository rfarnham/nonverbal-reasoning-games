"""Validated proposed ontology and reviewed prerequisite DAG rules."""

from __future__ import annotations

import json
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _canonical_reviewers(values: object) -> object:
    if not isinstance(values, (list, tuple)):
        return values
    canonical: list[object] = []
    for value in values:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("reviewer identities cannot be blank")
        canonical.append(value)
    return tuple(canonical)


class FlexibleFrozenModel(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)


class GradeRange(FlexibleFrozenModel):
    min: int = Field(ge=1, le=12)
    max: int = Field(ge=1, le=12)

    @model_validator(mode="after")
    def ordered(self) -> "GradeRange":
        if self.max < self.min:
            raise ValueError("grade range maximum cannot precede its minimum")
        return self


class Skill(FlexibleFrozenModel):
    skill_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    facet: Literal["mathematical_content", "reasoning_move", "procedure"]
    parent_skill_id: str | None = None
    typical_grade_range: GradeRange
    boundary_note: str = Field(min_length=1)
    positive_example_item_ids: tuple[str, ...] = ()
    negative_example_item_ids: tuple[str, ...] = ()
    status: Literal["proposed", "approved", "deprecated"]

    @model_validator(mode="after")
    def examples_are_distinct(self) -> "Skill":
        if any(not item_id.strip() for item_id in self.positive_example_item_ids):
            raise ValueError(f"{self.skill_id}: positive example IDs cannot be blank")
        if any(not item_id.strip() for item_id in self.negative_example_item_ids):
            raise ValueError(f"{self.skill_id}: negative example IDs cannot be blank")
        if len(set(self.positive_example_item_ids)) != len(
            self.positive_example_item_ids
        ) or len(set(self.negative_example_item_ids)) != len(
            self.negative_example_item_ids
        ):
            raise ValueError(f"{self.skill_id}: example IDs must be unique")
        if set(self.positive_example_item_ids) & set(self.negative_example_item_ids):
            raise ValueError(f"{self.skill_id}: positive and negative examples overlap")
        return self


class SkillRelation(FlexibleFrozenModel):
    relation_id: str = Field(min_length=1)
    type: Literal[
        "prerequisite",
        "part_of",
        "often_combined_with",
        "contrasts_with",
        "alternative_to",
    ]
    from_skill_id: str = Field(min_length=1)
    to_skill_id: str = Field(min_length=1)
    status: Literal["proposed", "approved", "deprecated"]
    reviewers: tuple[str, ...] = ()
    curriculum_gating: bool = False

    _normalize_reviewers = field_validator("reviewers", mode="before")(
        _canonical_reviewers
    )


class OntologyReview(FlexibleFrozenModel):
    state: Literal["unreviewed", "in_review", "approved"]
    reviewers: tuple[str, ...] = ()
    reviewed_at: datetime | None = None
    approved_at: datetime | None = None

    _normalize_reviewers = field_validator("reviewers", mode="before")(
        _canonical_reviewers
    )


class SkillBoundaryExamples(FlexibleFrozenModel):
    positive_item_ids: tuple[str, ...] = Field(min_length=1)
    negative_item_ids: tuple[str, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def disjoint(self) -> "SkillBoundaryExamples":
        if set(self.positive_item_ids) & set(self.negative_item_ids):
            raise ValueError("positive and negative boundary examples must be disjoint")
        return self


class ReviewedOntologyEvidence(FlexibleFrozenModel):
    evidence_id: str = Field(min_length=1)
    gold_set_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    reviewers: tuple[str, ...] = Field(min_length=2)
    reviewed_at: datetime

    _normalize_reviewers = field_validator("reviewers", mode="before")(
        _canonical_reviewers
    )

    @model_validator(mode="after")
    def explicit_review_evidence(self) -> "ReviewedOntologyEvidence":
        if self.reviewed_at.tzinfo is None or self.reviewed_at.utcoffset() is None:
            raise ValueError("ontology evidence reviewed_at requires a timezone")
        if len(set(self.reviewers)) < 2:
            raise ValueError("ontology evidence requires two independent reviewers")
        return self


class GoldSetEvidence(ReviewedOntologyEvidence):
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    sample_item_content_versions: dict[str, str] = Field(min_length=1)

    @model_validator(mode="after")
    def content_versions_are_pinned(self) -> "GoldSetEvidence":
        for item_id, content_version in self.sample_item_content_versions.items():
            if not item_id or not re_full_content_version(content_version):
                raise ValueError("gold evidence requires pinned item content versions")
        return self


class ItemAnnotationEvidence(ReviewedOntologyEvidence):
    skill_boundaries: dict[str, SkillBoundaryExamples] = Field(min_length=1)
    item_content_versions: dict[str, str] = Field(min_length=1)

    @model_validator(mode="after")
    def boundary_content_versions_are_pinned(self) -> "ItemAnnotationEvidence":
        referenced = {
            item_id
            for boundary in self.skill_boundaries.values()
            for item_id in (
                *boundary.positive_item_ids,
                *boundary.negative_item_ids,
            )
        }
        if referenced != set(self.item_content_versions):
            raise ValueError(
                "boundary evidence content versions must match referenced items"
            )
        if any(
            not re_full_content_version(version)
            for version in self.item_content_versions.values()
        ):
            raise ValueError("boundary evidence requires pinned content versions")
        return self


def re_full_content_version(value: str) -> bool:
    import re

    return re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


class OntologyProvenance(FlexibleFrozenModel):
    kind: str = Field(min_length=1)
    item_annotation_evidence: tuple[ItemAnnotationEvidence, ...] = ()
    gold_set_evidence: tuple[GoldSetEvidence, ...] = ()
    note: str | None = None


class OntologyDocument(FlexibleFrozenModel):
    schema_version: str
    ontology_id: str
    ontology_version: str
    status: Literal["proposed", "approved", "deprecated"]
    review: OntologyReview
    provenance: OntologyProvenance
    scope: dict[str, Any]
    skills: tuple[Skill, ...]
    relations: tuple[SkillRelation, ...]

    @model_validator(mode="after")
    def validate_graph(self) -> "OntologyDocument":
        if not 25 <= len(self.skills) <= 60:
            raise ValueError("ontology must contain 25–60 teachable skills")
        skill_ids = [skill.skill_id for skill in self.skills]
        if len(skill_ids) != len(set(skill_ids)):
            raise ValueError("skill IDs must be unique")
        known = set(skill_ids)
        relation_ids = [relation.relation_id for relation in self.relations]
        if len(relation_ids) != len(set(relation_ids)):
            raise ValueError("relation IDs must be unique")
        for skill in self.skills:
            if skill.parent_skill_id is not None and skill.parent_skill_id not in known:
                raise ValueError(
                    f"{skill.skill_id}: unknown parent {skill.parent_skill_id}"
                )
        for relation in self.relations:
            if relation.from_skill_id not in known or relation.to_skill_id not in known:
                raise ValueError(f"{relation.relation_id}: relation references unknown skill")
            if relation.from_skill_id == relation.to_skill_id:
                raise ValueError(f"{relation.relation_id}: self relation is invalid")
            if relation.curriculum_gating and not (
                relation.type == "prerequisite"
                and relation.status == "approved"
                and len(set(relation.reviewers)) >= 2
            ):
                raise ValueError(
                    f"{relation.relation_id}: curriculum gates require an approved, "
                    "doubly reviewed prerequisite"
                )

        adjacency: dict[str, list[str]] = {skill_id: [] for skill_id in known}
        for relation in self.relations:
            if relation.type == "prerequisite":
                adjacency[relation.from_skill_id].append(relation.to_skill_id)
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(skill_id: str) -> None:
            if skill_id in visiting:
                raise ValueError("strict prerequisite graph must be acyclic")
            if skill_id in visited:
                return
            visiting.add(skill_id)
            for child in adjacency[skill_id]:
                visit(child)
            visiting.remove(skill_id)
            visited.add(skill_id)

        for skill_id in sorted(known):
            visit(skill_id)
        expected_count = self.scope.get("skill_count")
        if expected_count is not None and expected_count != len(self.skills):
            raise ValueError("scope.skill_count does not match skills")
        return self

    @property
    def review_ready(self) -> bool:
        return (
            self.status == "approved"
            and self.review.state == "approved"
            and len(set(self.review.reviewers)) >= 2
            and self.review.reviewed_at is not None
            and self.review.approved_at is not None
            and self.review.reviewed_at.tzinfo is not None
            and self.review.reviewed_at.utcoffset() is not None
            and self.review.approved_at.tzinfo is not None
            and self.review.approved_at.utcoffset() is not None
            and self.review.approved_at >= self.review.reviewed_at
            and bool(self.provenance.gold_set_evidence)
            and bool(self.provenance.item_annotation_evidence)
            and all(
                skill.status == "approved"
                and bool(skill.positive_example_item_ids)
                and bool(skill.negative_example_item_ids)
                for skill in self.skills
            )
        )

    def summary(self) -> dict[str, Any]:
        facet_counts: dict[str, int] = {}
        for skill in self.skills:
            facet_counts[skill.facet] = facet_counts.get(skill.facet, 0) + 1
        return {
            "ontology_id": self.ontology_id,
            "ontology_version": self.ontology_version,
            "status": self.status,
            "review_state": self.review.state,
            "reviewer_count": len(set(self.review.reviewers)),
            "review_ready": self.review_ready,
            "gold_set_evidence_count": len(self.provenance.gold_set_evidence),
            "item_annotation_evidence_count": len(
                self.provenance.item_annotation_evidence
            ),
            "skills_with_boundary_examples": sum(
                bool(skill.positive_example_item_ids)
                and bool(skill.negative_example_item_ids)
                for skill in self.skills
            ),
            "skill_count": len(self.skills),
            "facet_counts": dict(sorted(facet_counts.items())),
            "relation_count": len(self.relations),
            "prerequisite_count": sum(
                relation.type == "prerequisite" for relation in self.relations
            ),
            "curriculum_gating_edge_count": sum(
                relation.curriculum_gating for relation in self.relations
            ),
        }


def load_ontology(path: Path) -> OntologyDocument:
    return OntologyDocument.model_validate_json(path.read_text(encoding="utf-8"))


def ontology_checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def gold_set_checksum(item_content_versions: dict[str, str]) -> str:
    manifest = sorted(item_content_versions.items())
    encoded = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
