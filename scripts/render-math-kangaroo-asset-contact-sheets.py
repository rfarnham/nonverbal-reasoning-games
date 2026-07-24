#!/usr/bin/env python3
"""Render raw selected Math Kangaroo assets into level-scoped QA sheets.

The sheets deliberately contain no explanation overlays. They are for checking
that the public illustration is prompt-free, complete, legible, and correctly
separated from any semantic answer text before exact pixel digests are approved.
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = (
    ROOT
    / "app/journey/reviews/math-kangaroo/data/selection-manifest.json"
)
PUBLIC = ROOT / "public/journey/math-kangaroo"
DEFAULT_OUTPUT = (
    ROOT
    / "work/math-kangaroo-spatial-review/tmp/final-asset-contact-sheets"
)
LEVELS = (
    "junior-1",
    "junior-2",
    "expert-1",
    "expert-2",
    "wizard-1",
    "wizard-2",
)


def reject_duplicate_json_keys(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ):
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def panel(round_data: dict[str, Any], ordinal: int) -> Image.Image:
    round_id = str(round_data["id"])
    source = PUBLIC / f"{round_id}.webp"
    if not source.is_file():
        raise FileNotFoundError(source)
    with Image.open(source) as opened:
        illustration = opened.convert("RGB")
    declared = round_data.get("asset", {})
    declared_size = (
        int(declared.get("publicWidth", 0)),
        int(declared.get("publicHeight", 0)),
    )
    if declared_size != illustration.size:
        raise ValueError(
            f"{round_id}: manifest declares {declared_size}, "
            f"public pixels are {illustration.size}"
        )
    illustration.thumbnail((620, 360), Image.Resampling.LANCZOS)
    output = Image.new("RGB", (660, 430), "#fffdf8")
    output.paste(
        illustration,
        ((output.width - illustration.width) // 2, 52),
    )
    draw = ImageDraw.Draw(output)
    draw.text(
        (12, 9),
        f"{ordinal:02d}  {round_id}",
        fill="#17213d",
        font=font(16),
    )
    draw.text(
        (12, 30),
        (
            f"{declared_size[0]}×{declared_size[1]}  ·  "
            f"{declared.get('status', 'unknown')}"
        ),
        fill="#657087",
        font=font(13),
    )
    return output


def render_level(
    level: str,
    rounds: list[dict[str, Any]],
    output: Path,
    per_sheet: int,
) -> list[Path]:
    if len(rounds) != 28:
        raise ValueError(f"{level}: expected 28 rounds; found {len(rounds)}")
    panels = [
        panel(round_data, ordinal)
        for ordinal, round_data in enumerate(rounds, start=1)
    ]
    paths: list[Path] = []
    columns = 2
    for offset in range(0, len(panels), per_sheet):
        batch = panels[offset : offset + per_sheet]
        rows = (len(batch) + columns - 1) // columns
        sheet = Image.new(
            "RGB",
            (columns * 660, rows * 430),
            "#ddd8ca",
        )
        for index, item in enumerate(batch):
            sheet.paste(
                item,
                ((index % columns) * 660, (index // columns) * 430),
            )
        path = output / f"{level}-assets-{offset // per_sheet + 1:02d}.png"
        sheet.save(path, "PNG", optimize=True)
        paths.append(path)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--per-sheet", type=int, default=14)
    args = parser.parse_args()
    if args.per_sheet < 1:
        raise ValueError("--per-sheet must be positive")
    args.output = args.output.resolve()

    payload = json.loads(
        MANIFEST.read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicate_json_keys,
    )
    rounds = payload.get("rounds")
    if not isinstance(rounds, list) or len(rounds) != 168:
        raise ValueError("The selection manifest needs exactly 168 rounds")
    by_level: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for round_data in rounds:
        by_level[str(round_data["journeyLevel"])].append(round_data)
    if set(by_level) != set(LEVELS):
        raise ValueError(
            "The selection manifest does not contain the six expected levels"
        )

    if args.output.exists():
        shutil.rmtree(args.output)
    args.output.mkdir(parents=True)
    rendered = {
        level: [
            str(path.relative_to(ROOT))
            for path in render_level(
                level,
                by_level[level],
                args.output,
                args.per_sheet,
            )
        ]
        for level in LEVELS
    }
    (args.output / "contact-sheet-index.json").write_text(
        json.dumps(
            {
                "manifest": str(MANIFEST.relative_to(ROOT)),
                "roundCount": len(rounds),
                "levels": rendered,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"Rendered {len(rounds)} raw assets across "
        f"{sum(len(paths) for paths in rendered.values())} contact sheets."
    )


if __name__ == "__main__":
    main()
