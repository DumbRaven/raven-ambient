<div align="center">

<img src="docs/images/00-logo.png" width="180" alt="Raven Ambient">

# Raven Ambient

**把声音，收藏成生活。**

一个纯本地的桌面声音空间：把自己喜欢的音乐和环境音收进一面唱片柜，
挑一张放上唱盘，让雨声、火炉和风声陪着你。

![License](https://img.shields.io/badge/license-MIT-101010?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-101010?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-40-101010?style=flat-square)
![React](https://img.shields.io/badge/React-19-101010?style=flat-square)
![Tests](https://img.shields.io/badge/tests-175%20passing-101010?style=flat-square)

</div>

---

## 界面

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/images/01-cabinet.png" alt="唱片柜"><br>
      <b>唱片柜</b><br>
      <sub>每页 6 张，封面按主色生成彩胶外圈</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/images/02-hover.png" alt="悬停打开唱片盒"><br>
      <b>打开唱片盒</b><br>
      <sub>封面掀开 72°，唱片从套里滑出</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/images/03-listening.png" alt="正在听"><br>
      <b>正在听</b><br>
      <sub>唱盘、队列、环境音，各自单独控制</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/04-playcard.png" alt="播放卡"><br>
      <b>播放卡</b><br>
      <sub>点页签栏右边的圆碟弹出，波形跟着声音走</sub>
    </td>
    <td align="center">
      <img src="docs/images/05-focus.png" alt="专注"><br>
      <b>专注</b><br>
      <sub>番茄钟独立于播放器，暂停音乐不暂停计时</sub>
    </td>
    <td align="center">
      <img src="docs/images/06-settings.png" alt="设置"><br>
      <b>设置</b><br>
      <sub>背景取色、换唱片方式、外部音乐、定时休息</sub>
    </td>
  </tr>
</table>

---

## 它是什么

- **一面柜子，不是播放列表。** 唱片一张张摆在架上，打开盒子才看见封面和唱片，挑一张放上唱盘。
- **音乐和环境音是两个通道。** 音乐在响的时候，环境音会自己退后一点，安静下来再慢慢回来——不是开关式地压，是包络式的让路。
- **彩胶外圈从封面取色。** 晕染、云石、泼溅、透光、光晕五种压片工艺，同一次启动里固定，重启才重新分配。
- **纯本地。** 文件只在你自己选的范围内读取，不连音乐平台、不上传、不联网。音频副本存在本地 IndexedDB，原文件挪走了照样能放。
- **没有音乐文件也能用。** 「外部音乐模式」让网易云、Spotify 这些播放器去放歌，本程序只管环境音和避让（需要 VB-Cable 虚拟声卡）。

**关于体积：** 分发包约 82 MB，解压后 261 MB。其中 204 MB 是 Electron 运行时（Chromium + V8 + Node），我们自己的代码与全部 SVG 封面只有 1.2 MB。已经压掉的部分：语言包只留中英文、去掉本项目用不到的 WebGPU 着色器编译器、下载格式改 `tar.xz`。

## 快速开始

需要 **Node 24**。

```bash
npm install
npm run desktop      # 构建并启动
```

打包成 Windows 目录版（产物不进仓库，要自己构建）：

```bash
npm run package:win
# → release/win-unpacked/Raven Ambient Bold.exe

npm run make:release
# → release/dist/Raven-Ambient-v0.3.1-win-x64.tar.xz（约 82 MB）
```

用 `make:release` 而不是 `Compress-Archive`：Electron 的 dll 与 exe 用 deflate 只能压到 43%，`tar.xz` 能到 30%，整包从 134 MB 降到 82 MB。Windows 10 1803 之后系统自带 bsdtar，所以解压不需要装 7-Zip；脚本会顺手生成一个双击就能解压的 `解压后运行我.cmd`。

首次打开会播放一段开屏动画，随后进入唱片柜。点「收藏声音」导入音乐或环境音即可。

## 功能

### 唱片柜

- 悬停打开唱片盒，触屏点一下查看。点 ＋ 选择多张，音乐按点选顺序循环，环境音同时循环（最多 8 路）。
- 每页摆 6 张，超出后出现页码；导入完成后自动翻到新唱片所在页。
- 没有封面的唱片，每次启动随机挑一款封套（底色取自唱片色调，配晨光、地平线、拱门、轨道、涟漪、潮汐六种构图）。同一次使用中翻页、切分类、播放都不变，重启后重新抽一次。已指定或上传的封面始终优先。
- 打开唱片盒时，唱片外圈按封面主色选一种压片工艺；同一次启动里每张唱片的工艺和配色固定。

### 正在听

- 环境音列表里每张唱片左侧的小标识会跟着封面走：选了内置线描封面就显示那张封面的主图形（树、浪、火苗、雨云、雪花、鸟……），没有封面才用统一的波浪纹。
- 每一行右侧有单独的暂停/继续按钮，可以只停某一路环境音；停掉的那一路留在列表里，下次打开软件恢复全部流动。
- 音乐和环境音可以分开开关：播放卡里是两个圆形通道按钮，左边音符代表音乐、右边波浪代表环境音，关掉的那一路会在图标上划一道斜线。
- 队列里长按 0.35 秒把它拿起来，条目会上浮跟着手指移动，拖到新位置松手即完成排序；拖动过一行时目标位置显示一条细线。右侧只留一个 × 用来移出队列。
- 切歌分先后两拍，两张唱片不同时出现在唱盘上：上一张先原地淡出并向内轻轻收拢（1 秒），完全消失后新唱片才从略小、略低的位置落下（再 1 秒），标题跟着新唱片一起淡入。整个过程 2 秒，中间不留空盘。

### 避让

避让是包络式的，不是开关式的压低：音乐响起后按该声部的淡入时长平滑退后，音乐停下先保持一小段再慢慢回来，避免句与句之间来回抽动。淡入淡出、保持时长和判定阈值都绑在环境音的封面类型上——森林、风、雪这类绵延的声音慢进慢出，键盘、鸟、虫这类有明确起音的跟得紧、收得快。这些数值不开放给用户，界面上只暴露深度（0–24 dB，0 dB 表示这张唱片不避让）。

每张环境音的「声音微调」包含声像、柔和程度和独立避让幅度。**自动避让始终开启，没有开关。**

### 响度归一化

导入时测每段素材的 RMS 响度并补到同一基准（−23 dB，最多补 15 dB、最多压 12 dB），所以不同来源的环境音叠在一起不会一段盖住另一段。每路声部后面还挂了一个软限幅器兜住补上来的峰值——补 14.8 dB 的素材实测只有 0.05% 采样点触拐点。这些补偿值只存在内存里，不进存档。

### 换唱片的方式

设置里可选直接切换、交叉淡化、淡出后淡入三种。音乐用两块唱盘轮换承载，交叉淡化是上一首往下走的同时下一首往上走，淡出后淡入是上一首先退到安静、下一首再在后半段进来；过渡时长固定 1 秒，不单独开放调节。

这项只作用于手动切歌（上一首/下一首、点队列里的某一首），自然播完自动接下一首时仍然直接硬接，避免收尾被拖慢。

### 专注

25 分钟专注后小憩 5 分钟，每四轮长休息 15 分钟，可暂停、跳过和重置。右侧面板可切换 25/5、45/10、15/3 三种预设，分别调整时长和长休息前的轮数，并可关闭完成提示音。

专注计时独立于播放器，暂停音乐不会暂停计时；番茄记录只保存在本机。

- **桌面计时小窗**：开始计时后，桌面上会出现一个置顶的无边框小窗，显示剩余时间、进度环和当前轮次。它不受主窗口影响——把主窗口最小化之后它仍然留在最上层，方便你去干别的。小窗上可以直接暂停/继续、收起；收起之后从主界面的专注页点按钮能把它找回来。主窗口关掉时小窗一并消失。

## 外部音乐模式

给不下载音乐文件的人用：音乐交给网易云、Spotify 之类的播放器，本程序只负责环境音，并在音乐响起时让环境音退让。

这条链路需要 **VB-Cable 虚拟声卡**（[vb-audio.com/Cable](https://vb-audio.com/Cable/)，免费、donationware，需自行下载安装）。本程序不打包也不转售这个驱动。数据流是：

```
外部播放器 → 系统输出切到 CABLE Input → CABLE Output → 本程序抓取 → 混音 → 真实声卡
```

1. 装好 VB-Cable，把系统输出设备选成 `CABLE Input`。
2. 设置里打开「外部音乐」。程序按设备名匹配 `CABLE Output`（也认其它 VB-Audio 输入端点），匹配不到会提示先装驱动。设备不开放选择，因为每台机器的 id 不同、重装驱动会变。
3. 打开后唱片柜只剩环境音，「已选择」也只剩环境音；音乐那一路的通道按钮禁用。切回关闭状态时原本选好的音乐还在。
4. 播放卡接管外部播放器：播放/暂停、上一首、下一首都直接发给它，状态以播放器回报为准，不做本地乐观更新。播放顺序按钮在这个模式下禁用（顺序由对方决定）。
5. 「正在听」的唱盘上转的是对方正在播的那首：用它的封面取色生成彩胶，内圈是封面本身，歌名和来源显示在下方。拿不到封面时用歌名哈希从品牌色板挑一个底色。

抓取流时**必须**在 `getUserMedia` 的约束里一次传齐 `echoCancellation: false`、`noiseSuppression: false`、`autoGainControl: false`。实测开着 AGC 时，10 倍音量差只量出 5.86 倍，避让判定会彻底失准；事后用 `applyConstraints` 补传会抛 `OverconstrainedError`。

外部音乐的音量跟本地音乐吃同一档「音乐总音量」，再乘自己的微调；环境音基础系数是 0.55。两者都按 20ms 更新的 RMS 电平算，不是逐拍跟。

### 歌名和封面拿不到时

外壳里跑了一个常驻小工具 `electron/nowplaying/NowPlaying.exe`（C# 编译，`scripts/build-nowplaying.cjs` 生成），通过 Windows 的 SMTC（系统媒体传输控件）读对方正在播什么，每 700ms 推一次快照。

**网易云有一个自己的「SMTC」开关，默认可能是关的，而且版本更新或重装后会回到关闭。** 表现是：外部音乐明明有声音、环境音也在正常避让，但唱盘上没有碟、底部显示「等外部音乐」。这时候去网易云设置里把它打开即可（不同版本位置会变，可能叫「系统媒体控制」或「锁屏歌词」）。

验证方法：跑 `electron\nowplaying\NowPlaying.exe --list`，有输出就是好的。

> 顺带说明：网易云音频输出里的 WASAPI / DirectSound / WaveOut 是 Windows 提供的三套音频接口，都属于共享模式（会和别的程序一起混音），不是独占。选 WASAPI 即可，延迟最低、音质最好；它不影响环境音叠加。

关于这个模式在版权上是怎么回事、哪些责任在你这边，见 [关于版权](#关于版权)。

## 数据

文件只在用户选择的范围内读取，不连接音乐平台、不上传。文件夹导入是一次性扫描，不后台监控。导入音频复制保存在本地 IndexedDB；原文件移动后仍能播放。清除应用数据会移除该副本。音乐单文件上限 200 MB；环境音 50 MB、10 分钟。

已有音频、背景和介绍继续保留；旧全局避让幅度自动迁移为每张唱片的独立设置。移除唱片仅移除目录记录，保留缓存以便恢复；暂未实现缓存清理界面。

## 关于版权

这一节说明「外部音乐模式」在版权上是怎么一回事。不是法律意见，只是把项目做了什么、没做什么讲清楚，方便你自己判断。

**本程序不做什么。** 它不下载音乐，不保存别人播放器放出来的音频，不把任何内容传到网上，也不绕过任何 DRM 或技术保护措施。仓库里没有一个音频文件，所有环境音都要你自己导入，封面和图标全部自绘。

**外部音乐模式在技术上是什么。** 它读取的是你本机声卡上**已经在播放**的那一路声音——VB-Cable 把播放器的输出接到一个虚拟设备上，本程序再从那里把已经解码好的 PCM 流接过来，混进环境音，送回你的扬声器。这和 OBS 录屏、Discord 共享音频、声卡自带的「立体声混音」是同一类系统能力，不是解密或破解。程序也拿不到你在放什么歌的文件，它只知道音量有多大（用来做避让），以及系统媒体控件愿意公开的歌名和封面。

**为什么这不算侵权。** 前提是：那个播放器是你自己装的，账号是你自己的，歌是你自己点播的，声音最后只进你自己的耳朵。在这个前提下，你听的东西本来就是你被授权听到的，本程序只是在你已经能听到的声音上叠一层环境音。用户在自己家里为个人欣赏而使用已发表作品，属于《中华人民共和国著作权法》第二十四条第一项的合理使用情形。

**VB-Cable 是别人的软件。** 本程序不打包、不转售、不修改 VB-Audio 的驱动，只在文档里给出官网链接，由你自己去下载安装。驱动本身的许可条款请以 VB-Audio 的说明为准。

**需要你自己负责的部分。** 把外部音乐录下来、剪辑后发到网上，或者拿它做商业用途，那是**你的行为**，不是本程序的行为，请自行确认你有权这么做。本程序不提供录音功能，但系统层面能做这件事的工具很多（包括 OBS 和声卡驱动本身）。

**与音乐平台的关系。** 本项目是独立的个人项目，与网易云音乐、Spotify、QQ 音乐等任何音乐平台都没有关联、合作或授权关系。文档里提到这些名字只是为了说明「可以和它们一起用」，不表示任何形式的背书。

**许可证管的是代码，不是使用行为。** 文末的 MIT 许可证提供的是软件本身的「按原样提供、不担保可用」条款，它不覆盖、也无法覆盖你用这个软件去做什么。

## 开发

Node 24；`npm install`（Electron 下载慢时可设 `electron_config_cache` 指向本地缓存目录）。

- `npm run dev`：本地前端。
- `npm run desktop`：构建并启动 Electron。
- `npm test`：音频避让及节点连接、队列、封面匹配、数据恢复边界，避让包络的淡入淡出与迟滞防抖、按封面类型分配手感，专注时钟的时长与阶段切换，唱片柜分页的页码收敛，随机封套的稳定哈希与款式清单，彩色胶盘的压片工艺分配与封面取色、暗封面的明度兜底，音乐/环境音双通道的独立开关与播放顺序切换，队列拖拽排序的位置计算，换唱片过渡的双唱盘轮换与过渡方式持久化，存储层在切换 driver 后的读写与镜像降级，环境音单独暂停的名单语义与不进存档，响度归一化的测量与上下限、混音配平（音乐总音量共用、环境音系数、叠加补偿），外部音乐的歌名解析与封面白名单、虚拟声卡的设备匹配与错误文案，专注小窗的窗口尺寸与位置约束，以及动效层（滚动数字的数值插值、拖拽落位的插入线、表单错误反馈、播放键图标切换、加号反馈的触发条件）。
- `npm run build:nowplaying`：编译 SMTC 辅助程序（需要系统自带的 `csc.exe`，不依赖 .NET SDK）。`package:win` 会自动先跑这一步。
- `npm run package:win`：生成 Windows 目录版。
- `npm run make:release`：生成免安装分发包（先跑 `package:win`）。

推送到 `main` 会触发 GitHub Actions：类型检查、单元测试、构建，然后把实际通过数写回上面的徽章。打 `v*` 标签会自动打包并发布到 Release；也可以在 Actions 页面手动跑一次 Release 只取构建产物。

`src/player.ts` 管理队列和环境音，`src/audio.ts` 管理 Web Audio（音乐用两块音频元素轮换，切换时只推各自增益，所以能真正交叉淡化），`src/records.ts` 管理唱片模型。Electron 只提供安全桌面窗口；渲染器无 Node 权限，不加载外部网页。macOS 包和移动端后台音频尚未实现；手机宽度下介绍移至唱片柜下方。

外部音乐那条链路分布在四个文件里：`src/line-in.ts` 只负责找设备、抓流、把错误翻译成中文；`src/now-playing.ts` 是纯数据层（快照解析、播放器中文名、副标题拼接），可以脱离 Electron 测；`src/now-playing-bridge.ts` 是页面与外壳的唯一通道；`electron/now-playing.cjs` 管辅助进程的生命周期和 stdin 命令队列。

辅助进程和页面之间没有 IPC 通道——渲染器是 `sandbox: true` 且没有 preload，拿不到 `ipcRenderer`。方向反过来：主进程用 `executeJavaScript` 调页面里的 `window.__ravenNowPlaying(snapshot)` 推送快照，页面把动作写进 `window.__ravenNowPlayingOutbox`，主进程每 400ms 轮询取走。控制命令不另起进程，走常驻那个的 stdin：每次新建 SMTC 连接要几百毫秒，连按两下会明显迟滞。

`src/loudness.ts` 是响度归一化的纯函数（RMS 测量、增益换算、上下限）。`src/vinyl.ts` 的 `liftForVinyl()` 会把太暗的封面色抬到看得见层次，但不改色相——纯黑被抬成 `#6b6b6b` 而不是染成别的颜色。

`src/store.ts` 是存储层入口，业务代码只依赖它导出的 `getText`/`setText`/`readAsset`/`storeAsset`，不直接碰 `localStorage` 或 IndexedDB。默认实现在 `src/store-browser.ts`（文本走 localStorage、资产走 IndexedDB）。移植到新平台时，在渲染之前调用 `useStore()` 换一个 driver 即可，其余代码不动；driver 可选实现 `mirrorText`，用于把文本快照镜像到更持久的位置（移动端 WebView 的 localStorage 可能被系统清掉）。

`public/covers/` 保存原创 SVG 图标封面，`src/ambient-covers.ts` 保存名称匹配词库。纯本地中英文关键词匹配，无模型、联网或额外下载；17 款 SVG 合计约 17 KB。`node scripts/make-cover-library.mjs` 可重新生成素材。`src/cover-marks.ts` 是从这些 SVG 里摘出来的主图形，供环境音列表做小标识。

应用图标由 `build/icon.ico` 提供，窗口与任务栏图标用 `build/raven-logo.png`；打包时该 logo 会复制到 `resources/raven-logo.png`，随应用一起分发。`build/icon-*.png` 是同一份图标的各档尺寸，需要换图时重新生成即可。

## 视觉层结构

界面样式分两层：

- `src/styles.css`：基础样式，负责布局、唱片盒、唱盘、队列等结构。
- `src/skin-bold.css`：视觉覆盖层，选择器优先级略高于基础样式，负责颜色、圆角、字体、唱机、专注盘、播放卡、弹窗等。由 `src/main.tsx` 在 `import './styles.css';` 之后追加 `import './skin-bold.css';` 挂上去。

改视觉时优先调 `skin-bold.css` 里的设计令牌（文件开头的 `--bold-*` 变量），而不是逐个组件改颜色。

**例外：桌面计时小窗不走这两层。** 它是 `electron/mini.html` 里一套自带的样式——那是个独立的透明无边框窗口，加载的也不是主页面，所以拿不到 `skin-bold.css`。颜色和形状直接写在 `mini.html` 的 `<style>` 里，改它要单独改。

## 动效层

动效分两层：既有的页面/弹窗/高度过渡在 `src/motion-state.ts`、`src/use-motion.ts`、`src/use-view-layout.ts`、`src/height-motion.ts`；后来追加的细节在下面这些文件里。

- 开屏动画：`index.html` 里的静态 HTML + CSS（不走 React），这段一解析就开始渲染，正好盖住「窗口白屏 → React 挂载 → 读 IndexedDB」那段空白。
  - **时长只由 `.splash-clock` 的 `4000ms` 决定一处**，其余元素是逐拍 `animation-delay`。
  - `src/splash.ts` 的 `dismissSplash()` **不自己算时间**，而是等 `document.getAnimations()` 里所有 `splash-*` 动画的 `finished`。CSS 动画跑在自己的 document timeline 上，窗口隐藏时不推进、显示后追赶；用 `performance.now()` 另算一套钟必然错位，会把动画截断（实测第一版离场时进度线只走到 0.88）。
  - `prefers-reduced-motion` 里只把五个可见元素压到 1ms，**不能包含 `.splash-clock`**，否则计时器被瞬间跳过。
- `src/roll-number.tsx`：滚动数字。一列 0–9 竖排、`overflow:hidden` 只露一个窗口，靠 `translateY(calc(var(--roll) * -1.2em))` 滚到目标位。
  - **`--roll` 必须注册成 `<number>`**（`skin-bold.css` 开头的 `@property`）。换成 `<integer>` 会退化成逐档跳变：实测 5 个取值、156ms 就跳完，剩下 164ms 静止，观感是「咔咔咔」。
  - 首帧不滚：挂载后第一帧才给 `data-roll-ready="true"`，在那之前不给过渡。
  - 视觉隐藏的真实文本 `.roll-text` **必须在 `.roll-number` 内部**。放到外面时它的 `position:absolute` 会一路找到更外层的定位祖先，撑出滚动条。
- 拖拽落位画线：`src/MusicQueue.tsx` 落位后给该行加 `settled` 类 460ms，`skin-bold.css` 的 `.queue-item.settled::after` 从中心向两端展开再淡出。
- 表单错误反馈：`src/App.tsx` 的 `draftError` 状态 → `.text-field[data-invalid]` 变红 + 抖动 + `.field-error` 文案；打字即清除。
  - **表单必须带 `noValidate`**。`<input required>` 会让浏览器原生校验在 `onSubmit` 之前拦下提交，JS 校验分支永远走不到。
- 播放键：`.main-play-icon` 换图标时重挂载播 `play-icon-in 200ms`；`.main-play:not(:disabled):active` 压到 `scale(.9)`。`:not(:disabled)` 不能省——`:active` 在 disabled 的 `<button>` 上照样命中。
- 播放卡波形：`src/PlayCard.tsx` 用 32 个 `<span>` 的 ref 数组直接改 DOM 的 `--h`，**不走 setState**（每帧重渲染整棵树会掉帧）。电平来自 `player.level`（引擎每 80ms 的原始 RMS），开卡时用 60ms 定时器推。波形公式 `Math.min(1, Math.sqrt(rms) * 2.1)`——开方是为了让安静段也有可见起伏。
- 换页圆形扩散：`src/App.tsx` 的 `selectView(next, trigger)` / `selectFilter(next, trigger)` 用 `circleFrom()` 算出「圆心到四角最远距离」写进 `--wipe-x/y/r`，`skin-bold.css` 的 `page-wipe-in` 用 `clip-path: circle(...)` 铺开。触发元素的中心可能在内容区上方，圆心要夹进内容区边界，否则扩散会先空转一段。
  - **CSS 动画时长必须和 `src/motion-state.ts` 的 `wipeDuration`（520）一致**。`pageTiming` 是 `data-motion` 翻 idle 的时限，写小了动画会被提前摘掉，扩散变成硬切。
  - 高度动画不能跟着共用一个时长，所以单独有 `heightTiming = { enter: 110 }`，由 `use-view-layout.ts` 使用。
- 页签与筛选的黑色滑块：两处都是 JS 量出 active 按钮的 `left/width` 写进 CSS 变量（`--nav-marker-x/width`、`--flip-x/width`），`transition` 用 `cubic-bezier(.3, 1.32, .48, 1)` 制造回弹。首帧用 `data-marker-ready` / `data-ready` 关掉 transition，否则会从 0 宽度滑入。
  - 基础样式的 `.view-tabs>.nav-marker` 是下划线（`height:2px; bottom:-1px`），覆盖成滑块时必须把 `height` 和 `bottom` 一起改回来。
  - 量位置要用 `offsetLeft` / `offsetWidth` 而不是 `getBoundingClientRect()`：切回唱片柜时整块正处在扩散动画里，外层 `.view-stage` 带着 `transform: scale()`，量出来会小一圈。
  - **筛选栏在切视图时会被卸载重挂载**，所以那个 effect 的依赖里要带 `pageMotion.value`，否则新 DOM 上没人写变量，滑块宽度卡在 0。
- 大字标题换页：`title-swap` 460ms。CSS animation 在同一元素上不会因为文字变化重播，所以 `<h1 key={view}>` 要带 key 强制重挂载。
- 唱片盒开合：点击态用 `data-flip="open" | "closed"` 并加 `!important`，压过原样式的 `:hover` 和 **`:focus-within`**。
  - 只靠 `:hover` 不够。点过卡片后内部按钮获得焦点，鼠标移开时 `:hover` 消失但焦点还在，`:focus-within` 会立刻把盒子重新掀开，表现成「合上后又自己打开」。
  - 不要在 `pointerleave` 时清掉 `closed` 状态，那正好给 `:focus-within` 让路。想恢复悬停预览就点别的唱片。
- 加号反馈：两个「加一个声音」的入口（唱片柜底部虚线、每张唱片名前的圆圈）按下缩一下、图标转半圈；加进队列时圆圈弹一下并荡开一圈淡环。
  - **用 WAAPI（`node.animate()`）而不是切 class**。同名 CSS animation 在同一元素上重加一次不会重播，而用户连着点同一张是完全可能的。
  - 扩散环是运行时 `document.createElement('span')` 插进去的，动画 `finished` 后自己 `remove()`，不留残留节点。
  - 只有「从未选中变成选中」才触发，取消选择不放——撤销不需要庆祝。`justAdded` 带 `token` 递增，保证同一张连点两次也能重播。
- 连续曲率圆角：`skin-bold.css` 末尾「第十七批」用 `corner-shape: superellipse(1.2)` 统一 21 处胶囊，外层 `@supports` 包着。
  - 标准 `border-radius: 999px` 在 638×97 的胶囊上会被钳到高度一半，两端是标准半圆、中间直线，曲率从 1/r 突降到 0，看起来有折点。`squircle` 约等于超椭圆 n=4（苹果图标那档），但在这条长胶囊上端点收得太快、偏方；n=1.2 落在两者正中间。
  - **圆形元素要排除**（`border-radius: 50%` 的播放键、通道按钮、顺序按钮）——超椭圆会把圆变成圆角方形。

以上都写了 `prefers-reduced-motion` 兜底，行为是「立即到位」而不是「更快播一遍」。

## 排障

- **外部音乐有声音但唱盘没碟、底部显示「等外部音乐」** → 网易云的 SMTC 开关被关了，见上一节。
- **打不开、一闪就退**：检查环境变量里有没有残留 `ELECTRON_RUN_AS_NODE`，它会让 exe 退化成纯 Node，跑完就退出。清掉再启动。
- **打包报 `EBUSY: resource busy or locked`**：先彻底关掉正在运行的旧版本，再删 `release/win-unpacked`，然后重跑 `package:win`。不删的话 exe 的版本信息会退化成 `Electron`、文件大小也会小一点。
- **歌名对不上、封面是空白**：先跑 `electron\nowplaying\NowPlaying.exe --list` 看有没有会话输出。会话挑的是「按可执行名排序 + 播放状态」打分最低的那个，所以开着浏览器暂停着的会话不会抢到。
- **播放卡上的上一首/下一首对网易云没反应**：先单独跑一次 `NowPlaying.exe --watch`，如果能收到快照，说明辅助程序没问题，是主进程没找到页面去取命令。`electron/now-playing.cjs` 轮询 `outbox` 时要**排除专注小窗**——它也是 `BrowserWindow`，按数组下标取可能取到它，而小窗里没有那套变量。日志里搜 `mini.html` 能确认。
- **唱片柜显示「已选择 7」但柜子里只有 2 张**：外部音乐模式下音乐那一栏被隐藏了，计数就不能再把 `queue` 算进去。

本版为未签名的本地预览包，尚未包含安装器或自动更新。

## 许可

代码以 MIT 许可证发布，见 [`LICENSE`](LICENSE)。`public/covers/` 里的 17 款 SVG 封面、`build/` 里的应用图标与乌鸦 logo 均为本项目原创，同样适用该许可证。
