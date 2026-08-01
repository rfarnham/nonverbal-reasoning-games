"""Versioned configuration resources."""

from __future__ import annotations

from importlib.resources import files
from pathlib import Path


def default_ontology_path() -> Path:
    resource = files(__package__).joinpath("skill-ontology.v1.json")
    return Path(str(resource))


__all__ = ["default_ontology_path"]
