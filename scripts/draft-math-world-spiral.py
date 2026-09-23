#!/usr/bin/env python3
"""Read a pinned private catalogue and export a content-free curriculum proposal.

This authoring report never changes a database or the playable world. Counts
describe lexical candidates, not verified classifications or unique problems.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
RUN_ID = "catalogue-8b9cfc0f0f01b9ef7138902e"
PASSES = [
    (1, "Notice", ["1-2"]),
    (2, "Connect", ["3-4"]),
    (3, "Plan", ["5-6"]),
    (4, "Generalize", ["7-8", "9-10", "11-12"]),
]

# Skills are retrieval seeds. A shared seed never establishes a primary placement.
CONCEPTS = [
    ("counting", "Counting", ["cnt_counting_cardinality"], [
        "Count visible objects once; choose the relevant objects; count missing units.",
        "Organize groups, overlapping regions, and inclusive endpoints without double counting.",
        "Count by cases and complements; derive rather than enumerate a larger total.",
        "Prove a counting strategy; use invariants and combinatorial structure.",
    ]),
    ("symmetry", "Symmetry", ["cnt_symmetry"], [
        "Match mirror halves and complete one reflection across a visible line.",
        "Track folds and reflections across different axes; distinguish turns from mirrors.",
        "Combine transformations and reason about invariant features.",
        "Use symmetry to reduce cases and justify geometric relationships.",
    ]),
    ("addition-subtraction", "Addition & Subtraction", ["cnt_whole_addition_subtraction", "cnt_arithmetic_expressions"], [
        "Join, remove, and compare small visible quantities.",
        "Use inverse operations and two-step comparison stories.",
        "Choose an efficient decomposition and reason with signed quantities.",
        "Reason about expressions and additive invariants without brute-force calculation.",
    ]),
    ("patterns", "Patterns", ["cnt_numeric_patterns_sequences", "cnt_visual_patterns", "rsn_pattern_generalization"], [
        "Identify a repeating unit or one-step growing pattern.",
        "Find missing positions and use the period of a cycle.",
        "Compare recursive and position-based rules.",
        "Generalize a sequence and justify an indexed or recursive rule.",
    ]),
    ("shapes", "Shape Building", ["cnt_two_dimensional_shapes", "cnt_spatial_composition", "cnt_tessellation_covering", "cnt_polygon_angle_structure", "cnt_circle_geometry", "cnt_congruence_similarity"], [
        "Recognize boundaries and fit or combine simple pieces.",
        "Decompose and tile shapes while preserving their boundaries.",
        "Use angles, congruence, and similarity to constrain a construction.",
        "Prove a geometric relation using a useful decomposition or auxiliary shape.",
    ]),
    ("logic", "Logic", ["rsn_constraint_propagation", "rsn_case_analysis", "cnt_multi_clue_ordering", "cnt_truth_consistency", "cnt_assignment_constraints", "cnt_state_reversal", "cnt_possible_impossible", "cnt_invariant_structure"], [
        "Combine two concrete clues to eliminate an impossible arrangement.",
        "Order or place several objects; work backward through a short process.",
        "Track interacting constraints and exhaust a small set of cases.",
        "Use contradiction, invariants, and complete case analysis.",
    ]),
    ("groups-sharing", "Groups & Sharing", ["cnt_whole_multiplication_division", "cnt_ratio_proportion", "cnt_rates_percent"], [
        "Make equal groups and share concrete objects fairly.",
        "Link multiplication and division, including a meaningful remainder.",
        "Compare ratios and unit rates in multi-step situations.",
        "Reason proportionally with changing rates and constraints.",
    ]),
    ("digits", "Number & Digits", ["cnt_place_value", "cnt_digit_constraints", "cnt_parity", "cnt_factors_multiples", "cnt_divisibility", "cnt_remainders_cycles", "cnt_prime_factorization", "cnt_powers_roots"], [
        "Read place value and compose or compare numbers from digits.",
        "Use parity, place-value constraints, and simple divisibility.",
        "Use factors, multiples, remainders, and digit constraints together.",
        "Apply modular, factorization, and exponent structure.",
    ]),
    ("routes", "Routes & Grids", ["cnt_coordinates_grids", "cnt_viewpoint_navigation", "cnt_paths_networks", "cnt_graph_connectivity", "prc_grid_path_counting", "cnt_coordinate_geometry"], [
        "Follow a path, read positions, and distinguish steps from visited points.",
        "Compare routes on grids and obey one-way or no-repeat rules.",
        "Count constrained routes and use connectivity.",
        "Combine coordinate and graph structure to prove a route property.",
    ]),
    ("fractions", "Fractions", ["cnt_fractions_part_whole", "cnt_fraction_equivalence_comparison", "cnt_fraction_operations", "cnt_decimals_percent"], [
        "Recognize equal parts and halves in concrete pictures.",
        "Compare and compose fractions; reconstruct a whole from a part.",
        "Connect fraction operations, decimals, and percentages.",
        "Reason with successive fractional changes and constrained proportions.",
    ]),
    ("solids", "Solids & Views", ["cnt_three_dimensional_solids", "cnt_nets_cross_sections", "cnt_volume_surface_area"], [
        "Match a simple solid to a view and count visible blocks.",
        "Infer hidden blocks and match nets or multiple views.",
        "Reason about sections, painted faces, and surface versus volume.",
        "Use a spatial decomposition to justify a three-dimensional relationship.",
    ]),
    ("measurement", "Length & Measure", ["cnt_length_distance", "cnt_measurement_units", "cnt_mass_capacity", "cnt_volume_capacity", "cnt_scale_reasoning", "prc_unit_conversion"], [
        "Compare lengths and measure with repeated equal units.",
        "Combine measurements, choose units, and interpret a simple scale.",
        "Convert units and relate scale, capacity, and distance.",
        "Model an indirect measurement and justify the chosen units and scale.",
    ]),
    ("money", "Money & Value", ["cnt_money_value", "cnt_exchange_comparison"], [
        "Combine coin values and make a small purchase.",
        "Make change and compare equivalent purchases.",
        "Reason through exchanges, bundles, and proportional prices.",
        "Optimize a purchase or exchange with multiple constraints.",
    ]),
    ("time", "Time", ["cnt_time_calendar", "prc_elapsed_time", "cnt_rate_distance_time"], [
        "Read a clock or calendar and order short time intervals.",
        "Find elapsed time across hour and day boundaries.",
        "Coordinate schedules, periodic events, and travel time.",
        "Reason about simultaneous cycles and rate-time constraints.",
    ]),
    ("area", "Area & Boundary", ["cnt_area", "cnt_perimeter", "cnt_composite_measure"], [
        "Compare covered space using whole squares and trace a boundary.",
        "Distinguish area from perimeter and decompose a rectilinear region.",
        "Find composite or shaded area using equalities and subtraction.",
        "Prove area relations and optimize a boundary under constraints.",
    ]),
    ("missing-values", "Missing Values", ["cnt_unknowns_equations", "cnt_algebraic_expressions", "cnt_systems_relations", "cnt_functional_relationships", "cnt_symbol_codes"], [
        "Find one missing amount in a pictured balance or equality.",
        "Link two equalities and solve a simple symbol code.",
        "Translate relations into equations and solve coupled unknowns.",
        "Reason about functions, systems, and algebraic structure.",
    ]),
    ("possibilities", "Possibilities", ["cnt_combinatorial_counting", "cnt_arrangements_selections", "cnt_permutations_combinations", "rsn_systematic_enumeration", "prc_organize_cases_table", "prc_tree_diagram_enumeration", "prc_inclusion_exclusion"], [
        "Reserve: small concrete choice lists, if a separate world is worthwhile.",
        "List combinations systematically without missing or repeating an outcome.",
        "Use product structure, organized cases, and complementary counts.",
        "Use combinations, permutations, and inclusion-exclusion with justification.",
    ]),
    ("chance-data", "Chance & Data", ["cnt_sample_spaces", "cnt_elementary_probability", "cnt_conditional_probability", "cnt_data_interpretation"], [
        "Reserve: read a simple picture chart; no early probability prerequisite.",
        "Read a data display and identify all equally likely outcomes.",
        "Compare probabilities and aggregate or interpret data.",
        "Reason about conditional information and structured sample spaces.",
    ]),
]

COUNTING_ONE = [
    ("oasis-online-2012-grades-1-2-q01", 1, "Count animals; exclude non-animals and include the joey."),
    ("oasis-online-2023-grades-1-2-q01", 1, "Count nested circles once each."),
    ("oasis-online-2017-grades-1-2-q02", 1, "Count only stars with five points."),
    ("usa-2007-grades-1-2-q03", 2, "Track whole bicycles through overlap; crop out the next question."),
    ("oasis-online-2016-grades-1-2-q03", 2, "Count matches systematically by roof, rows, and columns."),
    ("oasis-online-2015-grades-1-2-q03", 2, "Count spots in visible groups without counting the ladybugs."),
    ("oasis-online-2016-grades-1-2-q02", 3, "Count whole ropes rather than exposed segments; endpoints provide a strategy."),
    ("oasis-online-2014-grades-1-2-q10", 3, "Count only circles containing the kangaroo."),
    ("oasis-online-2022-grades-1-2-q08", 3, "Count every touched grid cell once, using a row-by-row scan."),
    ("oasis-online-2014-grades-1-2-q07", 4, "Reconstruct a five-by-five grid to count missing squares."),
    ("oasis-online-2017-grades-1-2-q06", 4, "Count missing brick units across staggered rows."),
    ("oasis-online-2017-grades-1-2-q04", 4, "Stretch: distinguish cuts from resulting rope pieces."),
]


def build(catalogue: Path) -> dict:
    connection = sqlite3.connect(f"file:{catalogue.resolve()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    run = connection.execute("SELECT * FROM catalogue_runs WHERE run_id=?", (RUN_ID,)).fetchone()
    if run is None:
        raise ValueError(f"Missing pinned catalogue run: {RUN_ID}")
    raw = connection.execute("SELECT * FROM catalogue_items WHERE run_id=?", (RUN_ID,)).fetchall()
    review_count = connection.execute("SELECT COUNT(*) FROM catalogue_reviews WHERE run_id=?", (RUN_ID,)).fetchone()[0]
    placement_count = connection.execute("SELECT COUNT(DISTINCT item_id) FROM catalogue_world_placement_judgements WHERE run_id=?", (RUN_ID,)).fetchone()[0]
    connection.close()
    rows = []
    for record in raw:
        row = dict(record)
        source = json.loads(row["source_payload_json"])
        learner = json.loads(row["learner_payload_json"])
        proposal = json.loads(row["proposal_payload_json"])
        assets = json.loads(row["asset_refs_json"])
        answer = source.get("official_answer") or ""
        choices = learner.get("choices") or source.get("choices") or []
        row["asset"] = any(a.get("status") == "available" and Path(a.get("local_ref", "")).is_file() for a in assets)
        row["answer"] = bool(str(answer).strip())
        row["letter"] = row["asset"] and isinstance(answer, str) and len(answer) == 1 and answer in "ABCDE"
        row["complete"] = row["letter"] and row["option_count"] in (4, 5) and len(choices) == row["option_count"] and "ABCDE".index(answer) < len(choices)
        row["five"] = row["complete"] and len(choices) == 5
        row["skills"] = set(proposal.get("skill_ids", []))
        row["duplicate_flag"] = bool(json.loads(row["duplicate_group_ids_json"]))
        rows.append(row)
    by_id = {r["item_id"]: r for r in rows}
    complete = [r for r in rows if r["complete"]]
    summaries = []
    for band in ["1-2", "3-4", "5-6", "7-8", "9-10", "11-12"]:
        group = [r for r in rows if r["grade_band"] == band]
        summaries.append({"gradeBand": band, "items": len(group), **{key: sum(bool(r[key]) for r in group) for key in ["asset", "answer", "letter", "complete", "five"]}})
    slots = []
    for pass_number, pass_label, bands in PASSES:
        for order, (concept_id, label, skills, objectives) in enumerate(CONCEPTS, 1):
            if pass_number == 1 and order > 16:
                continue
            concept_iteration = pass_number if order <= 16 else pass_number - 1
            candidates = [r for r in complete if r["grade_band"] in bands and r["skills"].intersection(skills)]
            candidates.sort(key=lambda r: (r["published_point_tier"] or 6, r["question_number"], r["item_id"]))
            broad = [r for r in complete if r["grade_band"] in bands and r["skills"].intersection(set(skills) | {"cnt_geometric_transformations", "cnt_angles_turns"})] if concept_id == "symmetry" else candidates
            slots.append({
                "proposedOrder": len(slots) + 1,
                "id": f"{concept_id}-{concept_iteration}",
                "title": f"{label} {concept_iteration}",
                "conceptIteration": concept_iteration,
                "pass": pass_number, "passLabel": pass_label,
                "kind": "core-proposal" if order <= 16 else "conditional-specialist-proposal",
                "objective": objectives[pass_number - 1],
                "searchGradeBands": bands,
                "candidateCount": len(candidates),
                "fiveChoiceCandidateCount": sum(r["five"] for r in candidates),
                "duplicateFlaggedCandidateCount": sum(r["duplicate_flag"] for r in candidates),
                "broaderTransformationCandidateCount": len(broad) if concept_id == "symmetry" else None,
                "coverage": "retrieval-gap" if len(candidates) < 12 else "thin-candidate-pool" if len(candidates) < 24 else "candidate-pool",
                "classificationStatus": "unverified-lexical-candidates",
                "sampleCandidateReferences": [{"itemId": r["item_id"], "contentVersion": r["content_version"]} for r in candidates[:3]],
            })
    pilot = []
    for index, (item_id, stop, rationale) in enumerate(COUNTING_ONE, 1):
        row = by_id[item_id]
        if not row["five"]:
            raise ValueError(f"Counting candidate lacks the existing five-choice structure: {item_id}")
        pilot.append({"order": index, "stop": stop, "itemId": item_id, "contentVersion": row["content_version"], "rationale": rationale, "publishedPointTier": row["published_point_tier"], "sourceAnswerStatus": row["answer_status"], "assetInspected": True, "editorialStatus": "agent-proposed-after-visual-inspection", "runtimeApproved": False, "sourceFamily": row["source_family"]})
    return {
        "schemaVersion": 1, "proposalVersion": "spiral.2026-09-22.1",
        "status": "proposal-awaiting-user-sequence-approval",
        "runtimeConsumption": "none", "catalogueRunId": RUN_ID,
        "corpusSnapshotSha256": run["corpus_snapshot_sha256"],
        "classificationVersion": run["proposal_version"],
        "cautions": ["Candidate sets overlap and are not additive.", "Counts are records, not deduplicated unique problems.", "Stored answer metadata does not establish curriculum or display approval.", "Grade and published point tier are search hints, not calibrated learner difficulty.", "No private question text, answer, or asset is exported."],
        "corpus": {"items": len(rows), "completeChoiceRecords": len(complete), "fiveChoiceRecords": sum(r["five"] for r in rows), "duplicateFlaggedCompleteRecords": sum(r["duplicate_flag"] for r in complete), "currentRunCatalogueReviewRows": review_count, "currentRunWorldPlacementReviewedItems": placement_count, "bands": summaries, "completeChoiceAnswerStatuses": dict(sorted(Counter(r["answer_status"] for r in complete).items()))},
        "concepts": [{"id": c[0], "label": c[1], "retrievalSkillIds": c[2], "objectivesByPass": c[3]} for c in CONCEPTS],
        "worldSlots": slots, "countingOneProposedQuestions": pilot,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue", type=Path, default=ROOT / "work/math-kangaroo-adaptive-engine/catalogue/corpus-review.sqlite3")
    parser.add_argument("--output", type=Path, default=ROOT / "content/math-world/spiral-curriculum.proposed.json")
    args = parser.parse_args()
    result = build(args.catalogue)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {len(result['worldSlots'])} proposed world slots from {result['corpus']['items']} records to {args.output.relative_to(ROOT)}")
