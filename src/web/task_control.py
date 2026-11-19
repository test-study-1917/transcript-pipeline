"""Own stop requests for tasks submitted to the web executor."""
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from threading import Event

from fastapi import FastAPI, HTTPException

from src.web.state_store import read_json_file


@dataclass
class TaskControl:
    stop: Event
    future: Future | None = None


def submit_task(fastapi_app: FastAPI, state_path: Path, func, **kwargs) -> None:
    app_state = fastapi_app.state
    identifier = state_path.parent.name
    if app_state.run_tasks_inline:
        try:
            func(**kwargs)
        finally:
            app_state.active_jobs.discard(identifier)
        return

    control = TaskControl(Event())
    app_state.task_controls[identifier] = control

    def run() -> None:
        try:
            func(**kwargs)
        finally:
            app_state.task_controls.pop(identifier)
            app_state.active_jobs.discard(identifier)

    control.future = app_state.executor.submit(run)


def task_stop_event(app: FastAPI, identifier: str) -> Event | None:
    control = app.state.task_controls.get(identifier)
    return control.stop if control else None


def mark_task_stopped(app: FastAPI, state_path: Path, *, resumable: bool) -> dict:
    return app.state.update_state(
        state_path, status="stopped", error_message="", resumable=resumable,
    )


def request_task_stop(app: FastAPI, state_path: Path) -> dict:
    identifier = state_path.parent.name
    control = app.state.task_controls.get(identifier)
    if not state_path.is_file():
        raise HTTPException(status_code=404, detail="任务不存在。")
    state = read_json_file(state_path)
    if state["status"] == "stopped":
        return state
    if control is None or state["status"] not in {"pending", "running"}:
        raise HTTPException(status_code=409, detail="任务已结束，不能停止。")

    control.stop.set()
    if control.future is not None and control.future.cancel():
        app.state.task_controls.pop(identifier)
        app.state.active_jobs.discard(identifier)
        return mark_task_stopped(
            app, state_path,
            resumable=state["kind"] == "pdf-ocr" or state["current_stage"] == "prepare-reference",
        )
    state = read_json_file(state_path)
    return {**state, "status": "stopping"} if state["status"] in {"running", "pending"} else state
