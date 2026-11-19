const statusLabels: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  stopping: "正在停止",
  stopped: "已停止",
  success: "已完成",
  failed: "失败",
  partial: "部分完成",
  interrupted: "已中断",
};

export function taskStatusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

export function canStopTask(status: string): boolean {
  return status === "pending" || status === "running";
}

export function isTaskActive(status: string): boolean {
  return canStopTask(status) || status === "stopping";
}
