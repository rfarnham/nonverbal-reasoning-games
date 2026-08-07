"""Curated Grades 1–2 curriculum-world configuration.

The world is an authored navigation layer over the proposed catalogue
ontology.  It does not replace teacher review, infer mastery, or turn visual
layout distance into semantic distance.  Representations, reasoning moves,
and procedures remain orthogonal facets and never determine an item's
curricular home in this module.

``Crossroads`` and ``Heaven`` are presentation-only regions.  In particular,
Heaven is the QA destination for unresolved or unplayable items and is never a
persistable realm or district ID.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from enum import StrEnum
from types import MappingProxyType
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from math_kangaroo_trainer.corpus.catalogue import PrimaryDomain


GRADE12_WORLD_SCHEMA_VERSION: Final = "grade12-curriculum-world.v1"
GRADE12_WORLD_ONTOLOGY_VERSION: Final = "grade12-six-realm-ontology.v1"
GRADE12_WORLD_LAYOUT_VERSION: Final = "grade12-six-realm-hex-layout.v1"
GRADE12_WORLD_PROPOSAL_VERSION: Final = "grade12-world-placement-proposal.v1"

CROSSROADS_REGION_ID: Final = "crossroads"
HEAVEN_REGION_ID: Final = "heaven"


class _StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class HexCoordinate(_StrictFrozenModel):
    """Axial coordinate in the authored pointy-top hex layout."""

    q: int
    r: int


class DistrictDefinition(_StrictFrozenModel):
    district_id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    local_hex: HexCoordinate
    content_skill_ids: tuple[str, ...] = ()

    @field_validator("content_skill_ids")
    @classmethod
    def canonical_content_skills(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not skill_id.startswith("cnt_") for skill_id in value):
            raise ValueError("district placement skills must be content-facet IDs")
        if tuple(sorted(set(value))) != value:
            raise ValueError("district content skill IDs must be sorted and unique")
        return value


class RealmDefinition(_StrictFrozenModel):
    realm_id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    accent: str = Field(pattern=r"^#[0-9a-f]{6}$")
    world_hex: HexCoordinate
    districts: tuple[DistrictDefinition, ...] = Field(min_length=3, max_length=6)

    @model_validator(mode="after")
    def unique_district_layout(self) -> "RealmDefinition":
        district_ids = [district.district_id for district in self.districts]
        if len(district_ids) != len(set(district_ids)):
            raise ValueError(f"{self.realm_id}: district IDs must be unique")
        coordinates = [
            (district.local_hex.q, district.local_hex.r) for district in self.districts
        ]
        if len(coordinates) != len(set(coordinates)):
            raise ValueError(f"{self.realm_id}: district hexes must be unique")
        return self


class SpecialRegionDefinition(_StrictFrozenModel):
    region_id: Literal["crossroads", "heaven"]
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    world_hex: HexCoordinate
    presentation_only: Literal[True] = True


class OrthogonalFacetDefinition(_StrictFrozenModel):
    facet_id: Literal["representation", "reasoning_move", "procedure"]
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    source_id_prefix: Literal["rep_", "rsn_", "prc_"]
    affects_curricular_home: Literal[False] = False


class WorldLayoutDefinition(_StrictFrozenModel):
    layout_version: Literal["grade12-six-realm-hex-layout.v1"] = (
        GRADE12_WORLD_LAYOUT_VERSION
    )
    projection: Literal["axial_hex"] = "axial_hex"
    orientation: Literal["pointy_top"] = "pointy_top"
    realm_ring_radius: Literal[3] = 3
    district_ring_radius: Literal[1] = 1
    semantic_distance_controls_position: Literal[False] = False
    semantic_neighbors_render_as_links: Literal[True] = True


class Grade12WorldConfig(_StrictFrozenModel):
    schema_version: Literal["grade12-curriculum-world.v1"] = (
        GRADE12_WORLD_SCHEMA_VERSION
    )
    world_id: Literal["math_kangaroo_grade12"] = "math_kangaroo_grade12"
    ontology_version: Literal["grade12-six-realm-ontology.v1"] = (
        GRADE12_WORLD_ONTOLOGY_VERSION
    )
    status: Literal["curated_proposal"] = "curated_proposal"
    authoritative: Literal[False] = False
    grade_bands: tuple[Literal["1-2"], ...] = ("1-2",)
    crossroads: SpecialRegionDefinition
    heaven: SpecialRegionDefinition
    layout: WorldLayoutDefinition
    realms: tuple[RealmDefinition, ...] = Field(min_length=6, max_length=6)
    orthogonal_facets: tuple[OrthogonalFacetDefinition, ...] = Field(
        min_length=3, max_length=3
    )

    @model_validator(mode="after")
    def coherent_authored_world(self) -> "Grade12WorldConfig":
        realm_ids = [realm.realm_id for realm in self.realms]
        if len(realm_ids) != len(set(realm_ids)):
            raise ValueError("realm IDs must be unique")
        realm_hexes = [(realm.world_hex.q, realm.world_hex.r) for realm in self.realms]
        if len(realm_hexes) != len(set(realm_hexes)):
            raise ValueError("realm world hexes must be unique")
        if (self.crossroads.world_hex.q, self.crossroads.world_hex.r) != (0, 0):
            raise ValueError("Crossroads must remain at the world origin")
        special_ids = {self.crossroads.region_id, self.heaven.region_id}
        district_ids = [
            district.district_id
            for realm in self.realms
            for district in realm.districts
        ]
        if special_ids & (set(realm_ids) | set(district_ids)):
            raise ValueError("presentation regions cannot be curricular IDs")
        if len(district_ids) != len(set(district_ids)):
            raise ValueError("district IDs must be globally unique")
        placement_skills = [
            skill_id
            for realm in self.realms
            for district in realm.districts
            for skill_id in district.content_skill_ids
        ]
        if len(placement_skills) != len(set(placement_skills)):
            raise ValueError("a content skill can seed only one district")
        facet_ids = [facet.facet_id for facet in self.orthogonal_facets]
        if set(facet_ids) != {"representation", "reasoning_move", "procedure"}:
            raise ValueError("the three non-location facets must stay explicit")
        return self


_FIVE_DISTRICT_HEXES = (
    HexCoordinate(q=0, r=-1),
    HexCoordinate(q=1, r=-1),
    HexCoordinate(q=1, r=0),
    HexCoordinate(q=0, r=1),
    HexCoordinate(q=-1, r=1),
)

_FOUR_DISTRICT_HEXES = (
    HexCoordinate(q=0, r=-1),
    HexCoordinate(q=1, r=0),
    HexCoordinate(q=0, r=1),
    HexCoordinate(q=-1, r=0),
)


GRADE12_WORLD: Final = Grade12WorldConfig(
    crossroads=SpecialRegionDefinition(
        region_id=CROSSROADS_REGION_ID,
        label="Crossroads",
        description=(
            "The central search, random-question, recent-question, and "
            "teacher-QA launch point; it is not a curriculum category."
        ),
        world_hex=HexCoordinate(q=0, r=0),
    ),
    heaven=SpecialRegionDefinition(
        region_id=HEAVEN_REGION_ID,
        label="Heaven",
        description=(
            "A separate presentation-only QA area for unresolved or unplayable "
            "questions. Items here have no persisted curricular realm or district."
        ),
        world_hex=HexCoordinate(q=0, r=-7),
    ),
    layout=WorldLayoutDefinition(),
    realms=(
        RealmDefinition(
            realm_id="number_arithmetic",
            label="Number & Operations",
            description=(
                "Quantities, number structure, and operations on whole or "
                "fractional amounts."
            ),
            accent="#f06f5f",
            world_hex=HexCoordinate(q=0, r=-3),
            districts=(
                DistrictDefinition(
                    district_id="count_compare",
                    label="Count & Compare",
                    description="Count visible collections and compare their amounts.",
                    local_hex=_FIVE_DISTRICT_HEXES[0],
                    content_skill_ids=("cnt_counting_cardinality",),
                ),
                DistrictDefinition(
                    district_id="join_separate",
                    label="Join, Separate & Find the Missing Amount",
                    description=(
                        "Model addition, subtraction, totals, changes, and missing parts."
                    ),
                    local_hex=_FIVE_DISTRICT_HEXES[1],
                    content_skill_ids=(
                        "cnt_arithmetic_expressions",
                        "cnt_whole_addition_subtraction",
                    ),
                ),
                DistrictDefinition(
                    district_id="equal_groups_sharing",
                    label="Equal Groups & Sharing",
                    description=(
                        "Reason with repeated groups, arrays, sharing, and simple rates."
                    ),
                    local_hex=_FIVE_DISTRICT_HEXES[2],
                    content_skill_ids=(
                        "cnt_ratio_proportion",
                        "cnt_whole_multiplication_division",
                    ),
                ),
                DistrictDefinition(
                    district_id="equal_parts_fractions",
                    label="Equal Parts & Fractions",
                    description="Partition and compare halves, quarters, and other parts.",
                    local_hex=_FIVE_DISTRICT_HEXES[3],
                    content_skill_ids=(
                        "cnt_fraction_equivalence_comparison",
                        "cnt_fractions_part_whole",
                    ),
                ),
                DistrictDefinition(
                    district_id="number_digit_structure",
                    label="Number & Digit Structure",
                    description=(
                        "Explore place value, digits, parity, divisibility, and cycles."
                    ),
                    local_hex=_FIVE_DISTRICT_HEXES[4],
                    content_skill_ids=(
                        "cnt_divisibility",
                        "cnt_factors_multiples",
                        "cnt_parity",
                        "cnt_place_value",
                        "cnt_remainders_cycles",
                    ),
                ),
            ),
        ),
        RealmDefinition(
            realm_id="patterns_algebra",
            label="Patterns & Relationships",
            description=(
                "Repeating or growing structures, equality, correspondence, and order."
            ),
            accent="#f3bd4e",
            world_hex=HexCoordinate(q=3, r=-3),
            districts=(
                DistrictDefinition(
                    district_id="repeat_grow",
                    label="Repeat & Grow",
                    description="Continue and explain repeating or growing patterns.",
                    local_hex=_FOUR_DISTRICT_HEXES[0],
                    content_skill_ids=("cnt_numeric_patterns_sequences",),
                ),
                DistrictDefinition(
                    district_id="equality_missing_values",
                    label="Equality & Missing Values",
                    description=(
                        "Maintain equality and determine unknown or bounded values."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[1],
                    content_skill_ids=(
                        "cnt_inequalities_bounds",
                        "cnt_unknowns_equations",
                    ),
                ),
                DistrictDefinition(
                    district_id="tables_codes_correspondence",
                    label="Tables, Codes & Correspondence",
                    description=(
                        "Follow consistent mappings among rows, columns, symbols, or objects."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[2],
                ),
                DistrictDefinition(
                    district_id="order_rank_relations",
                    label="Order, Rank & Relations",
                    description=(
                        "Reason about before, after, between, relative rank, and chains."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[3],
                ),
            ),
        ),
        RealmDefinition(
            realm_id="logic_constraints",
            label="Logic & Constraints",
            description=(
                "Use clues and restrictions to rule out possibilities and determine "
                "what must be true."
            ),
            accent="#7767d7",
            world_hex=HexCoordinate(q=3, r=0),
            districts=(
                DistrictDefinition(
                    district_id="clue_ordering",
                    label="Clues & Ordering",
                    description="Combine relational clues into a consistent order.",
                    local_hex=_FOUR_DISTRICT_HEXES[0],
                ),
                DistrictDefinition(
                    district_id="constraint_placement",
                    label="Constraint Placement",
                    description=(
                        "Place objects while satisfying adjacency, capacity, or exclusion rules."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[1],
                ),
                DistrictDefinition(
                    district_id="working_backward",
                    label="Work Backward",
                    description="Reverse a sequence of stated actions or consequences.",
                    local_hex=_FOUR_DISTRICT_HEXES[2],
                ),
                DistrictDefinition(
                    district_id="elimination_invariants",
                    label="Elimination & Invariants",
                    description=(
                        "Find impossibilities or properties that stay fixed across cases."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[3],
                ),
            ),
        ),
        RealmDefinition(
            realm_id="counting_combinatorics",
            label="Possibilities & Combinatorics",
            description=(
                "Organize arrangements, routes, cases, and elementary chance outcomes."
            ),
            accent="#1679d2",
            world_hex=HexCoordinate(q=0, r=3),
            districts=(
                DistrictDefinition(
                    district_id="arrangements_selections",
                    label="Arrangements & Selections",
                    description=(
                        "Count choices, arrangements, and selections without omissions."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[0],
                    content_skill_ids=("cnt_combinatorial_counting",),
                ),
                DistrictDefinition(
                    district_id="systematic_counting",
                    label="Systematic Counting",
                    description="Organize cases so every possibility is counted once.",
                    local_hex=_FOUR_DISTRICT_HEXES[1],
                ),
                DistrictDefinition(
                    district_id="paths_networks",
                    label="Paths, Networks & Reachability",
                    description=(
                        "Choose, compare, or count routes through grids and networks."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[2],
                ),
                DistrictDefinition(
                    district_id="chance_outcomes",
                    label="Chance & Outcomes",
                    description=(
                        "Describe possible outcomes and elementary likelihood structure."
                    ),
                    local_hex=_FOUR_DISTRICT_HEXES[3],
                    content_skill_ids=("cnt_elementary_probability",),
                ),
            ),
        ),
        RealmDefinition(
            realm_id="geometry_spatial",
            label="Shape & Space",
            description=(
                "Recognize, assemble, transform, and navigate two- and "
                "three-dimensional structures."
            ),
            accent="#35a999",
            world_hex=HexCoordinate(q=-3, r=3),
            districts=(
                DistrictDefinition(
                    district_id="shape_properties",
                    label="Shape Properties",
                    description="Recognize and compare two-dimensional shapes and features.",
                    local_hex=_FIVE_DISTRICT_HEXES[0],
                    content_skill_ids=("cnt_two_dimensional_shapes",),
                ),
                DistrictDefinition(
                    district_id="compose_dissect_tile",
                    label="Compose, Dissect & Tile",
                    description="Build, cut, cover, and recombine visual pieces.",
                    local_hex=_FIVE_DISTRICT_HEXES[1],
                    content_skill_ids=("cnt_spatial_composition",),
                ),
                DistrictDefinition(
                    district_id="turn_reflect_symmetry",
                    label="Turn, Reflect & Symmetry",
                    description="Reason about rotations, flips, mirrors, folds, and symmetry.",
                    local_hex=_FIVE_DISTRICT_HEXES[2],
                    content_skill_ids=(
                        "cnt_angles_turns",
                        "cnt_geometric_transformations",
                        "cnt_symmetry",
                    ),
                ),
                DistrictDefinition(
                    district_id="solids_stacks_views",
                    label="Solids, Stacks & Views",
                    description="Inspect cubes, faces, stacks, and viewpoints in 3D.",
                    local_hex=_FIVE_DISTRICT_HEXES[3],
                    content_skill_ids=("cnt_three_dimensional_solids",),
                ),
                DistrictDefinition(
                    district_id="position_direction",
                    label="Position & Direction",
                    description="Locate and move objects using grids and spatial relations.",
                    local_hex=_FIVE_DISTRICT_HEXES[4],
                    content_skill_ids=("cnt_coordinates_grids",),
                ),
            ),
        ),
        RealmDefinition(
            realm_id="measurement_time",
            label="Measurement & Time",
            description=(
                "Measure and compare time, value, distance, boundary, area, and units."
            ),
            accent="#16836b",
            world_hex=HexCoordinate(q=-3, r=0),
            districts=(
                DistrictDefinition(
                    district_id="clock_calendar",
                    label="Clock & Calendar",
                    description="Read and reason about clocks, elapsed time, dates, and calendars.",
                    local_hex=_FIVE_DISTRICT_HEXES[0],
                    content_skill_ids=("cnt_time_calendar",),
                ),
                DistrictDefinition(
                    district_id="money_value",
                    label="Money & Value",
                    description="Compare prices, coins, exchanges, and equal value.",
                    local_hex=_FIVE_DISTRICT_HEXES[1],
                    content_skill_ids=("cnt_money_value",),
                ),
                DistrictDefinition(
                    district_id="length_distance",
                    label="Length & Distance",
                    description="Measure or compare lengths, heights, and route distances.",
                    local_hex=_FIVE_DISTRICT_HEXES[2],
                    content_skill_ids=("cnt_length_distance",),
                ),
                DistrictDefinition(
                    district_id="perimeter_area_covering",
                    label="Perimeter, Area & Covering",
                    description="Reason about boundaries, covered regions, and tiled area.",
                    local_hex=_FIVE_DISTRICT_HEXES[3],
                    content_skill_ids=("cnt_area", "cnt_perimeter"),
                ),
                DistrictDefinition(
                    district_id="weight_capacity_units",
                    label="Weight, Capacity & Units",
                    description="Compare measured quantities and use compatible units.",
                    local_hex=_FIVE_DISTRICT_HEXES[4],
                    content_skill_ids=("cnt_measurement_units",),
                ),
            ),
        ),
    ),
    orthogonal_facets=(
        OrthogonalFacetDefinition(
            facet_id="representation",
            label="Representation",
            description=(
                "Story, symbolic, grid, table, clock, diagram, solid, and network "
                "formats; these change the view, not curricular home."
            ),
            source_id_prefix="rep_",
        ),
        OrthogonalFacetDefinition(
            facet_id="reasoning_move",
            label="Reasoning Move",
            description=(
                "Moves such as case analysis, decomposition, elimination, or "
                "constraint propagation; these can cross every realm."
            ),
            source_id_prefix="rsn_",
        ),
        OrthogonalFacetDefinition(
            facet_id="procedure",
            label="Procedure",
            description=(
                "Explicit procedures such as elapsed-time calculation or organized "
                "enumeration; these remain separate from curricular geography."
            ),
            source_id_prefix="prc_",
        ),
    ),
)


GRADE12_REALM_IDS: Final[frozenset[str]] = frozenset(
    realm.realm_id for realm in GRADE12_WORLD.realms
)
GRADE12_DISTRICT_IDS: Final[frozenset[str]] = frozenset(
    district.district_id
    for realm in GRADE12_WORLD.realms
    for district in realm.districts
)
GRADE12_DISTRICT_TO_REALM: Final[Mapping[str, str]] = MappingProxyType(
    {
        district.district_id: realm.realm_id
        for realm in GRADE12_WORLD.realms
        for district in realm.districts
    }
)
GRADE12_CONTENT_SKILL_TO_DISTRICT: Final[Mapping[str, str]] = MappingProxyType(
    {
        skill_id: district.district_id
        for realm in GRADE12_WORLD.realms
        for district in realm.districts
        for skill_id in district.content_skill_ids
    }
)

_DOMAIN_TO_REALM: Final[Mapping[PrimaryDomain, str]] = MappingProxyType(
    {
        PrimaryDomain.NUMBER_ARITHMETIC: "number_arithmetic",
        PrimaryDomain.PATTERNS_ALGEBRA: "patterns_algebra",
        PrimaryDomain.LOGIC_CONSTRAINTS: "logic_constraints",
        PrimaryDomain.COUNTING_COMBINATORICS: "counting_combinatorics",
        PrimaryDomain.PROBABILITY_DATA: "counting_combinatorics",
        PrimaryDomain.GEOMETRY_SPATIAL: "geometry_spatial",
        PrimaryDomain.MEASUREMENT_TIME: "measurement_time",
    }
)


def _ontology_payload(config: Grade12WorldConfig) -> dict[str, object]:
    """Return the layout-independent, presentation-independent ontology payload."""

    return {
        "world_id": config.world_id,
        "ontology_version": config.ontology_version,
        "grade_bands": list(config.grade_bands),
        "realms": [
            {
                "realm_id": realm.realm_id,
                "label": realm.label,
                "description": realm.description,
                "districts": [
                    {
                        "district_id": district.district_id,
                        "label": district.label,
                        "description": district.description,
                        "content_skill_ids": list(district.content_skill_ids),
                    }
                    for district in realm.districts
                ],
            }
            for realm in config.realms
        ],
        "orthogonal_facets": [
            facet.model_dump(mode="json") for facet in config.orthogonal_facets
        ],
    }


def grade12_world_ontology_checksum(
    config: Grade12WorldConfig = GRADE12_WORLD,
) -> str:
    """Return a stable SHA-256 for persisted ontology provenance.

    The authored hex layout and the presentation-only Crossroads/Heaven regions
    are intentionally excluded, so a visual rearrangement cannot masquerade as
    a curriculum-taxonomy change.
    """

    encoded = json.dumps(
        _ontology_payload(config),
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def is_grade12_curricular_location(
    realm_id: str,
    district_id: str | None = None,
) -> bool:
    """Return whether IDs form a persistable Grades 1–2 curricular location."""

    if realm_id not in GRADE12_REALM_IDS:
        return False
    return district_id is None or GRADE12_DISTRICT_TO_REALM.get(district_id) == realm_id


class WorldPlacementKind(StrEnum):
    DISTRICT = "district"
    CROSSROADS = "crossroads"
    HEAVEN = "heaven"


class WorldPlacementProposal(_StrictFrozenModel):
    proposal_version: Literal["grade12-world-placement-proposal.v1"] = (
        GRADE12_WORLD_PROPOSAL_VERSION
    )
    ontology_version: Literal["grade12-six-realm-ontology.v1"] = (
        GRADE12_WORLD_ONTOLOGY_VERSION
    )
    ontology_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    authoritative: Literal[False] = False
    placement_kind: WorldPlacementKind
    realm_id: str | None = None
    district_id: str | None = None
    candidate_realm_ids: tuple[str, ...] = ()
    candidate_district_ids: tuple[str, ...] = ()
    reason_codes: tuple[str, ...] = Field(min_length=1)

    @field_validator("candidate_realm_ids", "candidate_district_ids", "reason_codes")
    @classmethod
    def canonical_tuples(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not entry.strip() for entry in value):
            raise ValueError("proposal evidence values cannot be blank")
        if tuple(sorted(set(value))) != value:
            raise ValueError("proposal evidence values must be sorted and unique")
        return value

    @model_validator(mode="after")
    def location_matches_kind(self) -> "WorldPlacementProposal":
        if self.placement_kind is WorldPlacementKind.DISTRICT:
            if self.realm_id is None or self.district_id is None:
                raise ValueError("district placements require curricular IDs")
            if not is_grade12_curricular_location(self.realm_id, self.district_id):
                raise ValueError("district placement uses an invalid curricular pair")
        elif self.realm_id is not None or self.district_id is not None:
            raise ValueError(
                "presentation-only placements cannot expose persistable curricular IDs"
            )
        return self


def _heaven_proposal(
    *reason_codes: str,
    candidate_realm_ids: Iterable[str] = (),
    candidate_district_ids: Iterable[str] = (),
) -> WorldPlacementProposal:
    return WorldPlacementProposal(
        ontology_sha256=grade12_world_ontology_checksum(),
        placement_kind=WorldPlacementKind.HEAVEN,
        candidate_realm_ids=tuple(sorted(set(candidate_realm_ids))),
        candidate_district_ids=tuple(sorted(set(candidate_district_ids))),
        reason_codes=tuple(sorted(set(reason_codes))),
    )


def propose_grade12_world_location(
    primary_domain: PrimaryDomain | str,
    *,
    skill_ids: Iterable[str] = (),
    playable: bool = True,
    unresolved: bool = False,
    reviewed_mixed: bool = False,
) -> WorldPlacementProposal:
    """Propose one conservative world location from existing catalogue evidence.

    Only mathematical-content skills explicitly mapped by this configuration
    can select a district. Representation IDs (``rep_``), reasoning moves
    (``rsn_``), procedures (``prc_``), and unknown skills are ignored for
    placement. Conflicting or insufficient evidence goes to presentation-only
    Heaven rather than being relabeled as a curricular ``mixed`` category.

    A genuinely cross-realm item reaches Crossroads only when a reviewer has
    explicitly confirmed ``reviewed_mixed=True``.
    """

    canonical_skills = tuple(sorted(set(skill_ids)))
    if any(not skill_id.strip() for skill_id in canonical_skills):
        raise ValueError("skill IDs cannot be blank")
    if not playable:
        return _heaven_proposal("UNPLAYABLE")
    if unresolved:
        return _heaven_proposal("UNRESOLVED")

    try:
        domain = PrimaryDomain(primary_domain)
    except (TypeError, ValueError):
        return _heaven_proposal("UNRECOGNIZED_DOMAIN")

    if domain is PrimaryDomain.UNKNOWN:
        return _heaven_proposal("UNKNOWN_DOMAIN")
    if domain is PrimaryDomain.MIXED:
        if not reviewed_mixed:
            return _heaven_proposal("UNRESOLVED_MIXED_DOMAIN")
        return WorldPlacementProposal(
            ontology_sha256=grade12_world_ontology_checksum(),
            placement_kind=WorldPlacementKind.CROSSROADS,
            reason_codes=("REVIEWED_CROSS_REALM",),
        )
    if reviewed_mixed:
        raise ValueError("reviewed_mixed is valid only for the mixed domain")

    realm_id = _DOMAIN_TO_REALM[domain]
    districts = tuple(
        sorted(
            {
                GRADE12_CONTENT_SKILL_TO_DISTRICT[skill_id]
                for skill_id in canonical_skills
                if skill_id in GRADE12_CONTENT_SKILL_TO_DISTRICT
            }
        )
    )
    if not districts:
        return _heaven_proposal(
            "NO_DISTRICT_EVIDENCE",
            candidate_realm_ids=(realm_id,),
        )

    district_realms = {
        GRADE12_DISTRICT_TO_REALM[district_id] for district_id in districts
    }
    if district_realms != {realm_id}:
        return _heaven_proposal(
            "CROSS_REALM_EVIDENCE_CONFLICT",
            candidate_realm_ids=(*district_realms, realm_id),
            candidate_district_ids=districts,
        )
    if len(districts) != 1:
        return _heaven_proposal(
            "MULTIPLE_DISTRICT_SIGNALS",
            candidate_realm_ids=(realm_id,),
            candidate_district_ids=districts,
        )

    return WorldPlacementProposal(
        ontology_sha256=grade12_world_ontology_checksum(),
        placement_kind=WorldPlacementKind.DISTRICT,
        realm_id=realm_id,
        district_id=districts[0],
        candidate_realm_ids=(realm_id,),
        candidate_district_ids=districts,
        reason_codes=("UNIQUE_DOMAIN_AND_CONTENT_SKILL",),
    )


__all__ = [
    "CROSSROADS_REGION_ID",
    "GRADE12_CONTENT_SKILL_TO_DISTRICT",
    "GRADE12_DISTRICT_IDS",
    "GRADE12_DISTRICT_TO_REALM",
    "GRADE12_REALM_IDS",
    "GRADE12_WORLD",
    "GRADE12_WORLD_LAYOUT_VERSION",
    "GRADE12_WORLD_ONTOLOGY_VERSION",
    "GRADE12_WORLD_PROPOSAL_VERSION",
    "GRADE12_WORLD_SCHEMA_VERSION",
    "HEAVEN_REGION_ID",
    "DistrictDefinition",
    "Grade12WorldConfig",
    "HexCoordinate",
    "OrthogonalFacetDefinition",
    "RealmDefinition",
    "SpecialRegionDefinition",
    "WorldLayoutDefinition",
    "WorldPlacementKind",
    "WorldPlacementProposal",
    "grade12_world_ontology_checksum",
    "is_grade12_curricular_location",
    "propose_grade12_world_location",
]
