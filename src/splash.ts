/**
 * 开屏动画的收尾控制。
 *
 * 开屏本身是 index.html 里的静态 HTML + CSS，一到就开始渲染，
 * 用来盖住 bundle 下载和第一次读收藏那段空白。
 * 这里只负责决定「什么时候撤」：动画播完**并且**应用已经就绪，两个条件都满足才淡出。
 */

/** 淡出时长，与 index.html 里 #splash 的 transition 保持一致。 */
export const SPLASH_FADE = 520;

/**
 * 等开屏里最长的那个动画自己走完。
 *
 * 不自己算时间：CSS 动画跑在自己的 document timeline 上，窗口没显示时照样在推进，
 * 用 performance.now() 另起一个裁判，两边一定会错位，动画就会在尾巴上被截断。
 * 直接等 Web Animations 给的 finished，动画什么时候完由它说了算。
 */
function animationDone(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const running = document.getAnimations().filter(animation => {
    const name = (animation as CSSAnimation).animationName;
    return typeof name === 'string' && name.startsWith('splash-');
  });
  if (!running.length) return Promise.resolve();
  return Promise.all(running.map(animation => animation.finished.catch(() => undefined))).then(() => undefined);
}

let leaving = false;

/**
 * 撤掉开屏。重复调用没有副作用，只有第一次生效。
 * 应用可能在开屏还没播完时就准备好了，所以要等动画走完再撤，不然会截断。
 */
export async function dismissSplash(): Promise<void> {
  if (leaving || typeof document === 'undefined') return;
  leaving = true;
  const splash = document.getElementById('splash');
  if (!splash) return;
  await animationDone();
  splash.classList.add('is-leaving');
  window.setTimeout(() => splash.remove(), SPLASH_FADE + 60);
}
