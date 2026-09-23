#!/usr/bin/env python3
"""Read a pinned private catalogue and export a content-free curriculum proposal.

This authoring report never changes a database or the playable world. Counts
describe lexical candidates, not verified classifications or unique problems.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
RUN_ID = "catalogue-8b9cfc0f0f01b9ef7138902e"
PASSES = [
    (1, "Notice", ["1-2"]),
    (2, "Connect", ["1-2", "3-4"]),
    (3, "Plan", ["3-4", "5-6"]),
    (4, "Generalize", ["5-6", "7-8", "9-10", "11-12"]),
]

# Public-safe summaries of the archived course materials. These are evidence
# for the curriculum vocabulary, not verified labels on individual corpus items.
SOURCE_LESSONS = [
    ("A", 1, "Fun With Patterns", ["patterns"], ["find-pattern"], "slides pp. 2-11", "Repeating pictures, colors, events, and addition/subtraction rules."),
    ("A", 2, "Picture It, Solve It!", ["counting", "addition-subtraction", "groups-sharing", "routes"], ["draw-diagram", "visualize"], "slides pp. 4-12", "Use simple pictures to track quantities, positions, intervals, and changing states."),
    ("A", 3, "Let's Work Backwards", ["addition-subtraction", "routes", "time", "missing-values"], ["work-backward"], "slides pp. 3-12", "Start from a known end state; reverse the order and direction of operations."),
    ("A", 4, "Tick-Tock Time Travelers", ["time"], ["draw-diagram", "work-backward"], "slides pp. 3-12", "Read clocks/calendars, convert familiar time units, and reason about elapsed time."),
    ("A", 5, "Puzzle Mania", ["counting", "shapes", "area"], ["visualize", "draw-diagram", "compare-order"], "slides pp. 3-4, 15", "Infer missing pieces, compare outlines, and reconstruct a pictured whole."),
    ("A", 6, "Flat Figures and Shapes", ["shapes", "counting", "area"], ["decompose", "compare-order"], "slides pp. 3-17", "Distinguish flat/solid objects; compare and cut shapes; count missing units and compare coverage."),
    ("A", 7, "Think, Guess, Check!", ["digits", "logic", "missing-values"], ["guess-check", "organize-cases"], "slides pp. 2-13", "Use parity, digit clues, and equal-sum constraints to try and revise candidates."),
    ("A", 8, "Money, Money, Money", ["money", "groups-sharing", "missing-values"], ["draw-diagram", "write-equation", "compare-order"], "slides pp. 3-13", "List prices, combine costs, find change, repeat equal prices, and compare purchases."),
    ("A", 9, "Symmetry Quest", ["symmetry", "shapes"], ["visualize", "transform"], "slides pp. 3, 7-17", "Distinguish identical figures from mirror images; use axes, folds, stamps, and successive flips."),
    ("A", 10, "Game On! / MK 2012", [], ["choose-and-check"], "slides pp. 4-11", "Mixed synthesis: understand, choose a strategy, carry it out, check the result."),
    ("B", 1, "Math in Motion: Paths and Mazes", ["routes", "possibilities"], ["trace-path", "guess-check", "organized-list"], "class notes pp. 6-10", "Trace legal routes, backtrack from dead ends, minimize crossings, and count possible routes."),
    ("B", 2, "Compare, Get in Line!", ["counting", "digits", "logic", "measurement"], ["compare-order", "draw-diagram"], "class notes slides 7-8", "Use comparison clues, order values or objects, and reason about positions in a line."),
    ("B", 3, "Spatial Secrets", ["shapes", "solids", "counting"], ["visualize", "draw-diagram", "transform"], "class notes slide 7 and worked examples", "Track views, stacking order, overlaps, woven strips, and shape completion."),
    ("B", 4, "Measure Up!", ["measurement", "routes", "area"], ["compare-order", "draw-diagram"], "class notes slide 5 and worked examples", "Count equal units and compare lengths, heights, and route distances."),
    ("B", 5, "Story Problems", ["counting", "possibilities", "groups-sharing", "logic"], ["organized-list", "build-table", "organize-cases"], "class notes slides 4-10; instructor lesson summary", "Use organized lists and tables for routes, repeated processes, pairings, and allocations."),
    ("B", 6, "How Old Are You?", ["addition-subtraction", "missing-values"], ["draw-diagram", "use-invariant", "work-backward"], "class notes slides 7-13", "Ages change together; differences stay fixed; a sum grows once per person each year. Classify the quantity relation, not the age setting."),
    ("B", 7, "Solids in Action", ["solids"], ["visualize", "decompose"], "class notes slides 7-9 and worked examples", "Identify solids, faces, edges, and vertices; infer hidden cubes and match views/nets."),
    ("B", 8, "Balance the Scales / Balancing Act", ["missing-values", "groups-sharing", "money"], ["write-equation", "use-invariant", "work-backward"], "class notes slide 7 and worked examples", "Preserve equality on both sides, substitute equivalent groups, and chain exchanges."),
    ("B", 9, "Logical Reasoning / Got Logic?", ["logic", "measurement", "routes"], ["draw-diagram", "guess-check", "compare-order"], "class notes slide 7 and worked examples", "Combine explicit and implied clues; revise an arrangement while satisfying every condition."),
    ("B", 10, "The 4-Step Method and MK 2022", [], ["choose-and-check"], "class notes slides 5-8", "Mixed synthesis with pattern, diagram, list, table, visualization, trial, and equation strategies."),
]

STRATEGIES = [
    ("find-pattern", "Find a pattern", ["set-a-01", "set-b-10"]),
    ("draw-diagram", "Draw a diagram", ["set-a-02", "set-b-02", "set-b-09"]),
    ("visualize", "Visualize the state change", ["set-a-02", "set-a-09", "set-b-03"]),
    ("work-backward", "Work backward", ["set-a-03", "set-b-06", "set-b-10"]),
    ("guess-check", "Try, check, and revise", ["set-a-07", "set-b-01", "set-b-10"]),
    ("organized-list", "Make an organized list", ["set-b-05", "set-b-10", "think-enumeration"]),
    ("build-table", "Build a table", ["set-b-05", "set-b-10"]),
    ("write-equation", "Write an equation", ["set-b-08", "set-b-10"]),
    ("compare-order", "Compare and order", ["set-b-02", "set-b-04", "think-logic"]),
    ("organize-cases", "Organize and exhaust cases", ["set-a-07", "set-b-05", "think-enumeration"]),
    ("decompose", "Decompose and rebuild", ["set-a-05", "set-a-06", "set-b-07"]),
    ("transform", "Track a reflection, turn, or fold", ["set-a-09", "set-b-03", "think-shape"]),
    ("trace-path", "Trace and backtrack", ["set-a-03", "set-b-01"]),
    ("use-invariant", "Use what stays unchanged", ["set-b-06", "set-b-08"]),
    ("optimize", "Find a minimum or maximum", ["think-enumeration", "think-logic"]),
    ("choose-and-check", "Choose a strategy and check another way", ["set-a-10", "set-b-10"]),
]

SOURCE_SUBSKILLS = [
    ("count-once", "Count objects, relevant subsets, and missing units", ["counting"], ["set-a-05", "set-a-06"]),
    ("ordering-intervals", "Ordering, line positions, and intervals", ["counting", "digits", "routes"], ["set-a-02", "set-b-02", "think-enumeration"]),
    ("systematic-enumeration", "Count possibilities with a list, table, or cases", ["counting", "possibilities"], ["set-b-05", "think-enumeration"]),
    ("mirrors-identical", "Identical figures, mirror axes, folds, and successive flips", ["symmetry"], ["set-a-09", "think-shape"]),
    ("reverse-process", "Reverse a numerical or spatial process", ["addition-subtraction", "routes", "missing-values"], ["set-a-03"]),
    ("repeating-growing", "Repeating and growing picture/number rules", ["patterns"], ["set-a-01"]),
    ("missing-pieces", "Compose, complete, cut, and compare flat figures", ["shapes", "area"], ["set-a-05", "set-a-06", "set-b-03"]),
    ("constraint-clues", "Conditional, comparison, and arrangement clues", ["logic"], ["set-b-09", "think-logic"]),
    ("min-max", "Smallest/largest feasible result under constraints", ["logic", "counting", "money", "possibilities"], ["think-enumeration", "think-logic"]),
    ("equal-groups", "Equal sharing, repeated equal quantities, and exchange rates", ["groups-sharing"], ["set-a-02", "set-a-08", "set-b-08"]),
    ("number-structure", "Digit clues, parity, page numbering, and divisibility", ["digits"], ["set-a-07", "think-number"]),
    ("routes-rules", "Maze reachability, shortest paths, and constrained route counts", ["routes"], ["set-b-01"]),
    ("spatial-views", "Top views, occlusion, layers, hidden cubes, and nets", ["solids"], ["set-b-03", "set-b-07", "think-shape"]),
    ("dice-faces", "Dice faces, opposite faces, and nets", ["solids"], ["think-shape"]),
    ("gear-motion", "Linked gear motion", [], ["think-shape"]),
    ("measure-units", "Repeated units, length/height comparisons, and distance", ["measurement"], ["set-b-04"]),
    ("purchase-relations", "Coin values, change, bundles, and purchase differences", ["money"], ["set-a-08"]),
    ("clock-calendar", "Clocks, calendars, elapsed time, and backward schedules", ["time"], ["set-a-04", "set-a-03"]),
    ("age-invariants", "Ages changing together, fixed differences, and changing sums", ["addition-subtraction", "missing-values"], ["set-b-06"]),
    ("balance-exchange", "Equality-preserving moves, equivalent groups, and exchanges", ["missing-values", "groups-sharing", "money"], ["set-b-08"]),
    ("codes-surplus", "Codes, quantities without numbers, and surplus/shortage", ["missing-values", "addition-subtraction"], ["think-number", "think-logic"]),
]

STRATEGY_SCAFFOLDING = {
    1: "Demonstrate a useful move, then repeat it with a small variation.",
    2: "Transfer a familiar move to a new representation; combine two linked steps.",
    3: "Choose between plausible moves; organize several cases or interacting constraints.",
    4: "Justify completeness or invariance and check a solution independently; advanced notation is optional.",
}

# Family-to-world mappings are local proposals. The user-supplied taxonomy is
# preserved byte-for-byte in its versioned reference file, including all 86
# subtype definitions, 22 strategies, boundaries, schema, and source metadata.
TAXONOMY_FAMILIES = [
    ("NUM", "Number sense and arithmetic", ["counting", "addition-subtraction", "groups-sharing", "digits"], "Given objects, number order, place value, operations, estimation, and intervals."),
    ("INT", "Integer properties", ["digits"], "Parity, divisibility, factors, primes, GCD/LCM, remainders, and digit constraints."),
    ("FRC", "Fractions, decimals, and ratios", ["fractions", "groups-sharing"], "Part-whole relations, fraction operations, proportional sharing, and percentages."),
    ("REL", "Quantitative relations and early algebra", ["missing-values", "addition-subtraction", "groups-sharing", "digits", "money", "time"], "Comparisons, transfers, age relations, balances, codes, and rates; story context alone does not determine placement."),
    ("PAT", "Patterns", ["patterns", "time"], "Repeating, growing, interleaved, and synchronized cycles."),
    ("MEA", "Measurement, money, and time", ["measurement", "money", "time"], "Units, scales, prices/change, clocks, elapsed time, and calendars."),
    ("GEO", "Plane geometry", ["symmetry", "shapes", "area", "routes"], "Shapes, angles, area, perimeter, reflection, tiling, and coordinates."),
    ("SPA", "Spatial visualization", ["shapes", "solids", "symmetry"], "Positions, missing pieces, views, hidden cubes, nets, dice faces, folding, and layers."),
    ("CNT", "Combinatorial counting", ["counting", "possibilities", "routes", "digits"], "Arrangements, selections, distributions, route counts, embedded figures, digit occurrences, sets, and pairings."),
    ("LOG", "Logic and constraints", ["logic"], "Matching, ordering from clues, truth conditions, grids, pigeonhole, and informative weighings."),
    ("MOV", "Paths, legal moves, and strategy games", ["routes"], "Mazes, shortest paths, one-stroke routes, legal moves, winning strategies, and connectivity."),
    ("DAT", "Data, statistics, and probability", ["chance-data"], "Tables/charts, averages, spread, likelihood, and probability."),
]

TAXONOMY_BOUNDARIES = [
    ("given-vs-possible", "Counting given objects is NUM; counting configurations, embedded composite figures, or possible arrangements is CNT. If tracing containment or hidden structure is the bottleneck, consider SPA."),
    ("order-vs-arrangements", "Deducing a line-up is LOG.order_constraints; counting allowed line-ups is CNT.ordered_arrangements. Both IDs are registered in the supplied v1.0.0 taxonomy."),
    ("navigation-vs-route-count", "Find or optimize a legal route: MOV. Count valid routes: CNT. Use coordinate geometry essentially: GEO."),
    ("dice-structure", "Infer dice faces or a net: SPA. Count dice configurations: CNT. Reason about likelihood under a random experiment: DAT."),
    ("balance-vs-information", "Solve equivalent quantities on a balance: REL. Choose informative weighings to identify an unknown object: LOG."),
    ("clock-vs-age", "Read clocks, elapsed time, or calendars: MEA. Infer age sums, differences, or invariant relations: REL; the age story alone does not make Time the primary world."),
    ("money-context", "Money is primary MEA when denomination, units, value, or change is essential; a purchase setting alone does not displace REL, CNT, or another core structure."),
    ("symmetry-role", "Reflection or geometric symmetry can be primary GEO; using symmetry to simplify a count is a strategy with primary CNT."),
    ("incidental-arithmetic", "Do not add arithmetic as a secondary concept merely because a solution includes a routine calculation."),
]


TAXONOMY_PATH = ROOT / "content/math-world/competition-math-taxonomy.v1.0.0.proposed.json"
GUIDE_PATH = ROOT / "docs/competition-math-classification-guide.v1.0.0.proposed.md"

# These are candidate homes, not a replacement for subtype or item review.
TOPIC_HOME_OVERRIDES = {
    "NUM.quantities": ["counting"], "NUM.order_number_line": ["digits"],
    "NUM.place_value": ["digits"], "NUM.add_subtract": ["addition-subtraction"],
    "NUM.multiply_divide": ["groups-sharing"], "NUM.computation_structure": ["addition-subtraction"],
    "NUM.estimation": ["digits"], "NUM.intervals": ["counting"],
    "FRC.ratio_proportion": ["groups-sharing"],
    "REL.additive": ["addition-subtraction"], "REL.multiplicative": ["groups-sharing"],
    "REL.chained_operations": ["addition-subtraction", "missing-values"],
    "REL.transfers": ["addition-subtraction", "missing-values"],
    "REL.balance": ["missing-values", "groups-sharing", "money"],
    "REL.cryptarithms": ["missing-values", "digits"], "REL.rates": ["groups-sharing", "time"],
    "PAT.cycles": ["patterns", "time"],
    "MEA.units": ["measurement"], "MEA.length_scales": ["measurement"],
    "MEA.mass_capacity_temperature": ["measurement"], "MEA.money": ["money"],
    "MEA.clock_elapsed": ["time"], "MEA.calendar": ["time"],
    "GEO.properties": ["shapes"], "GEO.angles": ["shapes"],
    "GEO.perimeter": ["area"], "GEO.area_basic": ["area"], "GEO.area_composite": ["area"],
    "GEO.symmetry_transformations": ["symmetry"], "GEO.dissection_tiling": ["shapes"],
    "GEO.coordinates": ["routes"],
    "SPA.containment_position": ["shapes", "solids"], "SPA.visual_matching": ["shapes"],
    "SPA.folding_cutting": ["symmetry", "shapes"], "SPA.overlap_layers": ["shapes", "solids"],
    "CNT.path_counts": ["routes", "possibilities"], "CNT.figure_counts": ["counting"],
    "CNT.digit_occurrences": ["digits", "counting"], "CNT.overlap_counts": ["counting"],
    "MOV.navigation": ["routes"], "MOV.traversal": ["routes"], "MOV.networks": ["routes"],
    "MOV.state_moves": [], "MOV.winning_games": [],
}
TOPIC_DEFAULT_HOMES = {"INT": ["digits"], "FRC": ["fractions"], "REL": ["missing-values"], "PAT": ["patterns"], "SPA": ["solids"], "CNT": ["counting", "possibilities"], "LOG": ["logic"], "DAT": ["chance-data"]}

COURSE_STRATEGY_CROSSWALK = [
    ("find-pattern", ["find_pattern"], "Direct vocabulary match."),
    ("draw-diagram", ["draw_model"], "A model introduced to solve the problem, not every supplied diagram."),
    ("visualize", ["simulate_state"], "Candidate when explicitly tracking states; visual format alone is not a strategy."),
    ("work-backward", ["work_backward"], "Direct vocabulary match."),
    ("guess-check", ["guess_check"], "Structured candidate checking."),
    ("organized-list", ["organized_enumeration"], "List must support complete, nonduplicated enumeration."),
    ("build-table", ["organized_enumeration"], "Only when the table enumerates cases; otherwise table is a representation."),
    ("write-equation", [], "Equation is a representation; select substitution_elimination only when the actual method warrants it."),
    ("compare-order", [], "Compare/order are goals; choose a strategy from the actual solution."),
    ("organize-cases", ["case_split", "organized_enumeration"], "Choose the essential method(s), not both by default."),
    ("decompose", ["decompose_recompose"], "Direct vocabulary match."),
    ("transform", ["simulate_state", "symmetry"], "Tracking a turn and exploiting symmetry differ; inspect the method."),
    ("trace-path", ["simulate_state", "work_backward"], "Candidates depend on whether tracing proceeds forward or backward."),
    ("use-invariant", ["invariant"], "Direct vocabulary match."),
    ("optimize", ["extremal_bounds"], "Optimization is a goal; use this strategy only for a bound plus an attaining construction."),
    ("choose-and-check", [], "A teaching routine, not an automatic mathematical strategy tag."),
]


def taxonomy_reference():
    payload = TAXONOMY_PATH.read_bytes()
    taxonomy = json.loads(payload)
    topics = [topic for family in taxonomy["domains"] for topic in family["topics"]]
    topic_ids = {topic["id"] for topic in topics}
    strategy_ids = set(taxonomy["tag_vocabularies"]["strategies"])
    if len(taxonomy["domains"]) != 12 or len(topics) != 86 or len(topic_ids) != 86 or len(strategy_ids) != 22:
        raise ValueError("Unexpected supplied taxonomy scope")
    if not set(TOPIC_HOME_OVERRIDES).issubset(topic_ids):
        raise ValueError("Unregistered subtype in local world crosswalk")
    if any(not set(ids).issubset(strategy_ids) for _, ids, _ in COURSE_STRATEGY_CROSSWALK):
        raise ValueError("Unregistered strategy in course crosswalk")
    return taxonomy, payload, topics


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
        "Use angles, congruence, and tiling constraints to organize a construction.",
        "Use similarity, decomposition, and auxiliary shapes after ratios and scale have been taught.",
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
    taxonomy, taxonomy_bytes, taxonomy_topics = taxonomy_reference()
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
                "candidateTaxonomyFamilyIds": [f[0] for f in TAXONOMY_FAMILIES if concept_id in f[2]],
                "taxonomyPlacementStatus": "world-crosswalk-only-no-item-taxonomy-assignment",
                "taxonomyScopeReview": "upper-grade-extension-review" if pass_number == 4 else "preserve-grades-5-6-and-check-prerequisites" if pass_number == 3 else "within-reference-target-grades-subject-to-item-review",
                "strategyScaffolding": STRATEGY_SCAFFOLDING[pass_number],
                "sourceLinkedSubskillIds": [s[0] for s in SOURCE_SUBSKILLS if concept_id in s[2]],
                "strategyIds": sorted({strategy for lesson in SOURCE_LESSONS if concept_id in lesson[3] for strategy in lesson[4]} | ({"find-pattern"} if concept_id == "patterns" else set())),
                "editorialStatus": "proposed-not-assigned-or-approved",
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
        "schemaVersion": 1, "proposalVersion": "spiral.2026-09-22.3",
        "status": "proposal-awaiting-user-sequence-approval",
        "runtimeConsumption": "none", "catalogueRunId": RUN_ID,
        "corpusSnapshotSha256": run["corpus_snapshot_sha256"],
        "classificationVersion": run["proposal_version"],
        "cautions": ["Candidate sets overlap both across concepts and across passes and are not additive.", "Counts are records, not deduplicated unique problems.", "Stored answer metadata does not establish curriculum or display approval.", "Grade and published point tier are search hints, not calibrated learner difficulty.", "Set A and Set B are complementary Level 1-2 courses, not difficulty levels 1 and 2.", "Source-linked subskills describe curriculum evidence, not verified tags on each candidate question.", "The 12-family crosswalk is a secondary design input; existing candidate counts still use the pinned lexical classifier.", "The supplied taxonomy targets grades 1-5; upper-grade extension and every item assignment require review.", "No private question text, answer, email identifiers, conversation identifiers, or asset is exported."],
        "passes": [{"number": n, "label": label, "searchGradeBands": bands, "strategyScaffolding": STRATEGY_SCAFFOLDING[n]} for n, label, bands in PASSES],
        "ontologyFacets": {
            "primaryConcept": "One primary learning target and world home for each selected question. World grouping and taxonomy family are distinct; classify structure rather than story setting.",
            "taxonomy": "One primary subtype plus at most three essential secondary concepts; do not tag incidental arithmetic. Use the supplied 86 registered subtype IDs; any extension requires an explicit proposal and review.",
            "subskills": "Specific mathematical relations or actions evidenced in the source courses.",
            "strategies": "Several legitimate solving moves may apply to the same question.",
            "representation": "Pictures, diagrams, grids, physical arrangements, text, equations, lists, or tables.",
            "reasoningDemand": ["linked-relations", "cases", "hidden-state", "representation-changes", "prerequisite-operations", "strategy-choice", "scaffold-independence"],
            "sourceRole": ["topic-practice", "warm-up", "mixed-review", "course-capstone"],
            "editorialStatus": "Source vocabulary grounded; individual item assignments remain proposed.",
        },
        "secondaryTaxonomyInput": {
            "title": "Competition Math Taxonomy Outline", "type": "user-supplied ChatGPT synthesis and complete companion attachments",
            "authority": "secondary-design-input-not-verified-official-ontology",
            "reviewedScope": "12 families, 86 registered topics with definitions and boundaries, 22 strategy tags, controlled facets, classification rules, tie-breakers, output schema, and 12 illustrative examples.",
            "taxonomyId": taxonomy["taxonomy_id"], "version": taxonomy["version"], "sourceCreated": taxonomy["created"],
            "taxonomyPath": str(TAXONOMY_PATH.relative_to(ROOT)), "taxonomySha256": hashlib.sha256(taxonomy_bytes).hexdigest(),
            "guidePath": str(GUIDE_PATH.relative_to(ROOT)), "guideSha256": hashlib.sha256(GUIDE_PATH.read_bytes()).hexdigest(),
            "preservation": "Both supplied attachments are preserved byte-for-byte, including original metadata; not imported by the runtime.",
            "registeredTopicIds": [topic["id"] for topic in taxonomy_topics],
            "registeredStrategyIds": list(taxonomy["tag_vocabularies"]["strategies"]),
            "classificationSchemaReference": str(TAXONOMY_PATH.relative_to(ROOT)) + "#/output_json_schema",
            "targetGrades": taxonomy["scope"]["target_grades"],
            "upperGradeScopeStatus": "Requires extension review; grades 5-6 retain their source band and higher-grade pools are not validated by this elementary taxonomy.",
            "worldCrosswalkStatus": "locally-proposed-not-item-classifications",
            "newTaxonomyClassificationsProduced": 0,
        },
        "proposedTaxonomyFamilies": [{"id": fid, "label": next(d["label"] for d in taxonomy["domains"] if d["id"] == fid), "candidateWorldConceptIds": concepts, "scopeSummary": scope, "mappingStatus": "local-proposal-requires-primary-learning-target-review"} for fid, _, concepts, scope in TAXONOMY_FAMILIES],
        "proposedTopicWorldCrosswalk": [{"topicId": topic["id"], "candidateWorldConceptIds": homes, "status": "local-proposal-requires-item-review" if homes else "unplaced-requires-world-decision"} for topic in taxonomy_topics for homes in [TOPIC_HOME_OVERRIDES.get(topic["id"], TOPIC_DEFAULT_HOMES.get(topic["id"].split(".")[0], []))]],
        "courseStrategyCrosswalk": [{"courseStrategyId": sid, "candidateRegisteredStrategyIds": ids, "boundary": note, "status": "local-proposal-not-automatic-conversion"} for sid, ids, note in COURSE_STRATEGY_CROSSWALK],
        "classificationBoundaries": [{"id": bid, "rule": rule, "status": "proposed-editorial-rule"} for bid, rule in TAXONOMY_BOUNDARIES],
        "classificationProvenancePolicy": {
            "status": "proposed-not-implemented",
            "sourcePreservation": "Keep each original corpus record unchanged. Classification output is an annotation, not a replacement source record.",
            "separateEnvelope": ["problem_id", "content-version-or-input-fingerprint", "classification-run-id", "model-and-prompt-version", "parent-question-and-subpart", "shared-stimulus-reference", "source-country-and-system", "asset-references"],
            "schemaBoundary": "The supplied classification schema forbids extra properties; store provenance outside that schema, keyed by problem_id and the source content version.",
        },
        "classificationPilot": {
            "status": "proposed-not-executed", "targetRecords": 400, "acceptableRange": [300, 500],
            "stratifyBy": ["source-family", "grade-band", "point-tier", "candidate-family", "diagram-dependence", "metadata-quality"],
            "reviewChecks": ["Inspect prompt, diagrams, pictured options, and answer source.", "Resolve the primary structure and at most three essential secondary concepts.", "Keep source grade, prerequisites, reasoning demand, and incidental reading/computation/visual demand separate.", "Allow missing or uncertain classification rather than inferring unseen information.", "Review disagreement and overlap before scaling; deduplicate source editions before world assignment."],
            "semanticValidationStillRequired": ["No primary topic duplicated among secondary topics.", "Every tag is essential and supported; no unstated conventions.", "Ambiguous candidate topics agree with the stated family or explicitly span families.", "Material quality flags and proposed new topics require review.", "No calibrated difficulty claim without real response evidence."],
            "fixtureGaps": ["INT", "FRC", "MEA", "GEO", "family_only", "ambiguous", "unreadable", "out_of_scope"],
            "rolloutGate": "Sequence and aesthetics acceptance precede world production; a classification pilot and subtype-definition review precede corpus-wide relabeling.",
        },
        "taxonomyCoverageGaps": [
            {"familyId": "CNT", "issue": "Counting and Possibilities overlap; arrangements, selections, distributions, pairings, and embedded figures need explicit subtype boundaries before bank assignment.", "action": "Keep specialist worlds conditional; choose one primary home per problem."},
            {"familyId": "MOV", "issue": "Routes covers navigation but does not establish coverage of swaps, toggles, pouring, or winning-strategy games.", "action": "Reserve unplaced subskills; no new required world without inspected coverage and approval."},
            {"familyId": "DAT", "issue": "The thin Chance & Data pool does not establish statistics or probability coverage separately.", "action": "Inspect charts and statistical reasoning separately from random experiments; defer or split only after coverage review."},
            {"familyId": "LOG", "issue": "Pigeonhole and informative weighing are not established by the current broad Logic candidate count.", "action": "Review specific structures instead of inferring coverage from the family name."},
            {"familyId": "SPA", "issue": "Gear motion and folding details need a precise learning target; existing world names do not prove placement.", "action": "Hold unplaced cases for taxonomy and world-boundary review."},
        ],
        "sourceCurricula": [
            {"id": "set-a", "label": "Math Kangaroo Exploring Level 1-2, Set A", "orderedLessonIds": [f"set-a-{n:02}" for n in range(1, 11)], "relationship": "Complementary same-grade course; not a difficulty tier."},
            {"id": "set-b", "label": "Math Kangaroo Exploring Level 1-2, Set B", "orderedLessonIds": [f"set-b-{n:02}" for n in range(1, 11)], "relationship": "Complementary same-grade course; not a difficulty tier."},
            {"id": "think-mk300", "label": "Think Academy MK 300, six 2024 workbooks", "scope": "Grades 1-2 and 3-4, each at 3/4/5-point tiers; 600 source occurrences, including 80 review-role occurrences.", "hierarchy": ["grade-band", "point-tier", "week-domain", "day-topic"], "threePointOrder": ["Shape", "Enumeration", "Numbers and Word Problem", "Logic"], "fourFivePointCadence": "Four topical practice days followed by a fifth mixed-review day within each of four weeks.", "caveat": "Broad source headings can contain another concept; inspect each question. A dice problem is not automatically probability."},
        ],
        "sourceLessons": [{"id": f"set-{set_id.lower()}-{number:02}", "set": set_id, "lesson": number, "title": title, "conceptIds": concept_ids, "strategyIds": strategies, "evidenceLocator": locator, "summary": summary, "sourceRole": "course-capstone" if number == 10 else "topic-practice", "evidenceStatus": "source-grounded-summary"} for set_id, number, title, concept_ids, strategies, locator, summary in SOURCE_LESSONS],
        "additionalSourceReferences": [
            {"id": "think-shape", "label": "Think Academy Shape / Spatial Imagination / Geometry topics", "evidenceLocator": "Grades 1-2, 4-point pp. 3-16; 5-point pp. 35, 37; Grades 3-4, 5-point p. 49", "evidenceStatus": "source-grounded-summary"},
            {"id": "think-enumeration", "label": "Think Academy Enumeration and systematic-counting topics", "evidenceLocator": "Both 3-point workbook Enumeration weeks; topic and review structure across the six books", "evidenceStatus": "source-grounded-summary"},
            {"id": "think-number", "label": "Think Academy Numbers, Digital Logic, and Word Problems topics", "evidenceLocator": "Grades 1-2, 4-point pp. 17-41; Grades 3-4, 5-point pp. 19, 22, 33-38", "evidenceStatus": "source-grounded-summary"},
            {"id": "think-logic", "label": "Think Academy Logic and Logical Reasoning topics", "evidenceLocator": "Grades 1-2, 4-point pp. 42-48; four topical days then review", "evidenceStatus": "source-grounded-summary"},
        ],
        "reasoningStrategies": [{"id": sid, "label": label, "sourceReferenceIds": refs, "editorialStatus": "source-grounded-vocabulary-not-item-classification"} for sid, label, refs in STRATEGIES],
        "sourceLinkedSubskills": [{"id": sid, "label": label, "conceptIds": concepts, "sourceReferenceIds": refs, "editorialStatus": "source-grounded-vocabulary-not-item-classification", "placementCaveat": "A transformation extension needs an explicit world assignment; do not silently label gear motion as mirror symmetry." if sid == "gear-motion" else None} for sid, label, concepts, refs in SOURCE_SUBSKILLS],
        "corpus": {"items": len(rows), "completeChoiceRecords": len(complete), "fiveChoiceRecords": sum(r["five"] for r in rows), "duplicateFlaggedCompleteRecords": sum(r["duplicate_flag"] for r in complete), "currentRunCatalogueReviewRows": review_count, "currentRunWorldPlacementReviewedItems": placement_count, "bands": summaries, "completeChoiceAnswerStatuses": dict(sorted(Counter(r["answer_status"] for r in complete).items()))},
        "concepts": [{"id": c[0], "label": c[1], "retrievalSkillIds": c[2], "objectivesByPass": c[3], "candidateTaxonomyFamilyIds": [f[0] for f in TAXONOMY_FAMILIES if c[0] in f[2]], "taxonomyMappingStatus": "local-world-crosswalk-not-item-assignment"} for c in CONCEPTS],
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
    display_output = args.output.relative_to(ROOT) if args.output.is_relative_to(ROOT) else args.output
    print(f"Wrote {len(result['worldSlots'])} proposed world slots from {result['corpus']['items']} records to {display_output}")
