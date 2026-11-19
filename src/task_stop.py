"""Stop at a task boundary without reporting an execution failure."""
from threading import Event


class TaskStopped(RuntimeError):
    pass


def check_task_stop(stop_event: Event | None) -> None:
    if stop_event is not None and stop_event.is_set():
        raise TaskStopped("任务已停止")
