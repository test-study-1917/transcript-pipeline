---
kind: issue
title: 停止网页转写与 OCR 任务
type: feature
status: closed
created: 2026-11-19
---

单任务、批量任务、单阶段和任务列表共用各自任务的停止入口；整本 OCR、书库“处理任务”和选页窗口内的缺页识别也可停止。沿用 [书库 Epic](../epics/001-o-shared-pdf-library/spec.md) 的“停止投递、在途页落盘”规则，不合并两种 OCR 调度。

```text
[任务状态 · 当前进度] [停止任务]
点击后：正在停止 → 已停止    OCR：[继续 / 重试] 或 [重试缺失页]
```

- 未开始的任务直接从队列撤下。ASR 隔离在该任务自己的进程组中，停止时等正在发布的 JSON/TXT 写完，再终止进程组；不杀其他任务、API 或听写服务。
- OCR 不投递新请求；已经发出的页面正常完成并写入检查点，未投递的页面不算失败。书库单任务停止不影响其他排队任务。已完成产物继续可用，停止不触发自动重试。
- 不更改模型、输入或历史中间产物结构；旧 CLI 路径保持原样。非转写、非逐页 OCR 的其他阶段在当前操作收尾后停止。

## 验证

- `.venv/bin/python -m pytest -q`：1038 项通过，仅有 Starlette TestClient 的依赖弃用提醒。新增回归覆盖排队撤销、三个转写入口释放工作区锁、准备参考/整本/书库 OCR 停止后只补缺页，以及已取消的渲染不发网关请求。
- `cd frontend && npm run build`：通过类型检查及构建。
- 浏览器隔离验收：桌面单阶段中止真实 Whisper 转写并核实进程退出，另用 25 秒录音成功生成含 5 段的 JSON 和 TXT；390 px 手机版整本 OCR 与书库 OCR 各在 1/3 页停止，继续后达到 3/3 页且第一页不重发。PDF 页面真实渲染，识别响应由本地可控网关提供。
- 选页窗口在 1/2 页停止，检查底部准确显示“已准备 1 页 · 缺少 1 页”，并提供继续入口。
- 产物与截图：`tmp/task-stop-acceptance/`。未部署，未重启现有服务。

## 修改文件

- 执行和停止：`api_server.py`、`src/web/{task_control,tasks,library}.py`、`src/{task_stop,job_runner,asr_utils}.py`、`src/pipeline/stages.py`、`src/asr/{task_process,file,results}.py`。
- OCR 调度：`src/ocr_scheduler.py`、`src/pdf/ocr.py`、`src/{pdf_book_ocr,reference_utils}.py`、`src/library/{jobs,store}.py`。
- 网页：`frontend/src/api/{client,library,taskStatus}.ts`、`frontend/src/components/{TaskStopButton,JobStatusCard,LibraryMaterialComposer}.vue`、`frontend/src/views/{SingleJobView,BatchJobView,JobListView,StageRunnerView,PDFBookOCRView,LibraryView}.vue`。
- 测试与使用说明：`tests/{test_web_task_stop,test_library_pdf_pages}.py`、`README.md`、`docs/PDF_LIBRARY.md`、本记录。

## 关闭结论

转写实际退出、OCR 保留已完成页且继续只补缺页，网页各入口和历史状态已验收。稳定交互与执行边界回写到 [当前规格：停止网页任务](../spec/index.md#停止网页任务)；没有剩余实现事项。
