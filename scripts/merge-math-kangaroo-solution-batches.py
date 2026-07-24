#!/usr/bin/env python3
"""Merge reviewed private authoring batches into the checked-in MK overrides.

The first lower-grade batch was authored with the earlier string-based draft
shape. This script performs only a mechanical schema migration: it preserves
the authored prompt, reasoning, hint, and narration while wrapping steps and
beats in the current manifest structure and mapping animation names to the
finite renderer vocabulary.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = (
    ROOT / "app/journey/reviews/math-kangaroo/data/selection-manifest.json"
)
OUTPUT = (
    ROOT / "app/journey/reviews/math-kangaroo/data/solution-overrides.json"
)
PRIVATE_BATCHES = (
    ROOT
    / "work/math-kangaroo-spatial-review/tmp/grade12-solutions-batch-a.json",
    ROOT
    / "work/math-kangaroo-spatial-review/tmp/grade12-solutions-batch-b.json",
)
ANIMATION_KINDS = {
    "assemble",
    "fold",
    "layer",
    "pattern",
    "reflect",
    "rotate",
    "trace",
    "viewpoint",
}


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = " ".join(text.split())
    choice_number = {
        "A": "1",
        "B": "2",
        "C": "3",
        "D": "4",
        "E": "5",
    }
    return re.sub(
        r"\bchoice\s+([A-E])\b",
        lambda match: f"choice {choice_number[match.group(1).upper()]}",
        text,
        flags=re.IGNORECASE,
    )


def normalized_kind(
    authored: str,
    fallback: str,
) -> str:
    candidate = clean_text(authored).lower()
    if candidate in ANIMATION_KINDS:
        return candidate
    if any(token in candidate for token in ("mirror", "reflect", "reverse-view")):
        return "reflect"
    if any(token in candidate for token in ("fold", "unfold", "hole-overlay")):
        return "fold"
    if any(token in candidate for token in ("rotate", "turn", "carousel")):
        return "rotate"
    if any(token in candidate for token in ("layer", "stack", "occlusion", "transparent")):
        return "layer"
    if any(token in candidate for token in ("path", "maze", "trace", "route", "strand", "tangle")):
        return "trace"
    if any(token in candidate for token in ("view", "camera", "silhouette")):
        return "viewpoint"
    if any(token in candidate for token in ("assemble", "fit", "piece", "partition", "packing")):
        return "assemble"
    if any(token in candidate for token in ("pattern", "sequence", "colour", "stamp")):
        return "pattern"
    return fallback if fallback in ANIMATION_KINDS else "pattern"


def normalize_solution(
    round_id: str,
    value: dict[str, Any],
    fallback_kind: str,
) -> dict[str, Any]:
    raw_steps = list(value.get("solutionSteps") or [])
    steps: list[dict[str, str]] = []
    for index, step in enumerate(raw_steps, start=1):
        if isinstance(step, dict):
            title = clean_text(step.get("title"))
            body = clean_text(step.get("body"))
        else:
            title = "Inspect the evidence" if index == 1 else (
                "Verify the only match" if index == len(raw_steps) else f"Reasoning step {index}"
            )
            body = clean_text(step)
        if not title or not body:
            raise ValueError(f"{round_id} has an empty solution step")
        steps.append({"title": title, "body": body})
    if len(steps) < 2:
        raise ValueError(f"{round_id} needs at least two solution steps")

    raw_plan = value.get("animationPlan") or {}
    kind = normalized_kind(raw_plan.get("kind", ""), fallback_kind)
    raw_beats = list(raw_plan.get("beats") or [])
    beats: list[dict[str, str]] = []
    for index, beat in enumerate(raw_beats):
        if isinstance(beat, dict):
            action = clean_text(beat.get("action"))
            target = clean_text(beat.get("target"))
            narration = clean_text(beat.get("narration"))
        else:
            narration = clean_text(beat)
            action = (
                "highlight"
                if index == 0
                else "reveal"
                if index == len(raw_beats) - 1
                else kind
            )
            # The authored narration names the exact source objects and motion;
            # retaining it as the legacy target is more specific than replacing
            # it with a generic "diagram" placeholder.
            target = narration
        if not action or not target or not narration:
            raise ValueError(f"{round_id} has an empty animation beat")
        beats.append(
            {
                "action": action,
                "target": target,
                "narration": narration,
            }
        )
    if len(beats) < 2:
        raise ValueError(f"{round_id} needs at least two animation beats")

    prompt = clean_text(value.get("prompt"))
    result: dict[str, Any] = {
        "status": "final-reviewed",
        "solutionSteps": steps,
        "wrongAnswerHint": clean_text(value.get("wrongAnswerHint")),
        "animationPlan": {
            "kind": kind,
            "beats": beats,
        },
    }
    if prompt:
        result["prompt"] = prompt
    if not result["wrongAnswerHint"]:
        raise ValueError(f"{round_id} needs a tailored wrong-answer hint")
    return result


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    fallback_by_id = {
        item["id"]: item["explanationPlan"]["animation"]
        for item in manifest["rounds"]
    }
    output = json.loads(OUTPUT.read_text(encoding="utf-8"))
    solutions = dict(output["solutions"])

    merged = 0
    for path in PRIVATE_BATCHES:
        if not path.exists():
            continue
        batch = json.loads(path.read_text(encoding="utf-8"))
        for round_id, value in batch.items():
            if round_id not in fallback_by_id:
                raise ValueError(f"Unselected batch solution: {round_id}")
            solutions[round_id] = normalize_solution(
                round_id,
                value,
                fallback_by_id[round_id],
            )
            merged += 1

    temporary = OUTPUT.with_name(OUTPUT.name + ".tmp")
    temporary.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "solutions": solutions,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    temporary.replace(OUTPUT)
    print(f"Merged {merged} private batch solutions; {len(solutions)} total.")


if __name__ == "__main__":
    main()
