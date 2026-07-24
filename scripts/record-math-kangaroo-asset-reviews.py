#!/usr/bin/env python3
"""Bind completed manual Math Kangaroo visual QA to exact public pixels.

This command does not inspect or approve an image. It records the digest of an
asset that a person has already reviewed. The asset builder accepts that
approval only while the decoded pixels remain identical.

Examples:

  python3 scripts/record-math-kangaroo-asset-reviews.py \
    --id mk-cyprus-2024-12-q07 --confirm-reviewed

  python3 scripts/record-math-kangaroo-asset-reviews.py \
    --all --confirm-reviewed
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "app/journey/reviews/math-kangaroo/data"
MANIFEST = DATA / "selection-manifest.json"
REVIEWS = DATA / "asset-release-reviews.json"
PUBLIC_DIR = ROOT / "public/journey/math-kangaroo"


def reject_duplicate_json_keys(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicate_json_keys,
    )


def decoded_asset_fingerprint(path: Path) -> str:
    with Image.open(path) as source:
        image = source.convert("RGBA")
        digest = hashlib.sha256()
        digest.update(f"{image.width}x{image.height}:RGBA:".encode("ascii"))
        digest.update(image.tobytes())
        return digest.hexdigest()


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Record exact asset digests after manual prompt, option, "
            "completeness, and visual review."
        )
    )
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument(
        "--all",
        action="store_true",
        help="Record every asset in the current 168-round manifest.",
    )
    selection.add_argument(
        "--id",
        action="append",
        dest="ids",
        help="Record one reviewed round ID; repeat for several rounds.",
    )
    parser.add_argument(
        "--confirm-reviewed",
        action="store_true",
        required=True,
        help="Confirm that the selected final assets were manually inspected.",
    )
    return parser.parse_args()


def main() -> None:
    args = arguments()
    manifest = read_json(MANIFEST)
    rounds = manifest.get("rounds")
    if not isinstance(rounds, list):
        raise ValueError("The selection manifest needs a rounds array")
    by_id = {str(round["id"]): round for round in rounds}
    if len(by_id) != len(rounds):
        raise ValueError("The selection manifest contains duplicate round IDs")

    selected_ids = sorted(by_id if args.all else set(args.ids or []))
    unknown = [round_id for round_id in selected_ids if round_id not in by_id]
    if unknown:
        raise ValueError(f"Unknown Math Kangaroo round IDs: {', '.join(unknown)}")
    if args.all and len(selected_ids) != 168:
        raise ValueError(
            f"Expected the complete 168-round corpus; found {len(selected_ids)}"
        )

    existing: dict[str, Any] = {}
    if REVIEWS.exists():
        payload = read_json(REVIEWS)
        if payload.get("schemaVersion") != 1:
            raise ValueError("Unsupported Math Kangaroo asset review schema")
        if not isinstance(payload.get("items"), dict):
            raise ValueError("The asset review file needs an items object")
        existing = dict(payload["items"])

    for round_id in selected_ids:
        asset = by_id[round_id].get("asset", {})
        if asset.get("status") == "unresolved-asset-build":
            raise ValueError(f"{round_id} has an unresolved asset build")
        path = PUBLIC_DIR / f"{round_id}.webp"
        if not path.is_file():
            raise FileNotFoundError(path)
        existing[round_id] = {
            "pixelSha256": decoded_asset_fingerprint(path),
            "promptFree": True,
            "optionsRelabeled": True,
            "diagramComplete": True,
            "reviewed": True,
        }

    valid_ids = set(by_id)
    items = {
        round_id: existing[round_id]
        for round_id in sorted(existing)
        if round_id in valid_ids
    }
    payload = {
        "schemaVersion": 1,
        "reviewBasis": (
            "Manual contact-sheet and targeted final-asset inspection; "
            "approval is invalidated by any decoded-pixel change."
        ),
        "items": items,
    }
    temporary = REVIEWS.with_name(f"{REVIEWS.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(REVIEWS)
    print(f"Recorded exact manual review digests for {len(selected_ids)} assets.")


if __name__ == "__main__":
    main()
