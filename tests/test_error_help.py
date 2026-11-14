from __future__ import annotations

import json
import logging
from dataclasses import replace
from pathlib import Path

import pytest

from src.config_loader import load_settings
from src.ffmpeg_utils import AudioExtractionError
from src.pipeline import run_stage
from src.pipeline.stages import default_stage_operations
from src.web.error_details import enrich_error_details
from src.web.state_store import write_json_file
from tests.helpers import write_minimal_settings


def failed_state(**overrides):
    return {"id": "example", "kind": "job", "status": "failed", "current_stage": "refine",
            "updated_at": "2026-11-15T01:30:00+09:00", "error_message": "stage=refine exit_code=1", **overrides}


def experiment(root, name="run-20261115T000000Z", **overrides):
    path = root / "data/jobs/example/output/logs/refine/source/terra-terra" / name / "experiment.json"
    write_json_file(path, {"status": "failed", "error": {"message": "curl: (56) Connection reset by peer",
                    "recorded_at": "2026-11-15T01:30:00.500+09:00"}, **overrides})
    return path


def test_historical_failure_is_enriched_without_changing_state_or_artifacts(tmp_path):
    from api_server import create_app
    from tests.test_api_server import request_json

    original = failed_state()
    state_path = tmp_path / "data/jobs/example/state.json"
    write_json_file(state_path, original)
    detail_path = experiment(tmp_path)
    before = {p: p.read_bytes() for p in (state_path, detail_path)}
    app = create_app(project_root=tmp_path)
    for route in ("/api/jobs/example", "/api/jobs"):
        response = request_json(app, "GET", route)
        assert response.status_code == 200
        payload = response.json()
        state = payload["items"][0] if "items" in payload else payload
        assert "Connection reset" in state["error_detail"]
        assert state["error_message"] == original["error_message"]
    assert all(p.read_bytes() == value for p, value in before.items())


@pytest.mark.parametrize("overrides", [
    {"status": "running"}, {"status": "success"}, {"current_stage": "transcribe"},
    {"updated_at": "2026-11-16T01:30:00+09:00"}, {"error_message": "任务已意外中断或服务重启"},
    {"id": "../example"},
])
def test_unrelated_or_old_evidence_is_not_presented_as_current(tmp_path, overrides):
    experiment(tmp_path)
    assert "error_detail" not in enrich_error_details(tmp_path, failed_state(**overrides))


def test_latest_success_and_broken_diagnostics_do_not_revive_old_failure(tmp_path):
    experiment(tmp_path)
    latest = experiment(tmp_path, "run-20261115T010000Z", status="completed")
    assert "error_detail" not in enrich_error_details(tmp_path, failed_state())
    for content in ("{", "[]", "x" * 140000):
        latest.write_text(content)
        assert "error_detail" not in enrich_error_details(tmp_path, failed_state())


def test_stage_error_keeps_exit_code_and_is_available_for_the_ui(tmp_path):
    write_minimal_settings(tmp_path)
    loaded = load_settings(project_root=tmp_path)
    def fail(*args, **kwargs):
        raise AudioExtractionError("No space left on device")
    code = run_stage("extract-audio", loaded, logging.getLogger("error-help"),
                     operations=replace(default_stage_operations(), extract_audio_batch=fail))
    assert code == 1
    summaries = list((loaded.path_for("logs_dir") / "stage-failures/extract-audio").glob("*.json"))
    assert len(summaries) == 1
    payload = json.loads(summaries[0].read_text())
    target = tmp_path / "data/jobs/example/output/logs/stage-failures/extract-audio/test.json"
    write_json_file(target, payload)
    state = failed_state(current_stage="extract-audio", updated_at=payload["recorded_at"],
                         error_message="stage=extract-audio exit_code=1")
    assert enrich_error_details(tmp_path, state)["error_detail"] == "No space left on device"


def test_diagnostic_write_failure_preserves_original_error(tmp_path, monkeypatch):
    from src.stage_error import report_stage_error
    write_minimal_settings(tmp_path)
    loaded = load_settings(project_root=tmp_path)
    monkeypatch.setattr(Path, "mkdir", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("disk full")))
    report_stage_error(logging.getLogger("error-help"), loaded, "transcribe", RuntimeError("CUDA out of memory"))


def test_batch_children_and_stage_file_failures_use_their_own_workspace(tmp_path):
    experiment(tmp_path)
    child = failed_state(job_id="example")
    child.pop("id")
    batch = enrich_error_details(tmp_path, {"kind": "batch", "status": "failed", "items": [child]})
    assert "Connection reset" in batch["items"][0]["error_detail"]
    assert set(batch["items"][0]) == set(child) | {"error_detail"}
    source = experiment(tmp_path)
    target = tmp_path / "data/jobs/stage-runs/example/workspace/output/logs/refine/source/terra-terra/run-1/experiment.json"
    write_json_file(target, json.loads(source.read_text()))
    state = enrich_error_details(tmp_path, failed_state(kind="stage-run", run_mode="file"))
    assert "Connection reset" in state["error_detail"]
