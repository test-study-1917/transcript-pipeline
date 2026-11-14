"""Small, independent error summaries for the task UI; full logs remain unchanged."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4


def report_stage_error(logger, loaded_settings, stage: str, error: Exception) -> None:
    logger.error("%s", error)
    try:
        directory = loaded_settings.path_for("logs_dir") / "stage-failures" / stage
        directory.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc)
        path = directory / f"{timestamp.strftime('%Y%m%dT%H%M%S%fZ')}-{uuid4().hex}.json"
        path.write_text(json.dumps({
            "stage": stage, "recorded_at": timestamp.isoformat(),
            "error_type": type(error).__name__, "message": str(error)[:8000],
        }, ensure_ascii=False), encoding="utf-8")
    except (OSError, AttributeError):
        # Disk/permission failures must not replace the original failure or exit code.
        pass
