#!/usr/bin/env python3
"""Build a private, deterministic search corpus for encrypt-question-search.mjs.

This script reads the canonical SQLite bank without modifying it. Outputs are
allowed only below this checkout's ignored work/ directory. No credentials,
source PDFs, email metadata, or source filesystem paths enter corpus.json.
assets.json is a PRIVATE build manifest and must never be published.

Image fingerprints: SHA-256 of original bytes; 64-bit horizontal dHash from
Pillow L-mode grayscale resized to 9 x 8 with LANCZOS. In row-major order a bit
is 1 iff the left pixel is strictly brighter than its right neighbor; the first
comparison is the most-significant bit. Hex is padded to 16 lowercase digits.

Optional --annotations JSONL records may override topics, strategies,
description, structure and method. Each must include id, annotationStatus
(human-reviewed, agent-reviewed, or unreviewed), and nonempty evidence[].
These are annotations, not commands. Unknown fields and IDs are rejected.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow is required. Run this with a Python environment containing Pillow.")


ROOT = Path(__file__).resolve().parents[1]
EXPORT_VERSION = "question-search-export.v1"
SEMANTIC_MANIFEST = "work/math-kangaroo-adaptive-engine/catalogue/math-kangaroo-semantic-index.manifest.json"
TAXONOMY_FILE = "content/math-world/competition-math-taxonomy.v1.0.0.proposed.json"
WORLD_PLANS = ("content/math-world/spiral-20.plan.json", "content/math-world/spiral-32.plan.json")

# These are search proposals from visible words, never verified solution labels.
# Deliberately omit broad guesses such as every 'how many' being enumeration.
KEYWORD_TOPICS = (
    ("GEO.symmetry_transformations", r"\b(mirror|reflection|reflects|reflected|rotat\w*|symmetr\w*|clockwise|anticlockwise)\b"),
    ("SPA.folding_cutting", r"\b(fold\w*|unfold\w*)\b"),
    ("SPA.cube_stacks_views", r"\b(top view|side view|hidden cubes?|cube stacks?|stack of cubes)\b"),
    ("GEO.area_basic", r"\barea\b"),
    ("GEO.perimeter", r"\bperimeter\b"),
    ("GEO.angles", r"\bangle[sd]?\b"),
    ("MEA.clock_elapsed", r"\b(clock|o['’]clock|minutes?|hours?)\b"),
    ("MEA.calendar", r"\b(calendar|monday|tuesday|wednesday|thursday|friday|saturday|sunday|leap year)\b"),
    ("MEA.money", r"\b(coins?|dollars?|euros?|cents?|pounds?|price|costs?|change for)\b"),
    ("INT.parity", r"\b(odd|even) (number|integer|sum|product)\b"),
    ("INT.divisibility", r"\b(divisible|multiple of|multiples of)\b"),
    ("INT.remainders", r"\bremainder\b"),
    ("NUM.place_value", r"\b(digits?|two-digit|three-digit|four-digit)\b"),
    ("FRC.part_whole", r"\b(fraction|one.half|one.third|one.quarter)\b"),
    ("PAT.repeat", r"\b(repeat\w*|repeating pattern|pattern repeats)\b"),
    ("PAT.growth_numeric", r"\b(sequence|next number|number pattern)\b"),
)
KEYWORD_STRATEGIES = (
    ("work_backward", r"\b(work\w* backwards?|reverse the (operations|process)|undo\w* the)\b"),
    ("symmetry", r"\b(symmetr\w*|mirror image|reflection)\b"),
    ("find_pattern", r"\b(repeating pattern|pattern repeats|next in the sequence)\b"),
    ("parity_coloring", r"\b(odd|even) (number|integer|sum|product)\b"),
)

LEGACY_STRATEGY_MAP = {
    "rsn_case_analysis": "case_split",
    "rsn_constraint_propagation": "constraint_propagation",
    "rsn_decomposition_recomposition": "decompose_recompose",
    "rsn_pattern_generalization": "find_pattern",
    "rsn_systematic_enumeration": "organized_enumeration",
}


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def humanize(value: str) -> str:
    return re.sub(r"^(cnt|rsn|prc|rep)_", "", value).replace("_", " ").capitalize()


def normalize_prompt(prompt: str) -> str:
    # Keep numbers and mathematical punctuation: this is identity, not similarity.
    return " ".join(unicodedata.normalize("NFKC", prompt).casefold().split())


def family_id(prompt: str, image_sha: str, question_id: str) -> str:
    # Same short/generic stem with different diagrams must never be merged.
    identity = [normalize_prompt(prompt), image_sha]
    if not identity[0] or not image_sha:
        identity.append(question_id)
    return "exact-" + digest(identity)[:24]


def image_record(path: Path) -> tuple[dict, dict]:
    payload = path.read_bytes()
    sha = hashlib.sha256(payload).hexdigest()
    with Image.open(path) as im:
        width, height = im.size
        mime = Image.MIME.get(im.format, "application/octet-stream")
        pixels = list(im.convert("L").resize((9, 8), Image.Resampling.LANCZOS).tobytes())
    bits = 0
    for y in range(8):
        for x in range(8):
            bits = (bits << 1) | int(pixels[y * 9 + x] > pixels[y * 9 + x + 1])
    target = f"assets/{sha}.bin"
    return (
        {"path": target, "mime": mime, "width": width, "height": height, "hash": sha, "dhash": f"{bits:016x}"},
        {"path": target, "source": str(path.resolve()), "sha256": sha, "mime": mime, "bytes": len(payload)},
    )


def load_enrichment(source_root: Path) -> tuple[dict, dict, dict, dict, dict]:
    taxonomy_path = source_root / TAXONOMY_FILE
    taxonomy = read_json(taxonomy_path) if taxonomy_path.exists() else {}
    topics = {t["id"]: t for domain in taxonomy.get("domains", []) for t in domain["topics"]}
    strategies = taxonomy.get("tag_vocabularies", {}).get("strategies", {})
    facets = {
        "topics": {key: value["label"] for key, value in topics.items()},
        "strategies": {key: humanize(key) for key in strategies},
    }
    semantic_path = source_root / SEMANTIC_MANIFEST
    semantic = read_json(semantic_path) if semantic_path.exists() else {}
    catalogue = {q["item_id"]: q for q in semantic.get("ordered_items", [])}
    for tag in semantic.get("tag_vocabulary", []):
        axis, name = tag.split(":", 1)
        if axis in ("domain", "skill", "type"):
            facets["topics"][f"catalogue:{tag}"] = humanize(name)
    worlds: dict[str, dict] = {}
    for relative in WORLD_PLANS:
        path = source_root / relative
        if not path.exists():
            continue
        data = read_json(path)
        for world in data.get("worlds", []):
            for question in world.get("questions", []):
                worlds[question["itemId"]] = {
                    **question,
                    "provenance": f"{path.name} ({data.get('contentVersion', 'unversioned')}); {data.get('status', 'unreviewed')}",
                }
    return topics, strategies, facets, catalogue, worlds


def annotation_for(question_id: str, prompt: str, image_sha: str, topics: dict, strategies: dict,
                   catalogue: dict, worlds: dict) -> dict:
    proposed = catalogue.get(question_id, {})
    tags = proposed.get("tags", [])
    legacy_topics = [f"catalogue:{tag}" for tag in tags if tag.split(":", 1)[0] in ("domain", "skill", "type")]
    representations = [humanize(tag.split(":", 1)[1]) for tag in tags if tag.startswith("representation:")]
    evidence = []
    if proposed:
        evidence.append("Existing catalogue: deterministic lexical proposal tags, unreviewed; its semantic manifest explicitly has no strategy embeddings.")
    placement = worlds.get(question_id)
    if placement:
        selected_topics = [placement["primaryTopic"], *placement.get("secondaryTopics", [])]
        selected_strategies = placement.get("strategies", [])
        status = "agent-reviewed"
        evidence.append("Agent-reviewed Worlds placement: " + placement["provenance"])
        if placement.get("assetSha256") != image_sha:
            status = "agent-reviewed-source-variant"
            evidence.append("Placement joined by question ID; the bank image differs from the reviewed Worlds asset. Confirm it before relying on the placement.")
        # Do not dilute reviewed topics with noisier legacy proposal tags.
    else:
        selected_topics = [key for key, pattern in KEYWORD_TOPICS if key in topics and re.search(pattern, prompt, re.I)]
        selected_topics += legacy_topics
        selected_strategies = [key for key, pattern in KEYWORD_STRATEGIES if key in strategies and re.search(pattern, prompt, re.I)]
        selected_strategies += [LEGACY_STRATEGY_MAP[tag.split(":", 1)[1]] for tag in tags
                                if tag.startswith("skill:") and tag.split(":", 1)[1] in LEGACY_STRATEGY_MAP]
        status = "heuristic-unreviewed" if selected_topics or selected_strategies else "unannotated"
        if selected_topics or selected_strategies:
            evidence.append("Keyword and catalogue search proposals only; no image interpretation or solution verification was performed.")
    selected_topics = sorted(set(selected_topics))
    selected_strategies = sorted(set(selected_strategies))
    labels = [topics[key]["label"] if key in topics else humanize(key.split(":")[-1]) for key in selected_topics]
    return {
        "topics": selected_topics,
        "strategies": selected_strategies,
        "description": "; ".join(dict.fromkeys(labels + representations)),
        "structure": " ".join(topics[key]["definition"] for key in selected_topics if key in topics),
        "method": " ".join(strategies.get(key, humanize(key)) for key in selected_strategies),
        "annotationStatus": status,
        "evidence": evidence + ["Structure and method fields contain taxonomy descriptions, not question-specific worked solutions."],
    }


def load_overrides(path: Path | None, known_ids: set[str], facets: dict) -> dict:
    if path is None:
        return {}
    allowed = {"id", "topics", "strategies", "description", "structure", "method", "annotationStatus", "evidence"}
    result = {}
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        item = json.loads(line)
        label = f"Annotation line {line_no}"
        if not isinstance(item, dict) or set(item) - allowed:
            raise ValueError(f"{label}: object contains unsupported fields")
        if item.get("id") not in known_ids or item["id"] in result:
            raise ValueError(f"{label}: unknown or duplicate question ID")
        if item.get("annotationStatus") not in ("human-reviewed", "agent-reviewed", "unreviewed"):
            raise ValueError(f"{label}: explicit annotationStatus is required")
        if not isinstance(item.get("evidence"), list) or not item["evidence"] or not all(isinstance(v, str) and v.strip() for v in item["evidence"]):
            raise ValueError(f"{label}: nonempty evidence strings are required")
        for axis in ("topics", "strategies"):
            if axis in item and (not isinstance(item[axis], list) or not all(isinstance(v, str) and v in facets[axis] for v in item[axis])):
                raise ValueError(f"{label}: {axis} must use known facet IDs")
        for field in ("description", "structure", "method"):
            if field in item and not isinstance(item[field], str):
                raise ValueError(f"{label}: {field} must be text")
        result[item["id"]] = {k: v for k, v in item.items() if k != "id"}
    return result


def safe_source_label(row: dict) -> str:
    label = row.get("source_label") or row.get("source_family") or "Question bank"
    label = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email omitted]", label)
    if re.search(r"(?:/Users/|/home/|[A-Z]:\\)", label):
        return row.get("source_family") or "Question bank"
    return label


def export_corpus(source_root: Path, bank: Path, output: Path, annotations: Path | None = None,
                  created_at: str | None = None) -> dict:
    output = output.resolve()
    if not output.is_relative_to((ROOT / "work").resolve()):
        raise ValueError("Plaintext search build output must stay inside this checkout's ignored work/ directory.")
    database = bank / "data/questions.sqlite3"
    if not database.is_file():
        raise ValueError(f"Canonical database not found: {database}")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = [dict(row) for row in connection.execute("SELECT * FROM questions ORDER BY id")]
    if len({row["id"] for row in rows}) != len(rows) or not rows:
        raise ValueError("Question IDs must be unique and the corpus nonempty")
    topics, strategies, facets, catalogue, worlds = load_enrichment(source_root)
    overrides = load_overrides(annotations, {row["id"] for row in rows}, facets)
    questions, assets = [], {}
    for row in rows:
        path = (bank / "report" / row["image"]).resolve()
        if not path.is_relative_to(bank.resolve()) or not path.is_file():
            raise ValueError(f"Missing or out-of-bank question image for {row['id']}")
        image, asset = image_record(path)
        assets[asset["path"]] = asset
        prompt = row.get("english_prompt_text") or row.get("prompt_text") or ""
        annotation = annotation_for(row["id"], prompt, image["hash"], topics, strategies, catalogue, worlds)
        annotation.update(overrides.get(row["id"], {}))
        question = {
            "id": row["id"], "prompt": prompt, "originalPrompt": row.get("prompt_text") or "",
            "options": json.loads(row.get("english_options_json") or "[]") or json.loads(row.get("options_json") or "[]"),
            "originalOptions": json.loads(row.get("options_json") or "[]"),
            "answer": row.get("answer") or None, "answerStatus": row.get("answer_status") or "unverified",
            "source": {"label": safe_source_label(row), "year": row["year"], "grade": row["grade"],
                       "question": row["question"], "language": row.get("language") or "unknown"},
            "image": image, **annotation,
            "family": family_id(prompt, image["hash"], row["id"]),
        }
        question["evidence"] += [f"Bank extraction: {row.get('extraction_status', 'unknown')}; translation: {row.get('translation_review_status') or 'not applicable'}; answer: {question['answerStatus']}."]
        question["version"] = "sha256:" + digest(question)
        questions.append(question)
    status_counts = Counter(q["annotationStatus"] for q in questions)
    family_counts = Counter(q["family"] for q in questions)
    stats = {
        "questions": len(questions), "uniqueImages": len(assets), "imageBytes": sum(a["bytes"] for a in assets.values()),
        "questionsWithAnswer": sum(q["answer"] is not None for q in questions),
        "questionsWithStrategy": sum(bool(q["strategies"]) for q in questions),
        "duplicateFamilies": sum(n > 1 for n in family_counts.values()),
        **{f"annotations:{key}": value for key, value in sorted(status_counts.items())},
    }
    version = digest({"exporter": EXPORT_VERSION, "questions": questions, "facets": facets})
    corpus = {"schemaVersion": 1, "version": version, "createdAt": created_at or datetime.now(timezone.utc).isoformat(),
              "questions": questions, "facets": facets, "stats": stats}
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, payload in (("corpus.json", corpus), ("assets.json", {"schemaVersion": 1, "corpusVersion": version, "assets": sorted(assets.values(), key=lambda a: a["path"])})):
        target = output / name
        temporary = output / f".{name}.tmp"
        temporary.write_bytes(canonical_bytes(payload) + b"\n")
        os.chmod(temporary, 0o600)
        temporary.replace(target)
    return {"version": version, "stats": stats, "corpus": str(output / "corpus.json"), "assetMap": str(output / "assets.json")}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-root", type=Path, default=ROOT, help="Repository holding Worlds and catalogue annotations")
    parser.add_argument("--bank", type=Path, help="Canonical bank directory; defaults to SOURCE_ROOT/work/math-kangaroo-complete-question-bank")
    parser.add_argument("--output", type=Path, default=ROOT / "work/question-search-build")
    parser.add_argument("--annotations", type=Path, help="Optional reviewed enrichment JSONL")
    parser.add_argument("--created-at", help="Optional reproducible ISO timestamp")
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    try:
        result = export_corpus(source_root, (args.bank or source_root / "work/math-kangaroo-complete-question-bank").resolve(), args.output, args.annotations, args.created_at)
    except (ValueError, OSError, sqlite3.Error, json.JSONDecodeError) as error:
        parser.exit(1, f"Export failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
