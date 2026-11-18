# 测量工具链

量「放映页拼贴版式」的脚本。改版式前先看这里——大概率已经有人写好了。

**背景**：这些脚本原来在 `.tools/`（被 gitignore），每换一个会话就重写一遍，踩的坑也重踩一遍。收进仓库是为了让结论和手段都能被下一个接手的人找到。

## 两套，按「要不要起 Electron」分

### `probe/` —— 要真渲染
量 DOM 几何、截真实截图。**必须清掉 `ELECTRON_RUN_AS_NODE`**，否则 Electron 以纯 Node 模式启动，报 `Cannot read properties of undefined (reading 'setPath')`。

```bash
cd /f/Vibe-bold
env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe tools/probe/geo.cjs --no-sandbox
```

| 文件 | 量什么 |
|---|---|
| `harness.cjs` | **公共底座**。起窗口 → 隔离 userData → 注册 media scheme → 注入 cabinet → 切放映页 → 点全屏 → 截图。文件头 5 条踩坑记录先读。 |
| `geo.cjs` | **总几何**：各块画布百分比 + 截图。改版式后必跑的回归项。 |
| `badge.cjs` | 竖排 DUMBRAVEN 徽标：每字母矩形、字号、行距、描边、四颗星位置 |
| `produced.cjs` | 右下署名：矩形、字号、内边距、圆角、z-index、两行 Range 矩形 |
| `styles.cjs` | **门禁第 1 步**。导出 12 份计算样式快照（约 274 万个属性），配 `style-diff.mjs` 比对 |
| `style-diff.mjs` | 比对两份样式快照。终端只列前 40 条（`MAX_PRINT`），判断「差异是否收敛在一个属性上」用下面的 tally |
| `style-diff-tally.mjs` | 全量聚合快照差异，**不截断**，按属性名计数 |
| `baseline.cjs` | **门禁第 2 步**。导出 28 张像素基线（wide 680×980 / narrow 440×860 / short 680×680） |
| `baseline-diff.py` | 比对像素基线。PSNR 判「有差异 / 噪声」，并给出差异区块坐标 |
| `italic-audit.cjs` | 读某处规则的**计算样式**与字体栈，判断一条 `font-style` 后面到底解析到了什么 |
| `italic-width.cjs` | 用 Canvas `measureText` 在 normal/italic 下量同字串宽度，差值为 0 即「死声明」。**必须带对照组**，否则测量方法出错也看不出来 |
| `rain-material-ab3.cjs` | 雨滴材质的 A/B。**背景必须是高频图案**——纯色被 `feDisplacementMap` 位移之后还是纯色，看起来「什么都没发生」，那是测法无效 |
| `rain-style.cjs` | 读一颗中珠的实际计算样式（`backgroundImage` / `boxShadow` / `backdropFilter` / 尺寸）。截图看着没变化时先跑这个，确认 CSS 到底生效没有 |
| `rain-on-photo.cjs` | 把一张有细节的照片塞进 `.theater-screen`（z-index 6）再开雨 |
| `rain-audit.cjs` | 汇总当前水珠的档位分布与几何 |
| `ticket-fit.cjs` | 票根浮层在五种画幅下是否溢出。**离屏窗口改不了尺寸**，必须用 CDP `Emulation.setDeviceMetricsOverride` |
| `ticket-face-height.cjs` | 量 `.ticket-lift` / `-shot` / `-panel` / `.ticket-face` / `.ticket-panel` 五层高度。票根「只剩一半」就是靠它查出来的：face 497.6px 而 panel 只有 204.8px |
| `palette-live.cjs` | 用**真实** userData 与真实视频跑一遍取色，输出「取到哪一帧、几个色、三层色」。**不能用 harness**：它把 userData 换成 mkdtemp，那里没有用户的库 |
| `tone-live.cjs` | 读实机 localStorage 里现在存的放映设置与配色设置（`raven-stage-tone` / `raven-stage-template` / `raven-cabinet-v2`） |
| `tone-panel-live.cjs` | 实机打开「配色 → 挑一个」面板，把 4 个色块与 `palette` 数组一起抓下来——面板显示的才是用户看到的 |
| `contrast-px.cjs` + `contrast-px.py` | **像素级对比度**。`.cjs` 收集所有自持文本的元素 + 截图，`.py` 用「矩形内出现最多的颜色」当底色算 WCAG。原有的 `contrast.cjs` 会误报：它只沿祖先链找背景，而本项目的激活态黑胶囊是**兄弟元素**画的 |
| `mini-look.cjs` | 番茄钟小窗（`electron/mini.html`）八种状态下全部渲染 + 几何。**这个文件不在 `src/skin/` 体系里、也不被三道门禁覆盖**，改它只能靠这个探针 |
| `mini-pressing-ab.cjs` | 小窗彩胶工艺与 `src/styles.css` 的 A/B。九方盘内逐像素比对（盘仅 38×38 = 1444 像素） |
| `mini-halo-variants.cjs` | halo 的五种变体对比。结论：**不能照抄主界面的外发光**，那圈 11px/24px 是按主界面 72px 标签调的 |
| `mini-contrast.cjs` | 小窗三阶段的文本元素 + 截图，配同一套「像素众数」算对比度 |
| `theater-radius.cjs` | 放映台窗口态的实际圆角。**必须 `expand: false`**，否则会点成全屏、恒量到 0px |

> 上表只列高频与门禁相关项。`probe/` 下共 140+ 个脚本，其余按文件名搜（命名都带领域：`ticket-*` / `tag-*` / `stone-*` / `desktop-*` / `template-*`）。

### `measure/` —— 只读像素，不用起 Electron
拿参考图或探针截图的 PNG 逐像素扫。

| 文件 | 量什么 |
|---|---|
| `pixels.cjs` | **公共底座**。`load()`（自动 ffprobe 读尺寸）、`flood()`（返回 bbox + **mask**）、`bands()`、`isGold()`、`goldBlocks()`、`fitCircle()` |
| `arc.cjs` | 面板弧：连通域、弧顶点、圆拟合、缝宽、同心偏移。**判定「是不是正圆」用它。** |
| `text-bands.cjs` | 文字带，三种窗口：`panel` / `bar` / `words` |
| `produced.cjs` | 署名：金色文字带、胶囊 bbox、底色中位色 |
| `gold.cjs` | 金色连通块排序（字母 vs 星星分得开）+ 四颗星包围盒 |
| `ae.cjs` | 读 AE 导出 JSON。**位置不可信**，只取字号/字距/文案/颜色 |

```bash
# 默认读参考图
node tools/measure/arc.cjs
# 读探针截图
node tools/measure/text-bands.cjs tools/probe/geo.png panel
```

## 参考资料位置

- 参考图（AE 最终渲染，**唯一可信的位置来源**）：`C:\Users\DumbRaven\Pictures\Screenshots\屏幕截图 2026-10-17 192657.png`（1917×1072）
- AE 导出：`C:\Users\DumbRaven\Videos\模板\raven-shapes.json`（27 个合成）
- 关键色：面板 `#4a5363`、页面底 `#1c2433`、信息条 `#72777d`、署名金字 `#d4a040`、徽标金 `#c48f46`

## 三条最容易踩的

1. **截图分辨率会变，不许把宽高写死。** 见过 3840×2160 和 1920×1080 两种。写死当 stride 用，读到不匹配的图**不会报错**，只会行错位、输出看似正常的假值。
2. **`cqw` 基准跟着元素走。** 画布级 `1cqw = 19.2px`，面板级 `1cqw = 5.55px`，差 3.5 倍。
3. **按颜色找边界会被照片污染。** 用 `flood()` 返回的 mask，不要只拿 bbox、更不要逐列按颜色扫。

更完整的踩坑记录在 `docs/交接文档-放映页.md` §9.8。
