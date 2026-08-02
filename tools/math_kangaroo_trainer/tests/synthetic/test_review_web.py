from __future__ import annotations

import http.client
import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http import HTTPStatus
from pathlib import Path
from typing import Any

import pytest

from math_kangaroo_trainer.cli import main
from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.web import ReviewWebApplication, create_review_server


def build_audit(source: Path, output: Path) -> None:
    assert (
        main(
            [
                "stage0",
                "build",
                "--source",
                str(source),
                "--output",
                str(output),
                "--sample-size",
                "100",
                "--seed",
                "7",
            ]
        )
        == 0
    )


@contextmanager
def running_reviewer(
    audit_dir: Path, *, reviewer_id: str = "reviewer-one", reviewer_slot: int = 1
) -> Iterator[tuple[ReviewWebApplication, int]]:
    application = ReviewWebApplication(
        audit_dir=audit_dir,
        reviewer_id=reviewer_id,
        reviewer_slot=reviewer_slot,
        ontology_path=default_ontology_path(),
    )
    server = create_review_server(application, port=0)
    assert server.server_address[0] == "127.0.0.1"
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
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request(method, path, body=payload, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        return (
            response.status,
            {key.lower(): value for key, value in response.getheaders()},
            data,
        )
    finally:
        connection.close()


def decoded(data: bytes) -> dict[str, Any]:
    return json.loads(data.decode("utf-8"))


def faithful_item_decision(**updates: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "question_boundary_verified": True,
        "choices_verified": True,
        "answer_key_verified": True,
        "diagram_verified": True,
        "source_metadata_verified": True,
        "disposition": "faithful",
        "notes": "independently checked",
    }
    value.update(updates)
    return value


def test_review_api_lists_summaries_and_serves_only_audited_media(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    audit_dir = tmp_path / "audit"
    build_audit(synthetic_bank, audit_dir)

    with running_reviewer(audit_dir) as (_application, port):
        status, headers, data = request(port, "GET", "/api/items")
        assert status == HTTPStatus.OK
        assert "access-control-allow-origin" not in headers
        listing = decoded(data)
        assert len(listing["items"]) == 100
        serialized_listing = data.decode("utf-8")
        assert "Invented prompt" not in serialized_listing
        assert "official_answer" not in serialized_listing
        assert "asset_path" not in serialized_listing

        item_id = listing["items"][0]["item_id"]
        status, _, data = request(port, "GET", f"/api/items/{item_id}")
        assert status == HTTPStatus.OK
        detail = decoded(data)
        assert detail["item_id"] == item_id
        assert detail["stem"].startswith("English helper")
        assert detail["original_stem"].startswith("Invented prompt")
        assert detail["asset_url"].endswith("/asset")
        assert detail["source_page_url"].endswith(
            f"#page={detail['source_metadata']['page']}"
        )
        assert detail["answer_key_url"] is None
        assert "asset_path" not in data.decode("utf-8")
        assert str(tmp_path) not in data.decode("utf-8")

        status, media_headers, media = request(port, "GET", detail["asset_url"])
        assert status == HTTPStatus.OK
        assert media_headers["content-type"] == "image/webp"
        assert media

        source_path = detail["source_page_url"].split("#", 1)[0]
        status, source_headers, source = request(port, "GET", source_path)
        assert status == HTTPStatus.OK
        assert source_headers["content-type"] == "application/pdf"
        assert source.startswith(b"invented-pdf-")

        status, _, _ = request(port, "GET", "/api/items/%2e%2e%2fetc/asset")
        assert status == HTTPStatus.BAD_REQUEST
        status, _, _ = request(
            port, "GET", "/api/progress", headers={"Host": "attacker.example"}
        )
        assert status == HTTPStatus.MISDIRECTED_REQUEST


def test_item_review_save_uses_server_identity_history_and_report(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    audit_dir = tmp_path / "audit"
    build_audit(synthetic_bank, audit_dir)

    with running_reviewer(audit_dir) as (application, port):
        status, _, data = request(port, "GET", "/api/progress")
        assert status == HTTPStatus.OK
        assert decoded(data)["items"]["saved"] == 0
        item_id = application.item_list()["items"][0]["item_id"]

        status, _, data = request(
            port,
            "POST",
            f"/api/items/{item_id}/review",
            faithful_item_decision(),
            headers={"Origin": f"http://127.0.0.1:{port}"},
        )
        assert status == HTTPStatus.CREATED
        saved = decoded(data)
        assert saved["saved"] is True
        assert saved["progress"]["items"]["saved"] == 1
        assert saved["progress"]["quality"]["status"] == "PENDING_REVIEW"

        status, _, data = request(port, "GET", f"/api/items/{item_id}")
        detail = decoded(data)
        etag = detail["current_review"]["etag"]
        assert detail["current_review"]["notes"] == "independently checked"

        status, _, data = request(
            port,
            "POST",
            f"/api/items/{item_id}",
            faithful_item_decision(),
            headers={
                "Origin": f"http://127.0.0.1:{port}",
                "If-Match": etag,
            },
        )
        assert status == HTTPStatus.OK
        assert decoded(data)["saved"] is False

        status, _, _ = request(
            port,
            "POST",
            f"/api/items/{item_id}",
            faithful_item_decision(notes="corrected note"),
            headers={
                "Origin": f"http://127.0.0.1:{port}",
                "If-Match": '"stale"',
            },
        )
        assert status == HTTPStatus.PRECONDITION_FAILED

        spoofed = faithful_item_decision(reviewer_id="someone-else")
        status, _, _ = request(
            port,
            "POST",
            f"/api/items/{item_id}",
            spoofed,
            headers={"Origin": f"http://127.0.0.1:{port}"},
        )
        assert status == HTTPStatus.UNPROCESSABLE_ENTITY

        status, _, _ = request(
            port,
            "POST",
            f"/api/items/{item_id}",
            faithful_item_decision(notes="cross site"),
            headers={"Origin": "https://attacker.example"},
        )
        assert status == HTTPStatus.FORBIDDEN

        assert (audit_dir / "quality-report.json").is_file()
        assert application.repository.review_history_count(application.run_id) == 1


def test_duplicate_review_save_and_queue_path_tampering_are_conservative(
    synthetic_bank: Path, tmp_path: Path
) -> None:
    audit_dir = tmp_path / "audit"
    build_audit(synthetic_bank, audit_dir)

    with running_reviewer(audit_dir) as (application, port):
        groups = application.duplicate_list()["duplicate_groups"]
        assert groups
        group_id = groups[0]["group_id"]
        status, _, data = request(
            port,
            "POST",
            f"/api/duplicates/{group_id}/review",
            {"decision": "rejected", "notes": "same bytes, different question"},
            headers={"Origin": f"http://localhost:{port}"},
        )
        assert status == HTTPStatus.CREATED
        result = decoded(data)
        assert result["progress"]["duplicate_groups"]["saved"] == 1
        assert result["progress"]["duplicate_groups"]["needs_attention"] == 0
        assert (
            application.repository.duplicate_review_history_count(application.run_id)
            == 1
        )

    queue = audit_dir / "review-queue.jsonl"
    records = [json.loads(line) for line in queue.read_text().splitlines()]
    records[0]["asset_path"] = "/etc/passwd"
    queue.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="does not match audit item"):
        ReviewWebApplication(
            audit_dir=audit_dir,
            reviewer_id="reviewer-one",
            reviewer_slot=1,
            ontology_path=default_ontology_path(),
        )
