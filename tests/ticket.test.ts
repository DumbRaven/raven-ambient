import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampTicketPage, pageCount, pageOf, pagerWindow, slipPage, ticketBars, ticketBlanks, ticketHash,
  ticketCode, ticketLayout, ticketLayouts, ticketNo, ticketSeat, ticketShape, ticketShapes,
  ticketShowtime, ticketStamp,
  TICKET_PAGE_SIZE,
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
  assert.equal(clampTicketPage(-3, 20), 0);
  assert.equal(clampTicketPage(99, 20), 3);
  assert.equal(clampTicketPage(1.9, 20), 1);
  assert.equal(clampTicketPage(Number.NaN, 20), 0);
  assert.equal(clampTicketPage(Infinity, 20), 3);
  // 空列表只有第 0 页
  assert.equal(clampTicketPage(5, 0), 0);
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

test('座位与行号是列表位置：本页第几张、第几页', () => {
  assert.deepEqual(ticketSeat(0), { row: 'ROW: 01', seat: 'SEAT: A01', page: '01', place: 'A01' });
  assert.deepEqual(ticketSeat(5), { row: 'ROW: 01', seat: 'SEAT: A06', page: '01', place: 'A06' });
  // 翻到第二页：行号变 02，座位从 A01 重新数
  assert.deepEqual(ticketSeat(6), { row: 'ROW: 02', seat: 'SEAT: A01', page: '02', place: 'A01' });
  // 负序号夹到 0，不出现 ROW: 00
  assert.equal(ticketSeat(-3).row, 'ROW: 01');
  // 一页里六个位置各不相同
  const places = Array.from({ length: 6 }, (_, i) => ticketSeat(i).place);
  assert.equal(new Set(places).size, 6);


  const bars = ticketBars('D:\\media\\ocean.png');
  assert.deepEqual(bars, ticketBars('D:\\media\\ocean.png'));
  assert.equal(bars.length, 32);
  // 归一化到 100，误差留一点给浮点
  const total = bars.reduce((sum, width) => sum + width, 0);
  assert.ok(Math.abs(total - 100) < 1e-6);
  for (const width of bars) assert.ok(width > 0);
});

test('不同的 id 得到不同的条纹（不会整页一个样）', () => {
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

test('有文件修改时间时，票面印的就是文件时间（本地时区）', () => {
  // 用本地时间构造，再按本地时区格式化回来，换台机器也不会因时区挂掉。
  const at = new Date(2023, 7, 21, 14, 5).getTime();
  assert.deepEqual(ticketStamp('a.png', at), {
    date: '2023.08.21',
    time: '14:05',
    // 那行细字仍是 id 决定的氛围文案，跟时间无关。
    fine: ticketStamp('a.png').fine,
  });
  assert.deepEqual(ticketShowtime('a.png', at), { date: 'DATE: 08 / 21', time: 'TIME: 14:05' });
  // 两个函数读的是同一个时刻：classic 与 stack 印出来不能互相打架。
  assert.equal(ticketShowtime('a.png', at).time, `TIME: ${ticketStamp('a.png', at).time}`);

  // 缺失 / 0 / NaN 都回落到散列，绝不会印出 1970 年。
  for (const bad of [undefined, 0, Number.NaN]) {
    assert.equal(ticketStamp('a.png', bad).date, ticketStamp('a.png').date);
  }
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

test('版式由 id 定死：同一个文件永远是同一款，翻页回来不变', () => {
  const ids = ['a.png', 'b.png', 'c.png', 'ocean.png', 'tokyo.mp4', 'snow.jpg'];
  for (const id of ids) {
    assert.equal(ticketLayout(id), ticketLayout(id));
    assert.ok(ticketLayouts.includes(ticketLayout(id)));
  }
});

test('四种版式都会出现，且不是按列表顺序轮流发', () => {
  const ids = Array.from({ length: 80 }, (_, index) => `media/${index}.png`);
  const seen = new Set(ids.map(ticketLayout));
  // 四种都得有：少一种说明取模那一步写死了或者散列塌了。
  assert.equal(seen.size, ticketLayouts.length);
  // 顺序里必须出现相邻两张同版式——那才说明不是「第 n 张发第 n%4 款」。
  const layouts = ids.map(ticketLayout);
  assert.ok(layouts.some((layout, index) => index > 0 && layout === layouts[index - 1]));
});

test('没有文件时间时，日期、时间与细字由 id 定死（回落的装饰值）', () => {
  const stamp = ticketStamp('D:\\media\\ocean.png');
  assert.deepEqual(stamp, ticketStamp('D:\\media\\ocean.png'));
  assert.match(stamp.date, /^2024\.\d{2}\.\d{2}$/);
  assert.match(stamp.time, /^\d{2}:\d{2}$/);
  assert.ok(stamp.fine.length > 4);
  // 这三样不该再出现旧的散列字段
  assert.equal('seat' in stamp, false);
  assert.equal('venue' in stamp, false);

  // 月 4~12、日 1~12（避开「2 / 30」这类不存在的日子），时 10~21。
  for (const id of ['a.png', 'b.png', 'tokyo.mp4']) {
    const { date, time } = ticketStamp(id);
    const [, month, day] = date.match(/^2024\.(\d{2})\.(\d{2})$/)!;
    assert.ok(Number(month) >= 4 && Number(month) <= 12, `month ${month}`);
    assert.ok(Number(day) >= 1 && Number(day) <= 12, `day ${day}`);
    const [, hour] = time.match(/^(\d{2}):/)!;
    assert.ok(Number(hour) >= 10 && Number(hour) <= 21, `hour ${hour}`);
  }
});

test('票形由 id 定死：两种都有，且不跟版式绑死', () => {
  const ids = Array.from({ length: 80 }, (_, index) => `media/${index}.png`);
  for (const id of ids) assert.equal(ticketShape(id), ticketShape(id));
  assert.equal(new Set(ids.map(ticketShape)).size, ticketShapes.length);
  // 版式 %4 的散列如果直接 %2，形状会跟版式完全同向；加后缀再散列就不会。
  const paired = ids.filter(id => ticketShape(id) === 'retro').map(ticketLayout);
  assert.ok(new Set(paired).size > 1);
});

test('编码是媒体类型加列表位次', () => {
  assert.equal(ticketCode('image', 0), 'IMG 000001');
  assert.equal(ticketCode('video', 41), 'MOV 000042');
  assert.equal(ticketCode('image', -2), 'IMG 000001');
});
