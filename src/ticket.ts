// 相集的票根。
//
// 一页八张：参考图（docs 里那六张）是竖版单张票的构图，但用户 m13607 要「每页只展示
// 8 个」，摊成两行正好八张，不用再往下滚。票的比例照参考图取 —— 左侧画面约六成，
// 右侧票根约四成，中间一道齿孔撕线。
//
// 列数不在这里定。它由 CSS 的 auto-fit 决定：外壳只有 760 宽，写死四列时每张票不到
// 160px，票根里那行日期会挤成一列字。所以「一页八张」与「一行几张」是两件事，
// 别把它俩绑在同一个常量上（原本有个 TICKET_COLUMNS 就是这么被误当成日期用的）。
//
// 这个文件只有纯算术与数组，不 import React：页数、条码纹理这些都要能直接跑测试，
// 也不必为了验一条除法去起 Electron。

/** 一页八张。参考图是单张票，八张要摊成两行才不显得空。 */
export const TICKET_PAGE_SIZE = 8;

export type TicketPage = {
  /** 从 0 数。 */
  index: number;
  /** 总页数，至少 1 —— 空库时也占一页，免得页脚写成 0/0。 */
  pages: number;
  /** 这一页第一张在整张列表里的下标。 */
  from: number;
  /** 这一页最后一张的下标（不含）。 */
  to: number;
};

/** 一共几页。至少 1：空列表也是「一页」，只是那一页上没有票。 */
export function pageCount(total: number): number {
  const count = Math.floor(total / TICKET_PAGE_SIZE);
  return Math.max(1, total % TICKET_PAGE_SIZE === 0 ? count : count + 1);
}

/** 把页码夹进合法范围。翻页按钮和键盘都要过这一道。 */
export function clampPage(index: number, total: number): number {
  const last = pageCount(total) - 1;
  // NaN / ±Infinity 不该让调用方自己先判断一遍：正穷顶到最后一页，其余归零。
  if (!Number.isFinite(index)) return index > 0 ? last : 0;
  return Math.min(last, Math.max(0, Math.trunc(index)));
}

export function pageOf(total: number, index: number): TicketPage {
  const safe = clampPage(index, total);
  const from = safe * TICKET_PAGE_SIZE;
  return {
    index: safe,
    pages: pageCount(total),
    from,
    // to 可以是 from —— 最后一页不满八张时它停在列表末尾。
    to: Math.min(total, from + TICKET_PAGE_SIZE),
  };
}

/**
 * 某一页上那几张。
 *
 * 只切数组不改顺序：票根上的 `NO.` 用的是**它在整张列表里的序号**，
 * 不是这一页里的第几张 —— 翻页时票号不该跳。
 */
export function slipPage<T>(items: T[], index: number): T[] {
  const page = pageOf(items.length, index);
  return items.slice(page.from, page.to);
}

/** FNV-1a。条码与座位号都要「同一个文件每次都长一样」，所以不能用 Math.random。 */
export function ticketHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 票号。用它在整张列表里的序号补零到六位 —— 参考图上是 `NO. 20241207`，
 * 那是日期；我们这边没有值得写进票号的日期（文件时间扫库时也没存），
 * 那就老老实实印序号，至少它是真的、翻到第几页都对得上。
 */
export function ticketNo(index: number): string {
  return `NO. ${String(Math.max(0, Math.trunc(index)) + 1).padStart(6, '0')}`;
}

/** 池子里的行号与座位。纯装饰，用 id 散列固定下来，同一个文件永远是同一个座。 */
export function ticketSeat(id: string): { row: string; seat: string } {
  const hash = ticketHash(id);
  const row = `ROW: ${String((hash % 12) + 1).padStart(2, '0')}`;
  const letter = 'ABCDEFGH'[Math.floor(hash / 12) % 8];
  const seat = `SEAT: ${letter}${String(Math.floor(hash / 96) % 24 + 1).padStart(2, '0')}`;
  return { row, seat };
}

/**
 * 场次日期与时间。
 *
 * 票根上原本印的是「文件大小」和「第几张 / 每页几张」——前一个是字节数，
 * 后一个是布局常量，两样都不该出现在一张电影票上。这里换成由 id 散列出来的
 * 月日与时刻：同一个文件永远是同一场，翻页回来不会变。
 *
 * 日期取 4 月到 12 月（避开 1、2 月，那两个月在 31 号上容易凑出「2 / 30」这种
 * 不存在的日子），日用 12 的模，保证不论哪个月都是合法日期。
 */
export function ticketShowtime(id: string): { date: string; time: string } {
  const hash = ticketHash(id);
  const month = String(4 + (hash % 9)).padStart(2, '0');
  const day = String(1 + (Math.floor(hash / 9) % 12)).padStart(2, '0');
  const hour = String(10 + (Math.floor(hash / 108) % 12)).padStart(2, '0');
  const minute = String(Math.floor(hash / 1296) % 60).padStart(2, '0');
  return { date: `DATE: ${month} / ${day}`, time: `TIME: ${hour}:${minute}` };
}

/**
 * 条码的条纹宽度（相对单位，加起来是 100）。
 *
 * 真条码有校验位、编码规则，这里不需要能被扫出来 —— 它承担的是「一张票」的形状。
 * 但必须**同一个文件每次都一样**，否则换页回来条纹会跳，眼睛立刻看得出是假的。
 */
export function ticketBars(id: string): number[] {
  const hash = ticketHash(id);
  const bars: number[] = [];
  let seed = hash || 1;
  for (let i = 0; i < 32; i += 1) {
    // 换位异或：比取模散得更开，相邻两条不会总是同宽。
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    bars.push(1 + (seed % 3));
  }
  // 归一化到 100，交给 flex 直接当 flex-grow 用。
  const sum = bars.reduce((total, width) => total + width, 0);
  return bars.map(width => (width / sum) * 100);
}

/** 一页八张够不够铺满两行？不满时补几个空位，票根网格才不会被最后一行拽歪。 */
export function ticketBlanks(count: number): number[] {
  const filled = Math.min(TICKET_PAGE_SIZE, Math.max(0, count));
  return Array.from({ length: Math.max(0, TICKET_PAGE_SIZE - filled) }, (_, index) => index);
}
