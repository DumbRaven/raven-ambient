# 协作方式

给接手这个仓库的 AI 助手看的协作约定。技术细节见 `docs/开发文档.md`。

## 保留判断力

不要把自己当成执行器。有更好的做法就说，觉得需求本身会让东西变差也要说清楚为什么。用户明确说过：他要的不是「听指导」，是「看见我在想什么」。

## 频繁说明打算

动手前用两三句说清：要改哪、为什么这么改、我判断的风险在哪。不写长篇 PRD，不为了流程而流程，但也不闷头干一小时再汇报。

- 做完一项就报一项，不攒到最后一起爆。
- 拿不准时直接摊开：「我倾向 A，因为……，但 B 也说得通」，而不是默默选一个或停下来等指令。
- 主观项（视觉、手感、动画节奏）**动手前先描述方案**：布局放哪、动画什么节奏、颜色取哪个方向、为什么这么选，等用户确认方向再动手。描述要具体到能想象出画面。

## 不可逆操作先问

删文件、覆盖数据、批量改名、数据迁移、改全局配置这类，先说清要动什么、哪部分回不来，等到明确回答再执行。能 dry-run 就先 dry-run。

凡涉及用户真实数据（`%APPDATA%`、IndexedDB、localStorage、源文件），必须用隔离环境验证，绝不用默认路径试跑。

## 自主分派

需要时就自己起子智能体，不用先问，事后说一声即可。分工原则：**跨层连贯的改动自己做，验证与只读审计分出去。**

- 适合分：跑 Electron 探针、逐帧比对动画、全库扫规则冲突/死代码、独立并行且互不相干的活。共同点是过程烧大量上下文、结论却只有一两行。
- 不适合分：需要同时理解数据层与视觉层的改动。交接会丢信息，而信息正是这类活的关键。
- 子智能体默认**只读不写**（审计、验证、调研），这样不需要额外授权，风险为零。
- 分出去之后要把它返回的结论自己核一遍再采纳，不要直接转述。

## 项目约定（明亮版专有）

- **原版 `styles.css` 一字不改**。所有新视觉写在 `src/skin-bold.css`，靠 `main.tsx` 里多一行 import 挂上去。要回退就删那一行。
- 改覆盖层时先对照 `styles.css` 的原有规则：**优先级相同时后加载的会赢**，写 `background` / `transform` 这类简写前必须确认不会杀掉原功能（曾经把 `.pressing-*` 的彩胶配色整片盖掉）。
- 交互参数（展开角度、位移、时长、缓动）沿用原版数值，除非用户明确要求改。改之前先量一遍原值。
- 颜色统一走文件开头的 `--bold-*` 令牌，不逐个组件写死色值。
- 纯本地：不新增图片资源、不联网、遵守 `index.html` 的 CSP。
- 每个新功能配测试；`tsc -b --force` 与 `npm test` 必须干净。

### 覆盖时必须逐项检查的状态类

覆盖层只写默认态会漏掉这些，它们由 `styles.css` 提供、JS 动态加：

`inspected`（触屏展开）、`on`、`active`、`selected`、`chosen`、`current`、`is-light`（浅色盘面换深字）、`is-break`、`is-running`、`spinning`、`is-playing`、`is-reordering`、`settling`、`dragging`、`drop-before`、`disc-leaving`、`disc-swap`、`showcase-case`、`ambient-case`。

几个易踩的具体点：

- `.queue-item.dragging` 原版是奶白玻璃渐变，在纯白底上几乎看不见，必须重设背景与阴影。
- `.queue-item.drop-before::before` 是拖拽插入线，原版用 `--accent` 派生色，明亮版要换成 `#101010`。
- `.nav-marker` 是导航滑动指示条（信息元素，非纯装饰）。明亮版用黑底胶囊替代，属合理取舍，但要确认激活态在视觉上确实可辨。
- `@media (hover: none)` 里的 `.record-card.inspected` 是触屏唯一的展开路径，**不能写成 `transform: none`**。
- `.cover-ambient` 在项目里从未定义（原版如此，环境音走 `coverPreset`），不是 bug，不要为它补样式。

### 审计分工

CSS 层叠冲突与死代码扫描适合交给只读子智能体：过程要读几千行、结论只有几行。但要给它**完整的 TSX 清单**——漏掉 `MusicQueue.tsx` 会误报 5 处死代码。

### 子智能体的结论必须自己复核

审计能查出真问题，也会误报。2026-10-21 那次审计给出「高 1 / 中 2 / 低 3」，逐条复核后：

- **#1 `.cover-art` 用了 `background` 简写**——真 bug，简写把 `background-size:cover` 重置成 `auto`，用户上传的封面图不再铺满。已改为 `background-color` + 显式补 `background-size` / `background-position`。
- **#2 440 断点 `.record-notes` 留了 88px 空列**——真 bug，`styles.css` 在同断点是 `grid-template-columns:1fr 88px`，而 `.notes-disc` 被隐藏。已补 `display:block`。
- **#3 `.vinyl-label{color:#101010}` 对比度不足**——**误报**。审计靠推理说「`base = shade(deep,0.34)` 只会更暗，`is-light` 几乎不触发」，但实测 17 个封面底色 + 6 个兜底色，深字对比度 5.27–7.73，原版浅字只有 2.19–3.21（反而不达 WCAG AA）。深字是对的，保留。

教训：**涉及「能不能看清」的判断一律实测对比度，不要靠推理**。用 WCAG 相对亮度公式算一遍，比看代码可靠。

### 验证交互效果必须用真实输入事件

- `sendInputEvent({type:'mouseMove'})` 才能触发 CSS `:hover`；页面内 `dispatchEvent(new MouseEvent('mouseover'))` **不会**触发 `:hover`，量到的 `transform` 恒为 `none`。
- 反过来，长按拖拽（Pointer Events）`sendInputEvent({type:'mouseDown'})` 产生不了 `pointerdown`，要在页面内 `dispatchEvent(new PointerEvent('pointerdown', {...}))`，等 350ms 后再 `pointermove`。
- 两者结论相反，别混用。
