/**
 * 检查更新的结果形状。主进程（electron/update.cjs）与页面共用这一份定义。
 *
 * `current` 是**主进程自己的版本号**（`app.getVersion()`），永远带上。
 * 它跟查询成败无关——这也正是设置面板里那行「Raven Ambient · 0.3.3」
 * 的唯一可信来源：以前它是写死在 JSX 里的，发版后不会变，加了检查更新之后
 * 它就会变成错误信息的来源（界面说 0.3.3，实际上检查的是 0.4.0）。
 *
 * `result` 三选一，页面按 status 判：
 *   current  已经是最新（不显示任何东西）
 *   newer    有新版本，给出版本号、更新说明与下载地址
 *   unknown  查不到（网络、超时、限流、对方格式不对）——静默，不给用户看
 *
 * 为什么 unknown 要区分 reason：用户看不到它，但排查时需要知道是超时还是
 * 根本没拿到 tag。它只写进 console 与探针输出。
 */

export type UpdateOutcome =
  | { status: 'current' }
  | { status: 'newer'; version: string; notes: string; url: string }
  | { status: 'unknown'; reason: string };

export type UpdateReply = {
  /** 主进程报告的本机版本号，例如 `0.4.0`。永远有值。 */
  current: string;
  result: UpdateOutcome;
};
