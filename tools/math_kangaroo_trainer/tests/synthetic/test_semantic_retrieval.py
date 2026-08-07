from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from math_kangaroo_trainer.retrieval import (
    MISSING_STRATEGY_WARNING,
    SEMANTIC_MAP_HYBRID_METRIC,
    TEXT_QUERY_LOW_EVIDENCE,
    TEXT_QUERY_NO_CORPUS_EVIDENCE,
    TEXT_QUERY_TAG_WARNING,
    RetrievalView,
    RetrievalViewUnavailableError,
    SemanticArtifactError,
    SemanticArtifactManifest,
    SemanticDocument,
    SemanticIndex,
    SemanticIndexConfig,
    StaleSemanticArtifactError,
    StrategyViewUnavailableError,
)
from math_kangaroo_trainer.retrieval import semantic as semantic_module
from math_kangaroo_trainer.retrieval.semantic import (
    SemanticManifestItem,
    _feature_bucket,
    _neighbor_overlap_at_k,
    _pca_projection,
    _projection_clusters,
    _projection_inputs_for_view,
)


ONTOLOGY_VERSION = "invented-ontology.v1"
CLASSIFIER_VERSION = "invented-classifier.v1"
CONFIG = SemanticIndexConfig(
    feature_count=512,
    lsa_dimensions=5,
    oversample_dimensions=2,
    power_iterations=1,
    random_seed=20260805,
    surface_weight=0.5,
    tag_weight=0.3,
    strategy_weight=0.2,
)


def semantic_document(
    item_id: str,
    stem: str,
    *,
    choices: tuple[str, ...] = ("8", "9", "10", "11", "12"),
    domain: str,
    question_type: str,
    skills: tuple[str, ...],
    representations: tuple[str, ...],
    demand: str | None,
    family_id: str | None = None,
    duplicate_group_id: str | None = None,
) -> SemanticDocument:
    content = json.dumps(
        {"stem": stem, "choices": choices},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    content_version = "sha256:" + hashlib.sha256(content.encode()).hexdigest()
    return SemanticDocument(
        item_id=item_id,
        content_version=content_version,
        stem=stem,
        choices=choices,
        primary_domain=domain,
        question_type=question_type,
        skill_ids=tuple(sorted(skills)),
        representation_tags=tuple(sorted(representations)),
        cognitive_demand_tag=demand,
        family_id=family_id,
        exact_duplicate_group_id=duplicate_group_id,
    )


@pytest.fixture(scope="module")
def documents() -> tuple[SemanticDocument, ...]:
    apple_stem = (
        "Mia has twelve red apples and gives two red apples away. How many remain?"
    )
    return (
        semantic_document(
            "apple-query",
            apple_stem,
            domain="number_arithmetic",
            question_type="word_problem",
            skills=("cnt_whole_addition_subtraction",),
            representations=("rep_story_text",),
            demand="demand_direct_application",
            family_id="number-family",
            duplicate_group_id="duplicate-apples",
        ),
        semantic_document(
            "apple-surface-match",
            apple_stem,
            domain="geometry_spatial",
            question_type="spatial_visual",
            skills=("cnt_geometric_transformations",),
            representations=("rep_spatial_transformation",),
            demand="demand_novel_transfer",
            family_id="visual-family",
            duplicate_group_id="duplicate-apples",
        ),
        semantic_document(
            "arithmetic-tag-match",
            "Evaluate the expression shown in the box.",
            choices=("7", "8", "9", "10", "11"),
            domain="number_arithmetic",
            question_type="word_problem",
            skills=("cnt_whole_addition_subtraction",),
            representations=("rep_story_text",),
            demand="demand_direct_application",
            family_id="number-family",
        ),
        semantic_document(
            "cube-net",
            "Which cube can be made by folding the pictured net?",
            domain="geometry_spatial",
            question_type="spatial_visual",
            skills=("cnt_geometric_transformations",),
            representations=("rep_solid_diagram_3d",),
            demand="demand_multi_step_integration",
        ),
        semantic_document(
            "clock-time",
            "A train leaves at 9:15 and arrives 45 minutes later. What time is it?",
            domain="measurement_time",
            question_type="word_problem",
            skills=("cnt_time_calendar", "prc_elapsed_time"),
            representations=("rep_clock_or_calendar",),
            demand="demand_one_step_inference",
        ),
        semantic_document(
            "shape-pattern",
            "Circle, square, circle, square: which shape comes next?",
            domain="patterns_algebra",
            question_type="pattern_sequence",
            skills=("cnt_repeating_patterns",),
            representations=("rep_physical_arrangement",),
            demand="demand_one_step_inference",
        ),
    )


@pytest.fixture(scope="module")
def index(documents: tuple[SemanticDocument, ...]) -> SemanticIndex:
    return SemanticIndex.build(
        documents,
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=CONFIG,
    )


def test_build_and_rankings_are_deterministic(
    documents: tuple[SemanticDocument, ...], index: SemanticIndex
) -> None:
    rebuilt = SemanticIndex.build(
        documents,
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=CONFIG,
    )

    np.testing.assert_array_equal(index.surface_vectors, rebuilt.surface_vectors)
    np.testing.assert_array_equal(index.tag_vectors, rebuilt.tag_vectors)
    for view in (RetrievalView.SURFACE, RetrievalView.TAG, RetrievalView.HYBRID):
        coordinates, cluster_ids, clusters = index.map_projection(view)
        (
            rebuilt_coordinates,
            rebuilt_cluster_ids,
            rebuilt_clusters,
        ) = rebuilt.map_projection(view)
        np.testing.assert_array_equal(coordinates, rebuilt_coordinates)
        np.testing.assert_array_equal(cluster_ids, rebuilt_cluster_ids)
        assert clusters == rebuilt_clusters
    assert index.query("apple-query", top_k=5).model_dump(mode="json") == (
        rebuilt.query("apple-query", top_k=5).model_dump(mode="json")
    )
    assert index.identity_sha256 == rebuilt.identity_sha256


def test_map_has_distinct_exploratory_views_and_quality_baseline(
    index: SemanticIndex,
) -> None:
    surface_coordinates, _, surface_clusters = index.map_projection("surface")
    tag_coordinates, _, tag_clusters = index.map_projection("tag")
    hybrid_coordinates, _, hybrid_clusters = index.map_projection("hybrid")

    assert surface_coordinates.shape == (len(index.items), 2)
    assert not np.array_equal(surface_coordinates, tag_coordinates)
    assert not np.array_equal(surface_coordinates, hybrid_coordinates)
    assert surface_clusters and tag_clusters and hybrid_clusters
    assert all(cluster.authoritative is False for cluster in hybrid_clusters)
    quality = index.map_quality("hybrid")
    assert quality["sample_size"] == len(index.items)
    assert quality["candidate_count"] == len(index.items)
    assert quality["exact_duplicate_group_count"] == 1
    assert quality["exact_duplicate_candidate_count"] == 2
    assert "inflate" in str(quality["quality_caveat"])
    assert 0 <= float(quality["knn_overlap"]) <= 1
    assert 0 <= float(quality["pca_knn_overlap"]) <= 1


def test_map_quality_samples_anchors_against_all_candidates_and_full_pca(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    large_documents = tuple(
        semantic_document(
            f"map-quality-{value:03d}",
            (
                f"Compare constellation group {value % 23} "
                f"with sequence marker {value}."
            ),
            domain="patterns_algebra",
            question_type="pattern_sequence",
            skills=(f"cnt_pattern_{value % 7}",),
            representations=("rep_story_text",),
            demand="demand_one_step_inference",
        )
        for value in range(401)
    )
    local_index = SemanticIndex.build(
        large_documents,
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=SemanticIndexConfig(
            feature_count=128,
            lsa_dimensions=3,
            oversample_dimensions=1,
            power_iterations=0,
            random_seed=7,
            surface_weight=0.5,
            tag_weight=0.3,
            strategy_weight=0.2,
        ),
    )
    pca_rows: list[int] = []
    overlap_calls: list[tuple[tuple[int, ...], tuple[int, ...], int]] = []
    real_pca = _pca_projection
    real_overlap = _neighbor_overlap_at_k

    def recording_pca(values: np.ndarray) -> np.ndarray:
        pca_rows.append(len(values))
        return real_pca(values)

    def recording_overlap(
        source_similarities: np.ndarray,
        coordinates: np.ndarray,
        *,
        k: int = 10,
        anchor_indices: np.ndarray | None = None,
    ) -> float:
        overlap_calls.append(
            (
                source_similarities.shape,
                coordinates.shape,
                len(anchor_indices) if anchor_indices is not None else len(coordinates),
            )
        )
        return real_overlap(
            source_similarities,
            coordinates,
            k=k,
            anchor_indices=anchor_indices,
        )

    monkeypatch.setattr(semantic_module, "_pca_projection", recording_pca)
    monkeypatch.setattr(semantic_module, "_neighbor_overlap_at_k", recording_overlap)

    quality = local_index.map_quality("surface")

    assert quality["candidate_count"] == 401
    assert quality["sample_size"] == 400
    assert quality["source_metric"] == "surface-cosine-similarity.v1"
    assert quality["exact_duplicate_candidate_count"] == 0
    assert pca_rows == [401]
    assert overlap_calls == [((401, 401), (401, 2), 400)] * 2
    assert float(quality["knn_overlap_improvement"]) >= 0


def test_cluster_labels_use_corpus_relative_evidence_not_ubiquitous_tags() -> None:
    common = "representation:rep_story_text"
    distinctive = "skill:cnt_time_calendar"
    items = tuple(
        SemanticManifestItem(
            item_id=f"item-{index:02d}",
            content_version="sha256:" + (f"{index:064x}"[-64:]),
            surface_sha256=f"{index:064x}"[-64:],
            tags=(common, distinctive) if index < 4 else (common,),
        )
        for index in range(20)
    )
    clusters = _projection_clusters(
        items,
        np.asarray([0] * 10 + [1] * 10, dtype=np.int32),
    )

    assert clusters[0].label_tag == distinctive
    assert clusters[0].label.startswith("Time Calendar")
    evidence = next(
        value for value in clusters[0].dominant_tags if value.tag == distinctive
    )
    assert evidence.coverage == pytest.approx(0.4)
    assert evidence.global_coverage == pytest.approx(0.2)
    assert evidence.lift > 1
    assert all(cluster.authoritative is False for cluster in clusters)


def test_tag_projection_explicitly_leaves_tagless_items_unmapped() -> None:
    tagged = semantic_document(
        "tagged",
        "Count the pictured stars.",
        domain="number_arithmetic",
        question_type="word_problem",
        skills=("cnt_counting",),
        representations=("rep_picture",),
        demand="demand_direct_application",
    )
    tagless = semantic_document(
        "tagless",
        "An unclassified but searchable question.",
        domain="unknown",
        question_type="unknown",
        skills=(),
        representations=(),
        demand=None,
    )
    local_index = SemanticIndex.build(
        (tagged, tagless),
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=CONFIG,
    )

    coordinates, cluster_ids, _ = local_index.map_projection("tag")
    tagless_position = next(
        index
        for index, item in enumerate(local_index.items)
        if item.item_id == "tagless"
    )
    assert cluster_ids[tagless_position] == -1
    np.testing.assert_array_equal(coordinates[tagless_position], np.zeros(2))


def test_hybrid_map_symmetrizes_actual_tagged_and_tagless_retrieval() -> None:
    shared_stem = "Count the pictured stars and choose the total."
    tagged = semantic_document(
        "tagged",
        shared_stem,
        domain="number_arithmetic",
        question_type="word_problem",
        skills=("cnt_counting",),
        representations=("rep_picture",),
        demand="demand_direct_application",
    )
    tagless = semantic_document(
        "tagless",
        shared_stem,
        domain="unknown",
        question_type="unknown",
        skills=(),
        representations=(),
        demand=None,
    )
    local_index = SemanticIndex.build(
        (tagged, tagless),
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=CONFIG,
    )

    _, similarities, mapped, metric = _projection_inputs_for_view(
        RetrievalView.HYBRID,
        surface_vectors=local_index.surface_vectors,
        tag_vectors=local_index.tag_vectors,
        config=local_index.config,
    )
    tagged_to_tagless = local_index.query("tagged", top_k=1).neighbors[0].score
    tagless_to_tagged = local_index.query("tagless", top_k=1).neighbors[0].score

    assert mapped.tolist() == [True, True]
    assert metric == SEMANTIC_MAP_HYBRID_METRIC
    assert similarities[0, 1] == pytest.approx(
        (tagged_to_tagless + tagless_to_tagged) / 2,
        abs=1e-7,
    )
    assert similarities[0, 1] == similarities[1, 0]
    assert local_index.map_quality("hybrid")["source_metric"] == metric


def test_ephemeral_text_query_uses_persisted_surface_transform(
    index: SemanticIndex,
) -> None:
    result = index.query_text(
        "Mia has twelve red apples and gives two red apples away. How many remain?",
        top_k=3,
        view="hybrid",
    )

    assert result.query_kind == "pasted_text"
    assert result.effective_weights == {"surface": 1.0}
    assert TEXT_QUERY_TAG_WARNING in result.warnings
    assert MISSING_STRATEGY_WARNING in result.warnings
    assert result.neighbors[0].item_id in {"apple-query", "apple-surface-match"}
    assert all(neighbor.components.tag is None for neighbor in result.neighbors)
    serialized = json.dumps(result.model_dump(mode="json"))
    assert "Mia has twelve" not in serialized

    with pytest.raises(RetrievalViewUnavailableError, match="cannot be empty"):
        index.query_text("   ")


def test_text_query_withholds_rankings_without_exact_corpus_evidence(
    index: SemanticIndex,
) -> None:
    unrelated = index.query_text("xylophonic quasar zephyrium", top_k=3)
    low_evidence = index.query_text("apples xylophonic zephyrium", top_k=3)

    assert unrelated.neighbors == ()
    assert TEXT_QUERY_NO_CORPUS_EVIDENCE in unrelated.warnings
    assert low_evidence.neighbors == ()
    assert TEXT_QUERY_LOW_EVIDENCE in low_evidence.warnings


def test_hash_bucket_collision_cannot_fabricate_text_query_evidence(
    index: SemanticIndex,
) -> None:
    target_bucket = _feature_bucket("u:apples", CONFIG.feature_count)
    collision = next(
        token
        for value in range(100_000)
        if (
            (token := f"unseenhashcollision{value}")
            and _feature_bucket(f"u:{token}", CONFIG.feature_count) == target_bucket
        )
    )

    result = index.query_text(collision, top_k=3)

    assert _feature_bucket(f"u:{collision}", CONFIG.feature_count) == target_bucket
    assert result.neighbors == ()
    assert TEXT_QUERY_NO_CORPUS_EVIDENCE in result.warnings


def test_ubiquitous_boilerplate_is_not_confident_query_evidence() -> None:
    boilerplate_documents = tuple(
        semantic_document(
            f"boilerplate-{value}",
            f"Please choose the correct answer unique{value}.",
            domain="number_arithmetic",
            question_type="word_problem",
            skills=("cnt_counting",),
            representations=("rep_story_text",),
            demand="demand_direct_application",
        )
        for value in range(10)
    )
    local_index = SemanticIndex.build(
        boilerplate_documents,
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=CONFIG,
    )

    result = local_index.query_text("Please choose the correct answer", top_k=3)

    assert result.neighbors == ()
    assert TEXT_QUERY_LOW_EVIDENCE in result.warnings


def test_retrieval_identity_binds_weights_and_complete_index_semantics(
    documents: tuple[SemanticDocument, ...], index: SemanticIndex
) -> None:
    changed_weights = SemanticIndex.build(
        documents,
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=CONFIG.model_copy(update={"surface_weight": 0.4, "tag_weight": 0.4}),
    )

    assert changed_weights.item_versions == index.item_versions
    assert changed_weights.identity_sha256 != index.identity_sha256


def test_surface_prefers_same_content_and_excludes_self(index: SemanticIndex) -> None:
    result = index.query("apple-query", top_k=5, view=RetrievalView.SURFACE)

    assert result.neighbors[0].item_id == "apple-surface-match"
    assert result.neighbors[0].components.surface == pytest.approx(1.0)
    assert "apple-query" not in {neighbor.item_id for neighbor in result.neighbors}
    assert result.neighbors[0].score > result.neighbors[-1].score
    assert result.neighbors[0].same_exact_duplicate_group is True


def test_tag_view_can_disagree_with_surface_view(index: SemanticIndex) -> None:
    surface = index.query("apple-query", top_k=1, view=RetrievalView.SURFACE)
    tags = index.query("apple-query", top_k=1, view=RetrievalView.TAG)

    assert surface.neighbors[0].item_id == "apple-surface-match"
    assert tags.neighbors[0].item_id == "arithmetic-tag-match"
    assert tags.neighbors[0].components.tag == pytest.approx(1.0)
    assert tags.neighbors[0].same_family is True
    assert tags.neighbors[0].same_exact_duplicate_group is None
    assert tags.neighbors[0].shared_tags == index.items[0].tags


def test_hybrid_explicitly_renormalizes_around_missing_strategy(
    index: SemanticIndex,
) -> None:
    result = index.query("apple-query", top_k=2, view=RetrievalView.HYBRID)

    assert result.strategy_available is False
    assert result.warnings == (MISSING_STRATEGY_WARNING,)
    assert result.effective_weights == {"surface": 0.625, "tag": 0.375}
    assert sum(result.effective_weights.values()) == pytest.approx(1.0)
    assert all(neighbor.components.strategy is None for neighbor in result.neighbors)


def test_default_weights_match_spec_and_renormalize_available_views(
    documents: tuple[SemanticDocument, ...],
) -> None:
    config = SemanticIndexConfig()
    default_index = SemanticIndex.build(
        documents,
        ontology_version=ONTOLOGY_VERSION,
        classifier_version=CLASSIFIER_VERSION,
        config=config,
    )

    assert config.strategy_weight == pytest.approx(0.45)
    assert config.surface_weight == pytest.approx(0.25)
    assert config.tag_weight == pytest.approx(0.30)
    result = default_index.query("apple-query", view=RetrievalView.HYBRID)
    assert result.warnings == (MISSING_STRATEGY_WARNING,)
    assert result.effective_weights == {
        "surface": pytest.approx(0.25 / 0.55),
        "tag": pytest.approx(0.30 / 0.55),
    }


def test_strategy_view_is_explicitly_unavailable(index: SemanticIndex) -> None:
    assert RetrievalView.STRATEGY not in index.available_views
    with pytest.raises(StrategyViewUnavailableError, match="reviewed solution paths"):
        index.query("apple-query", view=RetrievalView.STRATEGY)


def test_save_and_load_preserve_results_and_compact_arrays(
    tmp_path: Path,
    documents: tuple[SemanticDocument, ...],
    index: SemanticIndex,
) -> None:
    artifact = index.save(tmp_path / "ignored-work")
    loaded = SemanticIndex.load(
        artifact,
        expected_documents=documents,
        expected_ontology_version=ONTOLOGY_VERSION,
        expected_classifier_version=CLASSIFIER_VERSION,
    )
    manifest = SemanticArtifactManifest.model_validate_json(
        artifact.manifest_path.read_text(encoding="utf-8")
    )

    assert loaded.query("apple-query", top_k=5).model_dump(mode="json") == (
        index.query("apple-query", top_k=5).model_dump(mode="json")
    )
    assert loaded.surface_vectors.dtype == np.float32
    assert loaded.tag_vectors.dtype == np.float32
    assert loaded.surface_vectors.shape[0] == len(documents)
    assert loaded.surface_vectors.shape[1] <= CONFIG.lsa_dimensions
    assert loaded.tag_vectors.shape == (len(documents), len(loaded.tag_vocabulary))
    assert loaded.surface_idf.shape == (CONFIG.feature_count,)
    assert loaded.surface_components.shape == (
        CONFIG.feature_count,
        loaded.surface_vectors.shape[1],
    )
    assert loaded.surface_feature_digests.dtype == np.uint64
    assert loaded.surface_feature_document_frequencies.dtype == np.uint32
    assert len(loaded.surface_feature_digests) == (
        manifest.surface_feature_support_count
    )
    assert manifest.represents_mastery_or_difficulty is False
    assert manifest.strategy_available is False
    assert manifest.ordered_items_sha256
    assert manifest.projection_is_exploratory is True
    assert [projection.view.value for projection in manifest.projection_views] == [
        "surface",
        "tag",
        "hybrid",
    ]
    with np.load(artifact.vectors_path, allow_pickle=False) as arrays:
        assert "surface_idf" in arrays.files
        assert "surface_components" in arrays.files
        assert "surface_feature_digests" in arrays.files
        assert "surface_feature_document_frequencies" in arrays.files
        assert "surface_projection_coordinates" in arrays.files
        assert "tag_projection_coordinates" in arrays.files
        assert "hybrid_projection_coordinates" in arrays.files


def test_load_rejects_stale_content_and_version_bindings(
    tmp_path: Path,
    documents: tuple[SemanticDocument, ...],
    index: SemanticIndex,
) -> None:
    artifact = index.save(tmp_path / "ignored-work")
    stale_documents = (
        documents[0].model_copy(update={"stem": "The learner-visible text changed."}),
        *documents[1:],
    )

    with pytest.raises(StaleSemanticArtifactError, match="ordered item IDs"):
        SemanticIndex.load(artifact, expected_documents=stale_documents)
    with pytest.raises(StaleSemanticArtifactError, match="ontology version"):
        SemanticIndex.load(artifact, expected_ontology_version="ontology.v2")
    with pytest.raises(StaleSemanticArtifactError, match="classifier version"):
        SemanticIndex.load(artifact, expected_classifier_version="classifier.v2")


def test_load_rejects_nonfinite_persisted_query_transform_even_with_new_file_hash(
    tmp_path: Path,
    index: SemanticIndex,
) -> None:
    artifact = index.save(tmp_path / "ignored-work")
    with np.load(artifact.vectors_path, allow_pickle=False) as source:
        arrays = {name: np.asarray(source[name]) for name in source.files}
    arrays["surface_idf"] = arrays["surface_idf"].copy()
    arrays["surface_idf"][0] = np.nan
    with artifact.vectors_path.open("wb") as target:
        np.savez_compressed(target, **arrays)
    manifest = json.loads(artifact.manifest_path.read_text(encoding="utf-8"))
    manifest["vectors_sha256"] = hashlib.sha256(
        artifact.vectors_path.read_bytes()
    ).hexdigest()
    artifact.manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(SemanticArtifactError, match="non-finite"):
        SemanticIndex.load(artifact)


def test_expected_documents_bind_persisted_exact_feature_support(
    tmp_path: Path,
    documents: tuple[SemanticDocument, ...],
    index: SemanticIndex,
) -> None:
    artifact = index.save(tmp_path / "feature-support-tamper")
    with np.load(artifact.vectors_path, allow_pickle=False) as source:
        arrays = {name: np.asarray(source[name]) for name in source.files}
    frequencies = arrays["surface_feature_document_frequencies"].copy()
    frequencies[0] = 2 if frequencies[0] == 1 else 1
    arrays["surface_feature_document_frequencies"] = frequencies
    with artifact.vectors_path.open("wb") as target:
        np.savez_compressed(target, **arrays)
    manifest = json.loads(artifact.manifest_path.read_text(encoding="utf-8"))
    manifest["vectors_sha256"] = hashlib.sha256(
        artifact.vectors_path.read_bytes()
    ).hexdigest()
    artifact.manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(
        StaleSemanticArtifactError,
        match="vectors or query transform",
    ):
        SemanticIndex.load(artifact, expected_documents=documents)


@pytest.mark.parametrize("symlinked_member", ["manifest", "vectors"])
def test_load_rejects_symlinked_artifact_members(
    tmp_path: Path,
    index: SemanticIndex,
    symlinked_member: str,
) -> None:
    artifact = index.save(tmp_path / symlinked_member)
    original = (
        artifact.manifest_path
        if symlinked_member == "manifest"
        else artifact.vectors_path
    )
    target = original.with_name(f"real-{original.name}")
    original.rename(target)
    original.symlink_to(target.name)

    with pytest.raises(SemanticArtifactError, match="symlink"):
        SemanticIndex.load(artifact)


def test_vector_checksum_and_decoder_use_one_snapshot(
    tmp_path: Path,
    documents: tuple[SemanticDocument, ...],
    index: SemanticIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = index.save(tmp_path / "single-snapshot")
    real_np_load = np.load
    observed_snapshot = False

    def replace_file_before_decode(
        source: Any,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        nonlocal observed_snapshot
        observed_snapshot = isinstance(source, io.BytesIO)
        artifact.vectors_path.write_bytes(b"changed after the bounded snapshot")
        return real_np_load(source, *args, **kwargs)

    monkeypatch.setattr(semantic_module.np, "load", replace_file_before_decode)

    loaded = SemanticIndex.load(artifact, expected_documents=documents)

    assert observed_snapshot is True
    assert loaded.identity_sha256 == index.identity_sha256
    assert artifact.vectors_path.read_bytes().startswith(b"changed")


def test_load_applies_manifest_snapshot_size_limit(
    tmp_path: Path,
    index: SemanticIndex,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = index.save(tmp_path / "bounded-read")
    monkeypatch.setattr(semantic_module, "MAX_SEMANTIC_MANIFEST_BYTES", 1)

    with pytest.raises(SemanticArtifactError, match="size limit"):
        SemanticIndex.load(artifact)


def test_mutual_knn_is_deterministic_and_contains_no_self_edges(
    index: SemanticIndex,
) -> None:
    first = index.mutual_knn(k=1, view=RetrievalView.SURFACE)
    second = index.mutual_knn(k=1, view=RetrievalView.SURFACE)

    assert first == second
    assert first
    assert any(
        {edge.left_item_id, edge.right_item_id}
        == {"apple-query", "apple-surface-match"}
        for edge in first
    )
    assert all(edge.left_item_id < edge.right_item_id for edge in first)
