// Run against tests.frontend_workbench_server + Vite (see README). No model calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.WORKBENCH_URL ?? 'http://127.0.0.1:15179';
const output = resolve(process.env.WORKBENCH_OUTPUT ?? 'test-results/upload-drop');
const marker = await fetch(`${base}/api/__workbench_test__`).then(r => r.json());
assert(marker.isolated && marker.model_execution === false, 'Refusing to test a non-isolated API');
await mkdir(output, { recursive: true });
const browser = process.env.CDP_URL
  ? await chromium.connectOverCDP(process.env.CDP_URL)
  : await chromium.launch({ headless: true, executablePath: process.env.UPLOAD_TEST_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
if (process.env.UPLOAD_TEST_FONT) {
  const font = await readFile(process.env.UPLOAD_TEST_FONT);
  await context.route('**/__upload-test-font.ttf', route => route.fulfill({ body: font, contentType: 'font/ttf' }));
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const face = new FontFace('UploadTestChinese', 'url(/__upload-test-font.ttf)');
      document.fonts.add(face);
      void face.load();
      const style = document.createElement('style');
      style.textContent = "body { font-family: UploadTestChinese, sans-serif !important; }";
      document.head.append(style);
    });
  });
}
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], requests = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (r.method() === 'POST') requests.push(r); });
const zone = label => page.getByRole('region', { name: `${label}上传区`, exact: true });
const field = label => page.locator('.n-form-item').filter({ has: zone(label) }).locator('.n-input input').first();
const f = (name, type = '', text = '拖拽上传验证。') => ({ name, type, text });
async function visit(path) {
  await page.goto(`${base}/${path}`);
  await page.locator('.page-heading').waitFor();
  await page.locator('input[type=file]').first().waitFor({ state: 'attached' });
  await page.evaluate(() => document.fonts.ready);
}
async function check(name, action) {
  if (process.env.UPLOAD_TEST_FILTER && !new RegExp(process.env.UPLOAD_TEST_FILTER).test(name)) return;
  await action(); checks.push(name); console.log(`PASS ${name}`);
}
async function drop(target, files) {
  await target.evaluate((el, values) => {
    const data = new DataTransfer();
    for (const v of values) data.items.add(new File([v.text], v.name, { type: v.type }));
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }, files);
}
async function upload(label, file, kind, endpoint = '/api/uploads') {
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === endpoint);
  await drop(zone(label), [file]);
  const received = await response;
  assert(received.ok(), await received.text());
  const url = new URL(received.url());
  if (kind) assert.equal(url.searchParams.get('kind'), kind);
  const result = await received.json();
  if (await field(label).count()) await page.waitForFunction(({ path, label }) => {
    const el = document.querySelector(`[aria-label="${label}上传区"]`)?.closest('.n-form-item');
    return [...(el?.querySelectorAll('input') ?? [])].some(input => input.value === path);
  }, { path: result.path, label });
  return result;
}

try {
  await check('single job: media, reference and glossary stay isolated, including nested button drops', async () => {
    await visit('single-job');
    const media = await upload('视频或音频文件', f('录屏.mp4', 'video/mp4'), 'video');
    assert.equal(await field('参考源文件').inputValue(), '');
    const response = page.waitForResponse(r => r.url().includes('/api/uploads?') && r.request().method() === 'POST');
    await drop(zone('参考源文件').getByRole('button'), [f('参考原文.txt', 'text/plain')]);
    const reference = await (await response).json();
    assert.equal(await field('视频或音频文件').inputValue(), media.path);
    await page.getByText('参考原文.txt', { exact: true }).waitFor();
    assert.equal(await field('参考源文件').inputValue(), reference.path);
    await page.locator('summary').filter({ hasText: '高级参数' }).click();
    await upload('术语词表', f('术语.txt', 'text/plain'), 'glossary');
    assert.equal(await field('视频或音频文件').inputValue(), media.path);
    assert.equal(await field('参考源文件').inputValue(), reference.path);
    await page.screenshot({ path: `${output}/single-desktop.png`, fullPage: true });
  });
  await check('bad format, multi-file misdrop and outside drop never upload or change existing fields', async () => {
    const count = requests.length, before = await field('参考源文件').inputValue();
    await drop(zone('参考源文件'), [f('误投.mp4', 'video/mp4')]);
    await page.getByText(/误投.mp4 不符合参考源文件/).waitFor();
    await drop(zone('参考源文件'), [f('甲.txt'), f('乙.txt')]);
    await page.getByText(/参考源文件每次只能上传一个文件/).waitFor();
    await drop(page.locator('.page-heading'), [f('区域外.txt')]);
    await page.waitForTimeout(150);
    assert.equal(requests.length, count);
    assert.equal(await field('参考源文件').inputValue(), before);
    assert.equal(new URL(page.url()).pathname, '/single-job');
  });
  await check('hover highlights only the target; leaving child elements does not clear the highlight', async () => {
    const data = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['x'], '原文.txt')); return d; });
    await zone('参考源文件').dispatchEvent('dragenter', { dataTransfer: data });
    assert(await zone('参考源文件').evaluate(el => el.classList.contains('is-dragging')));
    assert.equal(await page.locator('.file-drop-zone.is-dragging').count(), 1);
    const button = zone('参考源文件').getByRole('button');
    await button.dispatchEvent('dragenter', { dataTransfer: data });
    await button.dispatchEvent('dragleave', { dataTransfer: data });
    assert(await zone('参考源文件').evaluate(el => el.classList.contains('is-dragging')));
    await zone('参考源文件').dispatchEvent('dragleave', { dataTransfer: data });
    assert.equal(await page.locator('.file-drop-zone.is-dragging').count(), 0);
    await data.dispose();
  });
  await check('busy region blocks duplicate drops and recovers after upload failure', async () => {
    let release, started;
    const pending = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { started = resolve; });
    await page.route('**/api/uploads?**', async route => {
      started(); await pending;
      await route.fulfill({ status: 400, json: { detail: '上传失败回归测试' } });
    });
    const count = requests.length;
    await drop(zone('参考源文件'), [f('失败.txt')]); await seen;
    await page.waitForFunction(() => document.querySelector('[aria-label="参考源文件上传区"]').getAttribute('aria-disabled') === 'true');
    await drop(zone('参考源文件'), [f('不可重复.txt')]);
    assert.equal(requests.length, count + 1);
    release();
    await page.getByText('上传失败回归测试', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="参考源文件上传区"]').getAttribute('aria-disabled') === 'false');
    await page.unroute('**/api/uploads?**');
  });
  await check('existing click-to-select upload remains usable', async () => {
    const response = page.waitForResponse(r => r.url().includes('/api/uploads?') && r.request().method() === 'POST');
    await zone('参考源文件').locator('input[type=file]').setInputFiles({ name: '点击选择.txt', mimeType: 'text/plain', buffer: Buffer.from('原入口仍可用。') });
    assert((await response).ok());
    await page.getByText('点击选择.txt', { exact: true }).waitFor();
  });
  await check('batch manifest and glossary keep their own upload kinds', async () => {
    await visit('batch-job');
    await upload('Manifest 清单', f('manifest.json', 'application/json', '{}'), 'manifest');
    await page.locator('summary').filter({ hasText: '高级参数' }).click();
    await upload('术语词表', f('批量术语.txt', 'text/plain'), 'glossary');
  });
  await check('batch paired directories: multiple files filter by target type without cross-writing', async () => {
    await visit('batch-job');
    await page.getByText('目录自动配对', { exact: true }).click();
    let responses = [];
    const listener = r => { if (new URL(r.url()).pathname === '/api/uploads' && r.request().method() === 'POST') responses.push(r); };
    page.on('response', listener);
    await drop(zone('视频或音频目录'), [f('第一课.mp4', 'video/mp4'), f('第二课.wav', 'audio/wav'), f('忽略.txt')]);
    await page.waitForFunction(() => document.querySelector('[aria-label="视频或音频目录上传区"]').getAttribute('aria-disabled') === 'false');
    await zone('视频或音频目录').getByText('2 个文件', { exact: true }).waitFor();
    assert.equal(responses.length, 2);
    assert(responses.every(r => new URL(r.url()).searchParams.get('kind') === 'video'));
    const videoPath = await field('视频或音频目录').inputValue();
    assert.equal(await field('参考源目录').inputValue(), '');
    await drop(zone('参考源目录'), [f('第一课.txt'), f('第二课.md')]);
    await zone('参考源目录').getByText('2 个文件', { exact: true }).waitFor();
    assert.equal(responses.length, 4);
    assert(responses.slice(2).every(r => new URL(r.url()).searchParams.get('kind') === 'reference'));
    assert.equal(await field('视频或音频目录').inputValue(), videoPath);
    assert.notEqual(await field('参考源目录').inputValue(), videoPath);
    page.off('response', listener);
    await page.screenshot({ path: `${output}/batch-directories.png`, fullPage: true });
    await page.getByText('目录共享参考', { exact: true }).click();
    await upload('共享参考文件', f('共享.txt', 'text/plain'), 'reference');
  });
  await check('stage inputs: every stage targets its own endpoint; simultaneous TXT inputs never cross-write', async () => {
    await visit('stage-runner');
    const stages = [
      ['音频提取 (extract-audio)', 'extract-audio', [['视频或音频文件', 'video', 'movie.mp4']]],
      ['语音识别 (transcribe)', 'transcribe', [['音频文件', 'audio', 'speech.wav']]],
      ['参考准备 (prepare-reference)', 'prepare-reference', [['参考文件', 'reference', 'reference.txt']]],
      ['块级对齐 (align)', 'align', [['ASR JSON', 'asr_json', 'asr.json'], ['参考 TXT', 'reference_txt', 'reference.txt']]],
      ['候选分类 (classify)', 'classify', [['对齐 JSON', 'aligned_json', 'aligned.json']]],
      ['LLM 精修 (refine)', 'refine', [['ASR TXT', 'asr_txt', 'speech.txt'], ['参考 TXT', 'reference_txt', 'reference.txt']]],
      ['导出文档 (export-markdown)', 'export-markdown', [['精修 JSON', 'refined_json', 'refined.json']]],
    ];
    // Labels come from the live stage selector, not a separate frontend stage list.
    for (const [, stage, slots] of stages) {
      await page.locator('.select-stage .n-base-selection').click();
      await page.locator('.n-base-select-option').filter({ hasText: `(${stage})` }).click();
      for (const [label, key, name] of slots) {
        await zone(label).waitFor();
        const result = await upload(label, f(name, '', name.endsWith('.json') ? '{"final_markdown":"# 拖拽验证\\n\\n拖拽上传后导出成功。"}' : '参考文字。'), null, `/api/stage-inputs/${stage}/${key}`);
        assert(result.path.includes(`/stage-inputs/${stage}/${key}/`));
        await zone(label).getByText(name, { exact: true }).waitFor();
      }
      assert.equal(await page.locator('.file-drop-zone').count(), slots.length);
    }
    const submitted = page.waitForResponse(r => r.url().includes('/export-markdown/file-run') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '运行并生成下载包', exact: true }).click();
    const response = await submitted;
    assert.equal(response.status(), 202);
    const { run_id } = await response.json();
    let state;
    for (let i = 0; i < 50; i++) {
      state = await fetch(`${base}/api/stage-runs/${run_id}`).then(r => r.json());
      if (['success', 'failed'].includes(state.status)) break;
      await page.waitForTimeout(100);
    }
    assert.equal(state.status, 'success', JSON.stringify(state));
    await writeFile(`${output}/real-export-state.json`, JSON.stringify(state, null, 2));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载结果 ZIP', exact: true }).click();
    await (await download).saveAs(`${output}/real-drop-export.zip`);
  });
  await check('late stage upload cannot populate a different stage sharing the same reference slot', async () => {
    await visit('stage-runner');
    async function select(stage) {
      await page.locator('.select-stage .n-base-selection').click();
      await page.locator('.n-base-select-option').filter({ hasText: `(${stage})` }).click();
      await zone('参考 TXT').waitFor();
    }
    await select('align');
    let release, arrived;
    const held = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { arrived = resolve; });
    await page.route('**/api/stage-inputs/align/reference_txt?**', async route => {
      const response = await route.fetch(); arrived(); await held;
      await route.fulfill({ response });
    });
    await drop(zone('参考 TXT'), [f('旧阶段原文.txt')]); await seen;
    await select('refine');
    release();
    await page.waitForFunction(() => document.querySelector('[aria-label="参考 TXT上传区"]').getAttribute('aria-disabled') === 'false');
    assert.equal(await zone('参考 TXT').getByText('旧阶段原文.txt', { exact: true }).count(), 0);
    await page.unroute('**/api/stage-inputs/align/reference_txt?**');
    await upload('参考 TXT', f('新阶段原文.txt'), null, '/api/stage-inputs/refine/reference_txt');
    await zone('参考 TXT').getByText('新阶段原文.txt', { exact: true }).waitFor();
  });
  await check('dragged folders keep nested relative paths and one group, only in the chosen directory zone', async () => {
    await visit('batch-job');
    await page.getByText('目录自动配对', { exact: true }).click();
    const responses = [];
    const listener = r => { if (new URL(r.url()).pathname === '/api/uploads' && r.request().method() === 'POST') responses.push(r); };
    page.on('response', listener);
    await zone('参考源目录').evaluate(el => {
      const file = name => ({ name, isFile: true, isDirectory: false,
        file: resolve => queueMicrotask(() => resolve(new File(['原文'], name, { type: 'text/plain' }))) });
      const folder = (name, children) => ({ name, isFile: false, isDirectory: true, createReader: () => {
        let read = false;
        return { readEntries: resolve => { resolve(read ? [] : children); read = true; } };
      } });
      const root = folder('参考资料', [folder('第一章', [file('原文.txt')]), file('补充.txt')]);
      const data = new DataTransfer(); data.items.add(new File([''], 'placeholder'));
      Object.defineProperty(data, 'items', { value: [{ kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null }] });
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await zone('参考源目录').getByText('2 个文件', { exact: true }).waitFor();
    assert.equal(responses.length, 2);
    const urls = responses.map(r => new URL(r.url()));
    assert.deepEqual(urls.map(u => u.searchParams.get('relative_path')), ['参考资料/第一章/原文.txt', '参考资料/补充.txt']);
    assert.equal(urls[0].searchParams.get('group_id'), urls[1].searchParams.get('group_id'));
    assert(urls.every(u => u.searchParams.get('kind') === 'reference'));
    assert.equal(await field('视频或音频目录').inputValue(), '');
    page.off('response', listener);
  });
  await check('PDF OCR single-file and directory use pdf_ocr, not reference or library uploads', async () => {
    await visit('pdf/ocr');
    await upload('PDF 书籍', f('单本.pdf', 'application/pdf'), 'pdf_ocr');
    await page.getByText('PDF 目录', { exact: true }).click();
    const response = page.waitForResponse(r => r.url().includes('/api/uploads?') && r.request().method() === 'POST');
    await drop(zone('PDF目录'), [f('书一.pdf', 'application/pdf'), f('不上传.txt')]);
    assert.equal(new URL((await response).url()).searchParams.get('kind'), 'pdf_ocr');
    await zone('PDF目录').getByText('1 个文件', { exact: true }).waitFor();
  });
  await check('library accepts multiple real PDFs without starting OCR', async () => {
    await visit('pdf/library');
    const bytes = execFileSync(resolve(import.meta.dirname, '../../.venv/bin/python'), ['-c', 'import io,base64;from pypdf import PdfWriter;p=PdfWriter();p.add_blank_page(width=200,height=200);b=io.BytesIO();p.write(b);print(base64.b64encode(b.getvalue()).decode())']).toString().trim();
    const responses = [];
    const listener = r => { if (new URL(r.url()).pathname === '/api/library/books' && r.request().method() === 'POST') responses.push(r); };
    page.on('response', listener);
    await zone('书库 PDF').evaluate((el, encoded) => {
      const d = new DataTransfer(), bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      for (const name of ['拖拽书一.pdf', '拖拽书二.pdf']) d.items.add(new File([bytes], name, { type: 'application/pdf' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d }));
    }, bytes);
    await page.waitForFunction(() => document.querySelector('[aria-label="书库 PDF上传区"]').getAttribute('aria-disabled') === 'false');
    await page.getByText('拖拽书二.pdf 已在书库中。', { exact: true }).waitFor();
    assert.equal(responses.length, 2);
    assert(responses.every(r => r.ok()));
    const body = await responses[0].json();
    assert.equal(body.page_count, 1); assert.equal(body.ready_pages, 0);
    assert(!requests.some(r => /\/(?:ocr|ocr-jobs)(?:\?|$)/.test(r.url())));
    page.off('response', listener);
    await page.screenshot({ path: `${output}/library.png`, fullPage: true });
  });
  await check('dictation drop uses the existing recording upload request; backend rejection remains visible', async () => {
    await visit('dictation?mode=upload');
    await page.route('**/api/dictation/uploads?**', route => route.fulfill({ status: 400, json: { detail: '听写上传路由已验证（不运行模型）' } }));
    const received = page.waitForRequest(r => r.url().includes('/api/dictation/uploads?') && r.method() === 'POST');
    await drop(zone('听写录音'), [f('录音.wav', 'audio/wav')]);
    const request = await received;
    assert.equal(new URL(request.url()).searchParams.get('filename'), '录音.wav');
    assert.equal(request.postDataBuffer().toString(), '拖拽上传验证。');
    await page.getByText('听写上传路由已验证（不运行模型）', { exact: true }).waitFor();
    await page.unroute('**/api/dictation/uploads?**');
    await page.screenshot({ path: `${output}/dictation.png`, fullPage: true });
  });
  await check('375px and dark mode: every visible upload input has a labelled, readable, non-overflowing zone', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const route of ['single-job', 'batch-job', 'stage-runner', 'pdf/library', 'pdf/ocr', 'dictation?mode=upload']) {
      await visit(route);
      for (const input of await page.locator('input[type=file]').all()) {
        assert(await input.evaluate(el => !!el.closest('.file-drop-zone[aria-label]')), `${route}: missing zone`);
      }
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(geometry.scroll <= geometry.width + 1, `${route}: overflow ${JSON.stringify(geometry)}`);
      await page.screenshot({ path: `${output}/mobile-${route.replaceAll(/[^a-z]+/g, '-')}.png`, fullPage: true });
    }
    await visit('single-job');
    await page.locator('.theme-toggle-btn').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.n-input')).backgroundColor === 'rgba(255, 255, 255, 0.1)');
    await page.screenshot({ path: `${output}/single-mobile-dark.png`, fullPage: true, animations: 'disabled' });
  });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/${process.env.UPLOAD_TEST_FILTER ? 'results-followup' : 'results'}.json`, JSON.stringify({ checks, errors, uploadRequests: requests.map(r => r.url()) }, null, 2));
} finally { await context.close(); await browser.close(); }
