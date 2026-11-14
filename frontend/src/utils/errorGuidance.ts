export interface ErrorGuide {
  title: string;
  message: string;
  steps: string[];
}

/** Deterministic explanations: never infer a specific cause from an exit code alone. */
export function errorGuidance(detail: string, status = 0): ErrorGuide {
  const guide = (title: string, message: string, ...steps: string[]): ErrorGuide => ({ title, message, steps });
  if (/NotAllowedError|麦克风.*(权限|允许)|权限.*麦克风/i.test(detail))
    return guide('无法使用麦克风', '浏览器尚未允许录音，或录音权限已被关闭。', '在浏览器地址栏旁的网站权限中允许使用麦克风。', '确认选中了可用的麦克风，再重新开始录音。');
  if (status === 401 || status === 403 || /\b(401|403)\b|unauthorized|invalid.api.key|authentication|API.?密钥.*(未|无效)|未.*API.?密钥/i.test(detail))
    return guide('服务连接验证未通过', '远程服务拒绝了当前连接信息或访问权限。', '打开“设置”，核对服务地址和访问密钥。', '请维护人员确认密钥有效、账号有权限后，再重试失败的操作。');
  if (status === 429 || /\b429\b|rate.limit|quota|余额不足|额度不足/i.test(detail))
    return guide('服务暂时无法接受更多请求', '可能是请求过于频繁，或服务额度已用完。', '先等几分钟，避免连续点击重试。', '仍然失败时，请维护人员检查额度和服务限制。');
  if (/no space left|disk.*full|磁盘.*(不足|已满)|空间不足/i.test(detail))
    return guide('存储空间不足', '服务器没有足够空间继续保存文件。', '请维护人员清理服务器中不再需要的文件，保留原件和已完成结果。', '确认有可用空间后，再重试失败的步骤。');
  if (/cuda.*out of memory|out of memory|显存不足|内存不足|MemoryError/i.test(detail))
    return guide('可用内存不足', '当前处理需要的内存或显存超过了可用容量。', '等待其他转写任务结束，或关闭占用资源较多的程序。', '重新尝试；仍然失败时，请维护人员调整模型或处理设置。');
  if (/permission denied|read.only file|无.*写入权限|没有.*权限/i.test(detail))
    return guide('无法读取或保存文件', '程序没有访问相关文件或文件夹的权限。', '确认文件仍然存在，且没有被其他程序锁定。', '请维护人员检查文件夹的读写权限，再重试。');
  if (/connection reset|recv failure|broken pipe|unexpected eof|未收到.*完成|response.*incomplete|流式.*(中断|截断)|流.*未完整/i.test(detail))
    return guide('处理过程中连接中断了', '远程服务的回复没有完整传回来，本次结果未能确认完成。', '确认网络可用，稍等片刻。', '点击任务的“展开详情”，只重试失败的阶段；整理失败时选择“校对润色”，再点“从该阶段重跑”，可复用已有转录。', '仍然失败时，复制下方求助信息发给维护人员。');
  if (status === 408 || status === 504 || /timed? ?out|timeout|超时|curl.*\(28\)/i.test(detail))
    return guide('等待服务回复超时了', '服务在规定时间内没有完成回复，可能正忙或连接较慢。', '稍等片刻，先查看任务状态，确认它是否仍在运行。', '确认失败后再重试该步骤；仍然超时则联系维护人员。');
  if (/failed to fetch|networkerror|network request failed|load failed|无法连接本机服务/i.test(detail))
    return guide('网页暂时连不上服务', '当前无法确认操作是否已被服务器接收。', '检查设备网络，并确认运行本程序的电脑和服务已开启。', '恢复连接后先刷新任务列表，确认状态，再决定是否重试，避免重复提交。');
  if (/could not resolve|name.*resolution|connection refused|failed to connect|无法解析|连接被拒绝|curl.*\([567]\)/i.test(detail))
    return guide('无法连接处理服务', '服务地址暂时无法访问，可能与网络、地址设置或服务停机有关。', '检查网络，稍等片刻再试。', '仍然失败时，请维护人员核对服务地址、代理和服务运行状态。');
  if (status >= 500 || /\b(500|502|503|504)\b|bad gateway|service unavailable|上游.*不可用/i.test(detail))
    return guide('处理服务暂时不可用', '服务器或远程处理服务没有正常响应。', '稍等几分钟，再查看任务状态。', '确认任务失败后重试该步骤；持续失败请联系维护人员。');
  if (status === 413 || /file too large|文件.*过大|超出.*大小/i.test(detail))
    return guide('文件超过上传大小限制', '当前文件太大，服务无法接收。', '选择更小的文件，或将材料拆分后上传。', '如必须处理原文件，请维护人员调整上传限制。');
  if (/ffmpeg.*(未|not found)|ModuleNotFoundError|No module named|依赖.*(缺失|未安装)|模型.*(未下载|不存在)/i.test(detail))
    return guide('处理所需的组件尚未准备好', '服务器缺少需要的软件组件或模型。', '把下方求助信息发给维护人员，等待组件准备完成。', '准备好后只重试失败的阶段。');
  if (status === 404 || /no such file|file not found|文件不存在|文件.*(损坏|无法读取)|invalid data found|不支持.*格式/i.test(detail))
    return guide('找不到或无法读取所需材料', '文件可能已移动、已删除，或格式无法识别。', '检查已选材料是否正确，必要时重新上传。', '若历史任务缺少中间文件，请维护人员确认文件是否仍保留。');
  if (/缺页|缺失页|OCR.*(中断|失败)|部分.*识别/i.test(detail))
    return guide('部分书页还没有识别完成', '请先查看页面进度，确认哪些书页仍待处理。', '使用“重试缺失页”补齐未完成页面。', '完成后核对页数；反复失败的页面请交给维护人员检查。');
  if (/交付校验|content_validation|locked_quote|invalid json|JSON.*解析|结果.*不完整|内容.*过滤/i.test(detail))
    return guide('返回的结果暂时无法使用', '处理服务返回的内容不完整或格式不符合要求，因此没有作为成功结果交付。', '重试失败的处理步骤。', '再次失败时，复制求助信息交给维护人员；不要把本次结果当作完整稿。');
  if (status === 409 || /意外中断|服务重启|interrupted|冲突|正在运行|仍在运行/i.test(detail))
    return guide('需要先确认任务状态', '任务可能仍在运行、发生了中断，或内容已被另一个窗口更新。', '先刷新任务状态；有未保存文字时先复制或下载备份。', '仍在运行则等待；确认已失败或中断后，再使用页面上的重试入口。');
  if (status === 400 || status === 422 || /配置|缺少|不能为空|不支持|至少.*选择|必须.*选择/i.test(detail))
    return guide('请检查材料或设置', '当前输入或设置未满足处理要求。', '核对必填项、所选文件和模型设置。', '调整后重新提交；不清楚如何调整时，把求助信息发给维护人员。');
  return guide('这次操作没有完成', '目前的信息还不足以确定具体原因。', '先刷新任务状态；有未保存文字时先复制或下载备份。', '确认失败后重试该操作；若再次失败，请复制求助信息联系维护人员。');
}

export function friendlyErrorMessage(detail: string, status = 0): string {
  const help = errorGuidance(detail, status);
  return `${help.title}。${plainErrorHint(detail) || help.message}\n${help.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`;
}

export function plainErrorHint(detail: string): string {
  return /[\u4e00-\u9fff]/.test(detail) && detail.length < 240
    && !/exit_code|Traceback|HTTP|curl|Error:|\/|\\|stage=|Bearer|sk-|api[ _-]?key|token\s*[:=]|password\s*[:=]|密钥\s*[:=]/i.test(detail)
    ? detail : '';
}

/** Preserve uncertain-submit semantics: a failed fetch must never automatically resubmit. */
export async function fetchWithHelp(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try { return await fetch(input, init); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new Error(friendlyErrorMessage('无法连接本机服务'));
  }
}

export async function readJsonWithHelp<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch (cause) {
    throw new Error(friendlyErrorMessage(cause instanceof SyntaxError ? 'invalid JSON response' : 'Failed to fetch'));
  }
}

export function redactErrorDetails(detail: string): string {
  return detail
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [已隐藏]')
    .replace(/((?:api[ _-]?key|access[_-]?token|token|password|authorization|密钥)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏]');
}
