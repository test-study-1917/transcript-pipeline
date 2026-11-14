"""Read small failure summaries for display; never alter task state or upstream artifacts."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


def _read_summary(path: Path) -> dict:
    try:
        if path.stat().st_size > 128 * 1024:
            return {}
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _safe_id(value: Any) -> str:
    identifier = str(value or "")
    return identifier if identifier not in {"", ".", ".."} and "/" not in identifier and "\\" not in identifier else ""


def enrich_error_details(project_root: Path, state: dict) -> dict:
    state = dict(state)
    # The display field is derived afresh, never trusted across a retry.
    state.pop("error_detail", None)
    if state.get("kind") == "batch":
        items = []
        for item in state.get("items") or []:
            if not isinstance(item, dict):
                items.append(item)
                continue
            details = enrich_error_details(project_root, {**item, "id": item.get("job_id"), "kind": "job"})
            enriched = {key: value for key, value in item.items() if key != "error_detail"}
            if details.get("error_detail"):
                enriched["error_detail"] = details["error_detail"]
            items.append(enriched)
        state["items"] = items
    if state.get("status") not in {"failed", "partial"} or not state.get("error_message"):
        return state
    identifier = _safe_id(state.get("id"))
    if not identifier:
        return state
    if state.get("kind") == "job":
        logs = project_root / "data/jobs" / identifier / "output/logs"
    elif state.get("kind") == "stage-run" and state.get("run_mode") == "file":
        logs = project_root / "data/jobs/stage-runs" / identifier / "workspace/output/logs"
    else:
        return state
    stage = str(state.get("failed_stage") or state.get("current_stage") or "")
    # Only inspect this task and the current failed stage. Never reuse an older failed
    # run after a more recent successful one, or treat interruption as a model failure.
    if "exit_code=" not in str(state.get("error_message")):
        return state
    if stage in {"extract-audio", "transcribe", "prepare-reference", "align", "classify", "refine", "export-markdown"}:
        summaries = sorted((logs / "stage-failures" / stage).glob("*.json"))
        if summaries:
            latest = _read_summary(summaries[-1])
            try:
                # Failed stage summaries must belong to this execution, not an old retry.
                elapsed = (datetime.fromisoformat(str(state["updated_at"])) - datetime.fromisoformat(str(latest["recorded_at"]))).total_seconds()
                if -2 <= elapsed <= 60 and latest.get("stage") == stage:
                    state["error_detail"] = str(latest.get("message") or "")[:8000]
                    return state
            except (KeyError, ValueError, TypeError):
                pass
    if stage != "refine":
        return state
    experiments = sorted(logs.glob("refine/*/terra-terra/run-*/experiment.json"), key=lambda path: path.parent.name)
    if experiments:
        latest = _read_summary(experiments[-1])
        error = latest.get("error")
        if latest.get("status") == "failed" and isinstance(error, dict):
            try:
                elapsed = (datetime.fromisoformat(str(state["updated_at"])) - datetime.fromisoformat(str(error["recorded_at"]))).total_seconds()
                if -2 <= elapsed <= 60:
                    state["error_detail"] = str(error.get("message") or "")[:8000]
            except (KeyError, ValueError, TypeError):
                pass
    return state
