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
import io
import importlib.metadata
import json
import math
import os
import re
import stat
import tempfile
import warnings
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, Final, Literal, Sequence, cast

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from umap import UMAP  # type: ignore[import-untyped]

from math_kangaroo_trainer.corpus.catalogue import CatalogueClassificationProposal
from math_kangaroo_trainer.domain.catalogue_reviews import CatalogueInventoryItem
from math_kangaroo_trainer.domain.items import ImportedItem


SEMANTIC_INDEX_MANIFEST_VERSION: Final = "semantic-index-manifest.v4"
SEMANTIC_INDEX_ALGORITHM_VERSION: Final = "hashed-tfidf-randomized-lsa.v1"
SEMANTIC_INDEX_CONFIG_VERSION: Final = "semantic-index-config.v1"
SEMANTIC_DOCUMENT_SCHEMA_VERSION: Final = "semantic-document.v1"
SEMANTIC_MAP_PROJECTION_VERSION: Final = "semantic-map-umap-precomputed.v1"
SEMANTIC_MAP_IMPLEMENTATION: Final = "umap-learn"
SEMANTIC_MAP_IMPLEMENTATION_VERSION: Final = importlib.metadata.version(
    SEMANTIC_MAP_IMPLEMENTATION
)
SEMANTIC_MAP_DISTANCE_VERSION: Final = "one-minus-served-similarity-clipped.v1"
SEMANTIC_MAP_RANDOM_SEED: Final = 20260807
SEMANTIC_MAP_NEIGHBOR_COUNT: Final = 15
SEMANTIC_MAP_MIN_DIST: Final = 0.1
SEMANTIC_MAP_SPREAD: Final = 1.0
SEMANTIC_MAP_EPOCHS: Final = 500
SEMANTIC_MAP_SMALL_SAMPLE_FALLBACK: Final = (
    "deterministic-linear-layout-below-three-items.v1"
)
SEMANTIC_MAP_CLUSTER_LABEL_VERSION: Final = "proposal-tag-lift.v1"
SEMANTIC_MAP_HYBRID_METRIC: Final = (
    "mean-bidirectional-anchor-renormalized-similarity.v1"
)
DEFAULT_ARTIFACT_BASENAME = "math-kangaroo-semantic-index"
MISSING_STRATEGY_WARNING = "STRATEGY_VIEW_UNAVAILABLE_RENORMALIZED"
TEXT_QUERY_TAG_WARNING = "TEXT_QUERY_HAS_NO_TAG_VECTOR"
TEXT_QUERY_NO_CORPUS_EVIDENCE = "TEXT_QUERY_NO_CORPUS_EVIDENCE"
TEXT_QUERY_LOW_EVIDENCE = "TEXT_QUERY_LOW_CORPUS_EVIDENCE"
MAX_SEMANTIC_MAP_CLUSTERS: Final = 14
MAX_SEMANTIC_MANIFEST_BYTES: Final = 16 * 1024 * 1024
MAX_SEMANTIC_VECTOR_BYTES: Final = 256 * 1024 * 1024


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


class SemanticMapProjectionParameters(StrictFrozenModel):
    """Versioned UMAP settings used to create every persisted map view."""

    implementation: Literal["umap-learn"] = SEMANTIC_MAP_IMPLEMENTATION
    implementation_version: str = Field(min_length=1)
    input_mode: Literal["precomputed"] = "precomputed"
    input_distance_version: Literal[
        "one-minus-served-similarity-clipped.v1"
    ] = SEMANTIC_MAP_DISTANCE_VERSION
    configured_neighbors: Literal[15] = SEMANTIC_MAP_NEIGHBOR_COUNT
    min_dist: float = Field(default=SEMANTIC_MAP_MIN_DIST, ge=0)
    spread: float = Field(default=SEMANTIC_MAP_SPREAD, gt=0)
    epochs: Literal[500] = SEMANTIC_MAP_EPOCHS
    initialization: Literal["random"] = "random"
    random_seed: Literal[20260807] = SEMANTIC_MAP_RANDOM_SEED
    transform_seed: Literal[20260807] = SEMANTIC_MAP_RANDOM_SEED
    jobs: Literal[1] = 1
    output_metric: Literal["euclidean"] = "euclidean"
    set_op_mix_ratio: float = Field(default=1.0, ge=0, le=1)
    local_connectivity: float = Field(default=1.0, ge=0)
    repulsion_strength: float = Field(default=1.0, ge=0)
    negative_sample_rate: Literal[5] = 5
    learning_rate: float = Field(default=1.0, gt=0)
    small_sample_fallback: Literal[
        "deterministic-linear-layout-below-three-items.v1"
    ] = SEMANTIC_MAP_SMALL_SAMPLE_FALLBACK

    @model_validator(mode="after")
    def fixed_algorithm_parameters_match(self) -> "SemanticMapProjectionParameters":
        if (
            self.min_dist,
            self.spread,
            self.set_op_mix_ratio,
            self.local_connectivity,
            self.repulsion_strength,
            self.learning_rate,
        ) != (SEMANTIC_MAP_MIN_DIST, SEMANTIC_MAP_SPREAD, 1.0, 1.0, 1.0, 1.0):
            raise ValueError("semantic projection parameters do not match the version")
        return self


class SemanticArtifactManifest(StrictFrozenModel):
    manifest_version: Literal[
        "semantic-index-manifest.v4"
    ] = SEMANTIC_INDEX_MANIFEST_VERSION
    algorithm_version: Literal[
        "hashed-tfidf-randomized-lsa.v1"
    ] = SEMANTIC_INDEX_ALGORITHM_VERSION
    purpose: Literal[
        "local_corpus_retrieval_and_exploration_only"
    ] = "local_corpus_retrieval_and_exploration_only"
    represents_mastery_or_difficulty: Literal[False] = False
    ontology_version: str = Field(min_length=1)
    classifier_version: str = Field(min_length=1)
    config: SemanticIndexConfig
    ordered_items: tuple[SemanticManifestItem, ...]
    ordered_items_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    tag_vocabulary: tuple[str, ...]
    surface_dimensions: int = Field(ge=1)
    surface_feature_support_count: int = Field(ge=1)
    tag_dimensions: int = Field(ge=0)
    strategy_available: Literal[False] = False
    projection_algorithm_version: Literal[
        "semantic-map-umap-precomputed.v1"
    ] = SEMANTIC_MAP_PROJECTION_VERSION
    projection_parameters: SemanticMapProjectionParameters
    cluster_label_algorithm_version: Literal[
        "proposal-tag-lift.v1"
    ] = SEMANTIC_MAP_CLUSTER_LABEL_VERSION
    projection_is_exploratory: Literal[True] = True
    projection_dimensions: Literal[2] = 2
    projection_views: tuple["SemanticMapViewManifest", ...]
    vectors_filename: str = Field(min_length=1)
    vectors_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def item_manifest_hash_matches(self) -> "SemanticArtifactManifest":
        if _manifest_items_sha256(self.ordered_items) != self.ordered_items_sha256:
            raise ValueError("ordered item manifest checksum does not match its rows")
        if self.tag_dimensions != len(self.tag_vocabulary):
            raise ValueError("tag dimensions do not match tag vocabulary")
        if (
            self.projection_parameters.implementation_version
            != SEMANTIC_MAP_IMPLEMENTATION_VERSION
        ):
            raise ValueError(
                "semantic projection implementation version does not match runtime"
            )
        if tuple(value.view for value in self.projection_views) != (
            RetrievalView.SURFACE,
            RetrievalView.TAG,
            RetrievalView.HYBRID,
        ):
            raise ValueError("projection views must contain surface, tag, and hybrid")
        for projection in self.projection_views:
            cluster_ids = tuple(cluster.cluster_id for cluster in projection.clusters)
            if cluster_ids != tuple(range(len(cluster_ids))):
                raise ValueError(
                    "projection cluster IDs must be contiguous and ordered"
                )
            clustered_count = sum(
                cluster.member_count for cluster in projection.clusters
            )
            if clustered_count != projection.mapped_count:
                raise ValueError("projection mapped count does not match its clusters")
            if projection.mapped_count + projection.unmapped_count != len(
                self.ordered_items
            ):
                raise ValueError(
                    "projection cluster counts do not cover the item manifest"
                )
            expected_neighbors = (
                min(SEMANTIC_MAP_NEIGHBOR_COUNT, projection.mapped_count - 1)
                if projection.mapped_count >= 3
                else 0
            )
            if projection.effective_neighbors != expected_neighbors:
                raise ValueError("projection effective neighbor count is inconsistent")
            if projection.used_small_sample_fallback != (
                0 < projection.mapped_count < 3
            ):
                raise ValueError(
                    "projection small-sample fallback flag is inconsistent"
                )
        return self


class SemanticMapTagEvidence(StrictFrozenModel):
    tag: str = Field(min_length=1)
    member_count: int = Field(ge=1)
    coverage: float = Field(ge=0, le=1)
    global_coverage: float = Field(ge=0, le=1)
    lift: float = Field(gt=0)


class SemanticMapCluster(StrictFrozenModel):
    cluster_id: int = Field(ge=0)
    label: str = Field(min_length=1)
    label_tag: str = Field(min_length=1)
    member_count: int = Field(ge=1)
    dominant_tags: tuple[SemanticMapTagEvidence, ...]
    evidence_source: Literal[
        "unreviewed_catalogue_proposal_tags"
    ] = "unreviewed_catalogue_proposal_tags"
    authoritative: Literal[False] = False


class SemanticMapViewManifest(StrictFrozenModel):
    view: Literal[
        RetrievalView.SURFACE,
        RetrievalView.TAG,
        RetrievalView.HYBRID,
    ]
    clusters: tuple[SemanticMapCluster, ...]
    source_similarity_metric: str = Field(min_length=1)
    input_distance_version: Literal[
        "one-minus-served-similarity-clipped.v1"
    ] = SEMANTIC_MAP_DISTANCE_VERSION
    mapped_count: int = Field(ge=0)
    unmapped_count: int = Field(ge=0)
    effective_neighbors: int = Field(ge=0, le=SEMANTIC_MAP_NEIGHBOR_COUNT)
    used_small_sample_fallback: bool
    projection_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ComponentSimilarities(StrictFrozenModel):
    surface: float
    tag: float | None
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


class SemanticTextQueryResult(StrictFrozenModel):
    query_kind: Literal["pasted_text"] = "pasted_text"
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


def _read_regular_file_snapshot(
    path: Path,
    *,
    max_bytes: int,
    label: str,
) -> bytes:
    """Read one bounded, immutable-by-construction artifact snapshot.

    The vector checksum and ``numpy`` decoder must consume the same bytes.
    Opening with ``O_NOFOLLOW`` and checking every existing path component
    prevents a caller-controlled symlink from redirecting either artifact.
    Before/after ``fstat`` checks reject an in-place writer racing the read.
    """

    requested = path.absolute()
    for component in (requested, *requested.parents):
        try:
            metadata = os.lstat(component)
        except FileNotFoundError:
            continue
        except OSError as error:
            raise SemanticArtifactError(f"{label} path cannot be inspected") from error
        if stat.S_ISLNK(metadata.st_mode):
            raise SemanticArtifactError(f"{label} cannot be a symlink")

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(requested, flags)
    except OSError as error:
        raise SemanticArtifactError(f"{label} cannot be opened safely") from error
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise SemanticArtifactError(f"{label} must be a regular file")
        if before.st_size < 0 or before.st_size > max_bytes:
            raise SemanticArtifactError(f"{label} exceeds the safe size limit")
        chunks: list[bytes] = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        snapshot = b"".join(chunks)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)

    stable_fields = (
        "st_dev",
        "st_ino",
        "st_size",
        "st_mtime_ns",
        "st_ctime_ns",
    )
    if len(snapshot) != before.st_size or any(
        getattr(before, field) != getattr(after, field) for field in stable_fields
    ):
        raise SemanticArtifactError(f"{label} changed while it was being read")
    return snapshot


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
    surface_idf: np.ndarray,
    surface_components: np.ndarray,
    surface_feature_digests: np.ndarray,
    surface_feature_document_frequencies: np.ndarray,
    projection_coordinates: dict[RetrievalView, np.ndarray],
    projection_cluster_ids: dict[RetrievalView, np.ndarray],
    projection_clusters: dict[RetrievalView, tuple[SemanticMapCluster, ...]],
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
                "surface_feature_support_count": len(surface_feature_digests),
                "projection_algorithm_version": SEMANTIC_MAP_PROJECTION_VERSION,
                "projection_parameters": SemanticMapProjectionParameters(
                    implementation_version=SEMANTIC_MAP_IMPLEMENTATION_VERSION
                ).model_dump(mode="json"),
                "cluster_label_algorithm_version": (SEMANTIC_MAP_CLUSTER_LABEL_VERSION),
                "projection_clusters": {
                    view.value: [
                        cluster.model_dump(mode="json")
                        for cluster in projection_clusters[view]
                    ]
                    for view in (
                        RetrievalView.SURFACE,
                        RetrievalView.TAG,
                        RetrievalView.HYBRID,
                    )
                },
            }
        ).encode("utf-8")
    )
    for label, values, dtype in (
        ("surface", surface_vectors, np.float32),
        ("tag", tag_vectors, np.float32),
        ("surface_idf", surface_idf, np.float32),
        ("surface_components", surface_components, np.float32),
        ("surface_feature_digests", surface_feature_digests, np.uint64),
        (
            "surface_feature_document_frequencies",
            surface_feature_document_frequencies,
            np.uint32,
        ),
        *(
            (
                f"{view.value}_projection_coordinates",
                projection_coordinates[view],
                np.float32,
            )
            for view in (
                RetrievalView.SURFACE,
                RetrievalView.TAG,
                RetrievalView.HYBRID,
            )
        ),
        *(
            (
                f"{view.value}_projection_cluster_ids",
                projection_cluster_ids[view],
                np.int32,
            )
            for view in (
                RetrievalView.SURFACE,
                RetrievalView.TAG,
                RetrievalView.HYBRID,
            )
        ),
    ):
        canonical: Any = np.ascontiguousarray(values, dtype=dtype)
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


def _feature_support_digest(feature: str) -> int:
    """Return a collision-resistant exact-feature key for query evidence checks."""

    digest = hashlib.blake2b(
        feature.encode("utf-8"),
        digest_size=8,
        person=b"mk-support-v1",
    ).digest()
    return int.from_bytes(digest, "big")


def _surface_feature_support(
    documents: Sequence[SemanticDocument],
) -> tuple[np.ndarray, np.ndarray]:
    """Persist exact feature document frequencies alongside hashed TF-IDF.

    Feature hashing is intentionally lossy.  This separate representation lets
    pasted-text retrieval prove that a query contains actual corpus evidence,
    rather than accepting an unrelated token that merely shares a hash bucket.
    """

    document_frequencies: dict[int, int] = {}
    for document in documents:
        digests = {
            _feature_support_digest(feature)
            for feature in _features(document.surface_text)
        }
        for digest in digests:
            document_frequencies[digest] = document_frequencies.get(digest, 0) + 1
    ordered = sorted(document_frequencies)
    return (
        np.asarray(ordered, dtype=np.uint64),
        np.asarray(
            [document_frequencies[digest] for digest in ordered],
            dtype=np.uint32,
        ),
    )


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
) -> tuple[np.ndarray, np.ndarray]:
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
    return _normalize_rows(tf * idf), np.asarray(idf, dtype=np.float32)


def _randomized_lsa(
    tfidf: np.ndarray, config: SemanticIndexConfig
) -> tuple[np.ndarray, np.ndarray]:
    rows, columns = tfidf.shape
    rank = min(config.lsa_dimensions, rows, columns)
    if rank < 1:
        raise ValueError("semantic index requires at least one document")
    if not np.any(tfidf):
        return (
            np.zeros((rows, rank), dtype=np.float32),
            np.zeros((columns, rank), dtype=np.float32),
        )
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
    return (
        _normalize_rows(source @ components),
        np.asarray(components, dtype=np.float32),
    )


def _tag_vectors(
    documents: Sequence[SemanticDocument], tag_vocabulary: Sequence[str]
) -> np.ndarray:
    positions = {tag: index for index, tag in enumerate(tag_vocabulary)}
    matrix = np.zeros((len(documents), len(tag_vocabulary)), dtype=np.float32)
    for row, document in enumerate(documents):
        for tag in document.tag_tokens:
            matrix[row, positions[tag]] = 1.0
    return _normalize_rows(matrix)


def _combined_exploration_vectors(
    surface_vectors: np.ndarray,
    tag_vectors: np.ndarray,
    config: SemanticIndexConfig,
) -> np.ndarray:
    """Return a Euclidean initialization for the symmetric hybrid graph.

    The map's authoritative neighborhood relation is computed separately by
    :func:`_projection_inputs_for_view`.  These concatenated vectors are only
    the full-data PCA baseline/initialization for the attraction pass.
    """

    available: list[tuple[np.ndarray, float]] = []
    if surface_vectors.shape[1] and config.surface_weight > 0:
        available.append((surface_vectors, config.surface_weight))
    if tag_vectors.shape[1] and config.tag_weight > 0:
        available.append((tag_vectors, config.tag_weight))
    total = sum(weight for _, weight in available)
    if total <= 0:
        raise SemanticArtifactError(
            "semantic map requires at least one surface or tag vector facet"
        )
    scaled = [
        np.asarray(values, dtype=np.float64) * np.sqrt(weight / total)
        for values, weight in available
    ]
    return _normalize_rows(np.concatenate(scaled, axis=1))


def _hybrid_similarity_matrix(
    surface_vectors: np.ndarray,
    tag_vectors: np.ndarray,
    config: SemanticIndexConfig,
) -> tuple[np.ndarray, np.ndarray]:
    """Symmetrize the actual anchor-dependent hybrid retrieval similarity.

    Item retrieval renormalizes configured weights around the facets available
    to the query item.  That relation is directional when, for example, one
    item is tagged and another is tagless.  An undirected map therefore uses
    the arithmetic mean of both served directions, not a concatenated-vector
    cosine that silently applies a different missing-facet rule.
    """

    surface_available = np.linalg.norm(surface_vectors, axis=1) > 1e-12
    tag_available = np.linalg.norm(tag_vectors, axis=1) > 1e-12
    surface_weights: Any = np.asarray(
        np.where(
            surface_available,
            config.surface_weight,
            0.0,
        ),
        dtype=np.float64,
    )
    tag_weights: Any = np.asarray(
        np.where(tag_available, config.tag_weight, 0.0),
        dtype=np.float64,
    )
    totals: Any = surface_weights + tag_weights
    mapped = totals > 1e-12
    normalized_surface_weights = np.divide(
        surface_weights,
        totals,
        out=np.zeros_like(surface_weights, dtype=np.float64),
        where=mapped,
    )
    normalized_tag_weights = np.divide(
        tag_weights,
        totals,
        out=np.zeros_like(tag_weights, dtype=np.float64),
        where=mapped,
    )
    surface_scores = np.asarray(surface_vectors @ surface_vectors.T, dtype=np.float64)
    tag_scores = np.asarray(tag_vectors @ tag_vectors.T, dtype=np.float64)
    directional = (
        normalized_surface_weights[:, np.newaxis] * surface_scores
        + normalized_tag_weights[:, np.newaxis] * tag_scores
    )
    return (directional + directional.T) / 2.0, mapped


def _source_similarity_metric(view: RetrievalView) -> str:
    if view is RetrievalView.SURFACE:
        return "surface-cosine-similarity.v1"
    if view is RetrievalView.TAG:
        return "tag-cosine-similarity.v1"
    if view is RetrievalView.HYBRID:
        return SEMANTIC_MAP_HYBRID_METRIC
    raise ValueError("semantic map does not support a strategy projection")


def _projection_inputs_for_view(
    view: RetrievalView,
    *,
    surface_vectors: np.ndarray,
    tag_vectors: np.ndarray,
    config: SemanticIndexConfig,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, str]:
    """Return PCA vectors, served-neighborhood scores, mapping mask, and metric."""

    if view is RetrievalView.SURFACE:
        vectors = _normalize_rows(surface_vectors)
        mapped = np.linalg.norm(vectors, axis=1) > 1e-12
        return (
            vectors,
            np.asarray(vectors @ vectors.T, dtype=np.float64),
            mapped,
            _source_similarity_metric(view),
        )
    if view is RetrievalView.TAG:
        vectors = _normalize_rows(tag_vectors)
        mapped = np.linalg.norm(vectors, axis=1) > 1e-12
        return (
            vectors,
            np.asarray(vectors @ vectors.T, dtype=np.float64),
            mapped,
            _source_similarity_metric(view),
        )
    if view is RetrievalView.HYBRID:
        similarities, mapped = _hybrid_similarity_matrix(
            surface_vectors,
            tag_vectors,
            config,
        )
        return (
            _combined_exploration_vectors(surface_vectors, tag_vectors, config),
            similarities,
            mapped,
            _source_similarity_metric(view),
        )
    raise ValueError("semantic map does not support a strategy projection")


def _orient_and_scale_projection(values: np.ndarray) -> np.ndarray:
    coordinates = np.asarray(values, dtype=np.float64).copy()
    if coordinates.size == 0:
        return np.asarray(coordinates, dtype=np.float32)
    coordinates -= np.mean(coordinates, axis=0)
    for dimension in range(coordinates.shape[1]):
        column = coordinates[:, dimension]
        pivot = int(np.argmax(np.abs(column)))
        if column[pivot] < 0:
            coordinates[:, dimension] *= -1
    extent = float(np.max(np.abs(coordinates)))
    if extent > 1e-12:
        coordinates /= extent
    else:
        coordinates.fill(0)
    return np.asarray(coordinates, dtype=np.float32)


def _pca_projection(vectors: np.ndarray) -> np.ndarray:
    rows = vectors.shape[0]
    centered = np.asarray(vectors, dtype=np.float64) - np.mean(vectors, axis=0)
    coordinates = np.zeros((rows, 2), dtype=np.float64)
    if rows > 1 and np.any(centered):
        _, _, right_vectors = np.linalg.svd(centered, full_matrices=False)
        dimensions = min(2, right_vectors.shape[0])
        coordinates[:, :dimensions] = centered @ right_vectors[:dimensions].T
    return _orient_and_scale_projection(coordinates)


def _served_distance_matrix(source_similarities: np.ndarray) -> np.ndarray:
    """Convert the exact served similarity relation into UMAP distances.

    Every available map relation is symmetric: Surface and Tag cosine are
    naturally symmetric, while Hybrid is explicitly the mean of both served
    anchor directions. ``1 - similarity`` is monotone, so it preserves the
    retrieval ordering while giving UMAP one precomputed distance matrix. The
    clip only absorbs floating-point drift immediately outside cosine's
    theoretical ``[-1, 1]`` range.
    """

    similarities = np.asarray(source_similarities, dtype=np.float64)
    if similarities.ndim != 2 or similarities.shape[0] != similarities.shape[1]:
        raise ValueError("source similarity matrix must be square")
    if not np.isfinite(similarities).all():
        raise ValueError("source similarity matrix must be finite")
    if not np.allclose(similarities, similarities.T, rtol=0, atol=1e-7):
        raise ValueError("source similarity matrix must be symmetric")
    if np.any(similarities < -1.00001) or np.any(similarities > 1.00001):
        raise ValueError("source similarities must remain in cosine bounds")
    distances = np.clip(1.0 - similarities, 0.0, 2.0)
    np.fill_diagonal(distances, 0.0)
    return np.asarray(distances, dtype=np.float32)


def _effective_umap_neighbors(rows: int) -> int:
    if rows < 3:
        return 0
    return min(SEMANTIC_MAP_NEIGHBOR_COUNT, rows - 1)


def _umap_projection(source_similarities: np.ndarray) -> np.ndarray:
    """Run deterministic UMAP over the exact served-distance relation."""

    distances = _served_distance_matrix(source_similarities)
    rows = len(distances)
    if rows == 0:
        return np.zeros((0, 2), dtype=np.float32)
    if rows == 1:
        return np.zeros((1, 2), dtype=np.float32)
    if rows == 2:
        separation = float(distances[0, 1])
        if separation <= 1e-12:
            return np.zeros((2, 2), dtype=np.float32)
        return _orient_and_scale_projection(
            np.asarray(
                [[-separation / 2.0, 0.0], [separation / 2.0, 0.0]],
                dtype=np.float64,
            )
        )

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="using precomputed metric; inverse_transform will be unavailable",
            category=UserWarning,
        )
        raw_coordinates = UMAP(
            n_neighbors=_effective_umap_neighbors(rows),
            n_components=2,
            metric="precomputed",
            output_metric="euclidean",
            n_epochs=SEMANTIC_MAP_EPOCHS,
            learning_rate=1.0,
            init="random",
            min_dist=SEMANTIC_MAP_MIN_DIST,
            spread=SEMANTIC_MAP_SPREAD,
            low_memory=True,
            n_jobs=1,
            set_op_mix_ratio=1.0,
            local_connectivity=1.0,
            repulsion_strength=1.0,
            negative_sample_rate=5,
            random_state=SEMANTIC_MAP_RANDOM_SEED,
            transform_seed=SEMANTIC_MAP_RANDOM_SEED,
            verbose=False,
        ).fit_transform(distances)
    coordinates = np.asarray(raw_coordinates, dtype=np.float64)
    if coordinates.shape != (rows, 2) or not np.isfinite(coordinates).all():
        raise SemanticArtifactError("UMAP returned invalid projection coordinates")
    return _orient_and_scale_projection(coordinates)


def _neighbor_overlap_at_k(
    source_similarities: np.ndarray,
    coordinates: np.ndarray,
    *,
    k: int = 10,
    anchor_indices: np.ndarray | None = None,
) -> float:
    """Compare sampled anchors against every mapped candidate in both spaces."""

    rows = len(source_similarities)
    if rows <= 1:
        return 1.0
    if source_similarities.shape != (rows, rows):
        raise ValueError("source similarity matrix must be square")
    if coordinates.shape != (rows, 2):
        raise ValueError("map coordinates must cover every source candidate")
    anchors: Any = (
        np.arange(rows, dtype=np.int64)
        if anchor_indices is None
        else np.asarray(anchor_indices, dtype=np.int64)
    )
    if np.any(anchors < 0) or np.any(anchors >= rows):
        raise ValueError("anchor indices must identify source candidates")
    effective_k = min(k, rows - 1)
    source_scores: Any = np.asarray(
        source_similarities,
        dtype=np.float64,
    ).copy()
    np.fill_diagonal(source_scores, -np.inf)
    source_neighbors = np.argsort(-source_scores[anchors], axis=1, kind="stable")[
        :, :effective_k
    ]
    distances: Any = np.sum(
        (coordinates[anchors, np.newaxis, :] - coordinates[np.newaxis, :, :]) ** 2,
        axis=2,
    )
    distances[np.arange(len(anchors)), anchors] = np.inf
    map_neighbors = np.argsort(distances, axis=1, kind="stable")[:, :effective_k]
    overlap = [
        len(set(source_neighbors[row]) & set(map_neighbors[row])) / effective_k
        for row in range(len(anchors))
    ]
    return round(float(np.mean(overlap)), 6)


def _neighbor_cutoff_tie_diagnostics(
    source_similarities: np.ndarray,
    *,
    k: int = 10,
    anchor_indices: np.ndarray | None = None,
    tolerance: float = 1e-7,
) -> dict[str, float | int]:
    """Quantify when exact top-k membership depends on stable tie ordering."""

    rows = len(source_similarities)
    if source_similarities.shape != (rows, rows):
        raise ValueError("source similarity matrix must be square")
    anchors: Any = (
        np.arange(rows, dtype=np.int64)
        if anchor_indices is None
        else np.asarray(anchor_indices, dtype=np.int64)
    )
    if np.any(anchors < 0) or np.any(anchors >= rows):
        raise ValueError("anchor indices must identify source candidates")
    if rows <= 1 or len(anchors) == 0:
        return {
            "tie_at_cutoff_anchor_count": 0,
            "tie_at_cutoff_anchor_fraction": 0.0,
            "mean_cutoff_tie_candidate_count": 0.0,
            "max_cutoff_tie_candidate_count": 0,
            "similarity_tie_tolerance": tolerance,
        }

    effective_k = min(k, rows - 1)
    source_scores = np.asarray(source_similarities, dtype=np.float64).copy()
    np.fill_diagonal(source_scores, -np.inf)
    affected_tie_sizes: list[int] = []
    for anchor in anchors:
        row = source_scores[int(anchor)]
        ordered = np.sort(row)[::-1]
        cutoff = float(ordered[effective_k - 1])
        at_cutoff = np.isclose(row, cutoff, rtol=0, atol=tolerance)
        strictly_above = (row > cutoff) & ~at_cutoff
        available_tie_slots = effective_k - int(np.count_nonzero(strictly_above))
        tied_candidates = int(np.count_nonzero(at_cutoff))
        if tied_candidates > available_tie_slots:
            affected_tie_sizes.append(tied_candidates)

    affected_count = len(affected_tie_sizes)
    return {
        "tie_at_cutoff_anchor_count": affected_count,
        "tie_at_cutoff_anchor_fraction": round(affected_count / len(anchors), 6),
        "mean_cutoff_tie_candidate_count": (
            round(float(np.mean(affected_tie_sizes)), 6) if affected_tie_sizes else 0.0
        ),
        "max_cutoff_tie_candidate_count": (
            max(affected_tie_sizes) if affected_tie_sizes else 0
        ),
        "similarity_tie_tolerance": tolerance,
    }


def _semantic_map_cluster_count(item_count: int) -> int:
    return min(
        MAX_SEMANTIC_MAP_CLUSTERS,
        max(1, int(np.ceil(np.sqrt(item_count / 4.0)))),
    )


def _cluster_coordinates(
    coordinates: np.ndarray,
    items: Sequence[SemanticManifestItem],
) -> np.ndarray:
    rows = len(items)
    cluster_count = _semantic_map_cluster_count(rows)
    selected = [min(range(rows), key=lambda index: items[index].item_id)]
    centers = [np.asarray(coordinates[selected[0]], dtype=np.float64)]
    nearest: Any = np.sum((coordinates - centers[0]) ** 2, axis=1)
    while len(centers) < cluster_count:
        remaining = [index for index in range(rows) if index not in selected]
        next_index = min(
            remaining,
            key=lambda index: (-float(nearest[index]), items[index].item_id),
        )
        selected.append(next_index)
        centers.append(np.asarray(coordinates[next_index], dtype=np.float64))
        candidate_distance = np.sum(
            (coordinates - centers[-1]) ** 2,
            axis=1,
        )
        nearest = np.minimum(nearest, candidate_distance)

    center_matrix: Any = np.stack(centers)
    assignments: Any = np.zeros(rows, dtype=np.int32)
    for _ in range(40):
        distances = np.sum(
            (coordinates[:, np.newaxis, :] - center_matrix[np.newaxis, :, :]) ** 2,
            axis=2,
        )
        updated: Any = np.asarray(np.argmin(distances, axis=1), dtype=np.int32)
        if np.array_equal(updated, assignments):
            break
        assignments = updated
        for cluster_id in range(cluster_count):
            members = coordinates[assignments == cluster_id]
            if len(members):
                center_matrix[cluster_id] = np.mean(members, axis=0)

    populated = sorted(
        set(int(value) for value in assignments),
        key=lambda cluster_id: min(
            items[index].item_id
            for index in range(rows)
            if assignments[index] == cluster_id
        ),
    )
    remap = {old: new for new, old in enumerate(populated)}
    return np.asarray([remap[int(value)] for value in assignments], dtype=np.int32)


def _tag_preference(tag: str) -> tuple[int, str]:
    prefix = tag.split(":", 1)[0]
    return (
        {
            "skill": 0,
            "type": 1,
            "domain": 2,
            "representation": 3,
            "demand": 4,
        }.get(prefix, 5),
        tag,
    )


def _humanize_tag(tag: str) -> str:
    if tag == "unknown":
        return "Unclassified questions"
    value = tag.split(":", 1)[-1]
    for prefix in ("cnt_", "prc_", "rsn_", "reason_", "rep_", "demand_"):
        if value.startswith(prefix):
            value = value.removeprefix(prefix)
            break
    return value.replace("_", " ").strip().title()


def _cluster_tag_evidence(
    *,
    tag: str,
    member_count: int,
    cluster_size: int,
    global_count: int,
    population_size: int,
) -> tuple[float, SemanticMapTagEvidence]:
    """Return a discriminative label score and its auditable evidence.

    Raw frequency made broad tags such as ``rep_story_text`` label many
    unrelated clusters.  Add-half smoothing keeps small clusters stable while
    lift identifies tags that are unusually concentrated in this neighborhood.
    The score still rewards meaningful coverage and support, so a one-item
    curiosity cannot become the map label.
    """

    coverage = member_count / cluster_size
    global_coverage = global_count / population_size
    smoothed_coverage = (member_count + 0.5) / (cluster_size + 1)
    smoothed_global = (global_count + 0.5) / (population_size + 1)
    lift = smoothed_coverage / smoothed_global
    facet = tag.split(":", 1)[0]
    facet_weight = {
        "skill": 1.18,
        "type": 1.10,
        "domain": 1.02,
        "representation": 0.92,
        "demand": 0.86,
    }.get(facet, 0.75)
    score = (
        math.log2(max(lift, 1.0)) * coverage * math.sqrt(member_count) * facet_weight
    )
    return score, SemanticMapTagEvidence(
        tag=tag,
        member_count=member_count,
        coverage=round(coverage, 6),
        global_coverage=round(global_coverage, 6),
        lift=round(lift, 6),
    )


def _cluster_label(
    ordered_evidence: Sequence[tuple[float, SemanticMapTagEvidence]],
) -> tuple[str, str]:
    """Choose one or two non-redundant, human-readable cluster descriptors."""

    generic_tags = {
        "domain:mixed",
        "type:mixed",
        "representation:rep_mixed",
    }
    useful = [
        (score, evidence)
        for score, evidence in ordered_evidence
        if score > 1e-12 and evidence.tag not in generic_tags
    ]
    if not useful:
        return "Mixed neighborhood", "unknown"

    # Prefer a curriculum-bearing facet for the primary phrase when it carries
    # a substantial part of the strongest available evidence.  This prevents a
    # generic representation or demand tag from hiding a useful skill label.
    best_score = useful[0][0]
    curriculum_facets = {"skill", "type", "domain"}
    primary = next(
        (
            entry
            for entry in useful
            if entry[1].tag.split(":", 1)[0] in curriculum_facets
            and entry[0] >= best_score * 0.35
        ),
        useful[0],
    )
    selected = [primary]
    primary_facet = primary[1].tag.split(":", 1)[0]
    primary_words = set(_humanize_tag(primary[1].tag).lower().split())
    for entry in useful:
        if entry == primary or entry[0] < primary[0] * 0.22:
            continue
        facet = entry[1].tag.split(":", 1)[0]
        words = set(_humanize_tag(entry[1].tag).lower().split())
        overlap = len(primary_words & words) / max(
            1, min(len(primary_words), len(words))
        )
        if facet != primary_facet and overlap < 0.6:
            selected.append(entry)
            break

    tags = [entry[1].tag for entry in selected]
    return " · ".join(_humanize_tag(tag) for tag in tags), tags[0]


def _projection_clusters(
    items: Sequence[SemanticManifestItem],
    cluster_ids: np.ndarray,
) -> tuple[SemanticMapCluster, ...]:
    clusters: list[SemanticMapCluster] = []
    global_counts: dict[str, int] = {}
    for item in items:
        for tag in item.tags:
            global_counts[tag] = global_counts.get(tag, 0) + 1
    for cluster_id in range(int(np.max(cluster_ids)) + 1):
        members = [
            item
            for item, assigned in zip(items, cluster_ids, strict=True)
            if int(assigned) == cluster_id
        ]
        counts: dict[str, int] = {}
        for item in members:
            for tag in item.tags:
                counts[tag] = counts.get(tag, 0) + 1
        minimum_support = max(2, math.ceil(len(members) * 0.04))
        evidence_with_scores = [
            _cluster_tag_evidence(
                tag=tag,
                member_count=count,
                cluster_size=len(members),
                global_count=global_counts[tag],
                population_size=len(items),
            )
            for tag, count in counts.items()
            if count >= minimum_support
        ]
        evidence_with_scores.sort(
            key=lambda entry: (
                -entry[0],
                *_tag_preference(entry[1].tag),
            )
        )
        label, label_tag = _cluster_label(evidence_with_scores)
        clusters.append(
            SemanticMapCluster(
                cluster_id=cluster_id,
                label=label,
                label_tag=label_tag,
                member_count=len(members),
                dominant_tags=tuple(
                    evidence for _, evidence in evidence_with_scores[:5]
                ),
            )
        )
    return tuple(clusters)


def _build_semantic_map(
    *,
    items: Sequence[SemanticManifestItem],
    source_similarities: np.ndarray,
    mapped: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, tuple[SemanticMapCluster, ...]]:
    if mapped.shape != (len(items),):
        raise ValueError("semantic map mask must cover all items")
    if source_similarities.shape != (len(items), len(items)):
        raise ValueError("semantic map similarity matrix must cover all items")
    coordinates = np.zeros((len(items), 2), dtype=np.float32)
    cluster_ids = np.full(len(items), -1, dtype=np.int32)
    if not np.any(mapped):
        return coordinates, cluster_ids, ()
    mapped_items = tuple(
        item for item, included in zip(items, mapped, strict=True) if bool(included)
    )
    mapped_coordinates = _umap_projection(source_similarities[np.ix_(mapped, mapped)])
    mapped_cluster_ids = _cluster_coordinates(mapped_coordinates, mapped_items)
    coordinates[mapped] = mapped_coordinates
    cluster_ids[mapped] = mapped_cluster_ids
    return (
        coordinates,
        cluster_ids,
        _projection_clusters(mapped_items, mapped_cluster_ids),
    )


def _projection_vectors_for_view(
    view: RetrievalView,
    *,
    surface_vectors: np.ndarray,
    tag_vectors: np.ndarray,
    config: SemanticIndexConfig,
) -> np.ndarray:
    return _projection_inputs_for_view(
        view,
        surface_vectors=surface_vectors,
        tag_vectors=tag_vectors,
        config=config,
    )[0]


def _projection_sha256(
    coordinates: np.ndarray,
    cluster_ids: np.ndarray,
    clusters: Sequence[SemanticMapCluster],
) -> str:
    digest = hashlib.sha256()
    for label, values, dtype in (
        ("coordinates", coordinates, np.float32),
        ("cluster_ids", cluster_ids, np.int32),
    ):
        canonical: Any = np.ascontiguousarray(values, dtype=dtype)
        digest.update(label.encode("ascii"))
        digest.update(_canonical_json(list(canonical.shape)).encode("ascii"))
        digest.update(canonical.tobytes(order="C"))
    digest.update(
        _canonical_json(
            [cluster.model_dump(mode="json") for cluster in clusters]
        ).encode("utf-8")
    )
    return digest.hexdigest()


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
        surface_idf: np.ndarray,
        surface_components: np.ndarray,
        surface_feature_digests: np.ndarray,
        surface_feature_document_frequencies: np.ndarray,
        projection_coordinates: dict[RetrievalView, np.ndarray],
        projection_cluster_ids: dict[RetrievalView, np.ndarray],
        projection_clusters: dict[RetrievalView, tuple[SemanticMapCluster, ...]],
    ) -> None:
        self.ontology_version = ontology_version
        self.classifier_version = classifier_version
        self.config = config
        self.items = items
        self.tag_vocabulary = tag_vocabulary
        self.surface_vectors = np.asarray(surface_vectors, dtype=np.float32)
        self.tag_vectors = np.asarray(tag_vectors, dtype=np.float32)
        self.surface_idf = np.asarray(surface_idf, dtype=np.float32)
        self.surface_components = np.asarray(surface_components, dtype=np.float32)
        self.surface_feature_digests = np.asarray(
            surface_feature_digests,
            dtype=np.uint64,
        )
        self.surface_feature_document_frequencies = np.asarray(
            surface_feature_document_frequencies,
            dtype=np.uint32,
        )
        self.projection_coordinates = {
            view: np.asarray(values, dtype=np.float32)
            for view, values in projection_coordinates.items()
        }
        self.projection_cluster_ids = {
            view: np.asarray(values, dtype=np.int32)
            for view, values in projection_cluster_ids.items()
        }
        self.projection_clusters = dict(projection_clusters)
        self._projection_quality_cache: dict[
            RetrievalView, dict[str, float | int | str]
        ] = {}
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
            surface_idf=self.surface_idf,
            surface_components=self.surface_components,
            surface_feature_digests=self.surface_feature_digests,
            surface_feature_document_frequencies=(
                self.surface_feature_document_frequencies
            ),
            projection_coordinates=self.projection_coordinates,
            projection_cluster_ids=self.projection_cluster_ids,
            projection_clusters=self.projection_clusters,
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
        tfidf, surface_idf = _surface_matrix(document_list, config)
        surface_vectors, surface_components = _randomized_lsa(tfidf, config)
        (
            surface_feature_digests,
            surface_feature_document_frequencies,
        ) = _surface_feature_support(document_list)
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
        projection_coordinates: dict[RetrievalView, np.ndarray] = {}
        projection_cluster_ids: dict[RetrievalView, np.ndarray] = {}
        projection_clusters: dict[RetrievalView, tuple[SemanticMapCluster, ...]] = {}
        for view in (
            RetrievalView.SURFACE,
            RetrievalView.TAG,
            RetrievalView.HYBRID,
        ):
            (
                _,
                source_similarities,
                mapped,
                _,
            ) = _projection_inputs_for_view(
                view,
                surface_vectors=surface_vectors,
                tag_vectors=tag_vectors,
                config=config,
            )
            coordinates, cluster_ids, clusters = _build_semantic_map(
                items=items,
                source_similarities=source_similarities,
                mapped=mapped,
            )
            projection_coordinates[view] = coordinates
            projection_cluster_ids[view] = cluster_ids
            projection_clusters[view] = clusters
        return cls(
            ontology_version=ontology_version,
            classifier_version=classifier_version,
            config=config,
            items=items,
            tag_vocabulary=tags,
            surface_vectors=surface_vectors,
            tag_vectors=tag_vectors,
            surface_idf=surface_idf,
            surface_components=surface_components,
            surface_feature_digests=surface_feature_digests,
            surface_feature_document_frequencies=(surface_feature_document_frequencies),
            projection_coordinates=projection_coordinates,
            projection_cluster_ids=projection_cluster_ids,
            projection_clusters=projection_clusters,
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
        if self.surface_idf.shape != (self.config.feature_count,):
            raise SemanticArtifactError("surface IDF shape does not match config")
        if self.surface_components.shape != (
            self.config.feature_count,
            self.surface_vectors.shape[1],
        ):
            raise SemanticArtifactError(
                "surface transform shape does not match vectors and config"
            )
        if (
            self.surface_feature_digests.ndim != 1
            or self.surface_feature_document_frequencies.shape
            != self.surface_feature_digests.shape
            or len(self.surface_feature_digests) == 0
        ):
            raise SemanticArtifactError(
                "surface feature support arrays have invalid dimensions"
            )
        if np.any(
            self.surface_feature_digests[1:] <= self.surface_feature_digests[:-1]
        ):
            raise SemanticArtifactError(
                "surface feature support digests must be sorted and unique"
            )
        if np.any(self.surface_feature_document_frequencies < 1) or np.any(
            self.surface_feature_document_frequencies > expected_rows
        ):
            raise SemanticArtifactError(
                "surface feature support frequencies are outside the corpus"
            )
        for label, values in (
            ("surface", self.surface_vectors),
            ("tag", self.tag_vectors),
            ("surface IDF", self.surface_idf),
            ("surface components", self.surface_components),
        ):
            if not np.isfinite(values).all():
                raise SemanticArtifactError(
                    f"{label} vectors contain non-finite values"
                )
            if label not in {"surface", "tag"}:
                continue
            norms = np.linalg.norm(values, axis=1)
            normalized_or_empty = np.isclose(norms, 0, atol=1e-5) | np.isclose(
                norms, 1, atol=1e-5
            )
            if not np.all(normalized_or_empty):
                raise SemanticArtifactError(f"{label} vectors are not row-normalized")
        expected_views = {
            RetrievalView.SURFACE,
            RetrievalView.TAG,
            RetrievalView.HYBRID,
        }
        if (
            set(self.projection_coordinates) != expected_views
            or set(self.projection_cluster_ids) != expected_views
            or set(self.projection_clusters) != expected_views
        ):
            raise SemanticArtifactError(
                "semantic map must contain surface, tag, and hybrid projections"
            )
        for view in sorted(expected_views, key=lambda value: value.value):
            coordinates = self.projection_coordinates[view]
            cluster_ids = self.projection_cluster_ids[view]
            clusters = self.projection_clusters[view]
            if coordinates.shape != (expected_rows, 2):
                raise SemanticArtifactError(
                    f"{view.value} projection coordinates have an invalid shape"
                )
            if not np.isfinite(coordinates).all():
                raise SemanticArtifactError(
                    f"{view.value} projection contains non-finite coordinates"
                )
            if cluster_ids.shape != (expected_rows,):
                raise SemanticArtifactError(
                    f"{view.value} projection cluster IDs have an invalid shape"
                )
            if np.any(cluster_ids < -1) or np.any(cluster_ids >= len(clusters)):
                raise SemanticArtifactError(
                    f"{view.value} projection contains an invalid cluster ID"
                )
            mapped_count = int(np.count_nonzero(cluster_ids >= 0))
            if sum(cluster.member_count for cluster in clusters) != mapped_count:
                raise SemanticArtifactError(
                    f"{view.value} projection cluster evidence has invalid counts"
                )

    def _query_components(self, position: int) -> tuple[np.ndarray, np.ndarray]:
        surface = self.surface_vectors @ self.surface_vectors[position]
        tag = self.tag_vectors @ self.tag_vectors[position]
        return surface, tag

    def map_projection(
        self,
        view: RetrievalView | str,
    ) -> tuple[np.ndarray, np.ndarray, tuple[SemanticMapCluster, ...]]:
        try:
            resolved = RetrievalView(view)
        except ValueError as error:
            raise ValueError(f"unsupported retrieval view {view!r}") from error
        if resolved is RetrievalView.STRATEGY:
            raise StrategyViewUnavailableError(
                "strategy projection is unavailable until reviewed solution paths exist"
            )
        return (
            self.projection_coordinates[resolved],
            self.projection_cluster_ids[resolved],
            self.projection_clusters[resolved],
        )

    def map_projection_metadata(
        self,
        view: RetrievalView | str,
    ) -> dict[str, Any]:
        resolved = RetrievalView(view)
        if resolved is RetrievalView.STRATEGY:
            raise StrategyViewUnavailableError(
                "strategy projection is unavailable until reviewed solution paths exist"
            )
        mapped_count = int(np.count_nonzero(self.projection_cluster_ids[resolved] >= 0))
        parameters = SemanticMapProjectionParameters(
            implementation_version=SEMANTIC_MAP_IMPLEMENTATION_VERSION
        ).model_dump(mode="json")
        parameters["effective_neighbors"] = _effective_umap_neighbors(mapped_count)
        parameters["used_small_sample_fallback"] = 0 < mapped_count < 3
        return {
            "algorithm_version": SEMANTIC_MAP_PROJECTION_VERSION,
            "method": (
                "UMAP over a precomputed distance matrix derived monotonically "
                "from the exact served similarity relation"
            ),
            "source_similarity_metric": _source_similarity_metric(resolved),
            "parameters": parameters,
        }

    def map_quality(
        self,
        view: RetrievalView | str,
    ) -> dict[str, float | int | str]:
        resolved = RetrievalView(view)
        if resolved is RetrievalView.STRATEGY:
            raise StrategyViewUnavailableError(
                "strategy projection is unavailable until reviewed solution paths exist"
            )
        cached = self._projection_quality_cache.get(resolved)
        if cached is not None:
            return dict(cached)
        vectors, similarities, mapped, source_metric = _projection_inputs_for_view(
            resolved,
            surface_vectors=self.surface_vectors,
            tag_vectors=self.tag_vectors,
            config=self.config,
        )
        artifact_mapped = self.projection_cluster_ids[resolved] >= 0
        if not np.array_equal(mapped, artifact_mapped):
            raise SemanticArtifactError(
                f"{resolved.value} projection mapping mask changed"
            )
        mapped_values: Any = np.flatnonzero(mapped)
        mapped_positions = [int(value) for value in mapped_values.tolist()]
        candidate_count = len(mapped_positions)
        duplicate_group_counts: dict[str, int] = {}
        for position in mapped_positions:
            group_id = self.items[int(position)].exact_duplicate_group_id
            if group_id is not None:
                duplicate_group_counts[group_id] = (
                    duplicate_group_counts.get(group_id, 0) + 1
                )
        repeated_duplicate_groups = {
            group_id: count
            for group_id, count in duplicate_group_counts.items()
            if count > 1
        }
        duplicate_candidate_count = sum(repeated_duplicate_groups.values())
        duplicate_caveat = (
            "Exact-duplicate candidates are included and can inflate kNN overlap."
            if duplicate_candidate_count
            else "No mapped exact-duplicate groups are present."
        )
        if candidate_count > 400:
            anchor_indices = np.linspace(
                0,
                candidate_count - 1,
                num=400,
                dtype=np.int64,
            )
        else:
            anchor_indices = np.arange(candidate_count, dtype=np.int64)
        if candidate_count == 0:
            empty_quality: dict[str, float | int | str] = {
                "sample_size": 0,
                "candidate_count": 0,
                "exact_duplicate_group_count": 0,
                "exact_duplicate_candidate_count": 0,
                "tie_at_cutoff_anchor_count": 0,
                "tie_at_cutoff_anchor_fraction": 0.0,
                "mean_cutoff_tie_candidate_count": 0.0,
                "max_cutoff_tie_candidate_count": 0,
                "similarity_tie_tolerance": 1e-7,
                "neighbor_k": 0,
                "knn_overlap": 0.0,
                "pca_knn_overlap": 0.0,
                "knn_overlap_improvement": 0.0,
                "source_metric": source_metric,
                "input_distance_version": SEMANTIC_MAP_DISTANCE_VERSION,
                "projection_method": SEMANTIC_MAP_PROJECTION_VERSION,
                "projection_implementation": SEMANTIC_MAP_IMPLEMENTATION,
                "projection_implementation_version": (
                    SEMANTIC_MAP_IMPLEMENTATION_VERSION
                ),
                "configured_neighbors": SEMANTIC_MAP_NEIGHBOR_COUNT,
                "effective_neighbors": 0,
                "baseline_method": "full-data-pca.v1",
                "quality_caveat": duplicate_caveat,
            }
            self._projection_quality_cache[resolved] = empty_quality
            return dict(empty_quality)
        mapped_vectors = vectors[mapped]
        mapped_similarities = similarities[np.ix_(mapped, mapped)]
        tie_diagnostics = _neighbor_cutoff_tie_diagnostics(
            mapped_similarities,
            anchor_indices=anchor_indices,
        )
        tie_affected_count = int(tie_diagnostics["tie_at_cutoff_anchor_count"])
        tie_fraction = float(tie_diagnostics["tie_at_cutoff_anchor_fraction"])
        tie_caveat = (
            "Similarity ties cross the k-neighbor cutoff for "
            f"{tie_affected_count} of {len(anchor_indices)} sampled anchors "
            f"({tie_fraction:.1%}; mean "
            f"{float(tie_diagnostics['mean_cutoff_tie_candidate_count']):.1f} "
            "candidates in each affected cutoff tie). Exact kNN overlap is "
            "stable-index-order dependent."
            if tie_affected_count
            else "No similarity ties cross the sampled k-neighbor cutoffs."
        )
        quality_caveat = f"{duplicate_caveat} {tie_caveat}"
        final_coordinates = self.projection_coordinates[resolved][mapped]
        pca_coordinates = _pca_projection(mapped_vectors)
        knn_overlap = _neighbor_overlap_at_k(
            mapped_similarities,
            final_coordinates,
            anchor_indices=anchor_indices,
        )
        pca_knn_overlap = _neighbor_overlap_at_k(
            mapped_similarities,
            pca_coordinates,
            anchor_indices=anchor_indices,
        )
        quality: dict[str, float | int | str] = {
            "sample_size": int(len(anchor_indices)),
            "candidate_count": int(candidate_count),
            "exact_duplicate_group_count": len(repeated_duplicate_groups),
            "exact_duplicate_candidate_count": duplicate_candidate_count,
            **tie_diagnostics,
            "neighbor_k": min(10, max(0, candidate_count - 1)),
            "knn_overlap": knn_overlap,
            "pca_knn_overlap": pca_knn_overlap,
            "knn_overlap_improvement": round(knn_overlap - pca_knn_overlap, 6),
            "source_metric": source_metric,
            "input_distance_version": SEMANTIC_MAP_DISTANCE_VERSION,
            "projection_method": SEMANTIC_MAP_PROJECTION_VERSION,
            "projection_implementation": SEMANTIC_MAP_IMPLEMENTATION,
            "projection_implementation_version": SEMANTIC_MAP_IMPLEMENTATION_VERSION,
            "configured_neighbors": SEMANTIC_MAP_NEIGHBOR_COUNT,
            "effective_neighbors": _effective_umap_neighbors(candidate_count),
            "baseline_method": "full-data-pca.v1",
            "quality_caveat": quality_caveat,
        }
        self._projection_quality_cache[resolved] = quality
        return dict(quality)

    def _query_has_corpus_evidence(self, normalized: str) -> tuple[bool, str | None]:
        query_features = tuple(sorted(set(_features(normalized))))
        supported: list[tuple[str, int]] = []
        for feature in query_features:
            digest = np.uint64(_feature_support_digest(feature))
            position = int(np.searchsorted(self.surface_feature_digests, digest))
            if (
                position < len(self.surface_feature_digests)
                and self.surface_feature_digests[position] == digest
            ):
                supported.append(
                    (
                        feature,
                        int(self.surface_feature_document_frequencies[position]),
                    )
                )
        if not supported:
            return False, TEXT_QUERY_NO_CORPUS_EVIDENCE

        # Terms present throughout the catalogue (for example, question
        # boilerplate) do not justify a confident semantic ranking.  A floor of
        # two documents keeps this decision stable for small QA fixtures.
        common_cutoff = max(2, math.ceil(len(self.items) * 0.35))
        informative = [
            feature
            for feature, document_frequency in supported
            if document_frequency <= common_cutoff
        ]
        informative_unigrams = [
            feature for feature in informative if feature.startswith("u:")
        ]
        if len(informative) < 2 or not informative_unigrams:
            return False, TEXT_QUERY_LOW_EVIDENCE
        return True, None

    def _embed_surface_text(
        self,
        text: str,
    ) -> tuple[np.ndarray | None, tuple[str, ...]]:
        normalized = " ".join(text.split())
        if not normalized:
            raise RetrievalViewUnavailableError("pasted-text query cannot be empty")
        if len(normalized) > 20_000:
            raise ValueError("pasted-text query cannot exceed 20,000 characters")
        tokens = _tokens(normalized)
        if not tokens:
            raise RetrievalViewUnavailableError(
                "pasted-text query contains no searchable tokens"
            )
        warnings = ["TEXT_QUERY_LOW_SIGNAL"] if len(tokens) < 3 else []
        has_evidence, evidence_warning = self._query_has_corpus_evidence(normalized)
        if evidence_warning is not None:
            warnings.append(evidence_warning)
        if not has_evidence:
            return None, tuple(warnings)
        counts = np.zeros(self.config.feature_count, dtype=np.float64)
        for feature in _features(f"stem {normalized}"):
            bucket, sign = _feature_bucket(feature, self.config.feature_count)
            counts[bucket] += sign
        tf = np.sign(counts) * np.where(
            counts != 0,
            1.0 + np.log(np.maximum(np.abs(counts), 1.0)),
            0.0,
        )
        weighted = tf * self.surface_idf
        norm = float(np.linalg.norm(weighted))
        if norm <= 1e-12:
            raise RetrievalViewUnavailableError(
                "pasted-text query has no usable surface signal"
            )
        projected = (weighted / norm) @ self.surface_components
        projected_norm = float(np.linalg.norm(projected))
        if projected_norm <= 1e-12:
            raise RetrievalViewUnavailableError(
                "pasted-text query has no usable latent surface signal"
            )
        return np.asarray(projected / projected_norm, dtype=np.float32), tuple(warnings)

    def query_text(
        self,
        text: str,
        *,
        top_k: int = 10,
        view: RetrievalView | str = RetrievalView.SURFACE,
    ) -> SemanticTextQueryResult:
        """Retrieve from ephemeral pasted text without echoing or persisting it."""

        if top_k < 1:
            raise ValueError("top_k must be at least one")
        try:
            resolved_view = RetrievalView(view)
        except ValueError as error:
            raise ValueError(f"unsupported retrieval view {view!r}") from error
        if resolved_view is RetrievalView.STRATEGY:
            raise StrategyViewUnavailableError(
                "strategy retrieval is unavailable until reviewed solution paths exist"
            )
        if resolved_view is RetrievalView.TAG:
            raise RetrievalViewUnavailableError(
                "pasted text has no catalogue tag vector; use surface or hybrid"
            )
        query_vector, signal_warnings = self._embed_surface_text(text)
        warnings = list(signal_warnings)
        if resolved_view is RetrievalView.HYBRID:
            warnings.extend((TEXT_QUERY_TAG_WARNING, MISSING_STRATEGY_WARNING))
        if query_vector is None:
            return SemanticTextQueryResult(
                view=resolved_view,
                requested_top_k=top_k,
                effective_weights={"surface": 1.0},
                warnings=tuple(warnings),
                neighbors=(),
            )
        scores = self.surface_vectors @ query_vector
        candidates = sorted(
            range(len(self.items)),
            key=lambda index: (
                -float(scores[index]),
                self.items[index].item_id,
                self.items[index].content_version,
                index,
            ),
        )
        neighbors = tuple(
            SemanticNeighbor(
                rank=rank,
                item_id=self.items[index].item_id,
                content_version=self.items[index].content_version,
                score=round(float(scores[index]), 8),
                components=ComponentSimilarities(
                    surface=round(float(scores[index]), 8),
                    tag=None,
                ),
                shared_tags=(),
                same_family=None,
                same_exact_duplicate_group=None,
            )
            for rank, index in enumerate(candidates[:top_k], start=1)
        )
        return SemanticTextQueryResult(
            view=resolved_view,
            requested_top_k=top_k,
            effective_weights={"surface": 1.0},
            warnings=tuple(warnings),
            neighbors=neighbors,
        )

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
                persisted_arrays: dict[str, Any] = {
                    "surface_vectors": self.surface_vectors,
                    "tag_vectors": self.tag_vectors,
                    "surface_idf": self.surface_idf,
                    "surface_components": self.surface_components,
                    "surface_feature_digests": self.surface_feature_digests,
                    "surface_feature_document_frequencies": (
                        self.surface_feature_document_frequencies
                    ),
                    **{
                        f"{view.value}_projection_coordinates": (
                            self.projection_coordinates[view]
                        )
                        for view in (
                            RetrievalView.SURFACE,
                            RetrievalView.TAG,
                            RetrievalView.HYBRID,
                        )
                    },
                    **{
                        f"{view.value}_projection_cluster_ids": (
                            self.projection_cluster_ids[view]
                        )
                        for view in (
                            RetrievalView.SURFACE,
                            RetrievalView.TAG,
                            RetrievalView.HYBRID,
                        )
                    },
                }
                np.savez_compressed(target, **persisted_arrays)
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
            surface_feature_support_count=len(self.surface_feature_digests),
            tag_dimensions=self.tag_vectors.shape[1],
            projection_parameters=SemanticMapProjectionParameters(
                implementation_version=SEMANTIC_MAP_IMPLEMENTATION_VERSION
            ),
            projection_views=tuple(
                SemanticMapViewManifest(
                    view=cast(Any, view),
                    clusters=self.projection_clusters[view],
                    source_similarity_metric=_source_similarity_metric(view),
                    mapped_count=int(
                        np.count_nonzero(self.projection_cluster_ids[view] >= 0)
                    ),
                    unmapped_count=int(
                        np.count_nonzero(self.projection_cluster_ids[view] < 0)
                    ),
                    effective_neighbors=_effective_umap_neighbors(
                        int(np.count_nonzero(self.projection_cluster_ids[view] >= 0))
                    ),
                    used_small_sample_fallback=(
                        0
                        < int(np.count_nonzero(self.projection_cluster_ids[view] >= 0))
                        < 3
                    ),
                    projection_sha256=_projection_sha256(
                        self.projection_coordinates[view],
                        self.projection_cluster_ids[view],
                        self.projection_clusters[view],
                    ),
                )
                for view in (
                    RetrievalView.SURFACE,
                    RetrievalView.TAG,
                    RetrievalView.HYBRID,
                )
            ),
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
        if (
            artifact.manifest_path.absolute().parent
            != artifact.vectors_path.absolute().parent
        ):
            raise SemanticArtifactError(
                "semantic manifest and vectors must share one artifact directory"
            )
        try:
            manifest_snapshot = _read_regular_file_snapshot(
                artifact.manifest_path,
                max_bytes=MAX_SEMANTIC_MANIFEST_BYTES,
                label="semantic manifest",
            )
            manifest = SemanticArtifactManifest.model_validate_json(manifest_snapshot)
        except SemanticArtifactError:
            raise
        except (ValidationError, ValueError) as error:
            raise SemanticArtifactError("semantic manifest is invalid") from error
        if artifact.vectors_path.name != manifest.vectors_filename:
            raise SemanticArtifactError("manifest references a different vector file")
        vector_snapshot = _read_regular_file_snapshot(
            artifact.vectors_path,
            max_bytes=MAX_SEMANTIC_VECTOR_BYTES,
            label="semantic vector artifact",
        )
        if hashlib.sha256(vector_snapshot).hexdigest() != manifest.vectors_sha256:
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
            with np.load(io.BytesIO(vector_snapshot), allow_pickle=False) as arrays:
                expected_arrays = {
                    "surface_vectors",
                    "tag_vectors",
                    "surface_idf",
                    "surface_components",
                    "surface_feature_digests",
                    "surface_feature_document_frequencies",
                    *(
                        f"{view.value}_projection_coordinates"
                        for view in (
                            RetrievalView.SURFACE,
                            RetrievalView.TAG,
                            RetrievalView.HYBRID,
                        )
                    ),
                    *(
                        f"{view.value}_projection_cluster_ids"
                        for view in (
                            RetrievalView.SURFACE,
                            RetrievalView.TAG,
                            RetrievalView.HYBRID,
                        )
                    ),
                }
                if set(arrays.files) != expected_arrays:
                    raise SemanticArtifactError(
                        "semantic vector artifact has unexpected arrays"
                    )
                surface_vectors = np.asarray(
                    arrays["surface_vectors"], dtype=np.float32
                )
                tag_vectors = np.asarray(arrays["tag_vectors"], dtype=np.float32)
                surface_idf = np.asarray(arrays["surface_idf"], dtype=np.float32)
                surface_components = np.asarray(
                    arrays["surface_components"], dtype=np.float32
                )
                surface_feature_digests = np.asarray(
                    arrays["surface_feature_digests"], dtype=np.uint64
                )
                surface_feature_document_frequencies = np.asarray(
                    arrays["surface_feature_document_frequencies"],
                    dtype=np.uint32,
                )
                projection_coordinates = {
                    view: np.asarray(
                        arrays[f"{view.value}_projection_coordinates"],
                        dtype=np.float32,
                    )
                    for view in (
                        RetrievalView.SURFACE,
                        RetrievalView.TAG,
                        RetrievalView.HYBRID,
                    )
                }
                projection_cluster_ids = {
                    view: np.asarray(
                        arrays[f"{view.value}_projection_cluster_ids"],
                        dtype=np.int32,
                    )
                    for view in (
                        RetrievalView.SURFACE,
                        RetrievalView.TAG,
                        RetrievalView.HYBRID,
                    )
                }
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
        if surface_idf.shape != (manifest.config.feature_count,) or (
            surface_components.shape
            != (manifest.config.feature_count, manifest.surface_dimensions)
        ):
            raise SemanticArtifactError(
                "persisted surface query transform has invalid dimensions"
            )
        if surface_feature_digests.shape != (
            manifest.surface_feature_support_count,
        ) or surface_feature_document_frequencies.shape != (
            manifest.surface_feature_support_count,
        ):
            raise SemanticArtifactError(
                "persisted surface feature support has invalid dimensions"
            )
        if expected_documents is not None:
            expected_tag_vocabulary = tuple(
                sorted(
                    {
                        tag
                        for document in expected_documents
                        for tag in document.tag_tokens
                    }
                )
            )
            if expected_tag_vocabulary != manifest.tag_vocabulary:
                raise StaleSemanticArtifactError(
                    "semantic tag vocabulary does not match expected documents"
                )
            expected_tfidf, expected_idf = _surface_matrix(
                expected_documents, manifest.config
            )
            expected_surface, expected_components = _randomized_lsa(
                expected_tfidf, manifest.config
            )
            (
                expected_feature_digests,
                expected_feature_document_frequencies,
            ) = _surface_feature_support(expected_documents)
            expected_tags = _tag_vectors(expected_documents, manifest.tag_vocabulary)
            if (
                not np.array_equal(surface_idf, expected_idf)
                or not np.array_equal(surface_components, expected_components)
                or not np.array_equal(surface_vectors, expected_surface)
                or not np.array_equal(tag_vectors, expected_tags)
                or not np.array_equal(
                    surface_feature_digests,
                    expected_feature_digests,
                )
                or not np.array_equal(
                    surface_feature_document_frequencies,
                    expected_feature_document_frequencies,
                )
            ):
                raise StaleSemanticArtifactError(
                    "semantic vectors or query transform do not match expected documents"
                )
        projection_manifests: dict[RetrievalView, SemanticMapViewManifest] = {
            RetrievalView(value.view): value for value in manifest.projection_views
        }
        projection_clusters = {
            view: projection_manifests[view].clusters
            for view in (
                RetrievalView.SURFACE,
                RetrievalView.TAG,
                RetrievalView.HYBRID,
            )
        }
        for view in (
            RetrievalView.SURFACE,
            RetrievalView.TAG,
            RetrievalView.HYBRID,
        ):
            projection_manifest = projection_manifests[view]
            mapped_count = int(np.count_nonzero(projection_cluster_ids[view] >= 0))
            if (
                projection_manifest.source_similarity_metric
                != _source_similarity_metric(view)
                or projection_manifest.mapped_count != mapped_count
                or projection_manifest.effective_neighbors
                != _effective_umap_neighbors(mapped_count)
                or projection_manifest.used_small_sample_fallback
                != (0 < mapped_count < 3)
            ):
                raise SemanticArtifactError(
                    f"{view.value} semantic projection metadata changed"
                )
            if (
                _projection_sha256(
                    projection_coordinates[view],
                    projection_cluster_ids[view],
                    projection_clusters[view],
                )
                != projection_manifest.projection_sha256
            ):
                raise SemanticArtifactError(
                    f"{view.value} semantic projection checksum changed"
                )
            (
                _,
                source_similarities,
                mapped,
                _,
            ) = _projection_inputs_for_view(
                view,
                surface_vectors=surface_vectors,
                tag_vectors=tag_vectors,
                config=manifest.config,
            )
            (
                expected_coordinates,
                expected_cluster_ids,
                expected_clusters,
            ) = _build_semantic_map(
                items=manifest.ordered_items,
                source_similarities=source_similarities,
                mapped=mapped,
            )
            if (
                not np.array_equal(projection_coordinates[view], expected_coordinates)
                or not np.array_equal(
                    projection_cluster_ids[view], expected_cluster_ids
                )
                or projection_clusters[view] != expected_clusters
            ):
                raise SemanticArtifactError(
                    f"{view.value} semantic projection does not match indexed vectors"
                )
        return cls(
            ontology_version=manifest.ontology_version,
            classifier_version=manifest.classifier_version,
            config=manifest.config,
            items=manifest.ordered_items,
            tag_vocabulary=manifest.tag_vocabulary,
            surface_vectors=surface_vectors,
            tag_vectors=tag_vectors,
            surface_idf=surface_idf,
            surface_components=surface_components,
            surface_feature_digests=surface_feature_digests,
            surface_feature_document_frequencies=(surface_feature_document_frequencies),
            projection_coordinates=projection_coordinates,
            projection_cluster_ids=projection_cluster_ids,
            projection_clusters=projection_clusters,
        )


__all__ = [
    "DEFAULT_ARTIFACT_BASENAME",
    "MISSING_STRATEGY_WARNING",
    "SEMANTIC_DOCUMENT_SCHEMA_VERSION",
    "SEMANTIC_INDEX_ALGORITHM_VERSION",
    "SEMANTIC_INDEX_CONFIG_VERSION",
    "SEMANTIC_INDEX_MANIFEST_VERSION",
    "SEMANTIC_MAP_CLUSTER_LABEL_VERSION",
    "SEMANTIC_MAP_DISTANCE_VERSION",
    "SEMANTIC_MAP_HYBRID_METRIC",
    "SEMANTIC_MAP_IMPLEMENTATION",
    "SEMANTIC_MAP_IMPLEMENTATION_VERSION",
    "SEMANTIC_MAP_PROJECTION_VERSION",
    "TEXT_QUERY_LOW_EVIDENCE",
    "TEXT_QUERY_NO_CORPUS_EVIDENCE",
    "TEXT_QUERY_TAG_WARNING",
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
    "SemanticMapCluster",
    "SemanticMapProjectionParameters",
    "SemanticMapTagEvidence",
    "SemanticMapViewManifest",
    "SemanticNeighbor",
    "SemanticQueryResult",
    "SemanticTextQueryResult",
    "StaleSemanticArtifactError",
    "StrategyViewUnavailableError",
]
