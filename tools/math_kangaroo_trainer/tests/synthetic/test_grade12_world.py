from __future__ import annotations

import re

from math_kangaroo_trainer.curriculum.grade12_world import (
    CROSSROADS_REGION_ID,
    GRADE12_CONTENT_SKILL_TO_DISTRICT,
    GRADE12_DISTRICT_IDS,
    GRADE12_DISTRICT_TO_REALM,
    GRADE12_REALM_IDS,
    GRADE12_WORLD,
    GRADE12_WORLD_LAYOUT_VERSION,
    GRADE12_WORLD_ONTOLOGY_VERSION,
    HEAVEN_REGION_ID,
    HexCoordinate,
    WorldPlacementKind,
    grade12_world_ontology_checksum,
    is_grade12_curricular_location,
    propose_grade12_world_location,
)


EXPECTED_REALMS = {
    "number_arithmetic": "Number & Operations",
    "patterns_algebra": "Patterns & Relationships",
    "logic_constraints": "Logic & Constraints",
    "counting_combinatorics": "Possibilities & Combinatorics",
    "geometry_spatial": "Shape & Space",
    "measurement_time": "Measurement & Time",
}

EXPECTED_DISTRICTS = {
    "count_compare",
    "join_separate",
    "equal_groups_sharing",
    "equal_parts_fractions",
    "number_digit_structure",
    "repeat_grow",
    "equality_missing_values",
    "tables_codes_correspondence",
    "order_rank_relations",
    "clue_ordering",
    "constraint_placement",
    "working_backward",
    "elimination_invariants",
    "arrangements_selections",
    "systematic_counting",
    "paths_networks",
    "chance_outcomes",
    "shape_properties",
    "compose_dissect_tile",
    "turn_reflect_symmetry",
    "solids_stacks_views",
    "position_direction",
    "clock_calendar",
    "money_value",
    "length_distance",
    "perimeter_area_covering",
    "weight_capacity_units",
}


def test_world_has_six_authored_realms_and_two_non_curricular_regions() -> None:
    assert GRADE12_WORLD.ontology_version == GRADE12_WORLD_ONTOLOGY_VERSION
    assert GRADE12_WORLD.layout.layout_version == GRADE12_WORLD_LAYOUT_VERSION
    assert {realm.realm_id: realm.label for realm in GRADE12_WORLD.realms} == (
        EXPECTED_REALMS
    )
    assert GRADE12_REALM_IDS == frozenset(EXPECTED_REALMS)
    assert GRADE12_WORLD.crossroads.region_id == CROSSROADS_REGION_ID
    assert GRADE12_WORLD.heaven.region_id == HEAVEN_REGION_ID
    assert GRADE12_WORLD.crossroads.presentation_only is True
    assert GRADE12_WORLD.heaven.presentation_only is True
    assert {CROSSROADS_REGION_ID, HEAVEN_REGION_ID}.isdisjoint(
        GRADE12_REALM_IDS | GRADE12_DISTRICT_IDS
    )


def test_district_ids_and_hexes_are_friendly_unique_and_well_formed() -> None:
    districts = [
        district for realm in GRADE12_WORLD.realms for district in realm.districts
    ]
    assert len(districts) == 27
    assert GRADE12_DISTRICT_IDS == EXPECTED_DISTRICTS
    assert all(3 <= len(realm.districts) <= 6 for realm in GRADE12_WORLD.realms)
    assert all(
        re.fullmatch(r"[a-z][a-z0-9_]*", district.district_id) for district in districts
    )
    assert all(district.label and district.description for district in districts)
    assert all(district.local_hex != HexCoordinate(q=0, r=0) for district in districts)
    assert GRADE12_DISTRICT_TO_REALM["count_compare"] == "number_arithmetic"
    assert GRADE12_DISTRICT_TO_REALM["paths_networks"] == "counting_combinatorics"
    assert GRADE12_DISTRICT_TO_REALM["solids_stacks_views"] == "geometry_spatial"


def test_representations_reasoning_and_procedures_stay_orthogonal() -> None:
    facets = {facet.facet_id: facet for facet in GRADE12_WORLD.orthogonal_facets}
    assert set(facets) == {"representation", "reasoning_move", "procedure"}
    assert facets["representation"].source_id_prefix == "rep_"
    assert facets["reasoning_move"].source_id_prefix == "rsn_"
    assert facets["procedure"].source_id_prefix == "prc_"
    assert not any(facet.affects_curricular_home for facet in facets.values())
    assert all(
        skill_id.startswith("cnt_") for skill_id in GRADE12_CONTENT_SKILL_TO_DISTRICT
    )

    base = propose_grade12_world_location(
        "geometry_spatial", skill_ids=("cnt_spatial_composition",)
    )
    with_orthogonal_facets = propose_grade12_world_location(
        "geometry_spatial",
        skill_ids=(
            "cnt_spatial_composition",
            "prc_partition_or_auxiliary_mark",
            "rep_geometric_diagram_2d",
            "rsn_decomposition_recomposition",
        ),
    )
    assert with_orthogonal_facets == base
    assert base.placement_kind is WorldPlacementKind.DISTRICT
    assert (base.realm_id, base.district_id) == (
        "geometry_spatial",
        "compose_dissect_tile",
    )


def test_unknown_unresolved_unplayable_and_unreviewed_mixed_go_to_heaven() -> None:
    proposals = (
        propose_grade12_world_location("unknown"),
        propose_grade12_world_location("not_a_domain"),
        propose_grade12_world_location(
            "number_arithmetic",
            skill_ids=("cnt_counting_cardinality",),
            unresolved=True,
        ),
        propose_grade12_world_location(
            "number_arithmetic",
            skill_ids=("cnt_counting_cardinality",),
            playable=False,
        ),
        propose_grade12_world_location("mixed"),
        propose_grade12_world_location("logic_constraints", skill_ids=()),
    )
    assert all(
        proposal.placement_kind is WorldPlacementKind.HEAVEN for proposal in proposals
    )
    assert all(proposal.realm_id is None for proposal in proposals)
    assert all(proposal.district_id is None for proposal in proposals)
    assert HEAVEN_REGION_ID not in GRADE12_REALM_IDS
    assert HEAVEN_REGION_ID not in GRADE12_DISTRICT_IDS


def test_only_explicitly_reviewed_mixed_evidence_reaches_crossroads() -> None:
    proposal = propose_grade12_world_location("mixed", reviewed_mixed=True)
    assert proposal.placement_kind is WorldPlacementKind.CROSSROADS
    assert proposal.realm_id is None
    assert proposal.district_id is None
    assert proposal.reason_codes == ("REVIEWED_CROSS_REALM",)


def test_conflicting_or_non_unique_district_evidence_remains_unresolved() -> None:
    multiple = propose_grade12_world_location(
        "number_arithmetic",
        skill_ids=("cnt_counting_cardinality", "cnt_whole_addition_subtraction"),
    )
    cross_realm = propose_grade12_world_location(
        "number_arithmetic",
        skill_ids=("cnt_counting_cardinality", "cnt_spatial_composition"),
    )
    assert multiple.placement_kind is WorldPlacementKind.HEAVEN
    assert multiple.candidate_district_ids == ("count_compare", "join_separate")
    assert multiple.reason_codes == ("MULTIPLE_DISTRICT_SIGNALS",)
    assert cross_realm.placement_kind is WorldPlacementKind.HEAVEN
    assert cross_realm.candidate_realm_ids == (
        "geometry_spatial",
        "number_arithmetic",
    )
    assert cross_realm.reason_codes == ("CROSS_REALM_EVIDENCE_CONFLICT",)


def test_curricular_location_validation_rejects_special_and_mismatched_ids() -> None:
    assert is_grade12_curricular_location("number_arithmetic")
    assert is_grade12_curricular_location("number_arithmetic", "count_compare")
    assert not is_grade12_curricular_location("geometry_spatial", "count_compare")
    assert not is_grade12_curricular_location(HEAVEN_REGION_ID)
    assert not is_grade12_curricular_location(CROSSROADS_REGION_ID)


def test_ontology_checksum_is_stable_and_excludes_visual_layout() -> None:
    checksum = grade12_world_ontology_checksum()
    assert (
        checksum == "5380d75281dfa0bd0fced90c85737ba287e075f45d95c1869c21cd14c59f56a1"
    )
    moved_crossroads = GRADE12_WORLD.model_copy(
        update={
            "crossroads": GRADE12_WORLD.crossroads.model_copy(
                update={"world_hex": HexCoordinate(q=9, r=9)}
            )
        }
    )
    assert grade12_world_ontology_checksum(moved_crossroads) == checksum
