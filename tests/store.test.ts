import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getText, readAsset, removeText, setText, storeAsset, storeName, useStore, type StoreDriver } from '../src/store.ts';

/** 一个纯内存驱动，用来验证接口本身的行为，不依赖浏览器。 */
function memoryDriver(): StoreDriver & { text: Map<string, string>; blobs: Map<string, Blob>; mirrored: Map<string, string> } {
  const text = new Map<string, string>();
  const blobs = new Map<string, Blob>();
  const mirrored = new Map<string, string>();
  return {
    name: 'memory',
    text,
    blobs,
    mirrored,
    getText: key => text.get(key) ?? null,
    setText: (key, value) => { text.set(key, value); },
    removeText: key => { text.delete(key); },
    readBlob: async key => blobs.get(key),
    writeBlob: async (key, value) => { if (value) blobs.set(key, value); else blobs.delete(key); },
    mirrorText: async (key, value) => { mirrored.set(key, value); },
  };
}

test('换驱动之后读写都走新的那一个', () => {
  const driver = memoryDriver();
  useStore(driver);
  setText('raven-test', 'hello');
  assert.equal(getText('raven-test'), 'hello');
  assert.equal(driver.text.get('raven-test'), 'hello');
  assert.equal(storeName(), 'memory');
});

test('删除文本后读到 null，而不是空字符串', () => {
  useStore(memoryDriver());
  setText('temp', 'x');
  removeText('temp');
  assert.equal(getText('temp'), null);
});

test('资产能存能取，存的是同一个 Blob 内容', async () => {
  const driver = memoryDriver();
  useStore(driver);
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
  await storeAsset('asset-1', blob);
  const back = await readAsset('asset-1');
  assert.ok(back);
  assert.equal(back.type, 'audio/wav');
  assert.deepEqual([...new Uint8Array(await back.arrayBuffer())], [1, 2, 3]);
});

test('不传 value 等于删除资产，读回来是 undefined', async () => {
  useStore(memoryDriver());
  await storeAsset('asset-2', new Blob(['x']));
  await storeAsset('asset-2');
  assert.equal(await readAsset('asset-2'), undefined);
});

test('没有 mirrorText 的驱动不会让 setText 报错', () => {
  const driver = memoryDriver();
  delete (driver as { mirrorText?: unknown }).mirrorText;
  useStore(driver);
  assert.doesNotThrow(() => setText('no-mirror', 'ok'));
  assert.equal(getText('no-mirror'), 'ok');
});

test('镜像失败不影响主存储——写成功就算成功', async () => {
  const driver = memoryDriver();
  driver.mirrorText = async () => { throw new Error('镜像盘挂了'); };
  useStore(driver);
  assert.doesNotThrow(() => setText('mirror-fail', 'value'));
  assert.equal(getText('mirror-fail'), 'value');
});

test('有 mirrorText 时会把同一份内容镜像出去', async () => {
  const driver = memoryDriver();
  useStore(driver);
  setText('raven-cabinet-v2', '{"a":1}');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(driver.mirrored.get('raven-cabinet-v2'), '{"a":1}');
});
