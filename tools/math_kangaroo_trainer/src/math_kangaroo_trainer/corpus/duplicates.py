"""High-precision exact duplicate candidates, before any model calls."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from math_kangaroo_trainer.domain.items import ImportedItem


@dataclass(frozen=True)
class DuplicateGroup:
    signature_type: str
    signature: str
    item_ids: tuple[str, ...]


def _normalized_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"\s+", " ", value).strip()


def text_signature(item: ImportedItem) -> str | None:
    stem = _normalized_text(item.source.english_stem or item.source.stem_markdown)
    choices = tuple(
        _normalized_text(choice)
        for choice in (item.source.english_choices or item.source.choices)
    )
    if len(stem) < 12 or not choices:
        return None
    payload = "\x1f".join((stem, *choices)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def asset_signature(asset_path: Path) -> str | None:
    if not asset_path.is_file():
        return None
    digest = hashlib.sha256()
    with asset_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_duplicate_groups(
    items: tuple[ImportedItem, ...], *, asset_paths: dict[str, Path]
) -> tuple[DuplicateGroup, ...]:
    buckets: dict[tuple[str, str], list[str]] = defaultdict(list)
    for item in items:
        item_id = item.source.item_id
        text_hash = text_signature(item)
        if text_hash:
            buckets[("normalized_text", text_hash)].append(item_id)
        image_hash = asset_signature(asset_paths[item_id])
        if image_hash:
            buckets[("exact_asset", image_hash)].append(item_id)

    groups = [
        DuplicateGroup(kind, signature, tuple(sorted(set(item_ids))))
        for (kind, signature), item_ids in buckets.items()
        if len(set(item_ids)) > 1
    ]
    return tuple(
        sorted(groups, key=lambda group: (group.signature_type, group.signature))
    )
