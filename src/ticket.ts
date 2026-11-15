// 相集的票根。
//
// 一页六张：参考图（docs 里那六张）是竖版单张票的构图，但用户 m13607 要「每页只展示
// 8 个」，后来 m14515 又收到六张——一列排下来六张正好一屏，再多就要往下找。
//
// 票的比例照参考图取：左侧画面约六成九，右侧票根约三成，中间一道齿孔撕线。
// 画面本身按 16:9 完整显示（用户 m14515：「至少应该按 16：9 把画面展示全了」），
// 所以整张票的宽高比是 `16 / 9 / 0.692 ≈ 2.57`，比参考图那张 2.0 更细长。
// 这个比例不在 JS 里算：CSS 让 `.ticket-shot` 自己拿 `aspect-ratio: 16 / 9`，
// 票的高度自然由它撑出来，改画面比例不用同步改两处。
//
// 列数不在这里定。用户 m14515 定的是一列。早先试过 auto-fit 多列：外壳只有
// 760 宽，四列时每张票不到 160px，票根里那行日期会挤成一列字。
//
// 这个文件只有纯算术与数组，不 import React：页数、条码纹理这些都要能直接跑测试，
// 也不必为了验一条除法去起 Electron。

import { hashText } from './hash.ts';

/** 一页六张：一列排下来正好一屏，再多就要滚动。 */
export const TICKET_PAGE_SIZE = 6;

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

/**
 * 把票根页码夹进合法范围。翻页按钮和键盘都要过这一道。
 *
 * 名字里的 `Page` 是这个文件专用的票根页码，别和 `records.ts` 的
 * `clampTicketPage` 混——那个是唱片架的分页，`+Infinity` 在它那儿归零，
 * 在这里顶到最后一页（票根往前翻到头该停在末页，而不是跳回第一页）。
 */
export function clampTicketPage(index: number, total: number): number {
  const last = pageCount(total) - 1;
  // NaN / ±Infinity 不该让调用方自己先判断一遍：正穷顶到最后一页，其余归零。
  if (!Number.isFinite(index)) return index > 0 ? last : 0;
  return Math.min(last, Math.max(0, Math.trunc(index)));
}

export function pageOf(total: number, index: number): TicketPage {
  const safe = clampTicketPage(index, total);
  const from = safe * TICKET_PAGE_SIZE;
  return {
    index: safe,
    pages: pageCount(total),
    from,
    // to 可以是 from —— 最后一页不满六张时它停在列表末尾。
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
  return hashText(text);
}

/**
 * 票号。用它在整张列表里的序号补零到六位 —— 参考图上是 `NO. 20241207`，
 * 那是日期；我们这边没有值得写进票号的日期（文件时间扫库时也没存），
 * 那就老老实实印序号，至少它是真的、翻到第几页都对得上。
 */
export function ticketNo(index: number): string {
  return `NO. ${String(Math.max(0, Math.trunc(index)) + 1).padStart(6, '0')}`;
}

/**
 * 票的外形。用户 m00941 说两种都好看、都要，每张票固定一种。
 *
 * - `modern` 现代电影票：横平竖直的直角矩形，只有中间那列撕线孔。
 * - `retro`  复古票：外缘一圈细密半圆齿 + 四角小圆角，撕线孔照旧。
 *
 * 用 `id:shape` 再散列一次，不直接拿 id 的散列取模：版式已经占了 `% 4`，
 * 同一份散列再 `% 2` 会让形状和版式完全绑死（版式 0/2 永远是同一种形状）。
 *
 * 散列完再搅一次：`image:0:shape`、`image:1:shape` 只差一个字符，FNV 的
 * bit0 会正好一替一个，六张连号票就成了 retro/modern/retro/…，看着像
 * 按序号排的。异或高位 + 乘一个奇数常数把低位打散（实测前 24 个 id
 * 的分布是 010110001011100011011111）。
 */
export type TicketShape = 'modern' | 'retro';

export const ticketShapes: readonly TicketShape[] = ['modern', 'retro'];

export function ticketShape(id: string): TicketShape {
  let hash = ticketHash(`${id}:shape`);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return ticketShapes[(hash >>> 16) % ticketShapes.length];
}

/**
 * 座位与行号。两项都是真的：座位是**这一页里的第几张**（A01..A06），
 * 行号是**第几页** —— 和票根上的 NO.（整表里的位次）互相印证，
 * 翻到第几页、坐在这一页第几个，都能对上。
 *
 * 早先这里用 id 散列编一组假座位，用户 m00941 问「这些信息有意义吗」，
 * 于是换成列表位置。同一个文件不动位置时座位就不变，翻页回来也一样。
 */
export function ticketSeat(index: number, perPage = TICKET_PAGE_SIZE): {
  /** `ROW: 01`，classic 那行整行印。 */
  row: string;
  /** `SEAT: A01`，classic 那行整行印。 */
  seat: string;
  /** 只写页码，stack 版「PAGE」那一行的值。 */
  page: string;
  /** 只写座位，arc 版方框里的值（参考图方框里是 `A 08`，不带前缀）。 */
  place: string;
} {
  const at = Math.max(0, Math.trunc(index));
  const page = Math.floor(at / perPage) + 1;
  const place = `A${String((at % perPage) + 1).padStart(2, '0')}`;
  return {
    row: `ROW: ${String(page).padStart(2, '0')}`,
    seat: `SEAT: ${place}`,
    page: String(page).padStart(2, '0'),
    place,
  };
}

/**
 * 票面上的那一刻。
 *
 * 有文件修改时间就用真的——用户 m01248 让扫描器把 `mtime` 一起带上来，
 * 票面上的 DATE / TIME 现在印的是这张图最后一次被改动的时刻，能和文件对上。
 *
 * 没有 mtime 的（老版本存下来的库、壁纸库条目、测试里的假数据）才回落到
 * id 散列：宁可印一个看起来正常的假日期，也别出现 1970 年或空白。
 * 用本地时区格式化——用户看的是自己电脑上的时间，不是 UTC。
 */
function ticketClock(id: string, mtime?: number): {
  year: string; month: string; day: string; hour: string; minute: string;
} {
  // mtime 是文件系统给的毫秒时间戳。光判 Number.isFinite 不够：Date 能表示的
  // 范围只有 ±8.64e15，1e300 也是「有限正数」，但 new Date(1e300) 是 Invalid Date，
  // 后面 getFullYear() 会返回 NaN，票根上就印出 "NaN" 三个字母。
  if (typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0) {
    const at = new Date(mtime);
    if (!Number.isNaN(at.getTime())) {
      return {
        year: String(at.getFullYear()),
        month: String(at.getMonth() + 1).padStart(2, '0'),
        day: String(at.getDate()).padStart(2, '0'),
        hour: String(at.getHours()).padStart(2, '0'),
        minute: String(at.getMinutes()).padStart(2, '0'),
      };
    }
  }
  const hash = ticketHash(id);
  return {
    year: '2024',
    month: String(4 + (hash % 9)).padStart(2, '0'),
    day: String(1 + (Math.floor(hash / 9) % 12)).padStart(2, '0'),
    hour: String(10 + (Math.floor(hash / 108) % 12)).padStart(2, '0'),
    minute: String(Math.floor(hash / 1296) % 60).padStart(2, '0'),
  };
}

/**
 * 场次日期与时间（classic 版的整行）。
 *
 * 早先这两行是由 id 散列出来的月日与时刻，纯编的；现在优先印文件的修改时间。
 */
export function ticketShowtime(id: string, mtime?: number): { date: string; time: string } {
  const clock = ticketClock(id, mtime);
  return { date: `DATE: ${clock.month} / ${clock.day}`, time: `TIME: ${clock.hour}:${clock.minute}` };
}

/**
 * 票根的版式。
 *
 * 用户 m14823 给了六张参考图，右侧票根的文字排版各不相同，要求「每次打开每张
 * 是随机排版的」。注意是**看起来随机**，不是真随机：同一个文件每次重渲染都得
 * 是同一款，否则翻页回来票面变样、眼睛立刻知道是假的。所以照旧走 id 散列。
 *
 * 四种取的是参考图里差别最大的四种骨架：
 * - `classic`   ref-1 / ref-2：标记、ADMIT ONE、片名、两组两栏字段、票号、条码
 * - `arc`       ref-3 / ref-4：居中标题、星级 ADMIT ONE、带竖分隔的两栏、方框座位
 * - `stack`     ref-5：纵排的「标签在上、值在下」三组，票号用红色大字
 * - `editorial` ref-6：顶部一行小字、大号两行片名、细字说明，条码下压一行影院名
 */
export type TicketLayout = 'classic' | 'arc' | 'stack' | 'editorial';

export const ticketLayouts: readonly TicketLayout[] = ['classic', 'arc', 'stack', 'editorial'];

export function ticketLayout(id: string): TicketLayout {
  return ticketLayouts[ticketHash(id) % ticketLayouts.length];
}

/**
 * 票面上的日期、时间与那行细字。
 *
 * 日期与时间现在来自文件的 mtime（见 `ticketClock`）——真的；那行细字仍然
 * 是从池子里挑的氛围文案（参考图上也是这么印的），没有事实含义。
 *
 * 和 `ticketShowtime` 分开是因为不同版式要不同的粒度：`classic` 用带前缀的
 * 整行（`DATE: 08 / 08`），`stack` 要把标签和值分两行排，`editorial` 又只要
 * 一行细字。都给出来，谁用谁取。
 */
export function ticketStamp(id: string, mtime?: number): { date: string; time: string; fine: string } {
  const clock = ticketClock(id, mtime);
  const hash = ticketHash(id);
  // 说明文字也从池子里挑，同一张票每次一样。纯氛围，参考图上也是这么印的。
  const codes = ['ONE ADMISSION ONLY', 'NON-REFUNDABLE', 'NO RE-ENTRY AFTER START', 'PLEASE KEEP THIS STUB'];
  return {
    date: `${clock.year}.${clock.month}.${clock.day}`,
    time: `${clock.hour}:${clock.minute}`,
    fine: codes[Math.floor(hash / 200000) % codes.length],
  };
}

/**
 * 票号下面那行编码（`stack` 版把它印成红色大字）。
 *
 * 用**媒体类型 + 整表位次**：IMG 000123 / MOV 000007。和 `NO.` 同源，
 * 但多告诉一件事——这是图还是视频。早先是 id 散列出来的七位数字，纯编的。
 */
export function ticketCode(kind: string, index: number): string {
  const at = Math.max(0, Math.trunc(index)) + 1;
  return `${kind === 'video' ? 'MOV' : 'IMG'} ${String(at).padStart(6, '0')}`;
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

/** 一页六张够不够铺满？不满时补几个空位，票根网格才不会被最后一行拽歪。 */
export function ticketBlanks(count: number): number[] {
  const filled = Math.min(TICKET_PAGE_SIZE, Math.max(0, count));
  return Array.from({ length: Math.max(0, TICKET_PAGE_SIZE - filled) }, (_, index) => index);
}

/** 页脚最多摆几个页码按钮。用户 m14515：「你看看是设置最多展示几页然后左右切换」。 */
export const PAGER_WINDOW = 5;

/**
 * 页脚要显示哪几页。
 *
 * 库里 178 件时旧写法会排出三十颗按钮，把整行撑爆——而人翻页从来不会去点第 24 页，
 * 他只在前后来回走。所以只给一扇窗：当前页尽量居中，走到两头时窗口贴边不再滑。
 *
 * 返回的是页码本身（从 0 数），不是窗口起点，调用方不用再换算一次。
 */
export function pagerWindow(current: number, total: number, size = PAGER_WINDOW): number[] {
  const pages = pageCount(total);
  if (pages <= size) return Array.from({ length: pages }, (_, index) => index);
  const index = clampTicketPage(current, total);
  // 窗口减半后往前推，两头夹住：贴边时窗口固定，中间的页才会跟着当前页滑。
  const start = Math.min(pages - size, Math.max(0, index - Math.floor(size / 2)));
  return Array.from({ length: size }, (_, offset) => start + offset);
}
