import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPage, pageCount, pageOf, pagerWindow, slipPage, ticketBars, ticketBlanks, ticketHash,
  ticketNo, ticketSeat, ticketShowtime, TICKET_PAGE_SIZE,
} from '../src/ticket.ts';

test('一页六张：0 件也算一页，6 件整一页，7 件两页', () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(1), 1);
  assert.equal(pageCount(6), 1);
  assert.equal(pageCount(7), 2);
  assert.equal(pageCount(12), 2);
  assert.equal(pageCount(13), 3);
  assert.equal(TICKET_PAGE_SIZE, 6);
});

test('页码越界夹回来，小数与 NaN 都不会让页面炸掉', () => {
  assert.equal(clampPage(-3, 20), 0);
  assert.equal(clampPage(99, 20), 3);
  assert.equal(clampPage(1.9, 20), 1);
  assert.equal(clampPage(Number.NaN, 20), 0);
  assert.equal(clampPage(Infinity, 20), 3);
  // 空列表只有第 0 页
  assert.equal(clampPage(5, 0), 0);
});

test('pageOf 给出这一页的下标范围，最后一页不满也停得住', () => {
  assert.deepEqual(pageOf(20, 0), { index: 0, pages: 4, from: 0, to: 6 });
  assert.deepEqual(pageOf(20, 3), { index: 3, pages: 4, from: 18, to: 20 });
  assert.deepEqual(pageOf(0, 0), { index: 0, pages: 1, from: 0, to: 0 });
});

test('slipPage 只切这一页，不动原数组', () => {
  const items = Array.from({ length: 20 }, (_, index) => index);
  assert.deepEqual(slipPage(items, 0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(slipPage(items, 3), [18, 19]);
  assert.deepEqual(slipPage(items, 9), [18, 19]);
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

test('空位补到六个，满页不补', () => {
  assert.deepEqual(ticketBlanks(6), []);
  assert.deepEqual(ticketBlanks(0), [0, 1, 2, 3, 4, 5]);
  assert.equal(ticketBlanks(3).length, TICKET_PAGE_SIZE - 3);
});

test('页脚只摆五颗页码，当前页尽量居中、两头贴边不空转', () => {
  // 页数不超过五页就全给
  assert.deepEqual(pagerWindow(0, 12), [0, 1]);
  assert.deepEqual(pagerWindow(0, 30), [0, 1, 2, 3, 4]);
  // 中间页：当前页落在正中
  assert.deepEqual(pagerWindow(3, 60), [1, 2, 3, 4, 5]);
  assert.deepEqual(pagerWindow(6, 60), [4, 5, 6, 7, 8]);
  // 最后一页：窗口贴右，不会滑到越界
  assert.deepEqual(pagerWindow(9, 60), [5, 6, 7, 8, 9]);
  assert.deepEqual(pagerWindow(99, 60), [5, 6, 7, 8, 9]);
  // 空库只有一页
  assert.deepEqual(pagerWindow(0, 0), [0]);
});
