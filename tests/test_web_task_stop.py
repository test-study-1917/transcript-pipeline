from __future__ import annotations

import fcntl
import shutil
import threading
import time
import wave

import pytest
import yaml
from fastapi.testclient import TestClient

from api_server import create_app
from src.llm.gateway import CodexLBClient
from tests.helpers import write_minimal_settings
from tests.test_library import pdf


def wait_status(client, url, status):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        response = client.get(url)
        assert response.status_code == 200
        state = response.json()
        if state["status"] == status:
            return state
        assert state["status"] not in {"success", "failed", "stopped"}, state
        time.sleep(0.02)
    pytest.fail(f"{url} 未进入 {status}: {state}")


def test_stop_queued_run_before_it_opens_inputs(tmp_path):
    write_minimal_settings(tmp_path)
    app = create_app(project_root=tmp_path)
    release = threading.Event()
    try:
        with TestClient(app) as client:
            for _ in range(4):
                app.state.executor.submit(release.wait, 6)
            run_id = client.post("/api/stages/transcribe", json={}).json()["run_id"]
            url = f"/api/stage-runs/{run_id}"
            assert client.get(url).json()["status"] == "pending"
            assert client.post(url + "/stop").json()["status"] == "stopped"
            assert client.post(url + "/stop").json()["status"] == "stopped"
            assert list(app.state.stage_run_state_path(run_id).parent.iterdir()) == [
                app.state.stage_run_state_path(run_id)
            ]
            release.set()
    finally:
        release.set()


@pytest.mark.parametrize("entry", ["single", "batch", "stage"])
def test_stop_transcription_process_waiting_for_gpu(tmp_path, monkeypatch, entry):
    config = write_minimal_settings(tmp_path)
    settings = yaml.safe_load(config.read_text())
    settings["profiles"]["local_cpu"]["device"] = "cuda"
    config.write_text(yaml.safe_dump(settings))
    audio_dir = tmp_path / "data/input/audio"
    audio_dir.mkdir(parents=True)
    audio = audio_dir / "sample.wav"
    with wave.open(str(audio), "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(b"\0\0" * 16000)
    # The input is already a WAV. Isolate the unrelated ffmpeg extraction.
    def pass_audio(loaded, logger=None):
        output = loaded.path_for("audio_dir")
        output.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(audio, output / "source.wav")
        return []

    monkeypatch.setattr("src.pipeline.stages.extract_audio_batch", pass_audio)
    lock_path = tmp_path / "data/jobs/_asr-gpu.lock"
    lock_path.parent.mkdir(parents=True)
    app = create_app(project_root=tmp_path)

    with lock_path.open("a") as gpu, TestClient(app) as client:
        fcntl.flock(gpu, fcntl.LOCK_EX)
        if entry == "stage":
            response = client.post("/api/stages/transcribe", json={})
            url = f"/api/stage-runs/{response.json()['run_id']}"
            workspace_root = tmp_path / "data/intermediate"
        elif entry == "single":
            response = client.post("/api/jobs", json={
                "video": str(audio), "output_dir": str(tmp_path / "final"), "content_type": "conversation",
            })
            url = f"/api/jobs/{response.json()['job_id']}"
            workspace_root = tmp_path / "data/jobs"
        else:
            response = client.post("/api/batch-jobs", json={
                "videos_dir": str(audio_dir), "output_dir": str(tmp_path / "final"), "content_type": "conversation",
            })
            url = f"/api/batches/{response.json()['batch_id']}"
            workspace_root = tmp_path / "data/jobs"

        assert response.status_code == 202
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            locks = list(workspace_root.rglob("._asr-asr.lock"))
            if locks:
                with locks[0].open("a") as workspace:
                    try:
                        fcntl.flock(workspace, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        break
            time.sleep(0.03)
        else:
            pytest.fail(str(client.get(url).json()))

        response = client.post(url + "/stop")
        assert response.status_code == 202
        assert response.json()["status"] in {"stopping", "stopped"}
        stopped = wait_status(client, url, "stopped")
        assert stopped["error_message"] == ""
        with locks[0].open("a") as workspace:
            fcntl.flock(workspace, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert audio.is_file()
        assert not (tmp_path / "final").exists() or not list((tmp_path / "final").rglob("*.md"))
        if entry == "batch":
            assert stopped["items"][0]["status"] == "stopped"
            assert stopped["failed"] == 0


@pytest.mark.parametrize("entry", ["book", "reference", "library"])
def test_stop_ocr_drains_one_page_and_resumes_only_missing(tmp_path, monkeypatch, entry):
    write_minimal_settings(tmp_path, reference_overrides={
        "codex_ocr_max_concurrency": 1, "codex_ocr_submit_interval_seconds": 0,
    })
    entered, release = threading.Event(), threading.Event()
    calls = []

    def recognize(self, payload):
        calls.append(payload["input"][0]["content"][1]["image_url"])
        if len(calls) == 1:
            entered.set()
            assert release.wait(6)
        return f"本页内容 {len(calls)}"

    monkeypatch.setattr(CodexLBClient, "responses_stream_text", recognize)
    app = create_app(project_root=tmp_path)
    try:
        with TestClient(app) as client:
            if entry == "book":
                source = pdf(tmp_path / "data/uploads/pdf-ocr/session/book.pdf")
                response = client.post("/api/pdf-book-ocr", json={"input_path": str(source)})
                url = f"/api/pdf-book-ocr/{response.json()['task_id']}"
            elif entry == "reference":
                pdf(tmp_path / "data/input/reference/book.pdf")
                response = client.post("/api/stages/prepare-reference", json={})
                url = f"/api/stage-runs/{response.json()['run_id']}"
            else:
                source = pdf(tmp_path / "book.pdf")
                book = app.state.library.add_book(source)
                response = client.post(f"/api/library/books/{book['id']}/ocr-jobs", json={})
                url = f"/api/library/jobs/{response.json()['id']}"

            assert response.status_code in {200, 202}
            assert entered.wait(4)
            assert client.post(url + "/stop").json()["status"] == "stopping"
            assert client.get(url).json()["status"] == "stopping"
            resume_url = url + ("/resume" if entry == "library" else "/retry")
            assert client.post(resume_url).status_code == 409
            if entry == "library":
                queued = client.post(f"/api/library/books/{book['id']}/ocr-jobs", json={"pages": [1]})
                queued_url = f"/api/library/jobs/{queued.json()['id']}"
                assert client.post(queued_url + "/stop").json()["status"] == "stopped"

            release.set()
            stopped = wait_status(client, url, "stopped")
            if entry == "library":
                assert stopped["completed_pages"] == 1
                checkpoint = app.state.library.get_page(book["id"], 1)
                assert checkpoint["text"] == "本页内容 1"
            else:
                assert stopped["pages_completed"] == 1
                assert stopped["pages_failed"] == 0
                assert stopped["resumable"]
            assert len(calls) == 1
            assert client.post(resume_url).status_code == 202
            completed = wait_status(client, url, "success")
            if entry == "book":
                assert completed["pages_completed"] == 3
                assert client.get(url + "/results/book.txt").text.endswith("本页内容 3")
            if entry == "library":
                assert completed["completed_pages"] == 3
                assert app.state.library.get_page(book["id"], 1)["current_revision_id"] == checkpoint["current_revision_id"]
                assert client.get(queued_url).json()["status"] == "stopped"
            assert len(calls) == 3
            assert len(set(calls)) == 3
    finally:
        release.set()
