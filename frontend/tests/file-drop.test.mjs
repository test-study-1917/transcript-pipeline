import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filesFromDrop, hasFileDrag, preventFileNavigation, validateDroppedFiles } from '../src/utils/fileDrop.ts';

const file = (name, type = '') => new File(['test'], name, { type });
function fileEntry(value) {
  return { name: value.name, isFile: true, isDirectory: false, file: resolve => resolve(value) };
}
function folder(name, batches) {
  return { name, isFile: false, isDirectory: true, createReader: () => {
    let batch = 0;
    return { readEntries: resolve => resolve(batches[batch++] ?? []) };
  } };
}
function transfer(entries) {
  return { files: [], items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null })) };
}

test('only OS file drags suppress browser navigation; internal reordering is untouched', () => {
  for (const [types, expected] of [[['Files'], true], [['text/plain'], false], [[], false]]) {
    let prevented = false;
    const event = { type: 'dragover', dataTransfer: { types, dropEffect: 'copy' }, preventDefault: () => { prevented = true; } };
    assert.equal(hasFileDrag(event), expected);
    preventFileNavigation(event);
    assert.equal(prevented, expected);
    assert.equal(event.dataTransfer.dropEffect, expected ? 'none' : 'copy');
  }
});

test('single-slot validation never silently takes the first file or misroutes an unsupported format', () => {
  validateDroppedFiles([file('原文.TXT')], '.txt,.pdf', false, '参考原文');
  validateDroppedFiles([file('audio.wav', 'audio/wav')], 'audio/*', false, '听写录音');
  validateDroppedFiles([file('x.pdf', 'application/pdf')], 'application/pdf', true, '书库');
  assert.throws(() => validateDroppedFiles([], '', false, '音频'), /未读取到文件/);
  assert.throws(() => validateDroppedFiles([file('a.txt'), file('b.txt')], '.txt', false, '参考原文'), /只能上传一个/);
  assert.throws(() => validateDroppedFiles([file('movie.mp4')], '.txt', false, '参考原文'), /不符合参考原文/);
  assert.throws(() => validateDroppedFiles([file('a.pdf'), file('b.txt')], '.pdf', true, '书库'), /b.txt/);
});

test('file regions reject folders instead of uploading them as empty files', async () => {
  await assert.rejects(filesFromDrop(transfer([folder('book', [])]), false), /目录上传区/);
});

test('directory drops exhaust every batch and preserve nested relative paths', async () => {
  const batches = Array.from({ length: 3 }, (_, i) =>
    Array.from({ length: 100 }, (_, n) => fileEntry(file(`${i}-${n}.pdf`))));
  const nested = folder('第二章', [[fileEntry(file('正文.txt'))]]);
  const files = await filesFromDrop(transfer([folder('参考资料', [...batches, [nested]])]), true);
  assert.equal(files.length, 301);
  assert.equal(files[0].webkitRelativePath, '参考资料/0-0.pdf');
  assert.equal(files[299].webkitRelativePath, '参考资料/2-99.pdf');
  assert.equal(files[300].webkitRelativePath, '参考资料/第二章/正文.txt');
});

test('all data-transfer handles are captured synchronously before the first asynchronous read', async () => {
  let protectedMode = false;
  const make = name => ({ kind: 'file', webkitGetAsEntry: () => {
    assert.equal(protectedMode, false);
    return { name, isFile: true, file: resolve => { protectedMode = true; queueMicrotask(() => resolve(file(name))); } };
  }, getAsFile: () => { assert.equal(protectedMode, false); return null; } });
  const files = await filesFromDrop({ files: [], items: [make('a.txt'), make('b.txt')] }, true);
  assert.deepEqual(files.map(f => f.name), ['a.txt', 'b.txt']);
});

test('ordinary multi-file drops still work without directory APIs', async () => {
  const files = [file('a.pdf'), file('b.pdf')];
  assert.deepEqual(await filesFromDrop({ files, items: [] }, true), files);
});

test('directory read failures surface instead of accepting a partial set', async () => {
  const entry = { name: 'bad', isDirectory: true, createReader: () => ({ readEntries: (_ok, fail) => fail(new Error('读取失败')) }) };
  await assert.rejects(filesFromDrop(transfer([entry]), true), /读取失败/);
});
