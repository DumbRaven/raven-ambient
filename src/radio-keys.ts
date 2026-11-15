/**
 * `role="radiogroup"` 的方向键。
 *
 * 为什么需要这个文件：把一组按钮写成 `role="radio"` 之后，屏幕阅读器会按
 * 「单选组」去读它，于是用户会**预期**上下左右能换选项——这是 ARIA 对
 * radiogroup 的硬性要求，不是锦上添花。可 `<button role="radio">` 本身
 * 只认 Tab 与回车，方向键什么都不做。缺了这一段，视障用户听到「单选组，
 * 共三项」之后，只能靠猜哪一个能按。
 *
 * 为什么不写成每个按钮各自的 `onKeyDown`：那样二十来个按钮要重复挂二十遍，
 * 而且判断「下一个是谁」得每个按钮都知道自己排第几。挂在组容器上，
 * 事件从按钮冒泡上来，一次问清「组里现在有几个、焦点在第几个」就够了。
 *
 * 行为对齐原生 `<input type="radio">`：
 * - 右/下换下一个，左/上换上一个，首尾循环；
 * - Home 跳第一个，End 跳最后一个；
 * - **焦点跟着选项走**，并且选中项也跟着变（原生就是这样，不同于 tablist）。
 */

const NEXT = ['ArrowRight', 'ArrowDown'];
const PREV = ['ArrowLeft', 'ArrowUp'];
const FIRST = ['Home'];
const LAST = ['End'];

/**
 * 挂在 `role="radiogroup"` 的容器上。
 *
 * 只认 `role="radio"` 的后代按钮；禁用的跳过（不可选就不该被方向键选中）。
 * 返回 true 表示这一下已经被用掉——调用方若是自己也监听 keydown，可据此让路。
 */
export function radioKeyDown(event: React.KeyboardEvent<HTMLElement>): boolean {
  const key = event.key;
  const handled = NEXT.includes(key) || PREV.includes(key) || FIRST.includes(key) || LAST.includes(key);
  if (!handled) return false;

  const group = event.currentTarget;
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    .filter(radio => !radio.disabled);
  if (!radios.length) return false;

  const current = radios.indexOf(event.target as HTMLButtonElement);
  // 焦点还没落在组里任何一项上时（比如刚 Tab 到容器），从第一项开始算。
  const from = current < 0 ? -1 : current;

  let next: number;
  if (FIRST.includes(key)) next = 0;
  else if (LAST.includes(key)) next = radios.length - 1;
  else if (NEXT.includes(key)) next = from < 0 ? 0 : (from + 1) % radios.length;
  else next = from <= 0 ? radios.length - 1 : from - 1;

  const target = radios[next];
  // 拦下来，否则方向键会顺带滚动整页——放射映页尤其明显，一按就跳走。
  event.preventDefault();
  target.focus();
  // 点一下而不是只聚焦：单选组是「焦点到哪儿就选中哪儿」。
  target.click();
  return true;
}
