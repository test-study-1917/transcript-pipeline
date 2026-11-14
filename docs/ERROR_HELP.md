# 普通使用者的错误提示

网页失败时，先展示问题说明与两至三个操作步骤，再提供默认收起的“求助信息 / 技术详情”。
用户不需要使用 Codex 或打开服务器日志；仍无法解决时可以复制带任务编号、失败阶段与底层原因的信息交给维护人员。
浏览器无法访问剪贴板时会提示手动选中文字复制。常见密钥、Bearer 令牌和密码会在求助文本中遮盖。

## 覆盖范围

- 单任务与单阶段任务的状态卡片：即使卡片收起，仍显示恢复提示。
- 批量任务及失败子任务。
- PDF 书籍识别的任务／书籍错误、书库单页错误。
- 语音输入页的全局错误、全文整理与逐句处理错误。
- 通用 API、书库 API 与常规上传请求：网络失败、HTTP 错误和无法读取的响应显示中文说明与处理步骤。

已覆盖连接重置、浏览器断网、服务地址不可达、等待超时、服务不可用、访问验证失败、请求频率／额度限制、
文件过大、文件不存在或损坏、读写权限、磁盘不足、内存／显存不足、组件缺失、书页缺失、结果校验失败及任务状态冲突。
未知错误明确说明“目前的信息还不足以确定具体原因”；保留简短、可直接操作的原有中文提示，不把错误码当成具体原因。

对于浏览器断网或上传结果不确定，提示先恢复连接并查看任务状态，避免重复提交。
对于整理阶段连接中断，提示点击“展开详情”，选择“校对润色”，再点“从该阶段重跑”，复用已有转录。
原有模型、重试策略、处理流程与完整交付校验保持原样。

## 失败原因如何传到页面

`src/stage_error.py` 在原有阶段异常处理处另存小型错误摘要，退出码与原有日志照常保留。
摘要使用独立文件，位于当前运行的 `logs_dir/stage-failures/<stage>/`；记录失败时间、异常类型与有限长度的消息。
写摘要失败时继续保留原来的失败行为，不以磁盘或权限错误掩盖原始异常。

`src/web/error_details.py` 仅在读取失败状态时补充可选的 `error_detail` 字段，不改写状态文件或上游产物。
只读取当前任务、当前阶段且时间匹配的小型摘要；缺失、损坏或过大的摘要不会影响状态 API。
既有双步整理任务可从最近一次 `experiment.json` 取得原始失败信息。
已成功的更新运行、其他阶段、过期证据或服务重启不会被解释成历史模型失败。
历史单步任务没有可用小型摘要时仍显示保守的通用流程，不解析大型 SSE 来猜测原因。

## 本轮修改文件

- 后端：`api_server.py`、`src/pipeline/stages.py`、`src/stage_error.py`、`src/web/error_details.py`。
- 共享前端：`frontend/src/utils/errorGuidance.ts`、`frontend/src/components/ErrorHelp.vue`、`frontend/src/api/client.ts`、`frontend/src/api/library.ts`。
- 展示入口：`JobStatusCard.vue`、`LibraryBookDetail.vue`、`BatchJobView.vue`、`PDFBookOCRView.vue`、`DictationView.vue`。
- 验证：`tests/test_error_help.py`、`frontend/tests/error-guidance.test.mjs`、`frontend/tests/error-help.mjs`、`frontend/package.json`。
- 文档：`README.md`、本文件与 `frontend/tests/README.md`。

## 验证记录（2026-11-15）

- `.venv/bin/python -m pytest`：1048 通过、1 失败，73.77 秒。
  唯一失败为已有的 `tests/test_config.py::test_load_settings_success`：测试固定期望 OCR 并发 40，当前本地配置为 3；
  本轮未改动该配置或该测试，不能将全量测试报告为通过。
- 改动后定向回归：`.venv/bin/python -m pytest tests/test_error_help.py tests/test_pipeline_capability.py tests/test_api_server.py`，74 通过。
- 发布前从 GitHub 当前 `main` 建立独立分支，并在仅含已提交文件的干净 worktree 使用同一项目 `.venv` 运行
  `.venv/bin/python -m pytest`：1049 全部通过，69.79 秒。该工作区使用版本库配置，未带入个人 OCR 并发等本地修改。
- `npm --prefix frontend run test:error-help`：5 通过，覆盖错误分类、未知原因、浏览器断网不重试、无效响应及求助文本遮盖。
- `npm --prefix frontend run build`：类型检查和生产构建通过；仍有既有的产物体积提示。
- 在隔离服务中使用真实失败任务 `fbf9fc626a0f` 的状态和小型诊断验证：显示“处理过程中连接中断了”，
  操作流程正确，技术详情默认收起，剪贴板复制包含任务编号；375px 页面无横向溢出。
  另以受控内存错误、未知退出码与浏览器断网检查分类和恢复提示。未执行 ASR、OCR 或模型请求。
- 真实记录与截图保存在 `tmp/error-help-20261115/`，其中 `real-job-check.json` 记录原任务状态摘要未变，
  `browser-checks.json` 记录浏览器检查。原始失败记录不是本轮新发起的模型运行。

已按 `docs/REVIEW_CHECKLIST.md` 核对范围、兼容性、测试与真实输出。
本轮只改错误信息的保留和呈现；未新增识别算法、重跑 ASR、改变模型或推进新的流水线阶段。
识别类别基于已知错误特征，不保证所有第三方错误都能准确分类；无法判断时保留通用恢复步骤。

## 使用与后续

前端已生成生产产物；运行中的后端进程需要重新加载新代码。
Docker 使用镜像内代码与前端产物，需要重新构建并更新容器后才会生效；本轮没有重启现有服务或容器。
下一步先在维护窗口更新运行服务，再从任务列表查看原失败任务的提示，无需重新付费调用模型。
干净发布工作区的全量测试已通过；个人本地配置与固定值断言的差异应独立处理，不能为通过测试而回改使用者的 OCR 并发设置。
