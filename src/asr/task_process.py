"""Run web transcription in its own process group, outside the API process."""
from __future__ import annotations

import fcntl
import json
import logging
import os
import signal
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event

from src.asr.errors import AsrTranscriptionError
from src.asr.file import summarize_transcription_results, transcribe_files
from src.asr.options import AsrResources, FileAsrOptions
from src.asr.results import publication_guard
from src.runtime_utils import setup_logging
from src.task_stop import check_task_stop


def run_transcription_process(
    audio_files: list[Path],
    output_dir: Path,
    options: FileAsrOptions,
    resources: AsrResources,
    logger: logging.Logger | None,
    stop_event: Event,
) -> None:
    check_task_stop(stop_event)
    with TemporaryDirectory(prefix="transcript-asr-") as temporary:
        lock_path = Path(temporary) / "publication.lock"
        request: bytes | None = json.dumps({
            "audio_files": audio_files, "output_dir": output_dir,
            "options": asdict(options), "resources": asdict(resources),
            "log_level": logging.getLevelName(logger.getEffectiveLevel()) if logger else "INFO",
            "lock_path": lock_path,
        }, default=str).encode()
        with subprocess.Popen(
            [sys.executable, "-m", "src.asr.task_process"],
            cwd=Path(__file__).resolve().parents[2],
            stdin=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
        ) as worker:
            while True:
                try:
                    _, stderr = worker.communicate(request, timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    request = None
                    if not stop_event.is_set():
                        continue
                    # Do not interrupt a JSON/TXT pair halfway through publication.
                    with lock_path.open("a") as guard:
                        fcntl.flock(guard, fcntl.LOCK_EX)
                        try:
                            os.killpg(worker.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        _, stderr = worker.communicate()
                    break
            if logger and stderr:
                logger.info("%s", stderr.decode(errors="replace").rstrip())
            check_task_stop(stop_event)
            if worker.returncode:
                detail = stderr.decode(errors="replace").strip().splitlines()
                raise AsrTranscriptionError(detail[-1] if detail else f"转写进程退出：{worker.returncode}")


def main() -> None:
    request = json.load(sys.stdin)
    resources = request["resources"]
    for key in ("cache_dir", "gpu_lock_path", "source_root"):
        if resources[key] is not None:
            resources[key] = Path(resources[key])
    # The lock is only set in this dedicated worker; CLI and live dictation
    # continue to publish without a web stop boundary.
    publication_guard.set(Path(request["lock_path"]))
    logger = setup_logging(request["log_level"])
    try:
        outputs = transcribe_files(
            [Path(path) for path in request["audio_files"]], Path(request["output_dir"]),
            options=FileAsrOptions(**request["options"]), resources=AsrResources(**resources),
            logger=logger,
            worker_temp_dir=Path(request["lock_path"]).parent,
        )
        logger.info("%s", summarize_transcription_results(outputs))
    except AsrTranscriptionError as exc:
        sys.exit(str(exc))


if __name__ == "__main__":
    main()
