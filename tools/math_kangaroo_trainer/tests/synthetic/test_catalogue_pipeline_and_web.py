from __future__ import annotations

import http.client
import json
import sqlite3
import stat
import threading
from contextlib import contextmanager
from http import HTTPStatus
from pathlib import Path
from typing import Any, Iterator

import pytest

from math_kangaroo_trainer.cli import main
from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.retrieval import StaleSemanticArtifactError
from math_kangaroo_trainer.web.catalogue_server import (
    CatalogueWebApplication,
    create_catalogue_server,
)


def build_catalogue(source: Path, output: Path) -> None:
    assert (
        main(["catalogue", "build", "--source", str(source), "--output", str(output)])
        == 0
    )


@contextmanager
def running_catalogue(
    source: Path, output: Path
) -> Iterator[tuple[CatalogueWebApplication, int]]:
    application = CatalogueWebApplication(
        catalogue_dir=output,
        source_path=source,
        reviewer_id="teacher-one",
        ontology_path=default_ontology_path(),
    )
    server = create_catalogue_server(application, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield application, int(server.server_address[1])
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def request(
    port: int,
    method: str,
    path: str,
    body: Any = None,
    *,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = dict(headers or {})
    if payload is not None:
        request_headers.setdefault("Content-Type", "application/json")
        request_headers.setdefault("Content-Length", str(len(payload)))
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    try:
        connection.request(method, path, body=payload, headers=request_headers)
        response = connection.getresponse()
        return (
            response.status,
            {key.lower(): value for key, value in response.getheaders()},
            response.read(),
        )
    finally:
        connection.close()


def decoded(data: bytes) -> dict[str, Any]:
    return json.loads(data.decode("utf-8"))


def test_catalogue_build_indexes_every_source_item_and_is_resumable(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "catalogue"
    build_catalogue(synthetic_bank, output)
    first = decoded((output / "catalogue-build-summary.json").read_bytes())
    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    assert stat.S_IMODE((output / "corpus-review.sqlite3").stat().st_mode) == 0o600
    assert (
        stat.S_IMODE((output / "catalogue-build-summary.json").stat().st_mode) == 0o600
    )
    assert first["source_items"] == 120
    assert first["inventory_complete"] is True
    assert first["semantic_index"]["views"] == ["surface", "tag", "hybrid"]
    assert first["semantic_index"]["strategy_available"] is False

    # An unchanged rebuild targets the same deterministic run without losing
    # or conflicting with its original creation metadata.
    output.chmod(0o755)
    (output / "corpus-review.sqlite3").chmod(0o644)
    build_catalogue(synthetic_bank, output)
    second = decoded((output / "catalogue-build-summary.json").read_bytes())
    assert second["run_id"] == first["run_id"]
    assert second["inventory_items"] == 120
    assert stat.S_IMODE(output.stat().st_mode) == 0o700
    assert stat.S_IMODE((output / "corpus-review.sqlite3").stat().st_mode) == 0o600
    assert (
        stat.S_IMODE((output / "catalogue-build-summary.json").stat().st_mode) == 0o600
    )


def test_catalogue_startup_rejects_semantic_artifact_stale_against_inventory(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "catalogue"
    build_catalogue(synthetic_bank, output)
    database = output / "corpus-review.sqlite3"
    with sqlite3.connect(database) as connection:
        row = connection.execute(
            "SELECT run_id, item_id, learner_payload_json "
            "FROM catalogue_items ORDER BY inventory_order LIMIT 1"
        ).fetchone()
        assert row is not None
        payload = json.loads(row[2])
        payload["stem_markdown"] = "Changed private surface evidence."
        connection.execute(
            "UPDATE catalogue_items SET learner_payload_json=? "
            "WHERE run_id=? AND item_id=?",
            (json.dumps(payload, sort_keys=True), row[0], row[1]),
        )

    with pytest.raises(StaleSemanticArtifactError, match="ordered item IDs"):
        CatalogueWebApplication(
            catalogue_dir=output,
            source_path=synthetic_bank,
            reviewer_id="teacher-one",
            ontology_path=default_ontology_path(),
        )


def test_catalogue_snapshots_and_rechecks_answer_key_file_integrity(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    answer_key = synthetic_bank.parent.parent / "invented-answers.pdf"
    original = b"%PDF-1.4\ninvented answer-key evidence\n"
    answer_key.write_bytes(original)
    output = tmp_path / "catalogue"
    build_catalogue(synthetic_bank, output)

    with running_catalogue(synthetic_bank, output) as (application, port):
        record = application._items[application._summaries[0].item_id].item
        assert record.answer_key_ref is not None
        assert record.answer_key_ref.status == "available"
        assert record.answer_key_ref.bytes == len(original)
        status, _, data = request(
            port,
            "GET",
            f"/api/catalogue/items/{record.item_id}/answer-key",
        )
        assert status == HTTPStatus.OK
        assert data == original

    answer_key.write_bytes(b"%PDF-1.4\nchanged answer-key evidence\n")
    with pytest.raises(ValueError, match="answer-key evidence changed"):
        CatalogueWebApplication(
            catalogue_dir=output,
            source_path=synthetic_bank,
            reviewer_id="teacher-one",
            ontology_path=default_ontology_path(),
        )


def test_catalogue_does_not_trust_an_asset_that_appears_after_build(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    item_id = "invented-003"
    asset = (
        synthetic_bank.parent.parent
        / "report"
        / "assets"
        / "questions"
        / f"{item_id}.webp"
    )
    original = asset.read_bytes()
    asset.unlink()
    output = tmp_path / "catalogue"
    build_catalogue(synthetic_bank, output)

    # The old catalogue snapshot must not begin trusting new bytes merely
    # because a formerly missing path appears later.
    asset.write_bytes(original)
    with running_catalogue(synthetic_bank, output) as (_, port):
        status, _, _ = request(
            port,
            "GET",
            f"/api/catalogue/items/{item_id}/asset",
        )
        assert status == HTTPStatus.GONE


def test_catalogue_http_exposes_taxonomy_neighbors_and_policy_without_bulk_content(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "catalogue"
    build_catalogue(synthetic_bank, output)
    with running_catalogue(synthetic_bank, output) as (application, port):
        status, headers, page = request(port, "GET", "/")
        assert status == HTTPStatus.OK
        assert b"Corpus QA" in page
        assert "access-control-allow-origin" not in headers
        assert headers["cross-origin-resource-policy"] == "same-origin"
        assert headers["x-frame-options"] == "DENY"

        status, _, data = request(port, "GET", "/api/catalogue/summary")
        summary = decoded(data)
        assert status == HTTPStatus.OK
        assert summary["total_items"] == 120
        assert (
            summary["semantic_retrieval"]["represents_mastery_or_difficulty"] is False
        )

        status, _, data = request(port, "GET", "/api/catalogue/items?limit=5")
        listing = decoded(data)
        assert status == HTTPStatus.OK
        assert listing["total"] == 120
        assert len(listing["items"]) == 5
        assert "Invented prompt" not in data.decode("utf-8")
        item_id = listing["items"][0]["item_id"]

        status, _, data = request(port, "GET", f"/api/catalogue/items/{item_id}")
        detail = decoded(data)
        assert status == HTTPStatus.OK
        assert detail["prompt"].startswith(("Invented prompt", "English helper"))
        assert detail["source_crop_url"].endswith("/asset")

        status, _, data = request(
            port,
            "GET",
            f"/api/catalogue/items/{item_id}/neighbors?view=hybrid&limit=4",
        )
        neighbors = decoded(data)
        assert status == HTTPStatus.OK
        assert len(neighbors["neighbors"]) == 4
        assert "STRATEGY_VIEW_UNAVAILABLE_RENORMALIZED" in neighbors["warnings"]
        assert neighbors["retrieval_version"] == (
            f"{application.semantic_index.config.algorithm_version}:"
            f"{application.semantic_index.identity_sha256[:16]}"
        )

        status, _, data = request(port, "GET", "/api/catalogue/taxonomy")
        taxonomy = decoded(data)
        assert status == HTTPStatus.OK
        assert len(taxonomy["skills"]) == 52
        skill_id = taxonomy["skills"][0]["skill_id"]

        status, _, data = request(
            port,
            "POST",
            "/api/catalogue/recommendations/preview",
            {
                "target_skill_id": skill_id,
                "grade": "1-2",
                "mastery": 0.5,
                "uncertainty": 0.7,
                "mode": "diagnostic",
                "recent_item_ids": [],
            },
            headers={"Origin": f"http://127.0.0.1:{port}"},
        )
        preview = decoded(data)
        assert status == HTTPStatus.OK
        assert preview["policy_version"] == "curriculum-preview.v1"
        assert "PROPOSAL_ONLY_Q_MATRIX" in preview["warnings"]
        assert (
            sum(preview["exclusion_reason_counts"].values())
            >= preview["excluded_count"]
        )
        assert "approximate_selection_propensity" not in data.decode("utf-8")

        status, _, data = request(
            port,
            "POST",
            "/api/catalogue/recommendations/preview",
            {
                "target_skill_id": skill_id,
                "grade": "1-2",
                "mastery": 0.5,
                "uncertainty": 0.7,
                "mode": "practice",
                "recent_item_ids": ["invented-010"],
            },
            headers={"Origin": f"http://127.0.0.1:{port}"},
        )
        duplicate_preview = decoded(data)
        assert status == HTTPStatus.OK
        assert (
            duplicate_preview["exclusion_reason_counts"]["RECENT_EXACT_DUPLICATE_GROUP"]
            >= 1
        )

        status, _, data = request(
            port,
            "POST",
            "/api/catalogue/recommendations/preview",
            {
                "target_skill_id": skill_id,
                "grade": "1-2",
                "mastery": 0.5,
                "uncertainty": 0.7,
                "mode": "remediation",
                "target_item_id": item_id,
                "recent_item_ids": [],
            },
            headers={"Origin": f"http://127.0.0.1:{port}"},
        )
        target_preview = decoded(data)
        assert status == HTTPStatus.OK
        assert "SURFACE_SIMILARITY_PROXY_FROM_TARGET_ITEM" in target_preview["warnings"]

        status, _, _ = request(
            port,
            "POST",
            "/api/catalogue/recommendations/preview",
            {
                "target_skill_id": skill_id,
                "target_item_id": "not-in-this-run",
                "grade": "1-2",
                "mastery": 0.5,
                "uncertainty": 0.7,
                "mode": "transfer",
            },
            headers={"Origin": f"http://127.0.0.1:{port}"},
        )
        assert status == HTTPStatus.UNPROCESSABLE_ENTITY

        status, _, data = request(port, "GET", "/api/catalogue/export")
        assert status == HTTPStatus.OK
        serialized = data.decode("utf-8")
        assert "Invented prompt" not in serialized
        assert "official_answer" not in serialized
        assert "local_ref" not in serialized
        assert str(tmp_path) not in serialized

        status, _, _ = request(
            port,
            "GET",
            "/api/catalogue/summary",
            headers={"Host": "attacker.invalid"},
        )
        assert status == HTTPStatus.MISDIRECTED_REQUEST
        status, headers, _ = request(
            port,
            "GET",
            "/api/catalogue/summary",
            headers={
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
            },
        )
        assert status == HTTPStatus.FORBIDDEN
        assert headers["cross-origin-resource-policy"] == "same-origin"
        status, _, page = request(
            port,
            "GET",
            "/",
            headers={
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Dest": "document",
            },
        )
        assert status == HTTPStatus.OK
        assert b"Corpus QA" in page
        status, _, _ = request(port, "GET", "/api/catalogue/items/%2e%2e%2fetc/asset")
        assert status == HTTPStatus.BAD_REQUEST


def test_curriculum_cards_use_the_effective_teacher_classification(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "catalogue"
    build_catalogue(synthetic_bank, output)
    with running_catalogue(synthetic_bank, output) as (application, port):
        taxonomy = application.taxonomy()
        skill = next(
            value for value in taxonomy["skills"] if value["coverage_count"] == 0
        )
        record = next(
            value
            for value in application._items.values()
            if value.item.source_metadata.grade_band == "1-2"
            and value.item.parser_status == "parsed"
            and value.item.answer_status == "official-verified"
            and value.item.option_count in {4, 5}
        )
        item_id = record.item.item_id
        status, _, _ = request(
            port,
            "PUT",
            f"/api/catalogue/items/{item_id}/review",
            {
                "source_checks": {
                    "prompt": True,
                    "choices": True,
                    "answer": True,
                    "points": True,
                    "visual": True,
                },
                "disposition": "faithful",
                "primary_domain": "probability_data",
                "question_type": "probability_data",
                "skill_ids": [skill["skill_id"]],
                "representation_ids": [taxonomy["representation_tags"][0]["value"]],
                "cognitive_demand": taxonomy["cognitive_demand_tags"][0]["value"],
                "grade_appropriateness": "appropriate",
                "taxonomy_decision": "needs_changes",
                "notes": "Invented teacher classification for response-provenance coverage.",
            },
            headers={
                "Origin": f"http://127.0.0.1:{port}",
                "If-Match": "*",
            },
        )
        assert status == HTTPStatus.OK

        status, _, data = request(
            port,
            "POST",
            "/api/catalogue/recommendations/preview",
            {
                "target_skill_id": skill["skill_id"],
                "grade": "1-2",
                "mastery": 0.5,
                "uncertainty": 0.5,
                "mode": "practice",
            },
            headers={"Origin": f"http://127.0.0.1:{port}"},
        )
        assert status == HTTPStatus.OK
        slate = decoded(data)["slate"]
        assert [value["item_id"] for value in slate] == [item_id]
        assert slate[0]["evidence_status"] == "teacher_classification"
        assert slate[0]["primary_domain"] == "probability_data"
        assert slate[0]["question_type"] == "probability_data"
        assert slate[0]["classification"]["source"] == "teacher"


def test_catalogue_http_saves_append_only_taxonomy_and_neighbor_evidence(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    output = tmp_path / "catalogue"
    build_catalogue(synthetic_bank, output)
    with running_catalogue(synthetic_bank, output) as (application, port):
        taxonomy = application.taxonomy()
        skill_id = taxonomy["skills"][0]["skill_id"]
        status, headers, data = request(
            port,
            "PUT",
            f"/api/catalogue/taxonomy/skills/{skill_id}/review",
            {"judgement": "approve", "notes": "Boundary is coherent."},
            headers={
                "Origin": f"http://127.0.0.1:{port}",
                "If-Match": "*",
            },
        )
        assert status == HTTPStatus.OK
        assert headers["etag"]
        assert decoded(data)["judgement"]["decision"] == "approve"

        item_id = application._summaries[0].item_id
        status, headers, data = request(
            port,
            "PUT",
            f"/api/catalogue/items/{item_id}/review",
            {
                "source_checks": {
                    "prompt": False,
                    "choices": False,
                    "answer": False,
                    "points": False,
                    "visual": False,
                },
                "disposition": "needs_correction",
                "primary_domain": "unknown",
                "question_type": "unknown",
                "skill_ids": [],
                "representation_ids": [],
                "grade_appropriateness": "uncertain",
                "taxonomy_decision": "needs_changes",
                "notes": "Needs source correction.",
            },
            headers={
                "Origin": f"http://127.0.0.1:{port}",
                "If-Match": "*",
            },
        )
        assert status == HTTPStatus.OK
        assert decoded(data)["review"]["review_state"] == "needs_review"
        assert headers["etag"]
        status, _, data = request(port, "GET", f"/api/catalogue/items/{item_id}")
        assert status == HTTPStatus.OK
        assert decoded(data)["existing_review"]["review_state"] == "needs_review"

        neighbors = application.neighbors(item_id, {"view": ["hybrid"], "limit": ["2"]})
        neighbor_id = neighbors["neighbors"][0]["item_id"]
        status, headers, data = request(
            port,
            "PUT",
            f"/api/catalogue/items/{item_id}/neighbors/{neighbor_id}/review",
            {"rating": "surface_only", "view": "hybrid"},
            headers={
                "Origin": f"http://127.0.0.1:{port}",
                "If-Match": "*",
            },
        )
        assert status == HTTPStatus.OK
        assert decoded(data)["rating"] == "surface_only"
        assert headers["etag"]

        status, _, _ = request(
            port,
            "PUT",
            f"/api/catalogue/items/{item_id}/neighbors/{neighbor_id}/review",
            {"rating": "unrelated", "view": "hybrid"},
            headers={
                "Origin": f"http://127.0.0.1:{port}",
                "If-Match": '"stale"',
            },
        )
        assert status == HTTPStatus.PRECONDITION_FAILED

        export = application.export_evidence()
        assert len(export["reviews"]) == 1
        assert len(export["skill_judgements"]) == 1
        assert len(export["neighbor_judgements"]) == 1
