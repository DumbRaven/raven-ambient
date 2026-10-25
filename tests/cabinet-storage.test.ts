import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CabinetStorage } from '../src/cabinet-storage.ts';
import { emptyCabinet } from '../src/records.ts';
import { useStore } from '../src/store.ts';

const KEY = 'raven-cabinet-v2';
function memory() {
  const text = new Map<string, string>();
  const driver = { name: 'isolated-tests', getText: (key: string) => text.get(key) ?? null,
    setText: (key: string, value: string) => { text.set(key, value); }, removeText: (key: string) => { text.delete(key); },
    readBlob: async () => undefined, writeBlob: async () => {} };
  useStore(driver); return { text, driver };
}
test('首次使用须先成功读取，随后可以正常连续保存', async () => {
  const { text } = memory(), session = new CabinetStorage();
  assert.throws(() => session.save(emptyCabinet));
  assert.deepEqual(await session.load(), emptyCabinet);
  session.save({ ...emptyCabinet, master: 30 }); session.save({ ...emptyCabinet, master: 40 });
  assert.equal(JSON.parse(text.get(KEY)!).master, 40);
});
test('损坏、未知版本、部分坏记录一律保留原文并锁住保存', async () => {
  for (const raw of ['{"records":[', '', 'null', '{"version":3,"records":[]}', '{"version":2,"records":[{"id":"recoverable"}]}']) {
    const { text } = memory(), session = new CabinetStorage(); text.set(KEY, raw);
    await assert.rejects(session.load());
    assert.throws(() => session.save(emptyCabinet));
    assert.equal(text.get(KEY), raw);
  }
});
test('读取驱动失败时不能把空收藏写回，恢复读取后才可保存', async () => {
  const { text, driver } = memory(), raw = JSON.stringify(emptyCabinet), session = new CabinetStorage();
  text.set(KEY, raw); const read = driver.getText;
  driver.getText = () => { throw new Error('unavailable'); };
  await assert.rejects(session.load()); driver.getText = read;
  assert.throws(() => session.save({ ...emptyCabinet, master: 15 })); assert.equal(text.get(KEY), raw);
  await session.load(); session.save({ ...emptyCabinet, master: 15 });
});
test('旧窗口不能用过期快照覆盖新窗口保存的收藏', async () => {
  const { text } = memory(), a = new CabinetStorage(), b = new CabinetStorage();
  await a.load(); await b.load();
  a.save({ ...emptyCabinet, master: 33 }); const saved = text.get(KEY);
  assert.throws(() => b.save({ ...emptyCabinet, master: 70 }));
  assert.equal(text.get(KEY), saved);
});
test('写满失败不会推进快照，释放空间后可重试原修改', async () => {
  const { driver } = memory(), session = new CabinetStorage(); await session.load();
  const write = driver.setText; driver.setText = () => { throw new Error('quota'); };
  assert.throws(() => session.save(emptyCabinet)); driver.setText = write;
  assert.doesNotThrow(() => session.save(emptyCabinet));
});
test('环境音的单独暂停不进存档，重开软件回到全部流动', async () => {
  const { text } = memory(), session = new CabinetStorage(); await session.load();
  // 内存里这次运行是有效的：写了什么就是什么
  session.save({ ...emptyCabinet, ambience: ['a1'], muted: ['a1'] });
  // 但落到盘上的永远是空名单
  assert.deepEqual(JSON.parse(text.get(KEY)!).muted, []);
  assert.deepEqual(JSON.parse(text.get(KEY)!).ambience, ['a1']);
  // 下一次从盘里读回来，自然就是「没暂停任何一路」
  const reopened = new CabinetStorage();
  assert.deepEqual((await reopened.load()).muted, []);
});

