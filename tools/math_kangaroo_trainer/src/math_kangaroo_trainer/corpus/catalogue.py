"""Conservative, deterministic catalogue-classification proposals.

This module is intentionally smaller and less ambitious than the Stage 1
annotation pipeline.  It turns explicit metadata and lexical cues into a
review queue seed; it does not solve questions, approve curriculum labels, or
change an item's status.  Every result is bound to the source content and
ontology versions and is structurally marked as a proposal requiring a human
review.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from enum import StrEnum
from collections.abc import Mapping
from typing import Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from math_kangaroo_trainer.domain.items import AnswerType, ImportedItem, ItemStatus
from math_kangaroo_trainer.domain.skills import OntologyDocument


CATALOGUE_PROPOSAL_SCHEMA_VERSION = "catalogue-classification-proposal.v1"
CATALOGUE_CLASSIFIER_VERSION = "deterministic-lexical-catalogue.v1"
CATALOGUE_VOCABULARY_SCHEMA_VERSION = "catalogue-classification-vocabulary.v1"


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PrimaryDomain(StrEnum):
    NUMBER_ARITHMETIC = "number_arithmetic"
    GEOMETRY_SPATIAL = "geometry_spatial"
    MEASUREMENT_TIME = "measurement_time"
    PATTERNS_ALGEBRA = "patterns_algebra"
    COUNTING_COMBINATORICS = "counting_combinatorics"
    LOGIC_CONSTRAINTS = "logic_constraints"
    PROBABILITY_DATA = "probability_data"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class QuestionType(StrEnum):
    COMPUTATION = "computation"
    NUMBER_RELATIONSHIPS = "number_relationships"
    WORD_PROBLEM = "word_problem"
    PATTERN_SEQUENCE = "pattern_sequence"
    GEOMETRY_MEASUREMENT = "geometry_measurement"
    SPATIAL_VISUAL = "spatial_visual"
    COMBINATORICS_COUNTING = "combinatorics_counting"
    LOGIC_CONSTRAINTS = "logic_constraints"
    PROBABILITY_DATA = "probability_data"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class RepresentationTag(StrEnum):
    STORY_TEXT = "rep_story_text"
    SYMBOLIC_EXPRESSION = "rep_symbolic_expression"
    TABLE = "rep_table"
    NUMBER_LINE = "rep_number_line"
    GRID = "rep_grid"
    CLOCK_OR_CALENDAR = "rep_clock_or_calendar"
    GEOMETRIC_DIAGRAM_2D = "rep_geometric_diagram_2d"
    SOLID_DIAGRAM_3D = "rep_solid_diagram_3d"
    SPATIAL_TRANSFORMATION = "rep_spatial_transformation"
    GRAPH_OR_NETWORK = "rep_graph_or_network"
    PHYSICAL_ARRANGEMENT = "rep_physical_arrangement"
    MIXED = "rep_mixed"


class CognitiveDemandTag(StrEnum):
    DIRECT_APPLICATION = "demand_direct_application"
    ONE_STEP_INFERENCE = "demand_one_step_inference"
    MULTI_STEP_INTEGRATION = "demand_multi_step_integration"
    STRATEGY_SELECTION = "demand_strategy_selection"
    NEAR_TRANSFER = "demand_near_transfer"
    NOVEL_TRANSFER = "demand_novel_transfer"


class ReviewFlag(StrEnum):
    TEACHER_REVIEW_REQUIRED = "TEACHER_REVIEW_REQUIRED"
    ONTOLOGY_NOT_APPROVED = "ONTOLOGY_NOT_APPROVED"
    SOURCE_ITEM_NEEDS_REVIEW = "SOURCE_ITEM_NEEDS_REVIEW"
    SOURCE_WARNINGS_PRESENT = "SOURCE_WARNINGS_PRESENT"
    ANSWER_NOT_SINGLE_VERIFIED = "ANSWER_NOT_SINGLE_VERIFIED"
    CHOICES_NOT_STRUCTURED = "CHOICES_NOT_STRUCTURED"
    VISUAL_EVIDENCE_REQUIRES_HUMAN_REVIEW = "VISUAL_EVIDENCE_REQUIRES_HUMAN_REVIEW"
    AMBIGUOUS_PRIMARY_DOMAIN = "AMBIGUOUS_PRIMARY_DOMAIN"
    AMBIGUOUS_QUESTION_TYPE = "AMBIGUOUS_QUESTION_TYPE"
    MIXED_DOMAIN_CANDIDATE = "MIXED_DOMAIN_CANDIDATE"
    MIXED_QUESTION_TYPE_CANDIDATE = "MIXED_QUESTION_TYPE_CANDIDATE"
    NO_DOMAIN_SIGNAL = "NO_DOMAIN_SIGNAL"
    NO_QUESTION_TYPE_SIGNAL = "NO_QUESTION_TYPE_SIGNAL"
    NO_SKILL_SIGNAL = "NO_SKILL_SIGNAL"
    NO_REPRESENTATION_SIGNAL = "NO_REPRESENTATION_SIGNAL"
    COGNITIVE_DEMAND_UNKNOWN = "COGNITIVE_DEMAND_UNKNOWN"
    ONTOLOGY_SKILL_UNAVAILABLE = "ONTOLOGY_SKILL_UNAVAILABLE"
    ONTOLOGY_TAG_UNAVAILABLE = "ONTOLOGY_TAG_UNAVAILABLE"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"


class VocabularyOption(StrictFrozenModel):
    value: str = Field(min_length=1)
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)


class SkillVocabularyOption(VocabularyOption):
    facet: Literal["mathematical_content", "reasoning_move", "procedure"]
    status: Literal["proposed", "approved", "deprecated"]


class CatalogueControlledVocabularies(StrictFrozenModel):
    schema_version: Literal[
        "catalogue-classification-vocabulary.v1"
    ] = "catalogue-classification-vocabulary.v1"
    classifier_version: Literal[
        "deterministic-lexical-catalogue.v1"
    ] = "deterministic-lexical-catalogue.v1"
    ontology_version: str = Field(min_length=1)
    proposals_authoritative: Literal[False] = False
    primary_domains: tuple[VocabularyOption, ...]
    question_types: tuple[VocabularyOption, ...]
    skills: tuple[SkillVocabularyOption, ...]
    representation_tags: tuple[VocabularyOption, ...]
    cognitive_demand_tags: tuple[VocabularyOption, ...]
    review_flags: tuple[VocabularyOption, ...]


class CatalogueClassificationProposal(StrictFrozenModel):
    """One unapproved classification candidate for a fixed item version."""

    schema_version: Literal[
        "catalogue-classification-proposal.v1"
    ] = "catalogue-classification-proposal.v1"
    classifier_version: Literal[
        "deterministic-lexical-catalogue.v1"
    ] = "deterministic-lexical-catalogue.v1"
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    ontology_version: str = Field(min_length=1)
    provenance: Literal[
        "deterministic_metadata_lexical_heuristics"
    ] = "deterministic_metadata_lexical_heuristics"
    status: Literal["proposed"] = "proposed"
    authoritative: Literal[False] = False
    primary_domain: PrimaryDomain
    question_type: QuestionType
    skill_ids: tuple[str, ...]
    representation_tags: tuple[RepresentationTag, ...]
    cognitive_demand_tag: CognitiveDemandTag | None
    confidence: float = Field(ge=0, le=1)
    evidence: tuple[str, ...] = Field(min_length=1)
    reasons: tuple[str, ...] = Field(min_length=1)
    review_flags: tuple[ReviewFlag, ...] = Field(min_length=1)

    @field_validator("skill_ids")
    @classmethod
    def skill_ids_are_canonical(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not skill_id.strip() for skill_id in value):
            raise ValueError("proposed skill IDs cannot be blank")
        if tuple(sorted(set(value))) != value:
            raise ValueError("proposed skill IDs must be sorted and unique")
        return value

    @field_validator("representation_tags", "review_flags")
    @classmethod
    def enum_tuples_are_unique(cls, value: tuple[StrEnum, ...]) -> tuple[StrEnum, ...]:
        if len(set(value)) != len(value):
            raise ValueError("controlled-vocabulary values must be unique")
        return value

    @field_validator("evidence", "reasons")
    @classmethod
    def text_evidence_is_canonical(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not entry.strip() or entry != entry.strip() for entry in value):
            raise ValueError("evidence and reasons require canonical nonblank text")
        if len(set(value)) != len(value):
            raise ValueError("evidence and reasons must be unique")
        return value

    @model_validator(mode="after")
    def uncertain_results_are_flagged(self) -> "CatalogueClassificationProposal":
        flags = set(self.review_flags)
        if self.primary_domain is PrimaryDomain.UNKNOWN and (
            ReviewFlag.NO_DOMAIN_SIGNAL not in flags
        ):
            raise ValueError("unknown primary domain requires an explicit review flag")
        if self.primary_domain is PrimaryDomain.MIXED and (
            ReviewFlag.MIXED_DOMAIN_CANDIDATE not in flags
        ):
            raise ValueError("mixed primary domain requires an explicit review flag")
        if self.question_type is QuestionType.UNKNOWN and (
            ReviewFlag.NO_QUESTION_TYPE_SIGNAL not in flags
        ):
            raise ValueError("unknown question type requires an explicit review flag")
        if self.question_type is QuestionType.MIXED and (
            ReviewFlag.MIXED_QUESTION_TYPE_CANDIDATE not in flags
        ):
            raise ValueError("mixed question type requires an explicit review flag")
        if self.cognitive_demand_tag is None and (
            ReviewFlag.COGNITIVE_DEMAND_UNKNOWN not in flags
        ):
            raise ValueError(
                "unknown cognitive demand requires an explicit review flag"
            )
        if ReviewFlag.TEACHER_REVIEW_REQUIRED not in flags:
            raise ValueError("every catalogue proposal requires teacher review")
        return self


@dataclass(frozen=True)
class _Signal:
    signal_id: str
    pattern: re.Pattern[str]
    domain_scores: tuple[tuple[PrimaryDomain, int], ...] = ()
    question_type_scores: tuple[tuple[QuestionType, int], ...] = ()
    skill_scores: tuple[tuple[str, int], ...] = ()
    representation_scores: tuple[tuple[RepresentationTag, int], ...] = ()
    demand_scores: tuple[tuple[CognitiveDemandTag, int], ...] = ()


def _signal(
    signal_id: str,
    pattern: str,
    *,
    domain_scores: tuple[tuple[PrimaryDomain, int], ...] = (),
    question_type_scores: tuple[tuple[QuestionType, int], ...] = (),
    skill_scores: tuple[tuple[str, int], ...] = (),
    representation_scores: tuple[tuple[RepresentationTag, int], ...] = (),
    demand_scores: tuple[tuple[CognitiveDemandTag, int], ...] = (),
) -> _Signal:
    return _Signal(
        signal_id,
        re.compile(pattern, re.IGNORECASE),
        domain_scores=domain_scores,
        question_type_scores=question_type_scores,
        skill_scores=skill_scores,
        representation_scores=representation_scores,
        demand_scores=demand_scores,
    )


_SIGNALS = (
    _signal(
        "time-calendar",
        r"\b(?:clock|calendar|o['’]?clock|hour|hours|minute|minutes|weekday|"
        r"weekdays|month|months|elapsed\s+time)\b",
        domain_scores=((PrimaryDomain.MEASUREMENT_TIME, 4),),
        question_type_scores=((QuestionType.WORD_PROBLEM, 1),),
        skill_scores=(("cnt_time_calendar", 4),),
        representation_scores=((RepresentationTag.CLOCK_OR_CALENDAR, 3),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "elapsed-time",
        r"\b(?:later|earlier|before|after|arrives?|leaves?|starts?|ends?)\b.{0,45}"
        r"\b(?:hour|hours|minute|minutes|o['’]?clock)\b|"
        r"\b(?:hour|hours|minute|minutes)\b.{0,45}\b(?:later|earlier|before|after)\b",
        domain_scores=((PrimaryDomain.MEASUREMENT_TIME, 3),),
        skill_scores=(("prc_elapsed_time", 4), ("cnt_time_calendar", 2)),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "money-value",
        r"(?:[$€£]|\b(?:cent|cents|coin|coins|dollar|dollars|euro|euros|money|"
        r"price|cost|change)\b)",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.WORD_PROBLEM, 2),),
        skill_scores=(("cnt_money_value", 4),),
        representation_scores=((RepresentationTag.STORY_TEXT, 2),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "fraction-part-whole",
        r"\b(?:fraction|fractions|half|halves|third|thirds|quarter|quarters|"
        r"numerator|denominator)\b|\b\d+\s*/\s*\d+\b",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 3),),
        skill_scores=(("cnt_fractions_part_whole", 4),),
        representation_scores=((RepresentationTag.SYMBOLIC_EXPRESSION, 2),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 1),),
    ),
    _signal(
        "fraction-comparison",
        r"\b(?:equivalent\s+fractions?|compare\s+(?:the\s+)?fractions?|"
        r"greater\s+fraction|smaller\s+fraction)\b",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 3),),
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 3),),
        skill_scores=(("cnt_fraction_equivalence_comparison", 4),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "ratio-proportion",
        r"\b(?:ratio|ratios|proportion|proportional|percent|percentage)\b",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 3),),
        skill_scores=(("cnt_ratio_proportion", 4),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "arithmetic-add-subtract",
        r"\b(?:add|adds|added|addition|sum|total|altogether|subtract|subtracts|"
        r"subtraction|difference|remain|remains|remaining|left\s+over|gives?\s+away)\b|"
        r"\d\s*[+-]\s*\d",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.COMPUTATION, 2),),
        skill_scores=(("cnt_whole_addition_subtraction", 4),),
        demand_scores=((CognitiveDemandTag.DIRECT_APPLICATION, 2),),
    ),
    _signal(
        "arithmetic-multiply-divide",
        r"\b(?:multiply|multiplies|multiplication|product|divide|divides|division|"
        r"quotient|equal\s+groups?|equally\s+sized|shared?\s+equally)\b|"
        r"\d\s*[×÷*/]\s*\d",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.COMPUTATION, 2),),
        skill_scores=(("cnt_whole_multiplication_division", 4),),
        demand_scores=((CognitiveDemandTag.DIRECT_APPLICATION, 2),),
    ),
    _signal(
        "place-value",
        r"\b(?:place\s+value|ones?\s+digit|tens?\s+digit|hundreds?\s+digit|"
        r"thousands?\s+digit)\b",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 2),),
        skill_scores=(("cnt_place_value", 4),),
        representation_scores=((RepresentationTag.SYMBOLIC_EXPRESSION, 2),),
        demand_scores=((CognitiveDemandTag.DIRECT_APPLICATION, 2),),
    ),
    _signal(
        "divisibility",
        r"\b(?:divisible|divisibility)\b",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 3),),
        skill_scores=(("cnt_divisibility", 4),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "factors-multiples",
        r"\b(?:factor|factors|multiple|multiples|prime)\b",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 3),),
        skill_scores=(("cnt_factors_multiples", 4),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "parity",
        r"\b(?:even|odd|parity)\b",
        domain_scores=((PrimaryDomain.NUMBER_ARITHMETIC, 4),),
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 3),),
        skill_scores=(("cnt_parity", 4),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "numeric-pattern",
        r"\b(?:number\s+pattern|numeric\s+pattern|sequence|sequences|next\s+(?:number|term)|"
        r"continues?|missing\s+(?:number|term)|pattern\s+rule)\b",
        domain_scores=((PrimaryDomain.PATTERNS_ALGEBRA, 4),),
        question_type_scores=((QuestionType.PATTERN_SEQUENCE, 4),),
        skill_scores=(
            ("cnt_numeric_patterns_sequences", 4),
            ("rsn_pattern_generalization", 3),
        ),
        representation_scores=((RepresentationTag.SYMBOLIC_EXPRESSION, 2),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "equation-unknown",
        r"\b(?:equation|unknown\s+number|missing\s+value|solve\s+for)\b|"
        r"\b[a-z]\s*[+=-]\s*\d",
        domain_scores=((PrimaryDomain.PATTERNS_ALGEBRA, 4),),
        question_type_scores=((QuestionType.COMPUTATION, 2),),
        skill_scores=(("cnt_unknowns_equations", 4),),
        representation_scores=((RepresentationTag.SYMBOLIC_EXPRESSION, 3),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "perimeter",
        r"\bperimeter\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 4),),
        question_type_scores=((QuestionType.GEOMETRY_MEASUREMENT, 4),),
        skill_scores=(("cnt_perimeter", 4),),
        representation_scores=((RepresentationTag.GEOMETRIC_DIAGRAM_2D, 2),),
        demand_scores=((CognitiveDemandTag.DIRECT_APPLICATION, 2),),
    ),
    _signal(
        "area",
        r"\barea\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 4),),
        question_type_scores=((QuestionType.GEOMETRY_MEASUREMENT, 4),),
        skill_scores=(("cnt_area", 4),),
        representation_scores=((RepresentationTag.GEOMETRIC_DIAGRAM_2D, 2),),
        demand_scores=((CognitiveDemandTag.DIRECT_APPLICATION, 2),),
    ),
    _signal(
        "length-distance",
        r"\b(?:length|distance|centimet(?:er|re)s?|met(?:er|re)s?|kilomet(?:er|re)s?|"
        r"millimet(?:er|re)s?)\b",
        domain_scores=((PrimaryDomain.MEASUREMENT_TIME, 3),),
        question_type_scores=((QuestionType.GEOMETRY_MEASUREMENT, 3),),
        skill_scores=(("cnt_length_distance", 3),),
        demand_scores=((CognitiveDemandTag.DIRECT_APPLICATION, 2),),
    ),
    _signal(
        "unit-conversion",
        r"\b(?:unit\s+conversion|convert\s+(?:the\s+)?units?|how\s+many\s+"
        r"(?:centimet(?:er|re)s?|met(?:er|re)s?|kilomet(?:er|re)s?|millimet(?:er|re)s?)"
        r"\s+(?:are|is)\s+in)\b",
        domain_scores=((PrimaryDomain.MEASUREMENT_TIME, 4),),
        question_type_scores=((QuestionType.GEOMETRY_MEASUREMENT, 4),),
        skill_scores=(("cnt_measurement_units", 4), ("prc_unit_conversion", 3)),
        demand_scores=((CognitiveDemandTag.DIRECT_APPLICATION, 2),),
    ),
    _signal(
        "angles-turns",
        r"\b(?:angle|angles|degrees?|quarter[- ]turn|half[- ]turn)\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 3),),
        question_type_scores=((QuestionType.GEOMETRY_MEASUREMENT, 2),),
        skill_scores=(("cnt_angles_turns", 4),),
        representation_scores=((RepresentationTag.GEOMETRIC_DIAGRAM_2D, 2),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "rotation",
        r"\b(?:rotate|rotates|rotated|rotation)\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 5),),
        question_type_scores=((QuestionType.SPATIAL_VISUAL, 5),),
        skill_scores=(("cnt_geometric_transformations", 4),),
        representation_scores=((RepresentationTag.SPATIAL_TRANSFORMATION, 4),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "reflection-symmetry",
        r"\b(?:reflect|reflects|reflected|reflection|mirror|mirrored|flip|flipped|"
        r"symmetry|symmetrical|symmetric)\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 5),),
        question_type_scores=((QuestionType.SPATIAL_VISUAL, 5),),
        skill_scores=(
            ("cnt_geometric_transformations", 3),
            ("cnt_symmetry", 4),
        ),
        representation_scores=((RepresentationTag.SPATIAL_TRANSFORMATION, 4),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "folding",
        r"\b(?:fold|folds|folded|folding)\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 5),),
        question_type_scores=((QuestionType.SPATIAL_VISUAL, 4),),
        skill_scores=(("cnt_geometric_transformations", 3),),
        representation_scores=((RepresentationTag.SPATIAL_TRANSFORMATION, 3),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "net-solid",
        r"\b(?:cube\s+net|nets?|solid|three[- ]dimensional|3d)\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 5),),
        question_type_scores=((QuestionType.SPATIAL_VISUAL, 4),),
        skill_scores=(
            ("cnt_three_dimensional_solids", 4),
            ("cnt_geometric_transformations", 2),
        ),
        representation_scores=((RepresentationTag.SOLID_DIAGRAM_3D, 4),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "spatial-composition",
        r"\b(?:pieces|piece\s+(?:fits?|which|that)|fits?|assemble|assembly|dissect|dissection|compose|"
        r"decompose|cut\s+(?:out|into))\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 4),),
        question_type_scores=((QuestionType.SPATIAL_VISUAL, 4),),
        skill_scores=(
            ("cnt_spatial_composition", 4),
            ("rsn_decomposition_recomposition", 3),
        ),
        representation_scores=((RepresentationTag.GEOMETRIC_DIAGRAM_2D, 2),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "grid-coordinate",
        r"\b(?:grid|coordinate|coordinates|cell|cells|row|rows|column|columns)\b",
        domain_scores=((PrimaryDomain.GEOMETRY_SPATIAL, 2),),
        skill_scores=(("cnt_coordinates_grids", 3),),
        representation_scores=((RepresentationTag.GRID, 4),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 1),),
    ),
    _signal(
        "route-path",
        r"\b(?:route|routes|path|paths|road|roads|maze|network|nodes?|vertices)\b",
        domain_scores=((PrimaryDomain.COUNTING_COMBINATORICS, 3),),
        question_type_scores=((QuestionType.COMBINATORICS_COUNTING, 4),),
        representation_scores=((RepresentationTag.GRAPH_OR_NETWORK, 3),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "grid-path-counting",
        r"\b(?:grid\s+paths?|paths?\s+(?:through|across|on)\s+(?:the\s+)?grid|"
        r"how\s+many\s+(?:routes?|paths?))\b",
        domain_scores=((PrimaryDomain.COUNTING_COMBINATORICS, 4),),
        question_type_scores=((QuestionType.COMBINATORICS_COUNTING, 4),),
        skill_scores=(
            ("cnt_combinatorial_counting", 3),
            ("prc_grid_path_counting", 4),
        ),
        representation_scores=((RepresentationTag.GRAPH_OR_NETWORK, 2),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "count-possibilities",
        r"\b(?:how\s+many\s+ways|number\s+of\s+ways|possible\s+(?:ways|arrangements|"
        r"orders|outcomes)|combinations?|permutations?)\b",
        domain_scores=((PrimaryDomain.COUNTING_COMBINATORICS, 5),),
        question_type_scores=((QuestionType.COMBINATORICS_COUNTING, 5),),
        skill_scores=(
            ("cnt_combinatorial_counting", 4),
            ("rsn_systematic_enumeration", 3),
        ),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 3),),
    ),
    _signal(
        "probability",
        r"\b(?:probability|chance|likely|unlikely|randomly|outcomes?)\b",
        domain_scores=((PrimaryDomain.PROBABILITY_DATA, 5),),
        question_type_scores=((QuestionType.PROBABILITY_DATA, 5),),
        skill_scores=(("cnt_elementary_probability", 4),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "logic-constraint",
        r"\b(?:exactly\s+one|at\s+most|at\s+least|must\s+be|cannot\s+be|"
        r"could\s+be|truth|liar|clue|clues|constraint|constraints)\b",
        domain_scores=((PrimaryDomain.LOGIC_CONSTRAINTS, 5),),
        question_type_scores=((QuestionType.LOGIC_CONSTRAINTS, 4),),
        skill_scores=(
            ("rsn_constraint_propagation", 4),
            ("rsn_case_analysis", 2),
        ),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 3),),
    ),
    _signal(
        "ordered-arrangement",
        r"\b(?:arrange|arranged|arrangement|order|ordered|first\s+to\s+last|"
        r"seated|seating)\b",
        domain_scores=((PrimaryDomain.LOGIC_CONSTRAINTS, 3),),
        question_type_scores=((QuestionType.LOGIC_CONSTRAINTS, 4),),
        skill_scores=(("rsn_constraint_propagation", 2),),
        representation_scores=((RepresentationTag.PHYSICAL_ARRANGEMENT, 3),),
        demand_scores=((CognitiveDemandTag.STRATEGY_SELECTION, 2),),
    ),
    _signal(
        "classification-comparison",
        r"\b(?:which\s+(?:is|are)\s+(?:greater|larger|smaller|least|most)|"
        r"greatest|smallest|compare|same\s+as|different\s+from)\b",
        question_type_scores=((QuestionType.NUMBER_RELATIONSHIPS, 4),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 2),),
    ),
    _signal(
        "story-context",
        r"\b(?:has|had|gave|gives|buys?|bought|children|people|students?|girls?|"
        r"boys?|marbles?|apples?|train|shop|school|team|teams)\b",
        question_type_scores=((QuestionType.WORD_PROBLEM, 3),),
        representation_scores=((RepresentationTag.STORY_TEXT, 3),),
        demand_scores=((CognitiveDemandTag.ONE_STEP_INFERENCE, 1),),
    ),
    _signal(
        "symbolic-expression",
        r"(?:\d\s*[+=<>×÷*/-]\s*\d|\b\d+(?:\s*,\s*\d+){2,}\b)",
        representation_scores=((RepresentationTag.SYMBOLIC_EXPRESSION, 4),),
    ),
    _signal(
        "table-representation",
        r"\b(?:table|row\s+and\s+column|chart)\b",
        representation_scores=((RepresentationTag.TABLE, 4),),
    ),
    _signal(
        "number-line-representation",
        r"\bnumber\s+line\b",
        representation_scores=((RepresentationTag.NUMBER_LINE, 5),),
    ),
    _signal(
        "multi-step-language",
        r"\b(?:first\b.{0,80}\bthen|after\b.{0,80}\bthen|twice|three\s+times)\b",
        demand_scores=((CognitiveDemandTag.MULTI_STEP_INTEGRATION, 4),),
    ),
)


_DOMAIN_OPTIONS = {
    PrimaryDomain.NUMBER_ARITHMETIC: (
        "Number & arithmetic",
        "Whole numbers, operations, divisibility, place value, and related structure.",
    ),
    PrimaryDomain.GEOMETRY_SPATIAL: (
        "Geometry & spatial",
        "Shape, position, transformation, folding, views, composition, and dissection.",
    ),
    PrimaryDomain.MEASUREMENT_TIME: (
        "Measurement & time",
        "Length, units, elapsed time, clocks, weekdays, dates, and calendars.",
    ),
    PrimaryDomain.PATTERNS_ALGEBRA: (
        "Patterns & algebra",
        "Sequences, generalization, unknowns, equations, and bounds.",
    ),
    PrimaryDomain.COUNTING_COMBINATORICS: (
        "Counting & combinatorics",
        "Systematic counting, routes, arrangements, and combinations.",
    ),
    PrimaryDomain.LOGIC_CONSTRAINTS: (
        "Logic & constraints",
        "Deduction from restrictions, clues, ordering, and cases.",
    ),
    PrimaryDomain.PROBABILITY_DATA: (
        "Probability & data",
        "Chance, outcomes, likelihood, tables, and data interpretation.",
    ),
    PrimaryDomain.MIXED: (
        "Mixed domain",
        "Two or more domains have similarly strong evidence and need review.",
    ),
    PrimaryDomain.UNKNOWN: (
        "Unknown",
        "The deterministic evidence is insufficient for a responsible proposal.",
    ),
}


_QUESTION_TYPE_OPTIONS = {
    QuestionType.COMPUTATION: (
        "Computation",
        "Apply or evaluate an explicit numerical operation.",
    ),
    QuestionType.NUMBER_RELATIONSHIPS: (
        "Number relationships",
        "Compare or reason about numerical properties and relationships.",
    ),
    QuestionType.WORD_PROBLEM: (
        "Word problem",
        "Extract mathematical relationships from a described situation.",
    ),
    QuestionType.PATTERN_SEQUENCE: (
        "Pattern or sequence",
        "Infer a rule and extend or complete a sequence.",
    ),
    QuestionType.GEOMETRY_MEASUREMENT: (
        "Geometry or measurement",
        "Reason about shapes, position, measures, angles, or units.",
    ),
    QuestionType.SPATIAL_VISUAL: (
        "Spatial or visual",
        "Mentally transform, assemble, fold, or inspect a visual structure.",
    ),
    QuestionType.COMBINATORICS_COUNTING: (
        "Combinatorics or counting",
        "Systematically count distinct valid outcomes or arrangements.",
    ),
    QuestionType.LOGIC_CONSTRAINTS: (
        "Logic or constraints",
        "Find an ordering or state satisfying explicit restrictions.",
    ),
    QuestionType.PROBABILITY_DATA: (
        "Probability or data",
        "Reason about chance, outcomes, likelihood, or organized data.",
    ),
    QuestionType.MIXED: (
        "Mixed type",
        "Two or more task structures have similarly strong evidence.",
    ),
    QuestionType.UNKNOWN: (
        "Unknown",
        "The deterministic evidence is insufficient for a responsible proposal.",
    ),
}


_REPRESENTATION_OPTIONS = {
    RepresentationTag.STORY_TEXT: (
        "Story text",
        "Quantities and relationships are embedded in prose.",
    ),
    RepresentationTag.SYMBOLIC_EXPRESSION: (
        "Symbolic expression",
        "Numerals or mathematical symbols carry essential information.",
    ),
    RepresentationTag.TABLE: ("Table", "Rows and columns organize information."),
    RepresentationTag.NUMBER_LINE: (
        "Number line",
        "Order, distance, or operations appear on a number line.",
    ),
    RepresentationTag.GRID: ("Grid", "Cells or coordinates organize information."),
    RepresentationTag.CLOCK_OR_CALENDAR: (
        "Clock or calendar",
        "A clock, schedule, weekday, date, or calendar is central.",
    ),
    RepresentationTag.GEOMETRIC_DIAGRAM_2D: (
        "Two-dimensional diagram",
        "A planar geometric diagram is likely to carry essential evidence.",
    ),
    RepresentationTag.SOLID_DIAGRAM_3D: (
        "Three-dimensional diagram",
        "A solid, net, or drawn three-dimensional object is central.",
    ),
    RepresentationTag.SPATIAL_TRANSFORMATION: (
        "Spatial transformation",
        "Movement, rotation, reflection, or before-and-after views are central.",
    ),
    RepresentationTag.GRAPH_OR_NETWORK: (
        "Graph or network",
        "Nodes, links, routes, or paths organize information.",
    ),
    RepresentationTag.PHYSICAL_ARRANGEMENT: (
        "Physical arrangement",
        "Objects or people are arranged and compared spatially.",
    ),
    RepresentationTag.MIXED: (
        "Mixed representation",
        "More than one representation appears likely to be essential.",
    ),
}


_DEMAND_OPTIONS = {
    CognitiveDemandTag.DIRECT_APPLICATION: (
        "Direct application",
        "Apply a directly indicated fact or procedure.",
    ),
    CognitiveDemandTag.ONE_STEP_INFERENCE: (
        "One-step inference",
        "Make one material inference beyond reading the prompt.",
    ),
    CognitiveDemandTag.MULTI_STEP_INTEGRATION: (
        "Multi-step integration",
        "Coordinate two or more dependent reasoning steps.",
    ),
    CognitiveDemandTag.STRATEGY_SELECTION: (
        "Strategy selection",
        "Choose an organizing strategy before carrying it out.",
    ),
    CognitiveDemandTag.NEAR_TRANSFER: (
        "Near transfer",
        "Apply a familiar principle in a closely related form.",
    ),
    CognitiveDemandTag.NOVEL_TRANSFER: (
        "Novel transfer",
        "Apply reviewed ideas in a substantially changed form.",
    ),
}


_REVIEW_FLAG_OPTIONS = {
    ReviewFlag.TEACHER_REVIEW_REQUIRED: (
        "Teacher review required",
        "This classifier creates proposals only; a person must validate the result.",
    ),
    ReviewFlag.ONTOLOGY_NOT_APPROVED: (
        "Ontology not approved",
        "The bound skill ontology is still proposed or otherwise unapproved.",
    ),
    ReviewFlag.SOURCE_ITEM_NEEDS_REVIEW: (
        "Source item needs review",
        "The source audit did not mark this item as cleanly parsed.",
    ),
    ReviewFlag.SOURCE_WARNINGS_PRESENT: (
        "Source warnings present",
        "One or more versioned source-audit warnings remain attached.",
    ),
    ReviewFlag.ANSWER_NOT_SINGLE_VERIFIED: (
        "Answer not single verified",
        "The item does not have one currently verified official answer.",
    ),
    ReviewFlag.CHOICES_NOT_STRUCTURED: (
        "Choices not structured",
        "No machine-readable answer choices are currently available.",
    ),
    ReviewFlag.VISUAL_EVIDENCE_REQUIRES_HUMAN_REVIEW: (
        "Visual evidence requires review",
        "The item may depend on evidence that lexical rules cannot inspect.",
    ),
    ReviewFlag.AMBIGUOUS_PRIMARY_DOMAIN: (
        "Ambiguous primary domain",
        "The strongest domain scores are too close to select responsibly.",
    ),
    ReviewFlag.AMBIGUOUS_QUESTION_TYPE: (
        "Ambiguous question type",
        "The strongest task-type scores are too close to select responsibly.",
    ),
    ReviewFlag.MIXED_DOMAIN_CANDIDATE: (
        "Mixed domain candidate",
        "Several domains have strong evidence and may all be essential.",
    ),
    ReviewFlag.MIXED_QUESTION_TYPE_CANDIDATE: (
        "Mixed question type candidate",
        "Several task structures have strong evidence and may all be essential.",
    ),
    ReviewFlag.NO_DOMAIN_SIGNAL: (
        "No domain signal",
        "No sufficiently specific deterministic domain cue was found.",
    ),
    ReviewFlag.NO_QUESTION_TYPE_SIGNAL: (
        "No question-type signal",
        "No sufficiently specific deterministic task cue was found.",
    ),
    ReviewFlag.NO_SKILL_SIGNAL: (
        "No skill signal",
        "No existing ontology skill had sufficiently specific lexical evidence.",
    ),
    ReviewFlag.NO_REPRESENTATION_SIGNAL: (
        "No representation signal",
        "The representation cannot be responsibly inferred from available text.",
    ),
    ReviewFlag.COGNITIVE_DEMAND_UNKNOWN: (
        "Cognitive demand unknown",
        "Cognitive demand cannot be responsibly inferred from available evidence.",
    ),
    ReviewFlag.ONTOLOGY_SKILL_UNAVAILABLE: (
        "Ontology skill unavailable",
        "A rule referenced a skill absent from the bound ontology and omitted it.",
    ),
    ReviewFlag.ONTOLOGY_TAG_UNAVAILABLE: (
        "Ontology tag unavailable",
        "A rule referenced a representation tag absent from the bound ontology.",
    ),
    ReviewFlag.LOW_CONFIDENCE: (
        "Low confidence",
        "The conservative aggregate confidence is below the review threshold.",
    ),
}


_EnumT = TypeVar("_EnumT", bound=StrEnum)
_ScoreT = TypeVar("_ScoreT", bound=str)


def _vocabulary_options(
    values: type[_EnumT], descriptions: Mapping[_EnumT, tuple[str, str]]
) -> tuple[VocabularyOption, ...]:
    return tuple(
        VocabularyOption(
            value=value.value,
            label=descriptions[value][0],
            description=descriptions[value][1],
        )
        for value in values
    )


def _ontology_non_mastery_ids(
    ontology: OntologyDocument, vocabulary_name: str
) -> set[str]:
    raw = (ontology.model_extra or {}).get("non_mastery_tag_vocabularies", {})
    if not isinstance(raw, dict):
        return set()
    entries = raw.get(vocabulary_name, [])
    if not isinstance(entries, list):
        return set()
    return {
        str(entry["tag_id"])
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("tag_id"), str)
    }


def catalogue_controlled_vocabularies(
    ontology: OntologyDocument,
) -> CatalogueControlledVocabularies:
    """Return every value the teacher dashboard may display or submit."""

    return CatalogueControlledVocabularies(
        ontology_version=ontology.ontology_version,
        primary_domains=_vocabulary_options(PrimaryDomain, _DOMAIN_OPTIONS),
        question_types=_vocabulary_options(QuestionType, _QUESTION_TYPE_OPTIONS),
        skills=tuple(
            SkillVocabularyOption(
                value=skill.skill_id,
                label=skill.name,
                description=skill.description,
                facet=skill.facet,
                status=skill.status,
            )
            for skill in sorted(ontology.skills, key=lambda value: value.skill_id)
        ),
        representation_tags=_vocabulary_options(
            RepresentationTag, _REPRESENTATION_OPTIONS
        ),
        cognitive_demand_tags=_vocabulary_options(CognitiveDemandTag, _DEMAND_OPTIONS),
        review_flags=_vocabulary_options(ReviewFlag, _REVIEW_FLAG_OPTIONS),
    )


def _add_scores(
    target: dict[_ScoreT, int], entries: tuple[tuple[_ScoreT, int], ...]
) -> None:
    for value, score in entries:
        target[value] += score


def _ranked(scores: dict[_ScoreT, int]) -> list[tuple[_ScoreT, int]]:
    return sorted(scores.items(), key=lambda entry: (-entry[1], str(entry[0])))


def _select_primary(
    scores: dict[_EnumT, int],
    *,
    unknown: _EnumT,
    mixed: _EnumT,
) -> tuple[_EnumT, bool, int, int]:
    ranked = _ranked(scores)
    if not ranked or ranked[0][1] < 2:
        return unknown, False, 0, 0
    top_value, top_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0
    ambiguous = second_score >= 2 and second_score * 5 >= top_score * 4
    if ambiguous:
        return mixed, True, top_score, second_score
    return top_value, False, top_score, second_score


def _certainty(top_score: int, second_score: int) -> float:
    if top_score <= 0:
        return 0.0
    return max(0.0, min(1.0, (top_score - second_score) / top_score))


def propose_catalogue_classification(
    item: ImportedItem,
    ontology: OntologyDocument,
) -> CatalogueClassificationProposal:
    """Create a deterministic proposal without asserting curriculum truth."""

    text = " ".join(
        (
            item.learner.stem_markdown
            or item.source.english_stem
            or item.source.stem_markdown
        )
        .casefold()
        .split()
    )
    domain_scores: dict[PrimaryDomain, int] = defaultdict(int)
    question_type_scores: dict[QuestionType, int] = defaultdict(int)
    skill_scores: dict[str, int] = defaultdict(int)
    representation_scores: dict[RepresentationTag, int] = defaultdict(int)
    demand_scores: dict[CognitiveDemandTag, int] = defaultdict(int)
    matched_signal_ids: list[str] = []

    for signal in _SIGNALS:
        if not signal.pattern.search(text):
            continue
        matched_signal_ids.append(signal.signal_id)
        _add_scores(domain_scores, signal.domain_scores)
        _add_scores(question_type_scores, signal.question_type_scores)
        _add_scores(skill_scores, signal.skill_scores)
        _add_scores(representation_scores, signal.representation_scores)
        _add_scores(demand_scores, signal.demand_scores)

    domain, domain_ambiguous, domain_top, domain_second = _select_primary(
        domain_scores,
        unknown=PrimaryDomain.UNKNOWN,
        mixed=PrimaryDomain.MIXED,
    )
    question_type, type_ambiguous, type_top, type_second = _select_primary(
        question_type_scores,
        unknown=QuestionType.UNKNOWN,
        mixed=QuestionType.MIXED,
    )
    known_skills = {skill.skill_id for skill in ontology.skills}
    proposed_skill_ids = tuple(
        sorted(
            str(skill_id)
            for skill_id, score in skill_scores.items()
            if score >= 2 and str(skill_id) in known_skills
        )
    )
    unavailable_skill = any(
        score >= 2 and str(skill_id) not in known_skills
        for skill_id, score in skill_scores.items()
    )

    ontology_representation_ids = _ontology_non_mastery_ids(ontology, "representation")
    proposed_representations: tuple[RepresentationTag, ...] = tuple(
        sorted(
            (
                tag
                for tag, score in representation_scores.items()
                if score >= 2 and str(tag) in ontology_representation_ids
            ),
            key=lambda value: str(value),
        )
    )
    unavailable_tag = any(
        score >= 2 and str(tag) not in ontology_representation_ids
        for tag, score in representation_scores.items()
    )
    if len(proposed_representations) > 1 and (
        RepresentationTag.MIXED.value in ontology_representation_ids
    ):
        proposed_representations = tuple(
            sorted(
                {*proposed_representations, RepresentationTag.MIXED},
                key=lambda value: str(value),
            )
        )
    ontology_demand_ids = _ontology_non_mastery_ids(ontology, "cognitive_demand")
    ranked_demand = _ranked(
        {
            tag: score
            for tag, score in demand_scores.items()
            if str(tag) in ontology_demand_ids
        }
    )
    unavailable_tag = unavailable_tag or any(
        score >= 2 and str(tag) not in ontology_demand_ids
        for tag, score in demand_scores.items()
    )
    if not ranked_demand or ranked_demand[0][1] < 2:
        cognitive_demand = None
    else:
        cognitive_demand = ranked_demand[0][0]

    flags: set[ReviewFlag] = {ReviewFlag.TEACHER_REVIEW_REQUIRED}
    if ontology.status != "approved" or not ontology.review_ready:
        flags.add(ReviewFlag.ONTOLOGY_NOT_APPROVED)
    if item.learner.status is not ItemStatus.PARSED:
        flags.add(ReviewFlag.SOURCE_ITEM_NEEDS_REVIEW)
    if item.warning_codes:
        flags.add(ReviewFlag.SOURCE_WARNINGS_PRESENT)
    if item.learner.answer_type is not AnswerType.SINGLE_CHOICE:
        flags.add(ReviewFlag.ANSWER_NOT_SINGLE_VERIFIED)
    if not item.learner.choices:
        flags.add(ReviewFlag.CHOICES_NOT_STRUCTURED)
    if item.modality in {"diagram_dependent", "diagram_review_required"}:
        flags.add(ReviewFlag.VISUAL_EVIDENCE_REQUIRES_HUMAN_REVIEW)
    if domain is PrimaryDomain.UNKNOWN:
        flags.add(ReviewFlag.NO_DOMAIN_SIGNAL)
    elif domain is PrimaryDomain.MIXED:
        flags.update(
            {
                ReviewFlag.AMBIGUOUS_PRIMARY_DOMAIN,
                ReviewFlag.MIXED_DOMAIN_CANDIDATE,
            }
        )
    if question_type is QuestionType.UNKNOWN:
        flags.add(ReviewFlag.NO_QUESTION_TYPE_SIGNAL)
    elif question_type is QuestionType.MIXED:
        flags.update(
            {
                ReviewFlag.AMBIGUOUS_QUESTION_TYPE,
                ReviewFlag.MIXED_QUESTION_TYPE_CANDIDATE,
            }
        )
    if not proposed_skill_ids:
        flags.add(ReviewFlag.NO_SKILL_SIGNAL)
    if not proposed_representations:
        flags.add(ReviewFlag.NO_REPRESENTATION_SIGNAL)
    if cognitive_demand is None:
        flags.add(ReviewFlag.COGNITIVE_DEMAND_UNKNOWN)
    if unavailable_skill:
        flags.add(ReviewFlag.ONTOLOGY_SKILL_UNAVAILABLE)
    if unavailable_tag:
        flags.add(ReviewFlag.ONTOLOGY_TAG_UNAVAILABLE)

    confidence = (
        0.10
        + 0.25 * _certainty(domain_top, domain_second)
        + 0.20 * _certainty(type_top, type_second)
        + (0.15 if proposed_skill_ids else 0.0)
        + (0.10 if proposed_representations else 0.0)
        + (0.10 if cognitive_demand is not None else 0.0)
    )
    confidence = min(confidence, 0.85)
    if domain in {PrimaryDomain.UNKNOWN, PrimaryDomain.MIXED} or question_type in {
        QuestionType.UNKNOWN,
        QuestionType.MIXED,
    }:
        confidence = min(confidence, 0.45)
    if item.modality in {"diagram_dependent", "diagram_review_required"}:
        confidence = min(confidence, 0.65)
    if item.learner.status is not ItemStatus.PARSED or item.warning_codes:
        confidence = min(confidence, 0.60)
    if ontology.status != "approved" or not ontology.review_ready:
        confidence = min(confidence, 0.65)
    confidence = round(max(0.0, confidence), 3)
    if confidence < 0.55:
        flags.add(ReviewFlag.LOW_CONFIDENCE)

    evidence = tuple(
        [f"lexical:{signal_id}" for signal_id in matched_signal_ids]
        + [f"metadata:modality={item.modality}"]
        + [f"metadata:source-warning-count={len(item.warning_codes)}"]
    )
    reasons = [
        "Classification is a deterministic metadata-and-lexical proposal, not an authoritative curriculum judgment."
    ]
    if domain is PrimaryDomain.UNKNOWN:
        reasons.append("No sufficiently specific primary-domain cue was found.")
    elif domain is PrimaryDomain.MIXED:
        reasons.append(
            "Several primary-domain candidates had similarly strong evidence."
        )
    else:
        reasons.append(f"The strongest primary-domain candidate is {domain.value}.")
    if question_type is QuestionType.UNKNOWN:
        reasons.append("No sufficiently specific question-type cue was found.")
    elif question_type is QuestionType.MIXED:
        reasons.append(
            "Several question-type candidates had similarly strong evidence."
        )
    else:
        reasons.append(
            f"The strongest question-type candidate is {question_type.value}."
        )
    if item.modality in {"diagram_dependent", "diagram_review_required"}:
        reasons.append(
            "The available visual evidence must be inspected by a teacher before accepting the proposal."
        )

    return CatalogueClassificationProposal(
        item_id=item.learner.item_id,
        content_version=item.learner.content_version,
        ontology_version=ontology.ontology_version,
        primary_domain=domain,
        question_type=question_type,
        skill_ids=proposed_skill_ids,
        representation_tags=proposed_representations,
        cognitive_demand_tag=cognitive_demand,
        confidence=confidence,
        evidence=evidence,
        reasons=tuple(reasons),
        review_flags=tuple(sorted(flags, key=lambda value: value.value)),
    )


__all__ = [
    "CATALOGUE_CLASSIFIER_VERSION",
    "CATALOGUE_PROPOSAL_SCHEMA_VERSION",
    "CATALOGUE_VOCABULARY_SCHEMA_VERSION",
    "CatalogueClassificationProposal",
    "CatalogueControlledVocabularies",
    "CognitiveDemandTag",
    "PrimaryDomain",
    "QuestionType",
    "RepresentationTag",
    "ReviewFlag",
    "SkillVocabularyOption",
    "VocabularyOption",
    "catalogue_controlled_vocabularies",
    "propose_catalogue_classification",
]
