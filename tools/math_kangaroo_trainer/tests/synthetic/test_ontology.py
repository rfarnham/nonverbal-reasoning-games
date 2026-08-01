from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.domain.skills import OntologyDocument, load_ontology
from math_kangaroo_trainer.quality.reporting import _ontology_evidence_matches_run


def test_proposed_ontology_is_bounded_acyclic_and_cannot_gate() -> None:
    ontology = load_ontology(default_ontology_path())
    assert 25 <= len(ontology.skills) <= 60
    assert ontology.status == "proposed"
    assert all(skill.status == "proposed" for skill in ontology.skills)
    assert not any(relation.curriculum_gating for relation in ontology.relations)


def test_prerequisite_cycle_is_rejected() -> None:
    data = json.loads(default_ontology_path().read_text(encoding="utf-8"))
    first = next(relation for relation in data["relations"] if relation["type"] == "prerequisite")
    data["relations"].append(
        {
            "relation_id": "synthetic_cycle",
            "type": "prerequisite",
            "from_skill_id": first["to_skill_id"],
            "to_skill_id": first["from_skill_id"],
            "status": "proposed",
            "reviewers": [],
            "curriculum_gating": False,
        }
    )
    with pytest.raises(ValidationError, match="acyclic"):
        OntologyDocument.model_validate(data)


def test_ontology_reviewers_are_canonical_and_deprecated_skills_cannot_pass(
    approved_ontology,
) -> None:
    data = json.loads(approved_ontology.read_text(encoding="utf-8"))
    data["review"]["reviewers"] = [" reviewer-a ", "reviewer-a"]
    ontology = OntologyDocument.model_validate(data)
    assert ontology.review.reviewers == ("reviewer-a", "reviewer-a")
    assert ontology.review_ready is False

    data = json.loads(approved_ontology.read_text(encoding="utf-8"))
    data["skills"][0]["status"] = "deprecated"
    assert OntologyDocument.model_validate(data).review_ready is False


def test_ontology_evidence_is_typed_disjoint_and_bound_to_the_gold_set(
    approved_ontology,
) -> None:
    ontology = load_ontology(approved_ontology)
    gold = ontology.provenance.gold_set_evidence[0]
    matched, reason = _ontology_evidence_matches_run(
        ontology,
        source_sha256=gold.source_sha256,
        item_content_versions=gold.sample_item_content_versions,
    )
    assert (matched, reason) == (True, "matched")

    changed_versions = dict(gold.sample_item_content_versions)
    first_item = next(iter(changed_versions))
    changed_versions[first_item] = "sha256:" + "0" * 64
    matched, reason = _ontology_evidence_matches_run(
        ontology,
        source_sha256=gold.source_sha256,
        item_content_versions=changed_versions,
    )
    assert matched is False
    assert reason == "gold_set_checksum_mismatch"

    malformed = json.loads(approved_ontology.read_text(encoding="utf-8"))
    malformed["provenance"]["gold_set_evidence"] = [{}]
    with pytest.raises(ValidationError):
        OntologyDocument.model_validate(malformed)

    overlapping = json.loads(approved_ontology.read_text(encoding="utf-8"))
    overlapping["skills"][0]["negative_example_item_ids"] = overlapping[
        "skills"
    ][0]["positive_example_item_ids"]
    with pytest.raises(ValidationError, match="overlap"):
        OntologyDocument.model_validate(overlapping)
