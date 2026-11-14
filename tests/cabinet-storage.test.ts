import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CabinetStorage } from '../src/cabinet-storage.ts';
import { emptyCabinet } from '../src/records.ts';
import { useStore } from '../src/store.ts';

const KEY = 'raven-cabinet-v2', SALVAGE = 'raven-cabinet-v2-unreadable';

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
  assert.deepEqual((await session.load()).cabinet, emptyCabinet);
  session.save({ ...emptyCabinet, master: 30 }); session.save({ ...emptyCabinet, master: 40 });
  assert.equal(JSON.parse(text.get(KEY)!).master, 40);
});

/**
 * 这是本文件里最重要的一条：读盘出问题时，原文必须逐字留一份才能放行。
 *
 * 以前的做法是「一律抛错并锁住保存」——保护数据做到了，但界面会卡在空柜 + 按钮全灰，
 * 用户只能开 DevTools 删 localStorage。反过来「不锁」也不行，那等于把坏掉的那几条抹了。
 * 所以判据变成：**原文进备份键，一个字符不差**，然后才允许覆盖。
 */
test('读不出来的收藏：原文逐字备份，界面可用', async () => {
  for (const raw of ['{"records":[', '', 'null', '{"version":3,"records":[]}', '{"version":2,"records":[{"id":"recoverable"}]}']) {
    const { text } = memory(), session = new CabinetStorage(); text.set(KEY, raw);
    const loaded = await session.load();
    // 坏数据一个字符都不能动，且必须有备份
    assert.equal(text.get(SALVAGE), raw, `原文没备份：${raw}`);
    assert.ok(loaded.broken || loaded.lost >= 0);
    // 界面能继续用：不再抛「已暂停保存」
    assert.doesNotThrow(() => session.save(emptyCabinet));
  }
});

test('备份都写不进去时，宁可锁住保存也不覆盖原文', async () => {
  // 存储写满是很现实的场景。这时绝不能「备份失败但照常覆盖」。
  const { text, driver } = memory(), raw = '{"records":[', session = new CabinetStorage();
  text.set(KEY, raw);
  const write = driver.setText;
  driver.setText = (key: string, value: string) => {
    if (key === SALVAGE) throw new Error('quota');
    write(key, value);
  };
  await session.load();
  assert.throws(() => session.save(emptyCabinet));
  assert.equal(text.get(KEY), raw);
});

test('部分记录坏掉只丢坏的那几条，好唱片照常可用', async () => {
  const { text } = memory(), session = new CabinetStorage();
  const good = { ...emptyCabinet.records[0] ?? {}, id: 'ok-1', assetId: 'a1', name: '好的', category: 'music',
    artist: '', description: '', duration: 100, size: 1000, format: 'mp3', color: '#879a91',
    fingerprint: 'f1', volume: 80, pan: 0, warmth: 0, duckDepth: 9 };
  const bad = { id: 'bad-1', name: '缺 assetId' };
  text.set(KEY, JSON.stringify({ version: 2, records: [good, bad] }));
  const loaded = await session.load();
  assert.equal(loaded.lost, 1);
  assert.equal(loaded.cabinet.records.length, 1);
  assert.equal(loaded.cabinet.records[0].name, '好的');
  assert.ok(text.get(SALVAGE), '丢过记录也要备份原文');
});

test('读取驱动失败时不能把空收藏写回，恢复读取后才可保存', async () => {
  const { text, driver } = memory(), raw = JSON.stringify(emptyCabinet), session = new CabinetStorage();
  text.set(KEY, raw); const read = driver.getText;
  // getText 本身抛错：连备份都读不到原文，这时必须维持锁
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
  assert.deepEqual((await reopened.load()).cabinet.muted, []);
});
