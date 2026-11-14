import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';
const compiled = ts.transpileModule(readFileSync(new URL('../src/utils/errorGuidance.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const { errorGuidance, fetchWithHelp, friendlyErrorMessage, readJsonWithHelp, redactErrorDetails } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('recognizes common failures with a short explanation and practical steps', () => {
  for (const [detail, status, title] of [
    ['curl: (56) Recv failure: Connection reset by peer', 0, '处理过程中连接中断了'],
    ['阶段 6 输出未通过交付校验: 原因=Connection reset by peer', 0, '处理过程中连接中断了'],
    ['Failed to fetch', 0, '网页暂时连不上服务'],
    ['curl: (6) Could not resolve host', 0, '无法连接处理服务'],
    ['curl: (28) Operation timed out', 0, '等待服务回复超时了'],
    ['<html>unavailable</html>', 503, '处理服务暂时不可用'],
    ['', 401, '服务连接验证未通过'], ['', 429, '服务暂时无法接受更多请求'],
    ['CUDA out of memory', 0, '可用内存不足'], ['No space left on device', 0, '存储空间不足'],
    ['No module named faster_whisper', 0, '处理所需的组件尚未准备好'],
    ['No such file or directory', 0, '找不到或无法读取所需材料'],
    ['交付校验失败: invalid JSON', 0, '返回的结果暂时无法使用'],
    ['准备参考 OCR 尚有缺页', 0, '部分书页还没有识别完成'],
    ['NotAllowedError: microphone', 0, '无法使用麦克风'],
    ['Permission denied', 0, '无法读取或保存文件'],
  ]) {
    const guide = errorGuidance(detail, status);
    assert.equal(guide.title, title, detail);
    assert.ok(guide.message.length > 0);
    assert.ok(guide.steps.length >= 2 && guide.steps.length <= 3);
  }
});

test('an exit code alone does not claim a network cause; validation remains useful', () => {
  assert.equal(errorGuidance('job 重跑失败: stage=refine exit_code=1').title, '这次操作没有完成');
  assert.match(friendlyErrorMessage('至少选择一个文件', 422), /至少选择一个文件/);
  assert.doesNotMatch(friendlyErrorMessage('错误: curl: (56) Recv failure: Connection reset by peer'), /curl|Recv failure/);
  assert.doesNotMatch(friendlyErrorMessage('<html>proxy traceback</html>', 502), /<html>/);
});

test('lost browser connection does not retry or imply that submission was rejected', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(fetchWithHelp('/api/jobs', { method: 'POST' }), /先刷新任务列表.*避免重复提交/s);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('support text masks common credentials', () => {
  const safe = redactErrorDetails('Authorization: Bearer secret-value api_key="another-secret" token=hidden sk-secretkey');
  assert.doesNotMatch(safe, /secret-value|another-secret|token=hidden|sk-secretkey/);
});

test('invalid successful response and interrupted body are explained without raw HTML or parser errors', async () => {
  await assert.rejects(readJsonWithHelp(new Response('<html>proxy</html>')), error => {
    assert.match(error.message, /返回的结果暂时无法使用/);
    assert.doesNotMatch(error.message, /<html>|Unexpected token/);
    return true;
  });
  await assert.rejects(readJsonWithHelp({ json: () => Promise.reject(new TypeError('terminated')) }), /网页暂时连不上服务/);
});
