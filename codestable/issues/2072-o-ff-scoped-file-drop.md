---
kind: issue
title: 所有上传入口的独立拖放上传
type: ff
status: open
created: 2026-11-08
---

# 所有上传入口的独立拖放上传

已完成实现和工程验证，保留用户交互确认。单任务、批量、单阶段、PDF OCR、书库及听写的所有本机上传入口都有独立虚线落点、用途提示和悬停高亮；既有选择按钮继续可用。

落点关系：`媒体区 → 当前媒体字段`；`参考区 → 当前参考字段`；`词表区 → 当前词表字段`；`阶段输入区 → 当前阶段／槽位`。不按文件格式自动寻找另一个落点；区域外不上传、不打开文件，拖放为复制。

- 改动：新增 `frontend/src/components/FileDropZone.vue`、`frontend/src/utils/fileDrop.ts`；接入三类共用上传组件、`LibraryView.vue`、`DictationView.vue`，`App.vue` 阻止区域外文件导航。单文件拒绝多投与格式误投；目录保留分组、子目录、扩展名过滤和跳过计数；忙碌时不重复提交；阶段切换／卸载后忽略迟到上传回填。
- 测试：新增 `frontend/tests/file-drop.test.mjs`（7 项通过）、`upload-drop.mjs`（14 组场景分批通过），更新 npm 入口和浏览器测试说明；隔离 fixture 增加真实书库 PDF 上传，新增测试确认实际 `/ocr-jobs` 仍被禁止。`npm --prefix frontend run build` 通过，保留已有大包提示。
- Python：使用项目 `.venv/bin/python -m pytest`，最终完整运行 **1030 passed in 84.05s**。首次 3 项失败因本机缺少 `pdftoppm`；工具从 Ubuntu 包临时解压到 `/tmp/transcript-poppler/root`，未改生产 PDF 预览逻辑或系统安装状态。最终命令为 `PATH=/tmp/transcript-poppler/root/usr/bin:$PATH LD_LIBRARY_PATH=/tmp/transcript-poppler/root/usr/lib/x86_64-linux-gnu:/tmp/transcript-browser-libs/usr/lib/x86_64-linux-gnu .venv/bin/python -m pytest -o faulthandler_timeout=60`；常规环境仍按安装文档提供 `poppler-utils`。
- 真实运行：浏览器拖入精修 JSON，通过既有导出阶段下载 ZIP，已读取 `final/source.md` 与 `final/source.txt`，正文为“拖拽上传后导出成功。”；书库真实多 PDF 上传未触发 OCR，听写检查实际 XHR 字节／参数并返回受控错误，不运行模型。检查了桌面、375px 及深色实际截图。
- 证据：`frontend/test-results/upload-drop/` 含请求记录、截图、`real-export-state.json` 和 `real-drop-export.zip`。测试后关闭本轮启动的隔离服务；该目录由 Git 忽略。
- codestable：现有规格与能力边界无变更；只补本条实现与验证记录。未改变流水线阶段、生产 API 或中间 JSON。
