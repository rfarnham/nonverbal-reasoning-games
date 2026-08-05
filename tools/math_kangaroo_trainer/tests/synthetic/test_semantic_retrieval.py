from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from math_kangaroo_trainer.retrieval import (
    MISSING_STRATEGY_WARNING,
    RetrievalView,
    SemanticArtifactManifest,
    SemanticDocument,
    SemanticIndex,
    SemanticIndexConfig,
    StaleSemanticArtifactError,
    StrategyViewUnavailableError,
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
    assert index.query("apple-query", top_k=5).model_dump(mode="json") == (
        rebuilt.query("apple-query", top_k=5).model_dump(mode="json")
    )
    assert index.identity_sha256 == rebuilt.identity_sha256


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
    assert manifest.represents_mastery_or_difficulty is False
    assert manifest.strategy_available is False
    assert manifest.ordered_items_sha256


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
