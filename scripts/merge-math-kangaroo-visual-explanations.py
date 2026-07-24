#!/usr/bin/env python3
"""Merge the reviewed, strictly grounded MK visual explanations.

This script intentionally updates only ``visualExplanation``. Prompt polish,
solution prose, hints, and legacy animation plans remain owned by the canonical
solution overrides and must not be overwritten by audit artifacts.
"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "app/journey/reviews/math-kangaroo/data"
MANIFEST = DATA / "selection-manifest.json"
OUTPUT = DATA / "solution-overrides.json"
AUDITS = ROOT / "work/math-kangaroo-spatial-review/tmp"


def any_round(_: str) -> bool:
    return True


def expert_one(round_id: str) -> bool:
    return LEVEL_BY_ID.get(round_id) == "expert-1"


SOURCE_SPECS: tuple[tuple[str, Callable[[str], bool]], ...] = (
    ("junior-1-asset-grounding-audit.json", any_round),
    ("junior-2-asset-grounding-audit.json", any_round),
    ("expert-asset-grounding-audit.json", expert_one),
    ("expert-2-visual-enrichment.json", any_round),
    ("wizard-first-21-visual-enrichment.json", any_round),
    ("wizard-second-21-visual-enrichment.json", any_round),
    ("wizard-remaining-asset-grounding-audit.json", any_round),
)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


MANIFEST_PAYLOAD = load_json(MANIFEST)
LEVEL_BY_ID = {
    item["id"]: item["journeyLevel"]
    for item in MANIFEST_PAYLOAD["rounds"]
}
CORRECT_INDEX_BY_ID = {
    item["id"]: int(item["correctIndex"])
    for item in MANIFEST_PAYLOAD["rounds"]
}


def verified_reveal_index(
    round_id: str,
    explanation: dict[str, Any],
) -> int:
    reveals = [
        beat
        for beat in explanation.get("beats", [])
        if beat.get("kind") == "reveal"
        and "verifiedChoiceIndex" in beat
    ]
    if not reveals:
        raise ValueError(f"{round_id} has no verified reveal beat")
    reveal = reveals[-1]
    verified_index = int(reveal["verifiedChoiceIndex"])
    if (
        "choiceIndex" in reveal
        and int(reveal["choiceIndex"]) != verified_index
    ):
        raise ValueError(
            f"{round_id} reveal choice and verified choice disagree"
        )
    return verified_index


def require_current_asset_geometry(
    source_path: Path,
    round_id: str,
    audit: dict[str, Any],
) -> None:
    asset_audit = audit.get("assetAudit")
    if not isinstance(asset_audit, dict):
        return
    public_asset = asset_audit.get("publicAsset")
    coordinate_basis = asset_audit.get("coordinateBasisDimensions")
    recorded_live = asset_audit.get("livePublicDimensionsAtBuild")
    if not isinstance(public_asset, str) or not isinstance(
        coordinate_basis,
        dict,
    ):
        return
    asset_path = ROOT / public_asset
    if not asset_path.is_file():
        raise FileNotFoundError(f"{round_id} is missing {asset_path}")
    with Image.open(asset_path) as image:
        actual = {"width": image.width, "height": image.height}
    expected = {
        "width": int(coordinate_basis.get("width", 0)),
        "height": int(coordinate_basis.get("height", 0)),
    }
    if expected != actual:
        raise ValueError(
            f"{round_id} visual coordinates use {expected}, but the current "
            f"asset is {actual} ({source_path})"
        )
    if isinstance(recorded_live, dict):
        recorded = {
            "width": int(recorded_live.get("width", 0)),
            "height": int(recorded_live.get("height", 0)),
        }
        if recorded != actual:
            raise ValueError(
                f"{round_id} records live geometry {recorded}, but the "
                f"current asset is {actual} ({source_path})"
            )


def main() -> None:
    selected_ids = set(LEVEL_BY_ID)
    explanations: dict[str, dict[str, Any]] = {}

    for filename, include in SOURCE_SPECS:
        path = AUDITS / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing reviewed visual source: {path}")
        source_payload = load_json(path)
        blockers = source_payload.get("rebaseBlockers")
        if blockers:
            raise ValueError(
                f"{path} still has {len(blockers)} visual rebase blockers"
            )
        rounds = source_payload.get("rounds")
        if not isinstance(rounds, dict):
            raise ValueError(f"{path} has no round map")
        for round_id, audit in rounds.items():
            if not include(round_id):
                continue
            if round_id not in selected_ids:
                raise ValueError(f"{path} contains unselected round {round_id}")
            if round_id in explanations:
                raise ValueError(f"Duplicate visual explanation for {round_id}")
            require_current_asset_geometry(path, round_id, audit)
            explanation = audit.get("visualExplanation")
            if not isinstance(explanation, dict):
                raise ValueError(f"{round_id} has no visualExplanation")
            verified_index = verified_reveal_index(round_id, explanation)
            if verified_index != CORRECT_INDEX_BY_ID[round_id]:
                raise ValueError(
                    f"{round_id} reveals {verified_index}, expected "
                    f"{CORRECT_INDEX_BY_ID[round_id]}"
                )
            explanations[round_id] = deepcopy(explanation)

    missing = sorted(selected_ids - explanations.keys())
    extra = sorted(explanations.keys() - selected_ids)
    if missing or extra:
        raise ValueError(
            f"Visual coverage mismatch; missing={missing}, extra={extra}"
        )

    payload = load_json(OUTPUT)
    solutions = payload.get("solutions")
    if not isinstance(solutions, dict):
        raise ValueError("Canonical solution overrides have no solution map")
    for round_id in sorted(selected_ids):
        solution = solutions.get(round_id)
        if not isinstance(solution, dict):
            raise ValueError(f"Missing canonical solution for {round_id}")
        solution["visualExplanation"] = explanations[round_id]

    temporary = OUTPUT.with_name(OUTPUT.name + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(OUTPUT)
    print(f"Merged {len(explanations)} reviewed visual explanations.")


if __name__ == "__main__":
    main()
