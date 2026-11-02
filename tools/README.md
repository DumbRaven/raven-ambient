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
