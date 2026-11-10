import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPage, pageCount, pageOf, slipPage, ticketBars, ticketBlanks, ticketHash,
  ticketNo, ticketSeat, ticketShowtime, TICKET_PAGE_SIZE,
} from '../src/ticket.ts';

test('一页八张：0 件也算一页，8 件整一页，9 件两页', () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(1), 1);
  assert.equal(pageCount(8), 1);
  assert.equal(pageCount(9), 2);
  assert.equal(pageCount(16), 2);
  assert.equal(pageCount(17), 3);
});

test('页码越界夹回来，小数与 NaN 都不会让页面炸掉', () => {
  assert.equal(clampPage(-3, 20), 0);
  assert.equal(clampPage(99, 20), 2);
  assert.equal(clampPage(1.9, 20), 1);
  assert.equal(clampPage(Number.NaN, 20), 0);
  assert.equal(clampPage(Infinity, 20), 2);
  // 空列表只有第 0 页
  assert.equal(clampPage(5, 0), 0);
});

test('pageOf 给出这一页的下标范围，最后一页不满也停得住', () => {
  assert.deepEqual(pageOf(20, 0), { index: 0, pages: 3, from: 0, to: 8 });
  assert.deepEqual(pageOf(20, 2), { index: 2, pages: 3, from: 16, to: 20 });
  assert.deepEqual(pageOf(0, 0), { index: 0, pages: 1, from: 0, to: 0 });
});

test('slipPage 只切这一页，不动原数组', () => {
  const items = Array.from({ length: 20 }, (_, index) => index);
  assert.deepEqual(slipPage(items, 0), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(slipPage(items, 2), [16, 17, 18, 19]);
  assert.deepEqual(slipPage(items, 9), [16, 17, 18, 19]);
  assert.equal(items.length, 20);
});

test('票号是列表里的位次，补零到六位', () => {
  assert.equal(ticketNo(0), 'NO. 000001');
  assert.equal(ticketNo(7), 'NO. 000008');
  assert.equal(ticketNo(-4), 'NO. 000001');
});

test('同一个 id 的座位与条码固定不变', () => {
  const first = ticketSeat('D:\\media\\ocean.png');
  const again = ticketSeat('D:\\media\\ocean.png');
  assert.deepEqual(first, again);
  assert.match(first.row, /^ROW: \d{2}$/);
  assert.match(first.seat, /^SEAT: [A-H]\d{2}$/);

  const bars = ticketBars('D:\\media\\ocean.png');
  assert.deepEqual(bars, ticketBars('D:\\media\\ocean.png'));
  assert.equal(bars.length, 32);
  // 归一化到 100，误差留一点给浮点
  const total = bars.reduce((sum, width) => sum + width, 0);
  assert.ok(Math.abs(total - 100) < 1e-6);
  for (const width of bars) assert.ok(width > 0);
});

test('不同的 id 得到不同的条纹与座位（不会整页一个样）', () => {
  const a = ticketBars('a.png');
  const b = ticketBars('b.png');
  assert.notDeepEqual(a, b);
  assert.notEqual(ticketHash('a.png'), ticketHash('b.png'));
});

test('场次由 id 决定，日期合法且翻页不变', () => {
  const first = ticketShowtime('D:\\media\\ocean.png');
  assert.deepEqual(first, ticketShowtime('D:\\media\\ocean.png'));
  assert.match(first.date, /^DATE: 0[4-9]|^DATE: 1[0-2]/);
  assert.match(first.date, /^DATE: \d{2} \/ \d{2}$/);
  assert.match(first.time, /^TIME: \d{2}:\d{2}$/);

  // 月日与时分都得是真实存在的读数：日期 4~12 月、日 1~12、时 10~21、分 0~59。
  for (const id of ['a.png', 'b.png', 'c.png', 'ocean.png', 'tokyo.mp4']) {
    const { date, time } = ticketShowtime(id);
    const [, month, day] = date.match(/^DATE: (\d{2}) \/ (\d{2})$/)!;
    assert.ok(Number(month) >= 4 && Number(month) <= 12, `month ${month}`);
    assert.ok(Number(day) >= 1 && Number(day) <= 12, `day ${day}`);
    const [, hour, minute] = time.match(/^TIME: (\d{2}):(\d{2})$/)!;
    assert.ok(Number(hour) >= 10 && Number(hour) <= 21, `hour ${hour}`);
    assert.ok(Number(minute) <= 59, `minute ${minute}`);
  }

  // 不同文件的场次不该整页一个样。
  assert.notDeepEqual(ticketShowtime('a.png'), ticketShowtime('b.png'));
});

test('空位补到八个，满页不补', () => {
  assert.deepEqual(ticketBlanks(8), []);
  assert.deepEqual(ticketBlanks(0), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(ticketBlanks(3).length, TICKET_PAGE_SIZE - 3);
});
