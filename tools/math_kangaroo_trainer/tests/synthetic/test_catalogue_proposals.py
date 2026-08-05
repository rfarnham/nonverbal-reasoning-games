from __future__ import annotations

import hashlib
import json

import pytest

from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.corpus import catalogue as catalogue_module
from math_kangaroo_trainer.corpus.catalogue import (
    CATALOGUE_CLASSIFIER_VERSION,
    CATALOGUE_PROPOSAL_SCHEMA_VERSION,
    CognitiveDemandTag,
    PrimaryDomain,
    QuestionType,
    RepresentationTag,
    ReviewFlag,
    catalogue_controlled_vocabularies,
    propose_catalogue_classification,
)
from math_kangaroo_trainer.domain.items import (
    AnswerType,
    ImportedItem,
    ItemStatus,
    LearnerSafeItem,
    ProtectedAnswer,
    SourceQuestion,
)
from math_kangaroo_trainer.domain.skills import OntologyDocument, load_ontology


@pytest.fixture(scope="module")
def ontology() -> OntologyDocument:
    return load_ontology(default_ontology_path())


def imported_item(
    prompt: str,
    *,
    item_id: str = "invented-catalogue-item",
    modality: str = "text_extractable",
    status: ItemStatus = ItemStatus.PARSED,
    warning_codes: tuple[str, ...] = (),
    choices: tuple[str, ...] = ("1", "2", "3", "4", "5"),
) -> ImportedItem:
    content_version = "sha256:" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    raw_choices = json.dumps(list(choices))
    source = SourceQuestion(
        item_id=item_id,
        source_collection="invented-fixture",
        source_path="invented/source.pdf",
        source_file_id="source.pdf",
        source_label="Invented source",
        source_checksum="b" * 64,
        source_family="Invented",
        corpus_group="Invented",
        year=2026,
        grade_band="3-4",
        paper_part="single",
        section="3-point",
        competition_level=None,
        question_number=1,
        page=1,
        end_page=1,
        language="en",
        stem_markdown=prompt,
        raw_options_json=raw_choices,
        choices=choices,
        english_stem=prompt,
        raw_english_options_json=raw_choices,
        english_choices=choices,
        english_helper_needed=False,
        english_prompt_status="not-needed",
        english_options_status="not-needed",
        extraction_status="indexed_complete_text",
        adapter_warning_codes=warning_codes,
        visual_verified=True,
        official_answer="A",
        answer_status="official-verified",
        answer_source_label="Invented answer key",
        asset_id=f"assets/questions/{item_id}.webp",
        image_width=800,
        image_height=400,
        image_bytes=100,
        crop_status="indexed",
        crop_top_points=0,
        crop_bottom_points=100,
        source_page_link="invented/source.pdf#page=1",
        option_count=len(choices),
    )
    learner = LearnerSafeItem(
        item_id=item_id,
        content_version=content_version,
        source_collection="invented-fixture",
        source_file_id="source.pdf",
        source_checksum="b" * 64,
        year=2026,
        contest_track_or_grade_band="3-4",
        question_number=1,
        published_point_value_or_tier=3,
        language="en",
        stem_markdown=prompt,
        choices=choices,
        answer_type=AnswerType.SINGLE_CHOICE,
        asset_ids=(source.asset_id,),
        status=status,
        license_or_use_status="synthetic-test-only",
        schema_version="corpus-item.test.v1",
    )
    protected = ProtectedAnswer(
        item_id=item_id,
        content_version=content_version,
        official_answer="A",
        answer_status="official-verified",
        answer_source_label="Invented answer key",
    )
    return ImportedItem(
        source=source,
        learner=learner,
        protected=protected,
        warning_codes=warning_codes,
        content_gap_codes=(),
        modality=modality,
        year_band="2020_and_later",
        choice_count_bucket="five",
    )


def ontology_non_mastery_ids(
    ontology: OntologyDocument, vocabulary_name: str
) -> set[str]:
    vocabularies = (ontology.model_extra or {})["non_mastery_tag_vocabularies"]
    return {entry["tag_id"] for entry in vocabularies[vocabulary_name]}


def test_controlled_vocabularies_match_dashboard_contract(
    ontology: OntologyDocument,
) -> None:
    vocabulary = catalogue_controlled_vocabularies(ontology)

    assert {option.value for option in vocabulary.primary_domains} == {
        "number_arithmetic",
        "geometry_spatial",
        "measurement_time",
        "patterns_algebra",
        "counting_combinatorics",
        "logic_constraints",
        "probability_data",
        "mixed",
        "unknown",
    }
    assert {option.value for option in vocabulary.question_types} == {
        "computation",
        "number_relationships",
        "word_problem",
        "pattern_sequence",
        "geometry_measurement",
        "spatial_visual",
        "combinatorics_counting",
        "logic_constraints",
        "probability_data",
        "mixed",
        "unknown",
    }
    assert {option.value for option in vocabulary.skills} == {
        skill.skill_id for skill in ontology.skills
    }
    assert {option.value for option in vocabulary.representation_tags} == (
        ontology_non_mastery_ids(ontology, "representation")
    )
    assert {option.value for option in vocabulary.cognitive_demand_tags} == (
        ontology_non_mastery_ids(ontology, "cognitive_demand")
    )
    assert vocabulary.proposals_authoritative is False


def test_every_classifier_rule_uses_bound_ontology_ids(
    ontology: OntologyDocument,
) -> None:
    known_skills = {skill.skill_id for skill in ontology.skills}
    known_representations = ontology_non_mastery_ids(ontology, "representation")
    known_demands = ontology_non_mastery_ids(ontology, "cognitive_demand")

    for signal in catalogue_module._SIGNALS:
        assert {skill_id for skill_id, _ in signal.skill_scores} <= known_skills
        assert {
            representation.value for representation, _ in signal.representation_scores
        } <= known_representations
        assert {demand.value for demand, _ in signal.demand_scores} <= known_demands


def test_proposal_is_deterministic_versioned_and_non_authoritative(
    ontology: OntologyDocument,
) -> None:
    item = imported_item(
        "Mia has 12 marbles and gives 5 away. How many remain?",
        item_id="invented-arithmetic-determinism",
    )

    first = propose_catalogue_classification(item, ontology)
    second = propose_catalogue_classification(item, ontology)

    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert first.schema_version == CATALOGUE_PROPOSAL_SCHEMA_VERSION
    assert first.classifier_version == CATALOGUE_CLASSIFIER_VERSION
    assert first.content_version == item.learner.content_version
    assert first.ontology_version == ontology.ontology_version
    assert first.provenance == "deterministic_metadata_lexical_heuristics"
    assert first.status == "proposed"
    assert first.authoritative is False
    assert ReviewFlag.TEACHER_REVIEW_REQUIRED in first.review_flags
    assert 0 <= first.confidence <= 1


@pytest.mark.parametrize(
    ("prompt", "domain", "question_type", "skills", "representations"),
    (
        (
            "Mia has 12 marbles and gives 5 away. How many remain?",
            PrimaryDomain.NUMBER_ARITHMETIC,
            QuestionType.WORD_PROBLEM,
            {"cnt_whole_addition_subtraction"},
            {RepresentationTag.STORY_TEXT},
        ),
        (
            "A square sheet of paper is folded and then rotated 90 degrees. Which view is correct?",
            PrimaryDomain.GEOMETRY_SPATIAL,
            QuestionType.SPATIAL_VISUAL,
            {"cnt_geometric_transformations"},
            {RepresentationTag.SPATIAL_TRANSFORMATION},
        ),
        (
            "A train leaves at 9:15 and arrives 45 minutes later. What time does it arrive?",
            PrimaryDomain.MEASUREMENT_TIME,
            QuestionType.WORD_PROBLEM,
            {"cnt_time_calendar", "prc_elapsed_time"},
            {RepresentationTag.CLOCK_OR_CALENDAR},
        ),
        (
            "The sequence 2, 4, 8, 16 continues. Which number comes next?",
            PrimaryDomain.PATTERNS_ALGEBRA,
            QuestionType.PATTERN_SEQUENCE,
            {"cnt_numeric_patterns_sequences", "rsn_pattern_generalization"},
            {RepresentationTag.SYMBOLIC_EXPRESSION},
        ),
    ),
)
def test_representative_proposals_keep_facets_separate(
    ontology: OntologyDocument,
    prompt: str,
    domain: PrimaryDomain,
    question_type: QuestionType,
    skills: set[str],
    representations: set[RepresentationTag],
) -> None:
    proposal = propose_catalogue_classification(imported_item(prompt), ontology)
    known_skill_ids = {skill.skill_id for skill in ontology.skills}

    assert proposal.primary_domain is domain
    assert proposal.question_type is question_type
    assert skills <= set(proposal.skill_ids) <= known_skill_ids
    assert representations <= set(proposal.representation_tags)
    assert proposal.cognitive_demand_tag in set(CognitiveDemandTag)
    assert proposal.authoritative is False


def test_unknown_text_stays_unknown_and_routes_to_review(
    ontology: OntologyDocument,
) -> None:
    proposal = propose_catalogue_classification(
        imported_item("Which answer is correct?"), ontology
    )

    assert proposal.primary_domain is PrimaryDomain.UNKNOWN
    assert proposal.question_type is QuestionType.UNKNOWN
    assert proposal.skill_ids == ()
    assert proposal.representation_tags == ()
    assert proposal.cognitive_demand_tag is None
    assert proposal.confidence < 0.55
    assert {
        ReviewFlag.NO_DOMAIN_SIGNAL,
        ReviewFlag.NO_QUESTION_TYPE_SIGNAL,
        ReviewFlag.NO_SKILL_SIGNAL,
        ReviewFlag.NO_REPRESENTATION_SIGNAL,
        ReviewFlag.COGNITIVE_DEMAND_UNKNOWN,
        ReviewFlag.LOW_CONFIDENCE,
        ReviewFlag.TEACHER_REVIEW_REQUIRED,
    } <= set(proposal.review_flags)


def test_competing_strong_signals_become_mixed_not_false_precision(
    ontology: OntologyDocument,
) -> None:
    proposal = propose_catalogue_classification(
        imported_item(
            "A cube is rotated. What is the probability that the marked face is on top?",
            modality="diagram_dependent",
        ),
        ontology,
    )

    assert proposal.primary_domain is PrimaryDomain.MIXED
    assert proposal.question_type is QuestionType.MIXED
    assert ReviewFlag.MIXED_DOMAIN_CANDIDATE in proposal.review_flags
    assert ReviewFlag.MIXED_QUESTION_TYPE_CANDIDATE in proposal.review_flags
    assert ReviewFlag.VISUAL_EVIDENCE_REQUIRES_HUMAN_REVIEW in proposal.review_flags
    assert proposal.confidence <= 0.45
