"""Local, auditable semantic retrieval for corpus inspection.

The index has two available views:

* ``surface`` uses feature-hashed unigram/bigram TF-IDF followed by a
  deterministic randomized truncated SVD (LSA);
* ``tag`` uses normalized multi-hot vectors built from unapproved catalogue
  proposal fields.

The planned ``strategy`` view is deliberately unavailable until reviewed
solution paths exist.  None of these vectors represents learner mastery,
ability, fluency, or item difficulty.  Building, saving, loading, and querying
are entirely local and perform no network operation.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, Final, Literal, Sequence

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from math_kangaroo_trainer.corpus.catalogue import CatalogueClassificationProposal
from math_kangaroo_trainer.domain.catalogue_reviews import CatalogueInventoryItem
from math_kangaroo_trainer.domain.items import ImportedItem


SEMANTIC_INDEX_MANIFEST_VERSION: Final = "semantic-index-manifest.v1"
SEMANTIC_INDEX_ALGORITHM_VERSION: Final = "hashed-tfidf-randomized-lsa.v1"
SEMANTIC_INDEX_CONFIG_VERSION: Final = "semantic-index-config.v1"
SEMANTIC_DOCUMENT_SCHEMA_VERSION: Final = "semantic-document.v1"
DEFAULT_ARTIFACT_BASENAME = "math-kangaroo-semantic-index"
MISSING_STRATEGY_WARNING = "STRATEGY_VIEW_UNAVAILABLE_RENORMALIZED"


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RetrievalView(StrEnum):
    SURFACE = "surface"
    TAG = "tag"
    HYBRID = "hybrid"
    STRATEGY = "strategy"


class SemanticIndexError(RuntimeError):
    """Base class for semantic-index failures."""


class StrategyViewUnavailableError(SemanticIndexError):
    """The index cannot invent a strategy view without reviewed paths."""


class RetrievalViewUnavailableError(SemanticIndexError):
    """The requested item has no usable vector for the requested view."""


class SemanticArtifactError(SemanticIndexError):
    """A persisted artifact is missing, malformed, or internally inconsistent."""


class StaleSemanticArtifactError(SemanticArtifactError):
    """A persisted artifact does not match the caller's expected corpus version."""


class SemanticIndexConfig(StrictFrozenModel):
    config_version: Literal["semantic-index-config.v1"] = SEMANTIC_INDEX_CONFIG_VERSION
    algorithm_version: Literal[
        "hashed-tfidf-randomized-lsa.v1"
    ] = SEMANTIC_INDEX_ALGORITHM_VERSION
    feature_count: int = Field(default=2048, ge=128, le=32768)
    lsa_dimensions: int = Field(default=64, ge=2, le=256)
    oversample_dimensions: int = Field(default=12, ge=0, le=64)
    power_iterations: int = Field(default=1, ge=0, le=4)
    random_seed: int = 20260805
    surface_weight: float = Field(default=0.25, ge=0)
    tag_weight: float = Field(default=0.30, ge=0)
    strategy_weight: float = Field(default=0.45, ge=0)

    @model_validator(mode="after")
    def hybrid_has_weight(self) -> "SemanticIndexConfig":
        if self.surface_weight + self.tag_weight + self.strategy_weight <= 0:
            raise ValueError("at least one hybrid-view weight must be positive")
        return self


class SemanticDocument(StrictFrozenModel):
    """Learner-safe retrieval input plus unapproved catalogue proposal tags."""

    schema_version: Literal["semantic-document.v1"] = SEMANTIC_DOCUMENT_SCHEMA_VERSION
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    stem: str
    choices: tuple[str, ...] = ()
    primary_domain: str = Field(min_length=1)
    question_type: str = Field(min_length=1)
    skill_ids: tuple[str, ...] = ()
    representation_tags: tuple[str, ...] = ()
    cognitive_demand_tag: str | None = None
    family_id: str | None = None
    exact_duplicate_group_id: str | None = None

    @model_validator(mode="after")
    def collections_are_canonical(self) -> "SemanticDocument":
        for name, values in (
            ("skill_ids", self.skill_ids),
            ("representation_tags", self.representation_tags),
        ):
            if tuple(sorted(set(values))) != values:
                raise ValueError(f"{name} must be sorted and unique")
            if any(not value.strip() for value in values):
                raise ValueError(f"{name} cannot contain blank values")
        return self

    @classmethod
    def from_imported_item(
        cls,
        item: ImportedItem,
        proposal: CatalogueClassificationProposal,
        *,
        family_id: str | None = None,
        exact_duplicate_group_id: str | None = None,
    ) -> "SemanticDocument":
        if proposal.item_id != item.learner.item_id:
            raise ValueError(
                "classification proposal item does not match imported item"
            )
        if proposal.content_version != item.learner.content_version:
            raise ValueError(
                "classification proposal content version does not match imported item"
            )
        return cls(
            item_id=item.learner.item_id,
            content_version=item.learner.content_version,
            stem=item.learner.stem_markdown,
            choices=item.learner.choices,
            primary_domain=proposal.primary_domain.value,
            question_type=proposal.question_type.value,
            skill_ids=proposal.skill_ids,
            representation_tags=tuple(
                sorted(tag.value for tag in proposal.representation_tags)
            ),
            cognitive_demand_tag=(
                proposal.cognitive_demand_tag.value
                if proposal.cognitive_demand_tag is not None
                else None
            ),
            family_id=family_id if family_id is not None else item.learner.family_id,
            exact_duplicate_group_id=exact_duplicate_group_id,
        )

    @classmethod
    def from_catalogue_item(cls, item: CatalogueInventoryItem) -> "SemanticDocument":
        """Reconstruct exactly the inputs used by catalogue index builds.

        Serving passes these documents back to :meth:`SemanticIndex.load`, so
        an artifact cannot be accepted merely because item IDs and content
        versions still match after surface text or proposal evidence changed.
        """

        choices_value = item.learner_payload.get("choices", [])
        choices = choices_value if isinstance(choices_value, list) else []
        skill_ids_value = item.proposal_payload.get("skill_ids", [])
        skill_ids = skill_ids_value if isinstance(skill_ids_value, list) else []
        representation_tags_value = item.proposal_payload.get("representation_tags", [])
        representation_tags = (
            representation_tags_value
            if isinstance(representation_tags_value, list)
            else []
        )
        return cls(
            item_id=item.item_id,
            content_version=item.content_version,
            stem=str(item.learner_payload.get("stem_markdown", "")),
            choices=tuple(str(value) for value in choices),
            primary_domain=str(item.proposal_payload.get("primary_domain", "unknown")),
            question_type=str(item.proposal_payload.get("question_type", "unknown")),
            skill_ids=tuple(sorted(str(value) for value in skill_ids)),
            representation_tags=tuple(
                sorted(str(value) for value in representation_tags)
            ),
            cognitive_demand_tag=(
                str(item.proposal_payload["cognitive_demand_tag"])
                if item.proposal_payload.get("cognitive_demand_tag")
                else None
            ),
            family_id=(
                str(item.learner_payload["family_id"])
                if item.learner_payload.get("family_id")
                else None
            ),
            exact_duplicate_group_id=(
                item.duplicate_group_ids[0] if item.duplicate_group_ids else None
            ),
        )

    @property
    def surface_text(self) -> str:
        sections = [f"stem {self.stem}"]
        sections.extend(f"choice {choice}" for choice in self.choices)
        return "\n".join(sections)

    @property
    def surface_sha256(self) -> str:
        return hashlib.sha256(self.surface_text.encode("utf-8")).hexdigest()

    @property
    def tag_tokens(self) -> tuple[str, ...]:
        tags: set[str] = set()
        if self.primary_domain != "unknown":
            tags.add(f"domain:{self.primary_domain}")
        if self.question_type != "unknown":
            tags.add(f"type:{self.question_type}")
        tags.update(f"skill:{skill_id}" for skill_id in self.skill_ids)
        tags.update(f"representation:{tag_id}" for tag_id in self.representation_tags)
        if self.cognitive_demand_tag is not None:
            tags.add(f"demand:{self.cognitive_demand_tag}")
        return tuple(sorted(tags))


class SemanticManifestItem(StrictFrozenModel):
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    surface_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    tags: tuple[str, ...]
    family_id: str | None = None
    exact_duplicate_group_id: str | None = None


class SemanticArtifactManifest(StrictFrozenModel):
    manifest_version: Literal[
        "semantic-index-manifest.v1"
    ] = SEMANTIC_INDEX_MANIFEST_VERSION
    algorithm_version: Literal[
        "hashed-tfidf-randomized-lsa.v1"
    ] = SEMANTIC_INDEX_ALGORITHM_VERSION
    purpose: Literal["local_corpus_retrieval_only"] = "local_corpus_retrieval_only"
    represents_mastery_or_difficulty: Literal[False] = False
    ontology_version: str = Field(min_length=1)
    classifier_version: str = Field(min_length=1)
    config: SemanticIndexConfig
    ordered_items: tuple[SemanticManifestItem, ...]
    ordered_items_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    tag_vocabulary: tuple[str, ...]
    surface_dimensions: int = Field(ge=1)
    tag_dimensions: int = Field(ge=0)
    strategy_available: Literal[False] = False
    vectors_filename: str = Field(min_length=1)
    vectors_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def item_manifest_hash_matches(self) -> "SemanticArtifactManifest":
        if _manifest_items_sha256(self.ordered_items) != self.ordered_items_sha256:
            raise ValueError("ordered item manifest checksum does not match its rows")
        if self.tag_dimensions != len(self.tag_vocabulary):
            raise ValueError("tag dimensions do not match tag vocabulary")
        return self


class ComponentSimilarities(StrictFrozenModel):
    surface: float
    tag: float
    strategy: None = None


class SemanticNeighbor(StrictFrozenModel):
    rank: int = Field(ge=1)
    item_id: str
    content_version: str
    score: float
    components: ComponentSimilarities
    shared_tags: tuple[str, ...]
    same_family: bool | None
    same_exact_duplicate_group: bool | None


class SemanticQueryResult(StrictFrozenModel):
    query_item_id: str
    query_content_version: str
    view: RetrievalView
    requested_top_k: int = Field(ge=1)
    effective_weights: dict[str, float]
    strategy_available: Literal[False] = False
    warnings: tuple[str, ...]
    neighbors: tuple[SemanticNeighbor, ...]


class MutualKnnEdge(StrictFrozenModel):
    left_item_id: str
    right_item_id: str
    view: RetrievalView
    left_to_right_rank: int = Field(ge=1)
    right_to_left_rank: int = Field(ge=1)
    score: float
    components: ComponentSimilarities
    shared_tags: tuple[str, ...]
    same_family: bool | None
    same_exact_duplicate_group: bool | None


@dataclass(frozen=True)
class SemanticArtifactPaths:
    vectors_path: Path
    manifest_path: Path


_TOKEN_PATTERN = re.compile(r"[^\W_]+(?:['’][^\W_]+)?|\d+", re.UNICODE)


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest_items_sha256(items: Sequence[SemanticManifestItem]) -> str:
    payload = [item.model_dump(mode="json") for item in items]
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def _semantic_identity_sha256(
    *,
    ontology_version: str,
    classifier_version: str,
    config: SemanticIndexConfig,
    items: Sequence[SemanticManifestItem],
    tag_vocabulary: Sequence[str],
    surface_vectors: np.ndarray,
    tag_vectors: np.ndarray,
) -> str:
    """Hash all retrieval semantics, including weights and vector contents."""

    digest = hashlib.sha256()
    digest.update(
        _canonical_json(
            {
                "ontology_version": ontology_version,
                "classifier_version": classifier_version,
                "config": config.model_dump(mode="json"),
                "items": [item.model_dump(mode="json") for item in items],
                "tag_vocabulary": list(tag_vocabulary),
            }
        ).encode("utf-8")
    )
    for label, values in (
        ("surface", surface_vectors),
        ("tag", tag_vectors),
    ):
        canonical: Any = np.ascontiguousarray(values, dtype=np.float32)
        digest.update(label.encode("ascii"))
        digest.update(_canonical_json(list(canonical.shape)).encode("ascii"))
        digest.update(canonical.tobytes(order="C"))
    return digest.hexdigest()


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(token.casefold() for token in _TOKEN_PATTERN.findall(text))


def _features(text: str) -> tuple[str, ...]:
    tokens = _tokens(text)
    unigrams = tuple(f"u:{token}" for token in tokens)
    bigrams = tuple(f"b:{left}\x1f{right}" for left, right in zip(tokens, tokens[1:]))
    return (*unigrams, *bigrams)


def _feature_bucket(feature: str, feature_count: int) -> tuple[int, float]:
    digest = hashlib.blake2b(
        feature.encode("utf-8"),
        digest_size=8,
        person=b"mk-surface-v1",
    ).digest()
    value = int.from_bytes(digest, "big")
    return value % feature_count, (-1.0 if value & (1 << 63) else 1.0)


def _normalize_rows(values: np.ndarray) -> np.ndarray:
    result = np.asarray(values, dtype=np.float64)
    norms = np.linalg.norm(result, axis=1, keepdims=True)
    return np.divide(
        result,
        norms,
        out=np.zeros_like(result),
        where=norms > 1e-12,
    ).astype(np.float32)


def _surface_matrix(
    documents: Sequence[SemanticDocument], config: SemanticIndexConfig
) -> np.ndarray:
    counts = np.zeros((len(documents), config.feature_count), dtype=np.float64)
    for row, document in enumerate(documents):
        for feature in _features(document.surface_text):
            bucket, sign = _feature_bucket(feature, config.feature_count)
            counts[row, bucket] += sign
    document_frequency = np.count_nonzero(counts, axis=0)
    idf = np.log((1.0 + len(documents)) / (1.0 + document_frequency)) + 1.0
    tf = np.sign(counts) * np.where(
        counts != 0,
        1.0 + np.log(np.maximum(np.abs(counts), 1.0)),
        0.0,
    )
    return _normalize_rows(tf * idf)


def _randomized_lsa(tfidf: np.ndarray, config: SemanticIndexConfig) -> np.ndarray:
    rows, columns = tfidf.shape
    rank = min(config.lsa_dimensions, rows, columns)
    if rank < 1:
        raise ValueError("semantic index requires at least one document")
    if not np.any(tfidf):
        return np.zeros((rows, rank), dtype=np.float32)
    sample_dimensions = min(columns, rank + config.oversample_dimensions)
    rng = np.random.default_rng(config.random_seed)
    omega = rng.standard_normal((columns, sample_dimensions), dtype=np.float64)
    source = np.asarray(tfidf, dtype=np.float64)
    projected = source @ omega
    for _ in range(config.power_iterations):
        basis, _ = np.linalg.qr(projected, mode="reduced")
        projected = source @ (source.T @ basis)
    basis, _ = np.linalg.qr(projected, mode="reduced")
    reduced = basis.T @ source
    _, _, right_vectors = np.linalg.svd(reduced, full_matrices=False)
    components = right_vectors[:rank].T
    return _normalize_rows(source @ components)


def _tag_vectors(
    documents: Sequence[SemanticDocument], tag_vocabulary: Sequence[str]
) -> np.ndarray:
    positions = {tag: index for index, tag in enumerate(tag_vocabulary)}
    matrix = np.zeros((len(documents), len(tag_vocabulary)), dtype=np.float32)
    for row, document in enumerate(documents):
        for tag in document.tag_tokens:
            matrix[row, positions[tag]] = 1.0
    return _normalize_rows(matrix)


class SemanticIndex:
    """Immutable in-memory item-to-item retrieval index."""

    def __init__(
        self,
        *,
        ontology_version: str,
        classifier_version: str,
        config: SemanticIndexConfig,
        items: tuple[SemanticManifestItem, ...],
        tag_vocabulary: tuple[str, ...],
        surface_vectors: np.ndarray,
        tag_vectors: np.ndarray,
    ) -> None:
        self.ontology_version = ontology_version
        self.classifier_version = classifier_version
        self.config = config
        self.items = items
        self.tag_vocabulary = tag_vocabulary
        self.surface_vectors = np.asarray(surface_vectors, dtype=np.float32)
        self.tag_vectors = np.asarray(tag_vectors, dtype=np.float32)
        self.strategy_vectors: None = None
        self._positions = {item.item_id: index for index, item in enumerate(items)}
        if len(self._positions) != len(items):
            raise ValueError("semantic index item IDs must be unique")
        self._validate_arrays()
        self.identity_sha256 = _semantic_identity_sha256(
            ontology_version=self.ontology_version,
            classifier_version=self.classifier_version,
            config=self.config,
            items=self.items,
            tag_vocabulary=self.tag_vocabulary,
            surface_vectors=self.surface_vectors,
            tag_vectors=self.tag_vectors,
        )

    @classmethod
    def build(
        cls,
        documents: Sequence[SemanticDocument],
        *,
        ontology_version: str,
        classifier_version: str,
        config: SemanticIndexConfig | None = None,
    ) -> "SemanticIndex":
        document_list = tuple(documents)
        if not document_list:
            raise ValueError("semantic index requires at least one document")
        if len({document.item_id for document in document_list}) != len(document_list):
            raise ValueError("semantic document item IDs must be unique")
        config = config or SemanticIndexConfig()
        tags = tuple(
            sorted({tag for document in document_list for tag in document.tag_tokens})
        )
        tfidf = _surface_matrix(document_list, config)
        surface_vectors = _randomized_lsa(tfidf, config)
        tag_vectors = _tag_vectors(document_list, tags)
        items = tuple(
            SemanticManifestItem(
                item_id=document.item_id,
                content_version=document.content_version,
                surface_sha256=document.surface_sha256,
                tags=document.tag_tokens,
                family_id=document.family_id,
                exact_duplicate_group_id=document.exact_duplicate_group_id,
            )
            for document in document_list
        )
        return cls(
            ontology_version=ontology_version,
            classifier_version=classifier_version,
            config=config,
            items=items,
            tag_vocabulary=tags,
            surface_vectors=surface_vectors,
            tag_vectors=tag_vectors,
        )

    @property
    def available_views(self) -> tuple[RetrievalView, ...]:
        return (RetrievalView.SURFACE, RetrievalView.TAG, RetrievalView.HYBRID)

    @property
    def strategy_available(self) -> Literal[False]:
        return False

    @property
    def item_versions(self) -> tuple[tuple[str, str], ...]:
        return tuple((item.item_id, item.content_version) for item in self.items)

    def _validate_arrays(self) -> None:
        expected_rows = len(self.items)
        if (
            self.surface_vectors.ndim != 2
            or self.surface_vectors.shape[0] != expected_rows
        ):
            raise SemanticArtifactError("surface array row count does not match items")
        if self.tag_vectors.shape != (expected_rows, len(self.tag_vocabulary)):
            raise SemanticArtifactError("tag array shape does not match manifest")
        for label, values in (
            ("surface", self.surface_vectors),
            ("tag", self.tag_vectors),
        ):
            if not np.isfinite(values).all():
                raise SemanticArtifactError(
                    f"{label} vectors contain non-finite values"
                )
            norms = np.linalg.norm(values, axis=1)
            normalized_or_empty = np.isclose(norms, 0, atol=1e-5) | np.isclose(
                norms, 1, atol=1e-5
            )
            if not np.all(normalized_or_empty):
                raise SemanticArtifactError(f"{label} vectors are not row-normalized")

    def _query_components(self, position: int) -> tuple[np.ndarray, np.ndarray]:
        surface = self.surface_vectors @ self.surface_vectors[position]
        tag = self.tag_vectors @ self.tag_vectors[position]
        return surface, tag

    def _effective_weights(
        self, position: int, view: RetrievalView
    ) -> tuple[dict[str, float], tuple[str, ...]]:
        if view is RetrievalView.STRATEGY:
            raise StrategyViewUnavailableError(
                "strategy retrieval is unavailable until reviewed solution paths exist"
            )
        if view is RetrievalView.SURFACE:
            view_warnings = (
                ("SURFACE_VIEW_EMPTY_FOR_QUERY",)
                if not np.any(self.surface_vectors[position])
                else ()
            )
            return {"surface": 1.0}, view_warnings
        if view is RetrievalView.TAG:
            view_warnings = (
                ("TAG_VIEW_EMPTY_FOR_QUERY",)
                if not np.any(self.tag_vectors[position])
                else ()
            )
            return {"tag": 1.0}, view_warnings

        candidates: list[tuple[str, float]] = []
        warnings: list[str] = []
        if self.config.surface_weight > 0 and np.any(self.surface_vectors[position]):
            candidates.append(("surface", self.config.surface_weight))
        elif self.config.surface_weight > 0:
            warnings.append("SURFACE_VIEW_EMPTY_FOR_QUERY")
        if self.config.tag_weight > 0 and np.any(self.tag_vectors[position]):
            candidates.append(("tag", self.config.tag_weight))
        elif self.config.tag_weight > 0:
            warnings.append("TAG_VIEW_EMPTY_FOR_QUERY")
        if self.config.strategy_weight > 0:
            warnings.append(MISSING_STRATEGY_WARNING)
        total = sum(weight for _, weight in candidates)
        if total <= 0:
            raise RetrievalViewUnavailableError(
                "hybrid retrieval has no available view for this query item"
            )
        return (
            {name: round(weight / total, 8) for name, weight in candidates},
            tuple(warnings),
        )

    @staticmethod
    def _indicator(left: str | None, right: str | None) -> bool | None:
        if left is None or right is None:
            return None
        return left == right

    def query(
        self,
        item_id: str,
        *,
        top_k: int = 10,
        view: RetrievalView | str = RetrievalView.HYBRID,
    ) -> SemanticQueryResult:
        if top_k < 1:
            raise ValueError("top_k must be at least one")
        try:
            view = RetrievalView(view)
        except ValueError as error:
            raise ValueError(f"unsupported retrieval view {view!r}") from error
        try:
            position = self._positions[item_id]
        except KeyError as error:
            raise KeyError(f"unknown semantic-index item {item_id!r}") from error
        weights, warnings = self._effective_weights(position, view)
        surface_scores, tag_scores = self._query_components(position)
        if view is RetrievalView.SURFACE:
            scores = surface_scores
        elif view is RetrievalView.TAG:
            scores = tag_scores
        else:
            scores = np.zeros(len(self.items), dtype=np.float64)
            if "surface" in weights:
                scores += weights["surface"] * surface_scores
            if "tag" in weights:
                scores += weights["tag"] * tag_scores

        query_item = self.items[position]
        candidates = [index for index in range(len(self.items)) if index != position]
        candidates.sort(
            key=lambda index: (
                -float(scores[index]),
                self.items[index].item_id,
                self.items[index].content_version,
                index,
            )
        )
        neighbors = []
        for rank, index in enumerate(candidates[:top_k], start=1):
            candidate = self.items[index]
            neighbors.append(
                SemanticNeighbor(
                    rank=rank,
                    item_id=candidate.item_id,
                    content_version=candidate.content_version,
                    score=round(float(scores[index]), 8),
                    components=ComponentSimilarities(
                        surface=round(float(surface_scores[index]), 8),
                        tag=round(float(tag_scores[index]), 8),
                    ),
                    shared_tags=tuple(
                        sorted(set(query_item.tags) & set(candidate.tags))
                    ),
                    same_family=self._indicator(
                        query_item.family_id, candidate.family_id
                    ),
                    same_exact_duplicate_group=self._indicator(
                        query_item.exact_duplicate_group_id,
                        candidate.exact_duplicate_group_id,
                    ),
                )
            )
        return SemanticQueryResult(
            query_item_id=query_item.item_id,
            query_content_version=query_item.content_version,
            view=view,
            requested_top_k=top_k,
            effective_weights=weights,
            warnings=warnings,
            neighbors=tuple(neighbors),
        )

    def mutual_knn(
        self,
        *,
        k: int = 5,
        view: RetrievalView | str = RetrievalView.HYBRID,
    ) -> tuple[MutualKnnEdge, ...]:
        if k < 1:
            raise ValueError("k must be at least one")
        view = RetrievalView(view)
        results = {
            item.item_id: self.query(item.item_id, top_k=k, view=view)
            for item in self.items
        }
        ranks = {
            query_id: {neighbor.item_id: neighbor.rank for neighbor in result.neighbors}
            for query_id, result in results.items()
        }
        edges: list[MutualKnnEdge] = []
        for left in self.items:
            left_neighbors = {
                neighbor.item_id: neighbor
                for neighbor in results[left.item_id].neighbors
            }
            for right_id, neighbor in left_neighbors.items():
                if left.item_id >= right_id:
                    continue
                if left.item_id not in ranks[right_id]:
                    continue
                edges.append(
                    MutualKnnEdge(
                        left_item_id=left.item_id,
                        right_item_id=right_id,
                        view=view,
                        left_to_right_rank=neighbor.rank,
                        right_to_left_rank=ranks[right_id][left.item_id],
                        score=neighbor.score,
                        components=neighbor.components,
                        shared_tags=neighbor.shared_tags,
                        same_family=neighbor.same_family,
                        same_exact_duplicate_group=(
                            neighbor.same_exact_duplicate_group
                        ),
                    )
                )
        return tuple(
            sorted(edges, key=lambda edge: (edge.left_item_id, edge.right_item_id))
        )

    def save(
        self,
        directory: Path,
        *,
        basename: str = DEFAULT_ARTIFACT_BASENAME,
    ) -> SemanticArtifactPaths:
        if not basename or basename in {".", ".."} or Path(basename).name != basename:
            raise ValueError("artifact basename must be one safe path component")
        directory = directory.resolve()
        directory.mkdir(parents=True, exist_ok=True)
        vectors_path = directory / f"{basename}.npz"
        manifest_path = directory / f"{basename}.manifest.json"

        temporary_vectors: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb", suffix=".npz", dir=directory, delete=False
            ) as target:
                temporary_vectors = Path(target.name)
                np.savez_compressed(
                    target,
                    surface_vectors=self.surface_vectors,
                    tag_vectors=self.tag_vectors,
                )
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary_vectors, vectors_path)
            temporary_vectors = None
        finally:
            if temporary_vectors is not None:
                temporary_vectors.unlink(missing_ok=True)

        manifest = SemanticArtifactManifest(
            ontology_version=self.ontology_version,
            classifier_version=self.classifier_version,
            config=self.config,
            ordered_items=self.items,
            ordered_items_sha256=_manifest_items_sha256(self.items),
            tag_vocabulary=self.tag_vocabulary,
            surface_dimensions=self.surface_vectors.shape[1],
            tag_dimensions=self.tag_vectors.shape[1],
            vectors_filename=vectors_path.name,
            vectors_sha256=_sha256_file(vectors_path),
        )
        serialized = (
            json.dumps(
                manifest.model_dump(mode="json"),
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )
        temporary_manifest: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix=".json",
                dir=directory,
                delete=False,
            ) as target:
                temporary_manifest = Path(target.name)
                target.write(serialized)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary_manifest, manifest_path)
            temporary_manifest = None
        finally:
            if temporary_manifest is not None:
                temporary_manifest.unlink(missing_ok=True)
        return SemanticArtifactPaths(
            vectors_path=vectors_path,
            manifest_path=manifest_path,
        )

    @classmethod
    def load(
        cls,
        artifact: SemanticArtifactPaths,
        *,
        expected_documents: Sequence[SemanticDocument] | None = None,
        expected_ontology_version: str | None = None,
        expected_classifier_version: str | None = None,
    ) -> "SemanticIndex":
        try:
            raw_manifest = artifact.manifest_path.read_text(encoding="utf-8")
            manifest = SemanticArtifactManifest.model_validate_json(raw_manifest)
        except (OSError, ValidationError, ValueError) as error:
            raise SemanticArtifactError("semantic manifest is invalid") from error
        if artifact.vectors_path.name != manifest.vectors_filename:
            raise SemanticArtifactError("manifest references a different vector file")
        if not artifact.vectors_path.is_file():
            raise SemanticArtifactError("semantic vector artifact is missing")
        if _sha256_file(artifact.vectors_path) != manifest.vectors_sha256:
            raise SemanticArtifactError("semantic vector artifact checksum changed")
        if (
            expected_ontology_version is not None
            and manifest.ontology_version != expected_ontology_version
        ):
            raise StaleSemanticArtifactError("ontology version does not match artifact")
        if (
            expected_classifier_version is not None
            and manifest.classifier_version != expected_classifier_version
        ):
            raise StaleSemanticArtifactError(
                "classifier version does not match artifact"
            )
        if expected_documents is not None:
            expected_items = tuple(
                SemanticManifestItem(
                    item_id=document.item_id,
                    content_version=document.content_version,
                    surface_sha256=document.surface_sha256,
                    tags=document.tag_tokens,
                    family_id=document.family_id,
                    exact_duplicate_group_id=(document.exact_duplicate_group_id),
                )
                for document in expected_documents
            )
            if expected_items != manifest.ordered_items:
                raise StaleSemanticArtifactError(
                    "ordered item IDs, versions, content, or tags do not match artifact"
                )
        try:
            with np.load(artifact.vectors_path, allow_pickle=False) as arrays:
                if set(arrays.files) != {"surface_vectors", "tag_vectors"}:
                    raise SemanticArtifactError(
                        "semantic vector artifact has unexpected arrays"
                    )
                surface_vectors = np.asarray(
                    arrays["surface_vectors"], dtype=np.float32
                )
                tag_vectors = np.asarray(arrays["tag_vectors"], dtype=np.float32)
        except (OSError, ValueError) as error:
            raise SemanticArtifactError(
                "semantic vector artifact is invalid"
            ) from error
        if surface_vectors.shape != (
            len(manifest.ordered_items),
            manifest.surface_dimensions,
        ):
            raise SemanticArtifactError(
                "surface vector dimensions do not match manifest"
            )
        return cls(
            ontology_version=manifest.ontology_version,
            classifier_version=manifest.classifier_version,
            config=manifest.config,
            items=manifest.ordered_items,
            tag_vocabulary=manifest.tag_vocabulary,
            surface_vectors=surface_vectors,
            tag_vectors=tag_vectors,
        )


__all__ = [
    "DEFAULT_ARTIFACT_BASENAME",
    "MISSING_STRATEGY_WARNING",
    "SEMANTIC_DOCUMENT_SCHEMA_VERSION",
    "SEMANTIC_INDEX_ALGORITHM_VERSION",
    "SEMANTIC_INDEX_CONFIG_VERSION",
    "SEMANTIC_INDEX_MANIFEST_VERSION",
    "ComponentSimilarities",
    "MutualKnnEdge",
    "RetrievalView",
    "RetrievalViewUnavailableError",
    "SemanticArtifactError",
    "SemanticArtifactManifest",
    "SemanticArtifactPaths",
    "SemanticDocument",
    "SemanticIndex",
    "SemanticIndexConfig",
    "SemanticIndexError",
    "SemanticNeighbor",
    "SemanticQueryResult",
    "StaleSemanticArtifactError",
    "StrategyViewUnavailableError",
]
