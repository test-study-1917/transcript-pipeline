// Isolated UI checks only. No real ASR/OCR/model calls or production writes.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.WORKBENCH_URL || 'http://127.0.0.1:15179';
const output = resolve(process.env.WORKBENCH_OUTPUT || 'tmp/error-help-20261115');
const marker = await fetch(`${base}/api/__workbench_test__`).then(r => r.json());
assert.equal(marker.isolated, true);
assert.equal(marker.model_execution, false);
const jobs = await fetch(`${base}/api/jobs`).then(r => r.json());
const actual = jobs.items.find(item => /Connection reset by peer/.test(item.error_detail || ''));
const sample = actual || { id: 'ui-example-network', kind: 'job', status: 'failed', current_stage: 'refine',
  error_message: 'stage=refine exit_code=1', error_detail: 'curl: (56) Connection reset by peer' };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
if (process.env.ERROR_HELP_FONT) {
  const font = await readFile(process.env.ERROR_HELP_FONT);
  await context.route('**/__error-help-font.ttf', route => route.fulfill({ body: font, contentType: 'font/ttf' }));
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', async () => {
      const face = new FontFace('ErrorHelpChinese', 'url(/__error-help-font.ttf)');
      document.fonts.add(face); await face.load();
      const style = document.createElement('style');
      style.textContent = 'body { font-family: ErrorHelpChinese, sans-serif !important; }';
      document.head.append(style);
    });
  });
}
const page = await context.newPage();
const errors = [], checks = [], submissions = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', request => { if (request.method() === 'POST') submissions.push(request.url()); });
try {
  if (!actual) await page.route('**/api/jobs', route => route.fulfill({ json: { items: [sample] } }));
  await page.goto(`${base}/jobs`);
  const real = page.locator('.status-card').filter({ hasText: sample.id });
  await real.getByText('处理过程中连接中断了', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const panel = real.locator('.error-help');
  assert.equal(await panel.isVisible(), true, 'guidance must be visible even with task details collapsed');
  assert.equal(await real.getByText('从指定阶段重新运行', { exact: true }).isVisible(), false);
  assert.equal(await panel.locator('ol li').count(), 3);
  assert.match(await panel.locator('ol').innerText(), /校对润色.*从该阶段重跑/);
  assert.equal(await panel.locator('pre').isVisible(), false);
  await real.screenshot({ path: `${output}/real-network-desktop.png` });
  await panel.locator('summary').click();
  assert.match(await panel.locator('pre').innerText(), /Connection reset by peer/);
  await panel.getByRole('button', { name: '复制求助信息' }).click();
  await panel.getByText('已复制，可发给维护人员', { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes(sample.id));
  await real.screenshot({ path: `${output}/real-network-support.png` });
  checks.push(`${actual ? 'actual archived failure' : 'fixture failure'}: readable explanation, three steps, details collapsed by default, clipboard support`);

  await page.setViewportSize({ width: 375, height: 812 });
  await real.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await real.screenshot({ path: `${output}/real-network-mobile.png` });
  checks.push('375px layout has no horizontal overflow, including expanded technical detail');

  let shown = { id: 'test-error', kind: 'job', status: 'failed', current_stage: 'transcribe', error_message: 'stage=transcribe exit_code=1', error_detail: 'CUDA out of memory' };
  await page.unroute('**/api/jobs');
  await page.route('**/api/jobs', route => route.fulfill({ json: { items: [shown] } }));
  await page.goto(`${base}/jobs`);
  await page.getByText('可用内存不足', { exact: true }).waitFor();
  shown = { ...shown, error_detail: '' };
  await page.getByRole('button', { name: '刷新任务列表', exact: true }).click();
  await page.getByText('这次操作没有完成', { exact: true }).waitFor();
  checks.push('memory error is explained; an exit code alone does not claim a network cause');

  await page.unroute('**/api/jobs');
  await page.route('**/api/jobs', route => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: '刷新任务列表', exact: true }).click();
  await page.getByText('任务列表加载失败', { exact: true }).waitFor();
  assert.match(await page.locator('.n-alert').first().innerText(), /网页暂时连不上服务/);
  assert.equal(submissions.length, 0, 'no retries or model requests may be triggered');
  assert.deepEqual(errors, []);
  checks.push('disconnected browser receives plain-language recovery steps without automatically submitting anything');
  await writeFile(`${output}/browser-checks.json`, JSON.stringify({ checks, page_errors: errors, submissions }, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} finally { await browser.close(); }
