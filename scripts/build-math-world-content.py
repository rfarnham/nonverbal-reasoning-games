#!/usr/bin/env python3
"""Freeze a small, static Math Kangaroo world from the private catalogue.

This is an authoring command, not a build step. The committed runtime JSON and
question crops are all the browser sees; private database paths and protected
catalogue payloads never enter the application bundle.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOGUE = (
    ROOT / "work/math-kangaroo-adaptive-engine/catalogue/corpus-review.sqlite3"
)
DEFAULT_RUN_ID = "catalogue-c08d01a42b45e1116a6591dd"
CONTENT_VERSION = "counting-coast.2026-08-09.1"
ONTOLOGY_VERSION = "mk-map-ontology.v1"
ALLOWED_SOURCE_FAMILIES = {
    "USA",
    "Think Academy SharePoint",
    "Canada",
    "Canada official alternative edition",
}
DOMAIN_ORDER = (
    "number_arithmetic",
    "geometry_spatial",
    "measurement_time",
)
DOMAIN_STOPS = {
    "number_arithmetic": (
        "counting-cove",
        "number-bridge",
        "digit-dunes",
        "orchard-market",
    ),
    "geometry_spatial": ("shape-shore", "puzzle-cliffs"),
    "measurement_time": ("coin-harbor", "clock-tower"),
}
DISTRICTS = {
    "number_arithmetic": (
        "count-compare",
        "join-separate",
        "number-digit-structure",
        "join-separate",
    ),
    "geometry_spatial": ("shape-properties", "compose-dissect-tile"),
    "measurement_time": ("money-value", "clock-calendar"),
}
DOMAIN_SELECTION_COUNTS = {
    "number_arithmetic": 18,
    "geometry_spatial": 10,
    "measurement_time": 10,
}


@dataclass(frozen=True)
class Candidate:
    item_id: str
    content_version: str
    source_family: str
    year: int
    grade_band: str
    question_number: int
    modality: str
    source_payload: dict[str, Any]
    learner_payload: dict[str, Any]
    proposal_payload: dict[str, Any]
    asset_ref: dict[str, Any]

    @property
    def domain(self) -> str:
        return str(self.proposal_payload.get("primary_domain", "unknown"))

    @property
    def answer(self) -> str:
        return str(self.source_payload.get("official_answer", ""))


def _json(raw: str) -> Any:
    return json.loads(raw)


def load_candidates(catalogue: Path, run_id: str) -> list[Candidate]:
    connection = sqlite3.connect(catalogue)
    connection.row_factory = sqlite3.Row
    try:
        run = connection.execute(
            "SELECT source_item_count FROM catalogue_runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise SystemExit(f"Unknown catalogue run: {run_id}")

        rows = connection.execute(
            """
            SELECT item_id, content_version, source_family, year, grade_band,
                   question_number, modality, source_payload_json,
                   learner_payload_json, proposal_payload_json, asset_refs_json
            FROM catalogue_items
            WHERE run_id = ? AND grade_band = '1-2' AND option_count = 5
            ORDER BY inventory_order
            """,
            (run_id,),
        ).fetchall()
    finally:
        connection.close()

    result: list[Candidate] = []
    for row in rows:
        if row["source_family"] not in ALLOWED_SOURCE_FAMILIES:
            continue
        source_payload = _json(row["source_payload_json"])
        learner_payload = _json(row["learner_payload_json"])
        proposal_payload = _json(row["proposal_payload_json"])
        asset_refs = _json(row["asset_refs_json"])
        answer = str(source_payload.get("official_answer") or "")
        choices = learner_payload.get("choices") or source_payload.get("choices") or []
        prompt = learner_payload.get("stem_markdown") or source_payload.get("stem_markdown")
        if len(answer) != 1 or answer not in "ABCDE":
            continue
        if not isinstance(choices, list) or len(choices) != 5:
            continue
        if not isinstance(prompt, str) or not prompt.strip():
            continue
        if not asset_refs or asset_refs[0].get("status") != "available":
            continue
        local_ref = Path(str(asset_refs[0].get("local_ref", "")))
        if not local_ref.is_file():
            continue
        if proposal_payload.get("primary_domain") not in DOMAIN_ORDER:
            continue
        result.append(
            Candidate(
                item_id=row["item_id"],
                content_version=row["content_version"],
                source_family=row["source_family"],
                year=int(row["year"]),
                grade_band=row["grade_band"],
                question_number=int(row["question_number"]),
                modality=row["modality"],
                source_payload=source_payload,
                learner_payload=learner_payload,
                proposal_payload=proposal_payload,
                asset_ref=asset_refs[0],
            )
        )
    return result


def select_balanced(candidates: list[Candidate], count: int) -> list[Candidate]:
    """Choose a deterministic mix of sources, answers, years, and tiers."""

    remaining = sorted(
        candidates,
        key=lambda item: (
            item.question_number,
            -item.year,
            item.source_family,
            item.item_id,
        ),
    )
    selected: list[Candidate] = []
    source_counts: Counter[str] = Counter()
    answer_counts: Counter[str] = Counter()
    year_counts: Counter[int] = Counter()

    while remaining and len(selected) < count:
        best = min(
            remaining,
            key=lambda item: (
                source_counts[item.source_family] * 5
                + answer_counts[item.answer] * 4
                + year_counts[item.year] * 2,
                item.question_number,
                -item.year,
                item.item_id,
            ),
        )
        selected.append(best)
        remaining.remove(best)
        source_counts[best.source_family] += 1
        answer_counts[best.answer] += 1
        year_counts[best.year] += 1
    if len(selected) != count:
        raise SystemExit(f"Only found {len(selected)} of {count} required questions")
    return selected


def runtime_question(
    candidate: Candidate,
    stop_id: str,
    district_id: str,
    target_dir: Path,
) -> dict[str, Any]:
    source_asset = Path(str(candidate.asset_ref["local_ref"]))
    target_name = f"{candidate.item_id}{source_asset.suffix.lower()}"
    shutil.copyfile(source_asset, target_dir / target_name)

    raw_choices = candidate.learner_payload.get("choices") or candidate.source_payload["choices"]
    choices = []
    for index, value in enumerate(raw_choices):
        text = str(value).strip()
        visual_only = "visual option" in text.lower()
        letter = "ABCDE"[index]
        choices.append(
            {
                "label": letter if visual_only else text,
                "accessibleLabel": (
                    f"Choice {letter}. Refer to the original question card."
                    if visual_only
                    else f"Choice {letter}: {text}"
                ),
                "visualOnly": visual_only,
            }
        )

    confidence = candidate.proposal_payload.get("confidence")
    return {
        "id": candidate.item_id,
        "stopId": stop_id,
        "prompt": str(
            candidate.learner_payload.get("stem_markdown")
            or candidate.source_payload["stem_markdown"]
        ).strip(),
        "choices": choices,
        "correctIndex": "ABCDE".index(candidate.answer),
        "presentation": (
            "semantic" if candidate.modality == "text_extractable" else "source-card"
        ),
        "asset": {
            "src": f"/math-world/questions/{target_name}",
            "width": int(candidate.asset_ref["width"]),
            "height": int(candidate.asset_ref["height"]),
            "alt": "Original Math Kangaroo question card. Answer using the five accessible choices below.",
        },
        "source": {
            "year": candidate.year,
            "gradeBand": candidate.grade_band,
            "questionNumber": candidate.question_number,
            "sourceLabel": f"Math Kangaroo {candidate.year}, Grades 1–2",
        },
        "curriculum": {
            "realmId": candidate.domain,
            "districtId": district_id,
            "skillIds": list(candidate.proposal_payload.get("skill_ids", [])),
            "placementVersion": ONTOLOGY_VERSION,
            "placementStatus": "provisional-playtest",
            "proposalConfidence": confidence if isinstance(confidence, (int, float)) else None,
        },
    }


def build(catalogue: Path, run_id: str) -> None:
    candidates = load_candidates(catalogue, run_id)
    by_domain: dict[str, list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        by_domain[candidate.domain].append(candidate)

    selected_by_domain = {
        domain: select_balanced(by_domain[domain], DOMAIN_SELECTION_COUNTS[domain])
        for domain in DOMAIN_ORDER
    }
    # Thirty-two questions form eight short trails. Six unused questions make
    # the lighthouse culmination.
    stop_assignments: list[tuple[Candidate, str, str]] = []
    culmination_pool: list[Candidate] = []
    for domain in DOMAIN_ORDER:
        stops = DOMAIN_STOPS[domain]
        districts = DISTRICTS[domain]
        chosen = selected_by_domain[domain]
        ordinary_count = len(stops) * 4
        for index, stop_id in enumerate(stops):
            start = index * 4
            stop_assignments.extend(
                (item, stop_id, districts[index])
                for item in chosen[start : start + 4]
            )
        culmination_pool.extend(chosen[ordinary_count : ordinary_count + 2])
    stop_assignments.extend(
        (item, "lighthouse-crossroads", "mixed-expedition")
        for item in culmination_pool
    )

    public_dir = ROOT / "public/math-world/questions"
    public_dir.mkdir(parents=True, exist_ok=True)
    for stale in public_dir.glob("*.webp"):
        stale.unlink()

    questions = [
        runtime_question(candidate, stop_id, district_id, public_dir)
        for candidate, stop_id, district_id in stop_assignments
    ]
    payload = {
        "schemaVersion": 1,
        "contentVersion": CONTENT_VERSION,
        "catalogueRunId": run_id,
        "ontologyVersion": ONTOLOGY_VERSION,
        "questions": questions,
    }
    runtime_path = ROOT / "app/math-world/data/world-01.questions.json"
    runtime_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    plan = {
        "schemaVersion": 1,
        "contentVersion": CONTENT_VERSION,
        "catalogueRunId": run_id,
        "questionIdsByStop": {
            stop_id: [question["id"] for question in questions if question["stopId"] == stop_id]
            for stop_id in dict.fromkeys(question["stopId"] for question in questions)
        },
    }
    plan_path = ROOT / "content/math-world/world-01.plan.json"
    plan_path.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(questions)} questions to {runtime_path.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", type=Path, default=DEFAULT_CATALOGUE)
    parser.add_argument("--run-id", default=DEFAULT_RUN_ID)
    args = parser.parse_args()
    build(args.catalogue.resolve(), args.run_id)


if __name__ == "__main__":
    main()
