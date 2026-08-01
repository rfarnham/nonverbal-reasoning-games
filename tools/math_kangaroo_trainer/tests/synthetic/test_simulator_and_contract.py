from __future__ import annotations

import json
from importlib.resources import files

from math_kangaroo_trainer.evaluation.synthetic import (
    SyntheticLearner,
    correct_probability,
    reference_synthetic_corpus,
    simulate_attempt,
)


def test_synthetic_simulator_is_deterministic_and_not_child_data() -> None:
    item = reference_synthetic_corpus()[0]
    strong = SyntheticLearner(
        learner_id="invented-strong",
        skill_abilities={"parity": 2.0},
    )
    developing = SyntheticLearner(
        learner_id="invented-developing",
        skill_abilities={"parity": -1.0},
    )
    assert correct_probability(strong, item) > correct_probability(developing, item)
    first = simulate_attempt(strong, item, seed=99)
    second = simulate_attempt(strong, item, seed=99)
    assert first == second
    assert first.simulator_version == "conjunctive-mismatch-simulator.v1"


def test_all_spec_acceptance_scenarios_are_frozen_before_policy_code() -> None:
    path = files("math_kangaroo_trainer.config").joinpath(
        "core-acceptance-scenarios.v1.json"
    )
    contract = json.loads(path.read_text(encoding="utf-8"))
    assert contract["status"] == "contract_pending_higher_stages"
    assert [scenario["scenario_id"] for scenario in contract["scenarios"]] == [
        f"AC-{number:02d}" for number in range(1, 11)
    ]
    assert all(scenario["stage"] in {2, 3} for scenario in contract["scenarios"])
