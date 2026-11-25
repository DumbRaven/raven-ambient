/**
 * 这个渲染进程是不是子窗口（桌面放映窗 / 专注小窗）。
 *
 * 为什么单独成一个文件：这个判据现在有两个使用者——`media.cjs`（谁能发
 * `media:request`）和 `now-playing.cjs`（谁能发 `now:action` 与谁是那个
 * 「主窗口」）。**必须共用同一份实现**：2026-11-16 那次审计把内联的
 * `includes('mini.html')` 换成了 IsSubWindow 调用，却把这个符号留在了
 * 另一个文件里也没导出，于是 `now-playing.cjs` 每 400ms 抛一次
 * `isSubWindow is not defined`。两份判据各写一遍，迟早会有一份漏掉
 * `desktop.html`——AGENTS.md 里记着这个坑，那次就是这么踩的。
 *
 * 判据看 URL：子窗口各有自己的 html，主窗口是 index.html。
 * URL 拿不到时按**是**处理——宁可让主窗口的一条请求被吃掉，
 * 也不要让子窗口把 `target` 换走（那会让对话框开在一块看不见的窗口上）。
 *
 * @param {Electron.WebContents|null|undefined} webContents
 * @returns {boolean}
 */
function isSubWindow(webContents) {
  if (!webContents || webContents.isDestroyed()) return true;
  const url = webContents.getURL();
  if (!url) return true;
  return url.includes('mini.html') || url.includes('desktop.html');
}

module.exports = { isSubWindow };
