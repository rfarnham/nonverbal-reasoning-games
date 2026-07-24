#!/usr/bin/env python3
"""Render visualExplanation geometry over final Math Kangaroo assets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public/journey/math-kangaroo"
ROLE_COLOURS = {
    "evidence": "#1679d2",
    "work-area": "#f06f5f",
    "answer-choice": "#16836b",
}


def label_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def normalized_box(
    region: dict[str, Any],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    return (
        round(float(region["x"]) * width),
        round(float(region["y"]) * height),
        round((float(region["x"]) + float(region["width"])) * width),
        round((float(region["y"]) + float(region["height"])) * height),
    )


def render(round_id: str, explanation: dict[str, Any]) -> Image.Image:
    image = Image.open(PUBLIC / f"{round_id}.webp").convert("RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    stroke = max(2, round(min(image.size) / 180))
    font = label_font(max(12, round(min(image.size) / 45)))

    for region in explanation.get("regions", []):
        colour = ROLE_COLOURS.get(region.get("role"), "#7767d7")
        box = normalized_box(region, image.width, image.height)
        draw.rectangle(box, outline=colour, width=stroke)
        text = str(region["id"])
        text_box = draw.textbbox((0, 0), text, font=font)
        text_width = text_box[2] - text_box[0] + 8
        text_height = text_box[3] - text_box[1] + 6
        label_box = (
            box[0],
            max(0, box[1] - text_height),
            min(image.width, box[0] + text_width),
            box[1],
        )
        draw.rectangle(label_box, fill=colour + "dc")
        draw.text(
            (label_box[0] + 4, label_box[1] + 2),
            text,
            fill="white",
            font=font,
        )

    for path in explanation.get("paths", []):
        points = [
            (
                round(float(point["x"]) * image.width),
                round(float(point["y"]) * image.height),
            )
            for point in path["points"]
        ]
        if path.get("closed") and points:
            points.append(points[0])
        if len(points) >= 2:
            draw.line(points, fill="#7767d7ff", width=stroke * 2)
        for point in points:
            radius = stroke * 2
            draw.ellipse(
                (
                    point[0] - radius,
                    point[1] - radius,
                    point[0] + radius,
                    point[1] + radius,
                ),
                fill="#7767d7ff",
            )
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--per-sheet", type=int, default=14)
    args = parser.parse_args()

    payload = json.loads(args.artifact.read_text(encoding="utf-8"))
    rounds = payload.get("rounds")
    if not isinstance(rounds, dict):
        raise ValueError("Artifact has no rounds map")
    args.output.mkdir(parents=True, exist_ok=True)

    panels: list[Image.Image] = []
    font = label_font(15)
    for index, (round_id, audit) in enumerate(rounds.items(), start=1):
        explanation = audit.get("visualExplanation")
        if not isinstance(explanation, dict):
            raise ValueError(f"{round_id} has no visualExplanation")
        image = render(round_id, explanation)
        image.thumbnail((640, 390))
        panel = Image.new("RGB", (660, 430), "white")
        panel.paste(image, ((660 - image.width) // 2, 34))
        ImageDraw.Draw(panel).text(
            (8, 8),
            f"{index:02d} {round_id}",
            fill="#17213d",
            font=font,
        )
        panels.append(panel)
        image.save(args.output / f"{round_id}.png")

    for offset in range(0, len(panels), args.per_sheet):
        batch = panels[offset : offset + args.per_sheet]
        columns = 2
        rows = (len(batch) + columns - 1) // columns
        sheet = Image.new("RGB", (columns * 660, rows * 430), "#ddd8ca")
        for index, panel in enumerate(batch):
            sheet.paste(panel, ((index % columns) * 660, (index // columns) * 430))
        sheet.save(
            args.output
            / f"sheet-{offset // args.per_sheet + 1:02d}.png"
        )
    print(f"Rendered {len(panels)} overlay audits to {args.output}")


if __name__ == "__main__":
    main()
