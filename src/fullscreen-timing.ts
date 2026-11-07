// 全屏切换的时序工具：把「先窗口、后页面」这件事从组件里抽出来。
//
// 为什么需要单独一个文件：这段逻辑的正确性靠的是「什么时候执行」，
// 而组件里没法验证时序。抽出来之后依赖（取尺寸、下一帧、当前时刻）都能注入，
// 测试里用一个假的时钟和尺寸表就能把每条路径走完。
//
// 背景（踩过的坑）：Windows 进/出真全屏是渐变的，窗口要几十毫秒才变到新尺寸。
// 如果点全屏时页面立刻挂 `.is-expanded`，播放台会先撑满**旧窗口**，
// 窗口变大后又是第二跳，用户看到的就是「先在窗口里铺满，再整个放大」。
// 反过来等窗口尺寸真的变了再铺满，放大就和窗口一起走，看起来只有一跳。
// 实测修前两跳间隔 ~100ms（肉眼可见），修后进入方向中间那帧是小尺寸满屏、
// 退出方向是满屏跟窗口一起缩——两个方向都不再有「旧窗口里撑满」。

/** 尺寸轮询的兜底上限：窗口万一没变（主进程没响应），也不能让点击没有下文。 */
export const RESIZE_TIMEOUT = 250;

/** 切换冷却。系统过渡期间的连点会让窗口和页面错开，必须挡住。 */
export const TOGGLE_COOLDOWN = 320;

export type WaitDeps = {
  /** 取当前视口尺寸。变了就说明窗口动了。 */
  size: () => { width: number; height: number };
  /** 请求下一帧，返回一个可以取消的句柄。 */
  frame: (run: () => void) => number;
  /** 取消一帧。 */
  cancel: (handle: number) => void;
  /** 当前时刻（毫秒）。 */
  now: () => number;
};

/**
 * 等视口尺寸变化后执行 run，最多等 timeout 毫秒。
 *
 * 返回取消函数。被取消时 run 不会执行——连续点两次时，前一次还在等的那个回调
 * 必须作废，否则两次点击会各自触发一次铺满/撤回。
 */
export function afterResize(deps: WaitDeps, run: () => void, timeout = RESIZE_TIMEOUT): () => void {
  const start = deps.size();
  const startedAt = deps.now();
  let handle: number | null = null;
  let live = true;

  const tick = () => {
    if (!live) return;
    const now = deps.size();
    if (now.width !== start.width || now.height !== start.height) {
      live = false;
      run();
      return;
    }
    if (deps.now() - startedAt > timeout) {
      live = false;
      run();
      return;
    }
    handle = deps.frame(tick);
  };

  handle = deps.frame(tick);

  return () => {
    live = false;
    if (handle !== null) deps.cancel(handle);
  };
}

/**
 * 这次点击该不该被忽略。
 *
 * 只拦「上一次切换之后很短的时间里」的连点：Windows 的全屏过渡本身要
 * 一百多毫秒，期间的第二次点击会让 setFullScreen 收到相反的值，
 * 窗口停在一半，而页面已经按照另一个值铺满或撤回——两边就错开了。
 */
export function canToggle(lastAt: number, now: number): boolean {
  return now - lastAt >= TOGGLE_COOLDOWN;
}
