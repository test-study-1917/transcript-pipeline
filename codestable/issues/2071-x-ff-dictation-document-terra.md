---
kind: issue
title: 语音输入全文校对默认改为 Terra
type: ff
status: closed
created: 2026-11-07
---

# 语音输入全文校对默认改为 Terra

新会话全文校对默认从 `gemini-3.8-flash-high` 改为 `gpt-6.1-terra`，强度仍为 `high`。逐句 Flash Lite/medium 不变；菜单和创建请求允许显式选择 Terra，已有会话、显式选择及旧字段缺省语义保留。

- 改动：`src/dictation/schemas.py`、`frontend/src/views/DictationView.vue`、3份听写测试、`frontend/tests/dictation-notebook.mjs`、`docs/{DICTATION,PIPELINE_PLAN}.md`。
- 验证：`.venv/bin/python -m pytest`：1029 passed（72.11s）；前端 build 通过；真实浏览器/API/存储集成32项通过、0页面异常，已查看设置截图，全文显示 Terra/high，逐句保持 Flash Lite/medium。回归覆盖请求载荷、新会话冻结、显式 Terra 与旧 Flash 会话。日志 `tmp/dictation-terra-default-pytest.log`，浏览器产物 `tmp/dictation-notebook-1794102061935/`；语音和整理使用确定性 fixture，未调用真实模型。
- codestable：无独立 project spec；已在 `2046-o-two-pass-dictation.md` 顶部同步当前默认及本记录链接，历史记录保留。按 REVIEW_CHECKLIST 自评，无上游结构变化或未来阶段扩展；未部署或重启服务。
