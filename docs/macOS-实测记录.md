# macOS 实测记录

这台机器上真跑出来的数，以及跑到这些数之前撞过的墙。

**为什么单独记一份**：`docs/开发文档.md` 第 8 节写的是移植**怎么做**的，那里没有任何一个 Mac 上的实测数字——它自己就写着「没验证过 .app 实际启动、没在真 Mac 跑过像素基线」。这份补的就是那个缺口：哪些验过、数是多少、哪些还没验。

和 `重构交接-2026-11-16.md` 一样，这里只写「代码里看不出来的东西」：环境为什么长这样、某个数为什么是这个量级、哪条路试过了走不通。能从代码读出来的一律不写。

---

## 1. 这台机器的环境事实

macOS **27.2.1**（BuildVersion `26B131`），**arm64**，GPU `Apple M6`（12 核，Metal 4）。

### 没有的东西

| 工具 | 状态 | 后果 |
|---|---|---|
| Xcode / Command Line Tools | 无 | `/usr/bin/git` 和 `/usr/bin/python3` 都是**占位壳**：一跑就弹「要不要安装开发者工具」的窗，然后 `exit 1`。`file` 看它们是正常的 universal binary，只有跑起来才发现是壳 |
| Homebrew | 无 | 所有 brew 装的工具都得另想办法 |
| ffmpeg | 无 | 造测试音频只能用系统自带的 `afconvert` / `say` |

`/usr/bin/git` 是壳这件事影响很大：**这个仓库曾经因此没有 .git**。当时的判断是「tarball 解压时丢了」，实际上是「就算有 .git 也没有 git 能用」被误读成了「没有 .git」。

### 装上的东西

| 工具 | 位置 | 版本 | 怎么来的 |
|---|---|---|---|
| node | `~/.local/node/bin` | **v24.11.0** | 自己装的 |
| npm | 同上 | **11.6.1** | 跟 node 一起 |
| git | `~/.local/git`（150M） | **2.56.1** | 从 npm 包 **dugite**（GitHub Desktop 用的那个 git 分发）里取出来的完整 git |
| media-control | `~/.local/bin/media-control` | **0.9.0** | 从 Homebrew bottle 直接拉的预编译包，**没装 brew** |

**每条命令都要 `export PATH=$HOME/.local/node/bin:$PATH`**，否则找不到 node。

### git 的两个非显然要求

`~/.local/git-env.sh` 里三个变量，缺一个就会出不同的错：

```bash
export PATH="$HOME/.local/git/bin:$PATH"
export GIT_EXEC_PATH="$HOME/.local/git/libexec/git-core"      # 不设：网络操作报 "remote-https is not a git command"
export GIT_TEMPLATE_DIR="$HOME/.local/git/share/git-core/templates"  # 不设：只是模板警告
```

- **本地操作**（status / log / diff / commit）只要 PATH。
- **网络操作**（clone / fetch / push）**必须**额外有 `GIT_EXEC_PATH`——`git-remote-https` 这个 helper 在 `libexec/git-core` 里，git 不会自己找过去。报错信息是 `git: 'remote-https' is not a git command`，看起来像 git 缺功能，实际只是找不到 helper。

### 音频设备

只有两个：

```
27GX           Output Channels: 8   Transport: DisplayPort
Mac mini扬声器  Output Channels: 2   Transport: Built-in      Default Output Device: Yes
```

**没有任何虚拟声卡**（`system_profiler SPAudioDataType | grep -i 'cable\|blackhole'` 零命中）。这一条决定了 lineMode 在这台机器上打不开，见第 5 节。

### 显示器

```
27GX:  Resolution: 5120 x 2880
       UI Looks like: 2560 x 1440 @ 120.00Hz
       Main Display: Yes
```

**120Hz，帧预算 8.33ms，不是 16.67ms。** 拿 60Hz 的直觉读帧间隔数据会得出完全错误的结论。

---

## 2. 三个数

打包产物 `release/mac-arm64/Raven Ambient.app`，对应提交 `a552096`。测量脚本在 `/tmp/qa/`（`cdp.mjs` / `cold.mjs` / `rss.mjs` / `frames.mjs`），**不属于仓库**，是临时工具。

### 2.1 冷启动到可交互：**255.7 ms**（中位，n=5）

**起点**：Node 侧 `spawn()` 返回时的 `process.hrtime.bigint()`。这之后才发生 `posix_spawn`、exec、Electron 初始化。
**终点**：页面内 `performance.now()`，判据是 `.view-tabs button` 的 `getBoundingClientRect()` 宽高都 > 0——用户真正能点的那一刻。

换算方式：页面自己报 `performance.timeOrigin`（wall clock 毫秒），减去 spawn 的 wall 时间得到「页面 0 点相对 spawn 的偏移」，再把页面内的 `performance.now()` 加回去。**所以这些数字里不含 CDP 往返延迟。**

| run | pid | 页面 timeOrigin 相对 spawn | **可交互** | 开屏开始淡出 | 开屏移除 |
|---|---|---|---|---|---|
| 1 | 18415 | 169 ms | **242.5 ms** | 4222.0 ms | 4806.3 ms |
| 2 | 18441 | 181 ms | **254.9 ms** | 4237.2 ms | 4818.4 ms |
| 3 | 18463 | 181 ms | **255.7 ms** | 4246.1 ms | 4828.1 ms |
| 4 | 18484 | 196 ms | **270.3 ms** | 4262.1 ms | 4845.0 ms |
| 5 | 18505 | 189 ms | **262.6 ms** | 4241.9 ms | 4822.5 ms |

中位 **255.7 ms**，极差 27.8 ms。

**必须区分冷缓存与热态。** 同一版产物第一次被系统打开时测到 **1241.7 ms**（`pageOrigin` 本身就 1155 ms，pid 18290），之后连续 5 次稳定在 242–270 ms。前者是新 .app 从未被读过、整包要从磁盘冷加载的代价，只发生一次。把 1241.7 当「Mac 启动要 1.2 秒」是错的。

**为什么「开屏移除」是 4.8 秒却不是启动慢**：`dist/index.html:108` 的 `.splash-clock` 是 `animation: splash-clock 4000ms linear both`，`src/splash.ts:35` 的 `dismissSplash()` 先 `await animationDone()` 等所有 `splash-*` 动画 `finished`，才加 `is-leaving`，再等 `SPLASH_FADE + 60 = 580ms` 才 `remove()`。

所以 4806 ms ≈ 4000（设计动画）+ 580（淡出）+ 约 230（启动）。**应用在 255 ms 就已经渲染完、能点了，只是被开屏盖着。** 用户感觉「启动慢」反馈的是那 4 秒开屏，不是 Electron。

### 2.2 空闲内存：**440.8 MB**（整棵进程树 4 个进程）

主进程 pid **18532**。`ps -o rss=` 的单位是 **KB**。

为什么取整棵树：Electron 的内存在主进程、GPU 进程、Network Service、Renderer 之间分布，只报主进程会漏掉三分之二。

| 时刻 | wall (UTC) | 主进程 | Helper | Helper | Renderer | **合计** |
|---|---|---|---|---|---|---|
| t=5s | 2026-11-27T12:22:37.352Z | 150.4 MB | 93.5 MB | 46.6 MB | 149.4 MB | **440.0 MB** |
| t=15s | 2026-11-27T12:22:47.371Z | 150.9 MB | 93.4 MB | 46.8 MB | 149.5 MB | **440.5 MB** |
| t=30s | 2026-11-27T12:23:02.370Z | 150.8 MB | 93.4 MB | 46.8 MB | 149.8 MB | **440.7 MB** |
| t=45s | 2026-11-27T12:23:17.375Z | 150.0 MB | 93.4 MB | 46.8 MB | 149.7 MB | **439.9 MB** |
| **t=60s** | **2026-11-27T12:23:32.370Z** | 150.7 MB | 93.4 MB | 46.8 MB | 150.0 MB | **440.8 MB = 451392 KB** |
| t=90s | 2026-11-27T12:24:02.365Z | 150.8 MB | 93.4 MB | 46.8 MB | 144.8 MB | **435.8 MB** |

**60 秒取 440.8 MB（451392 KB）**。5 秒即稳态，90 秒内波动 1.1%，没有缓慢增长。

这个数就是 Electron 的固定底噪。它是「原生化能省多少」的上限参考，不是可优化项。

### 2.3 播放期间的帧间隔：28 秒 / 3349 帧，**超过 32ms 的 0 帧**（启动首帧除外）

窗口 680×948、dpr=2、`visibilityState: "visible"`；音频 `/tmp/long35.m4a`（33.8 秒）。

**为什么必须在真实窗口里量**：`docs/重构交接-2026-11-16.md` 记过，离屏窗口（`show: false`）会把 rAF 钉在 16.67ms，看起来完美但用户看到的是另一回事。离屏数据只能同环境相对比较。

**为什么采样在页面里跑而不在 Node 里**：CDP 往返有 5–15ms 抖动，拿来当帧计时器会把网络延迟算成渲染卡顿。

| 次 | 帧数 | 跨度 | mean | p50 | p95 | p99 | max | >16.7ms | **>32ms** | fps |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3350 | 28008.7 ms | 8.36 | 8.3 | 9.7 | 10.1 | 98.6 ms | 2 | **1** | 119.6 |
| 2 | 3349 | 28003.9 ms | 8.36 | 8.3 | 9.8 | 10.1 | 108.4 ms | 1 | **1** | 119.6 |
| 3 | 3351 | 28008.4 ms | 8.36 | 8.3 | 9.9 | 10.3 | 100.1 ms | 1 | **1** | 119.6 |

唯一超 32ms 的帧，三次都落在**第 3 帧**（开播后 107.3 / 122.2 / 108.4 ms，间隔 98.6 / 108.4 / 100.1 ms）——是采集刚启动、渲染进程首帧合成的代价，**不是播放造成的**。之后 27.9 秒连续播放，超 32ms 的帧为 **0**。

中位 8.3ms 正贴着 120Hz 的 8.33ms 预算，p99 10.1ms 只超预算 1.8ms。

**播放确证**（这个应用用 Web Audio 解码，**页面里没有 `<audio>` 元素**，`document.querySelectorAll('audio').length === 0` 已实测，所以不能看 `audio.currentTime`）：

```
5s  → 进度条 value 141/1000   14.1%（预期 14.8%）
10s → 289/1000   28.9%（预期 29.6%）
15s → 438/1000   43.8%（预期 44.4%）
20s → 579/1000   57.9%（预期 59.1%）
28s → 819/1000   81.9%
```

线性推进，与 33.8 秒时长吻合。

---

## 3. media-control 的真实行为

**0.9.0**，BSD-3-Clause，作者 Jonas van den Berg。

### 它不是二进制，是 Perl 脚本

`~/.local/bin/media-control` 是 10168 字节的文本文件，`#!/usr/bin/perl`，系统自带 perl **5.34.1**（`built for darwin-thread-multi-2level`）。

**这是设计，不是偷懒。** macOS 15.4 起，MediaRemote.framework 对调用方的 bundle id 有要求。Perl 解释器的 bundle id 是 `com.apple.perl`，以它身份调用就能通过。换成普通二进制会被拒。

### 目录结构必须并排，软链必失败

```
~/.local/bin/media-control                     ← 脚本本体
~/.local/lib/media-control/mediaremote-adapter.pl
~/.local/lib/media-control/MediaRemoteAdapterTestClient   (77920 字节)
~/.local/Frameworks/MediaRemoteAdapter.framework          (Mach-O thin arm64, adhoc 签名)
```

适配层用 `$FindBin::Bin/../lib` 和 `$FindBin::Bin/../Frameworks` 拼路径，`FindBin` 解析的是**真实脚本路径**。所以软链到别处会报：

```
Can't open perl script ".../bin/../lib/media-control/mediaremote-adapter.pl"
```

**bin / lib / Frameworks 必须并排放在同一个前缀下。** 我把它们放在 `~/.local` 下，正好对应 `~/.local/bin` 这条候选路径。

### 安装方式：没装 brew 也能拿到

ungive/media-control 和 ungive/mediaremote-adapter 的 GitHub release **都没有二进制 assets**（只有源码，正式分发只走 brew）。实际做法是从 Homebrew bottle 拉预编译包：

```bash
# 1. 拿匿名 token
curl -s "https://ghcr.io/token?scope=repository:homebrew/core/media-control:pull&service=ghcr.io"
# 2. 直接拉 blob（arm64_tahoe 那个）
curl -L -H "Authorization: Bearer $TOKEN" \
  "https://ghcr.io/v2/homebrew/core/media-control/blobs/sha256:93aaf6b1e2e004..."
```

必须选对系统代号。同一版本有 `arm64_tahoe` / `arm64_sequoia` / `arm64_golden_gate` 三个 blob。

### 子命令

`get` / `stream` / `test` / `send` / `seek` / `shuffle` / `repeat` / `speed`

- `get`：单次快照，平铺 JSON
- `get --bundle-id=ID`：强制读指定应用；无匹配时输出 `[]`（不是 `null`）
- `get --now`：额外汇总一个 `elapsedTimeNow` 字段
- `stream --no-diff --debounce=200`：长驻，每行一个 `{type:"data", diff:false, payload:{...}}`
- `test`：自检，退出码 0 = 适配层可用

### `get` 单次快照不可靠，`stream` 可靠

这是实测最反直觉的一条。Music.app 在播 33.8 秒的音频，`get` 连续读 **6 次全是 `null`**（在 2.4 秒内）；同一时刻起 `stream` 就立刻有数据。

项目本身只用 `stream`（`electron/now-playing-mac.cjs` 里 `spawn(tool, ['stream', '--no-diff', '--debounce=200'])`），所以这不成问题。**但要记住：`get` 拿到 null 不能证明「没有在播放」，也不能证明「读不到」。**

另外 `get` 有一条**时间窗陷阱**：早期用 `~/probe-music/t1.m4a` 测，那音频只有 **1.783946 秒**，而 `open` 本身要 0.085 秒、人看到 prompt 再敲命令必然超过 1.78 秒，于是永远是 null。当时误判成「media-control 失效」。换成 33.8 秒的音频后一切正常。

### 能读到的字段（真实 payload，17 个）

```json
{
  "playbackRate": 1,
  "contentItemIdentifier": "194::195",
  "album": "",
  "mediaType": "MRMediaRemoteMediaTypeMusic",
  "playing": true,
  "elapsedTime": 0,
  "timestamp": "2026-11-27T12:31:10Z",
  "bundleIdentifier": "com.apple.Music",
  "processIdentifier": 18913,
  "isMusicApp": true,
  "title": "long35",
  "uniqueIdentifier": -8944328538971309000,
  "duration": 33.81265306122449,
  "artist": "",
  "genre": "",
  "composer": "",
  "supportedCommands": [ /* 39 项，含 Play/Pause/TogglePlayPause/Stop/Seek 等 */ ]
}
```

**`elapsedTime` 恒为 0，`timestamp` 冻结**。Music 只在开始播放时上报一次进度，之后不更新。唯一能拿真实进度的是 `get --now` 的 `elapsedTimeNow`。

这条限制**不影响任何功能**：`src/now-playing.ts` 的 `NowPlaying` 只有 `app / title / artist / album / status / playing / cover` 六个字段，`grep elapsedTime src/` 零命中。项目不显示进度。

### 项目实际只用其中 6 个

`electron/now-playing-mac.cjs` 的 `parseLine()` 映射：

| media-control 字段 | 项目字段 | 说明 |
|---|---|---|
| `bundleIdentifier` | `app` | 原样传 bundle id，显示名映射在 `src/now-playing.ts` 做 |
| `title` | `title` | 非字符串一律当空串 |
| `artist` | `artist` | 同上 |
| `album` | `album` | 同上 |
| `playing` | `status` / `playing` | `title` 非空 + `playing===true` → `Playing`；有标题但没在放 → `Paused`；没标题 → `None` |
| `artworkData` + `artworkMimeType` | `cover` | 拼成 `data:${mime};base64,${artwork}`；MIME 缺省 `image/jpeg` |

**stream 首行的 `payload` 是 `{}`**，解析后得到 `app/title/artist/album` 全空、`status: "None"`。这是正常的启动态。

去重靠 `[app, title, artist, album, status].join('\u0000')` 做签名，相同就跳过——否则页面每 200ms 重算一次碟面配色，白白掉帧。

---

## 4. 逐条验过的链路（`a552096` 修的就是这里）

`TOOL_CANDIDATES` 原本只列 brew 的三个路径：

```js
'/opt/homebrew/bin/media-control',  // Apple Silicon 的 brew
'/usr/local/bin/media-control',     // Intel Mac / 旧 brew
'/opt/local/bin/media-control',     // MacPorts
```

这台机器三条全无（`/usr/local` 归 root 不可写），于是 `toolPath()` 返回 `""` → `start()` 返回 `false` → 应用走 `handle(EMPTY)` → 页面永远显示「没有外部音乐」。

**这个 bug 极难查**：`media-control get` 在命令行里一切正常，应用里什么都不显示，日志里没有任何错误——因为这整条链本来就是**设计成静默降级**的。

修法是追加第四条候选 `path.join(os.homedir(), '.local', 'bin', 'media-control')`，原三条保留。

**关于 `/usr/local/bin` 的一条原则**：即使它此刻可写，也不该把第三方二进制放进去。那是系统目录，塞东西进去是坏习惯，而且换台机器就失效。代码里加 `~/.local/bin` 候选才是对的做法。

验证了三层：

1. **源码**：`toolPath()` → `/Users/dumbraven/.local/bin/media-control`
2. **产物内代码**：把 `app.asar` 里的 `electron/now-playing-mac.cjs` 抽出来（8228 字节），与工作区文件字节一致，含 `.local` 那条
3. **端到端**：产物代码 + 真实 Music.app 播放 → `start()` 返回 `true`，收到 `{"app":"com.apple.Music","title":"long35","status":"Playing","playing":true,"cover":""}`

修复前 `start()` 是 `false`。

---

## 5. 已知未验 / 已知做不到

### 5.1 封面：字段名确认存在，但没拿到过真实数据

`artworkData` / `artworkMimeType` 这两个字段在 media-control 的 README 里有（`jq -r .artworkData | base64 -d > cover`），**但我们没有一首带封面的歌**。

实测的 payload 里**根本没有这两个 key**——因为测试音频无封面。所以「拿到带封面的歌之后封面能不能正确拼成 data URL」这一步是**未验**的。`parseLine()` 里那段拼接逻辑有单测覆盖（含「封面缺 MIME 退回 image/jpeg」「没封面时 cover 是空串」），但那验的是映射，不是 media-control 真的吐不吐这个字段。

验这一步需要一首带内嵌封面的歌，也就是等装第三方播放器（网易云）+ 手机验证码登录之后。

### 5.2 lineMode：这台机器打不开，因为缺虚拟声卡

**这和 media-control 无关，是两个不同的缺口。**

- media-control 只提供**元数据**（歌名/歌手/封面），给不了 `attachLineIn()` 需要的 `MediaStream`。
- 音频流那一路要虚拟声卡。`src/line-in.ts:24` 的正则是 `/cable\s*(output|out)|vb-?audio\s*(virtual\s*)?cable/i`，只认 **VB-Cable**（Windows 那个）。这台机器两个都没有，`openCable()` 抛 `DOMException('没有找到虚拟声卡', 'NotFoundError')`。

后果是 `src/App.tsx:450` 的 `toggleLineMode` 里：

```js
const stream = await line.current.open();   // 这里就抛了
player.current?.attachLineIn(stream);
change({ lineMode: true });                  // 永远走不到
```

`cabinet.lineMode` 保持 `false`，而 `src/App.tsx:123` 只在它为真时才 `askNowPlaying('start')`——**所以 media-control 根本不会被拉起来**。这解释了「应用启动后看不到 media-control 进程」的现象。

**`lineMode` 在 `src/` 里命中 48 行**（App.tsx 28 / player.ts 6 / PlayCard.tsx 5 / records.ts 4 / SettingsModal.tsx 4 / ListeningRoom.tsx 1），但真正把「显示」和「避让」锁死的只有 **2 行**——`src/App.tsx:121` 的 `if (!cabinet.lineMode)` 与 `:128` 的依赖数组。其余 46 行是 `cabinet.lineMode && …` 短路或三元，表达的是「音乐源是外部播放器，所以本地音乐让位」，属于音频层语义，解耦后应继续挂着 `lineMode`。

**耦合不深，但它卡的位置是全链路入口**：`lineMode` 为 false → 不 `listenNowPlaying` → `nowPlaying` 永远是 `emptyNowPlaying` → `hasTrack()` 恒假 → 后面所有守卫都短路。入口锁住，后面再多的判断也白搭。

**关键的结构事实（决定改法）**：显示层所有地方都是 `cabinet.lineMode && hasTrack(nowPlaying)` 或 `if (cabinet.lineMode)` 分支——`src/App.tsx:312` 的 `externalDisc`、`:319-339` 的 `playingNow`/`discTitle`/`discSubtitle`/`discCover`/`miniDiscSource`/`canSkipDisc`、`:374` 的 `stageNow`、`src/ListeningRoom.tsx:79`。所以**只放开设订阅条件是不够的**：那样交付的只是「能读到」，界面上一个字都不会多出来，属于做了等于没做。

**改法（未实施）**：不新增字段、不拆开关，而是把 `lineMode` 的语义从「我要听外部音乐（且已接好声卡）」放宽成「我要接入外部播放器（有没有声卡都行）」。开关打开时先试抓声卡：抓到 → 全都开（现状不变）；抓不到 → **仍然打开**，显示歌名 + 说明「这台机器没有虚拟声卡，所以环境音不会自动避让」。因为显示层那 6 处已经挂在 `lineMode` 上，`lineMode` 一为真它们就自动生效，不需要动。

**为什么 Windows 上不会回归**（已实测，不是推断）：`askNowPlaying('start')` 在 `src/` 里只有一处（`src/App.tsx:123`），而 `electron/now-playing.cjs` 的 `attachNowPlaying()` 只创建 bridge 并注册 IPC + 一个 400ms 的 outbox 轮询，**它自己从不调 `start()`**；`bridge.start()` 只有两个入口（`:72` 走 IPC、`:213` 走 outbox），都由页面主动发起。所以订阅仍然完全由开关控制——`lineMode` 为 false 时 `nowPlaying` 恒空，显示层放宽的那个 `||` 分支永远进不去。

**仍未解决**：`cablePattern` 只认 VB-Cable，装 BlackHole 也不会被认出来（要加 `/blackhole/i`）。所以 Mac 上「外部音乐响起时压低环境音」这个核心功能**确实用不了**，这与上面那条解耦无关，属于能力边界。

### 5.3 测试套件里那 5 条环境依赖的失败

**这一节在 2026-11-27 晚改过一次。** 原先这里记的是 6 条失败，其中一条是 `tests/now-playing-mac.test.ts` 第 9 条「找不到工具时返回空串」：

```js
assert.equal(toolPath(), '');
```

它当时的前提是「这台机器上没有 media-control」，而本机恰恰装了，而且正是 `a552096` 让它被认出来的——于是它和第 10 条（要求候选列表必须有 `~/.local/bin`）互相矛盾：工具真装了，第 9 条必红。实测过：把 `~/.local/bin/media-control` 移走 → 10/10 全过；移回来 → 9/10。

**这条已在提交 `5b46183` 修掉。** 错不在代码，在断言方式：拿「本机恰好没装」当契约。改法是验契约——返回值要么是空串，要么是磁盘上真实存在的文件，绝不能是「候选列表里的第一条」这种没验证过的字符串（后者正是原 bug 的形态）。负面验证：把 `toolPath()` 改成 `return TOOL_CANDIDATES[0]`，测试立刻失败。

**现在 Mac 上是 429 通过 / 5 失败**（`# tests 429 / # pass 424`），5 条全部来自 `tests/media-grants.test.ts`（第 41/101/128/220/272 行），断言 `looksLikeFolder('C:\\')` 这类 **Windows 路径语义**——盘符、`System32`、8.3 短名、末尾点号空格。这些在 macOS 上本来就不成立，不是回归。

**该怎么处理（未做）**：给这 5 条加平台跳过，例如 `const windowsOnly = { skip: process.platform !== 'win32' }`，或用 `describe` 包一层。现在没做是因为它们在 Windows 上是真保护（授权目标黑名单是安全边界），改成条件跳过要确保 Windows 上一条不少。**判断依据：这 5 条测的是「哪个目录不许授权」，属于 Windows 专属语义，Mac 上对应的边界应该是另一套（`/System`、`/Library` 等），不是把 Windows 路径塞进 Mac。

---

## 6. 踩过的坑

按「撞上时的症状」记，因为这些坑的共同特征是**症状指向错误的方向**。

### `ELECTRON_RUN_AS_NODE=1` 让 Electron 静默假成功

第一次启动 `.app` 时**静默 exit 0、0 秒退出、无任何输出**，连 stderr 都没有。原因是 shell 环境里带着这个变量，它让 Electron 二进制退化成纯 Node，跑完就退。

**以后每条启动命令都要 `env -u ELECTRON_RUN_AS_NODE`。**

### `osascript` 查播放状态会无限卡死

```
timeout 10 osascript -e 'tell application "Music" to get player state'
```

退出码 **124**（超时被杀）。原因是 macOS 自动化授权（TCC）弹窗无人点，进程就一直等。这台机器 `~/Library/Application Support/com.apple.TCC/TCC.db` 都不存在——从没授权过 AppleEvents。

**不要用 osascript 查播放状态。** 要查就用 media-control。

### 拿 `getElementById('splash') === null` 当「加载完成」

页面刚开始加载、DOM 还是空的时候，这个条件**也成立**。等待循环立刻 break，随后查 UI 元素永远是空数组（实测 `所有 input: []`、`所有带 aria-label 的按钮: []`），于是误判成「页面没有那些元素」。

正确判据是等**实际要用的元素**出现：`.view-tabs button` 与音频 file input 同时存在。

### `DOM.querySelector` 的 nodeId 会因 React 重渲染失效

报 `Error: Could not find node with given id (-32000)`。两次 CDP 往返之间节点就可能被替换。

改用 `objectId`：先 `Runtime.evaluate` 拿到 JS 对象句柄，再 `DOM.setFileInputFiles({objectId, files})`。句柄指向具体对象，重渲染不影响。

顺带：`DOM.setFileInputFiles` 是**真的走了 input 的 change 事件**，比在页面里造 `File` 对象更接近用户真实操作。

### 打桩 `fs.existsSync` 返回 true 会造成假绿灯

打桩让它说「工具在」，但 spawn 的路径实际不存在 → spawn 失败 → 触发 `stop()`。看起来测通了，实际什么都没跑。

**只有真路径才可靠。**

### `delete report.stats.deltas.length ? null : null`

这行语法上合法（`delete` 一个三元表达式的结果），但语义是 `delete null`，抛 `TypeError: Cannot delete property 'length' of [object Array]`。整轮测量数据算完了却没写进文件。

### 每跑完一次要等 CDP 端口真正释放

否则下一次会连到上一个实例，测出来的「启动时间」是零。做法是轮询 `/json/list` 直到连不上为止。

### `asar extract-file` 会把文件写到当前工作目录

我跑了一次 `npx asar extract-file ... electron/now-playing-mac.cjs`，结果在**仓库根目录**留下一个 `now-playing-mac.cjs`。虽然已被 `.gitignore`/未跟踪发现并删掉，但这类命令要留意 cwd。

用项目自带的 `@electron/asar` 更可控：

```js
const asar = require('/Users/dumbraven/Vibe-bold/node_modules/@electron/asar');
asar.extractFile(asarPath, 'electron/now-playing-mac.cjs');  // 返回 Buffer，不写盘
```

---

## 7. 怎么复现这些数

```bash
export PATH=$HOME/.local/node/bin:$PATH
source ~/.local/git-env.sh

# 冷启动 5 次
cd /tmp/qa && env -u ELECTRON_RUN_AS_NODE node run-cold.mjs

# 内存 90 秒
env -u ELECTRON_RUN_AS_NODE node rss.mjs

# 帧间隔 28 秒播放（需要音频）
env -u ELECTRON_RUN_AS_NODE node frames.mjs

# 单测
cd ~/Vibe-bold && node --test --test-reporter=tap tests/now-playing-mac.test.ts
```

造 30 秒以上的测试音频（系统自带，不需要 ffmpeg）：

```bash
# 40 个「长文本。」→ 36.9 秒；正常语速下约 0.9 秒/句
LONG=""; for i in $(seq 1 40); do LONG="${LONG}长文本。"; done
say -o /tmp/long.aiff "$LONG" && afconvert -f m4af -d aac /tmp/long.aiff /tmp/long35.m4a
afinfo /tmp/long35.m4a | grep duration   # 确认时长，别想当然
```

**别用短句子凑**：一句「这是一段用于测试的语音」只有 7.7 秒，不够测流畅度（5 次切歌半秒就结束了，测不出东西）。念文本前先在心里估一下字数，造完一定要 `afinfo` 确认。
