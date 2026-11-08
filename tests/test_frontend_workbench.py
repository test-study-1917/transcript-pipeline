from pathlib import Path

import pytest

from tests.frontend_workbench_server import build_app
from tests.test_api_server import request_json


def test_browser_fixture_refuses_existing_data(tmp_path: Path) -> None:
    existing = tmp_path / "keep.txt"
    existing.write_text("keep", encoding="utf-8")
    with pytest.raises(ValueError, match="new or empty"):
        build_app(tmp_path)
    assert existing.read_text(encoding="utf-8") == "keep"


def test_browser_fixture_blocks_model_execution(tmp_path: Path) -> None:
    app = build_app(tmp_path)
    marker = request_json(app, "GET", "/api/__workbench_test__")
    assert marker.json()["isolated"] is True
    assert marker.json()["model_execution"] is False
    for path in (
        "/api/jobs",
        "/api/batches",
        "/api/stages/transcribe/file-run",
        "/api/stages/refine/run",
        "/api/pdf-book-ocr",
        "/api/jobs/ui-example-failed/rerun",
    ):
        response = request_json(app, "POST", path, json_body={})
        assert response.status_code == 403
    states = request_json(app, "GET", "/api/jobs").json()["items"]
    assert {state["status"] for state in states} == {"success", "running", "failed"}


def test_browser_fixture_allows_isolated_settings(tmp_path: Path) -> None:
    app = build_app(tmp_path)
    response = request_json(app, "PUT", "/api/frontend-settings", json_body={"codex_lb_base_url": "http://127.0.0.1:2455"})
    assert response.status_code == 200
    assert (tmp_path / "data/jobs/frontend-settings.json").exists()


def test_browser_fixture_allows_pdf_upload_but_not_ocr(tmp_path: Path) -> None:
    import io
    from pypdf import PdfWriter
    from tests.test_api_server import request_raw

    app = build_app(tmp_path)
    pdf = PdfWriter()
    pdf.add_blank_page(width=200, height=200)
    content = io.BytesIO()
    pdf.write(content)
    response = request_raw(app, "POST", "/api/library/books", content=content.getvalue(), params={"filename": "drop-test.pdf"})
    assert response.status_code == 201
    book = response.json()
    assert book["page_count"] == 1
    assert book["ready_pages"] == 0
    blocked = request_json(app, "POST", f"/api/library/books/{book['id']}/ocr-jobs", json_body={})
    assert blocked.status_code == 403
