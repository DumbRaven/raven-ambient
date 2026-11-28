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

### 5.1 封面：2026-11-28 用带封面的真实文件验通了（并抓到一个去重 bug）

**之前是未验状态**：`artworkData` / `artworkMimeType` 这两个字段 media-control 的 README 里有，但我们没有一首带封面的歌，payload 里根本没有这两个 key，只验过 `parseLine` 的映射逻辑（单测），没验过 media-control 真的吐不吐。

**现在验通了**，用的是自己造的文件：`ffmpeg -i long35.m4a -i cover.png -map 0:a -map 1:v -c:v mjpeg -disposition:v attached_pic`，塞一张 600×600 的蓝橙条纹图，导入 Apple Music 播放。media-control 的真实输出：

```
title = "Artwork Test"
artist = "Raven QA"
album = "Probe Album"
playing = true
bundleIdentifier = "com.apple.Music"
artworkMimeType = "image/jpeg"
artworkData len = 63032          ← base64，真实存在
```

`parseLine` 转出来：`cover = "data:image/jpeg;base64,/9j/4AAQSkZ…"`，长度 63055；把这串 base64 解回来是 47274 字节、头 4 字节 `ffd8ffe0`（标准 JPEG 头），**打开就是那张条纹图，没有坏**。

app 界面也确认了：`.vinyl-label` 的 `background-image` 是 `url("data:image/jpeg;base64,/9j/4AAQSkZJRg…")`，长度 63062；`.playing-title` 显示 `APPLE MUSIC` / `Artwork Test`。

**顺带修掉一个真 bug（`electron/now-playing-mac.cjs` 的 `consume`）**：去重签名原来只含 `[app, title, artist, album, status]`，**不含封面**。而 macOS 是分两步给数据的——先歌名歌手，几百毫秒后才补封面。于是第二条「带封面」的消息签名与第一条相同，被去重直接跳过，**页面永远拿不到封面**，唱盘中心只剩一块纯色。

症状极隐蔽：**有时有封面、有时没有**，取决于两条消息哪条先到。真机上第一次看到封面（`bgImageLen: 63062`），换个时机再跑就变成 `bgImageLen: 4`（`none`），一开始还以为是异步取色把图盖掉了。

修法：签名里加 `String(payload.cover.length)`——放长度不放整串 base64（封面几万字节到几 MB，塞进签名会让每次比较都搬一大段字符串）。补了 `tests/now-playing-mac.test.ts` 的「先到的是歌名、后到的是封面——第二条不能被去重吃掉」，并做了负向验证：把这一项删掉，测试立刻红。

**紧接着又抓到第二个（同一处代码，`e010496`）**：签名修好之后封面能显示了，但**稳定 8 秒后突然变空**（真机连续采样：前五次都是 `63062`，第八秒变 `0`）。原因是系统会**反复**推同一条消息，其中一部分不带 artwork——「带封面」→「不带封面」两条连着推，第二次把唱盘中心清掉了。

修法：记 `lastCover` / `lastKey`（`app\u0000title`）。同一首歌里后一条没封面就把上一张补回来；只有换歌（key 变了）才允许没有封面。`stop()` 里一并清空，避免下次起来拿上一次会话的封面。补测试「同一首歌，后面那条不带封面也不能把已显示的封面抹掉」，同样做了负向验证。

**修完之后真机连测 20 秒，`bgImageLen` 全程 `63062` 不变**；截图里唱盘中心是那张蓝橙条纹封面，盘体颜色也是从封面取出来的（橙蓝渐变彩胶）。


### 5.2 lineMode：已解耦，没声卡也能显示歌名（`ae28db8` 落地）

**原来的问题**（保留下来当背景，它是这条设计决定的由来）：`cabinet.lineMode` 一个开关同时管了两件事——显示外部播放器歌名（只要元数据），和用虚拟声卡抓声音做环境音避让（要 `MediaStream`）。绑在一起的后果是：抓不到声卡时 `toggleLineMode` 里 `change({ lineMode: true })` 走不到，而 `App` 里 `if (!cabinet.lineMode) { setNowPlaying(emptyNowPlaying); return; }` 把订阅链路的入口整个关掉——连歌名都拿不到，`media-control` 永远不会被拉起。

**现在的语义**：「我要接入外部播放器，有没有声卡都行」。开关打开先试抓声卡：

- 抓到 → 全都开，与以前一致；
- 抓不到 → **仍然打开**。歌名、封面照常显示（它们来自系统媒体会话，与声卡无关），环境音照常起来（它是这个模式里唯一还会出声的东西），设置面板用 `noCableHint` 一次说清缺什么、装好之后怎么让它生效。

**为什么不用另外两种改法**（都考虑过，都否了）：

1. 新增 `extInfo` 字段：只解决「能读到元数据」。而显示层全都挂在 `lineMode` 上（`App` 里的 `externalDisc`、`playingNow`/`discTitle`/`discSubtitle`/`discCover`/`miniDiscSource`/`canSkipDisc`、`stageNow`，以及 `ListeningRoom` 里那处），不一起放宽的话界面上一个字都不会多，属于做了等于没做；还会引入两个 effect 抢同一个 media-control 子进程。
2. 拆成两个开关：设置面板从 1 维变 2 维，而 Mac 上「有元数据没声卡」是常态，每次都让用户面对两个开关去猜该开哪个。

**错误分类也一起改了**：`src/line-in.ts` 新增 `isRetriable()`。`lineError` 只装**可重试**的失败（`NotAllowedError` / `NotReadableError` / `OverconstrainedError`）——那三样配「再试一次」按钮有意义；`NotFoundError`（没装/没插）是**常态不是故障**，放进带按钮的位置等于给一条必然失败的假出路，它改走 `noCableHint` 那条状态说明。

**当时以为的能力边界（后来被推翻，见 5.4）**：`src/line-in.ts` 的 `cablePattern` 只认 VB-Cable，装 BlackHole 也不会被认出来，所以当时判断 Mac 上「外部音乐响起时压低环境音」用不了。**这个结论在 2026-11-28 被实测推翻**——走 Core Audio process tap（`audiotee`）不需要任何虚拟声卡，详见 5.4。

本机实测的三态（2026-11-27）：

| 状态 | 电表行 | 错误块 |
|---|---|---|
| 没装声卡 | `noCableHint`（含「装好之后关掉再打开这个开关」） | 不出现 |
| 系统拒权限 | 「外部音乐没有接通」 | 「系统拒绝了录音权限」+「再试一次」 |
| 关掉开关 | 整块不渲染 | 不出现 |

第一行和错误块**永远不同时出现**，这是 `isRetriable` 那条规则直接推出来的结果。

### 5.3 测试：全绿；那 5 条失败曾经是函数真失守，不是平台差异

**这一节在 2026-11-27 晚改过两次，第二次把结论整个推翻了。**

原先记的是：Mac 上 429 通过 / 5 失败，5 条来自 `tests/media-grants.test.ts`，断言 `looksLikeFolder('C:\\')` 这类 Windows 路径语义，判定为「在 macOS 上本来就不成立，不是回归」，处理方式是「加平台跳过」。

**这个判断是错的。** 那 5 条能失败，是因为 `looksLikeFolder()` 在 macOS 上真的失守了——它对任何路径都返回 `true`。实测（`ae28db8` 之前）：

```
"/"                true   ← 整个磁盘可以授权进来
"/System"          true
"/System/Library"  true
"/private"         true
"/Applications"    true
"/Volumes/Ext"     true
```

三个根因：

1. 黑名单 `['c:\\windows', 'c:\\program files', ...]` 全是 Windows 路径，在 macOS 上传入的 `/System` 一个都匹配不上。
2. 更隐蔽：`blocked.some(prefix => lower.startsWith(prefix + '\\'))` 把分隔符硬编码成反斜杠。即使往黑名单里加 `/System`，也判断不出 `/System/Library`（Mac 用 `/`）。
3. 根目录判据 `/^[a-zA-Z]:$/` 只认盘符。`/` 去掉尾斜杠是**空串**，一路放行。

**`ae28db8` 的修法——不改测试，改函数**：

- 按**路径自身长什么样**选解析器，不按跑在哪台机器上：有盘符或 UNC 前缀走 `path.win32`，以 `/` 开头走 `path.posix`，裸相对路径才用宿主平台。于是 `C:\Windows` 在 Mac 上也拒、`/System` 在 Windows 上也拒，两条契约与宿主无关。
- 黑名单按平台分两份（`WINDOWS_BLOCKED` / `POSIX_BLOCKED`），**逐段比对**而不是前缀字符串拼接。
- 根目录与挂载盘根单独挡（`/`、`/Volumes`、`/Volumes/<盘名>`），盘里的子目录照常放行——用户的素材通常在 `/Volumes/Ext/素材` 下面。

**现在的数字**：2026-11-27 那次是 Mac 与 Windows **都是 434 tests / 434 pass / 0 fail**；2026-11-28 加了 Apple Music 封面与去重两条（见 5.1），Windows 侧现在是 **441 tests / 441 pass / 0 fail**。`tests/media-grants.test.ts` 从 12 条涨到 15 条，新增的 3 条把这次 bug 本身固化成回归（含「在 Mac 上 `C:\Windows` 也必须拒」这条与宿主无关的契约）。

**教训一（比结论有用）**：把测试失败归因成「这个平台不适用」之前，先确认它在那个平台上**该不该**通过。这次差点用 5 条 `skip` 把一个「整盘可授权」的安全洞盖掉。判据是：测的是「什么该被拒绝」，就别问「这个平台上成不成立」，要问「这个平台上对应的是什么」。

**教训二**：`isVolumeRoot()` 第一版写了 `if (process.platform !== 'darwin') return false;`，和上面刚立的原则正相反——Windows 上它直接跳过，`/Volumes/Ext` 就放行了。是新增的测试抓出来的。判「该用哪个默认解析器」时用 `process.platform` 是对的，判「某个具体路径该不该拒」时用它就错。

### 5.4 系统音频：路线验证可行，但 macOS 27 的授权不落盘（2026-11-28 收工时的真实状态）

**这一节在 2026-11-28 晚被整个改写过。** 原来写的是「能实现了，不需要虚拟声卡也不用 native 代码」——技术路线那半是对的，但「装进 app 就能用」那半**没做成**。收工时的事实是：`audiotee` 能从 Terminal 里抓到真实音频，从 app 自己 spawn 起来永远是静音。下面按「已验证 / 已排除 / 卡在哪」分开记，别再把推测当成结论。

#### 已验证可行：Core Audio process tap

`audiotee`（[makeusabrew/audiotee](https://github.com/makeusabrew/audiotee)）——预编译 Swift 二进制，用 macOS 14.2+ 的 Core Audio taps API 把系统输出写成裸 PCM 到 stdout。604760 字节，Mach-O universal（x86_64 + arm64），MIT。

**同一份脚本、同一台机器，只有发起进程不同**的四次实测（都是 `--sample-rate 48000 --chunk-duration 0.2`，16-bit LE 单声道，边 `afplay` 放测试音频边采）：

| 怎么起的 | `launchctl managername` | 结果 |
|---|---|---|
| SSH（`mac_run.ps1`） | `Background` | `nonzero=0 peak=0` |
| `launchctl asuser 501 sudo -u dumbraven`（强换会话） | `Aqua` | `nonzero=0 peak=0` |
| `open xxx.command` → Terminal.app | `Aqua` | **`nonzero=332332 peak=29891`，15.5%** |
| 同上，重启 Mac 后第一次 | `Aqua` | **`nonzero=328817 peak=24004`，69.9%** |

还有两次破锁后的成功：`48.7%` 与 `33.4%`。**这条路线本身是通的，PCM 是真的。**

`audiotee` 的 stderr 有一条完整的成功链可以作为「tap 建成了」的判据：

```
AudioHardwareCreateProcessTap completed {"status":"0"}
Tap format retrieved {"channels":"1","sample_rate":"48000"}
Audio converter created 48000→16000
Using device's native format {bits_per_channel:16, channels:1, ...}
stream_start
Creating IO proc
```

**只有走到 `stream_start` / `Creating IO proc` 才算 IO proc 挂上了**。卡在 `Successfully retrieved device format` 之后就没了，等于 tap 建了但没开始推数据。

#### 已排除的两条路（实测过，不是查文档推的）

1. **Electron 的 `audio: 'loopback'`**：`electron.d.ts:22940` 原文「...is currently only supported on Windows」。macOS 上给这个值，`getDisplayMedia` 要么返回 `readyState` 从 `t=0` 就是 `ended` 的死轨（Background 下实测），要么整个请求挂到超时（Aqua 下实测）。**Chromium 内建 CATap 是 Web 版的能力，Electron 的 `setDisplayMediaRequestHandler` 在 darwin 上不接受这个参数，两件事不能划等号。**
2. **`useSystemPicker: true`**：`AbortError: Timeout starting video source`，连 video 都起不来。

#### 已排除的签名路子：`--options runtime` 走不通

Core Audio tap 会让 `coreaudiod` 向 `tccd` 查 `kTCCServiceMicrophone`，而 hardened runtime 下这条要求 `com.apple.security.device.audio-input` entitlement：

```
Prompting policy for hardened runtime; service: kTCCServiceMicrophone
requires entitlement com.apple.security.device.audio-input but it is missing
```

给 app 加 `--entitlements` 能让这条消失（`AUTHREQ_PROMPTING` 出现），但**加 `--options runtime` 会让 app 启动即崩**：

```
Library not loaded: @rpath/Electron Framework.framework/Electron Framework
Reason: code signature in '.../Electron Framework' not valid for use in process:
        mapping process and mapped file (non-platform) have different Team IDs
```

把每个 Mach-O（Electron Framework 本体、libGLESv2、libffmpeg、各 Helper、Squirrel、Mantle、ReactiveObjC、chrome_crashpad_handler）都用 ad-hoc 重签一遍再签外层，照样报同样的 Team IDs 不一致。**Electron Framework 需要 Apple 官方 Team ID，ad-hoc 签名没有，这条路彻底走不通。**

#### 顺带查清的两件事

**cdhash 是确定的，不会因为「重新打包」而随机变化。** 同一个包、同一条签名命令连签两次，`CDHash` 完全一致（实测 `756ffa630763031b99042f9dae8c0aafd0a8cefc`）。`scripts/package-mac.cjs` 里 `identity: null` 会让 electron-builder 跳过签名、直接用 Electron 自带的 linker-signed 签名，那条 cdhash 也是内容决定的（`2e8fbaade7de12b32c80708466ff71ac0ca2ace4`）。**之前观察到的「每次 cdhash 都变」是我混用了三种签名方式（先 `--deep`、再 `--sign -`、再带 `--entitlements`）造成的人为结果，不是必然。**

**「系统音频录制」的授权不写进 `TCC.db`。** 全盘只有 `/Library/Application Support/com.apple.TCC/TCC.db` 一份，`select distinct service from access` 里从来没有 `kTCCServiceAudioCapture`；`/Library/Preferences/Audio/com.apple.SystemSettings.plist` 里的 `Tap_UIDList` 也始终是空数组。`tccd` 内存里能记出 `authValue=2`（允许），但**不落盘**——重启 `tccd` 或换 responsible 进程就丢。

#### 卡在哪：coreaudiod ↔ tccd 的死锁

app 自己 spawn `audiotee` 时永远静音。用 `sample` 把两边都抓下来，是一条三方互锁：

```
audiotee        mach_msg / HALC_ProxyObject::SetPropertyData      （等 coreaudiod 回包）
coreaudiod      HALS_IOContext::CheckTCCAudioInputAccess
                  → CheckTCCAndThrow
                  → macOS_TCC_And_Input_Status_Handler::CheckTCC
                  → TCCAccessCheckAuditToken                      （等 tccd 回包）
tccd            RunLoop（等用户点弹窗，而弹窗走 UserNotificationCenter）
```

`audiotee` 的 IO 线程栈停在 `caulk::mach::semaphore::wait_signal_or_error` → `semaphore_wait_signal_trap`，几千个采样不动一次；`processAudio` 回调一次都没进。核验命令：

```
sudo sample <audiotee pid> 2 -f /tmp/a.txt   # 看有没有 processAudio / IOWorkLoop
sudo sample <coreaudiod pid> 2 -f /tmp/c.txt # 看有没有 CheckTCCAudioInputAccess
```

**两个实测出来的规律：**

1. **只 `killall coreaudiod` 无效，必须 `killall -9 tccd coreaudiod` 同时杀**。死锁形成以后杀一边，另一边还在等，重新请求立刻再次锁死。同时杀掉后立刻跑，成功率 100%（复现过两次：48.7% 和 33.4%）。
2. **TCC 按 `responsible` 进程查，不是按发起请求的二进制。** `procinfo` 显示 app 内 spawn 的 `audiotee` 的 `responsible pid` 就是 app 主进程；Terminal 里跑时 responsible 是 `com.apple.Terminal`（有授权）。所以「同一个二进制，Terminal 里能出声、app 里全零」不是文件坏、不是路径错——**是授权身份不同**。

**重启 Mac 解决不了这个问题。** 重启后 Terminal 路径第一次就直接 69.9%（不用破锁），说明死锁是长时间运行累积的状态；但 app 自己 spawn 仍然是 SILENT、`Tap_UIDList` 仍然为空。清理掉所有多余的 `.app` 副本（`~/Raven Ambient.app.old*` 等四份）也没有改变结论。

#### 收工时的结论与下一步

**代码保持现状**（`a3798b2` + `e0e6328`）：`audiotee` 子进程管理、PCM→`MediaStream` 拼装、`silent` 判据（2.5 秒没收到非零样本就报 `silent`，不再假装「已接上」）、以及指路「系统设置 → 隐私与安全性 → 录屏与系统录音 → 仅系统录音」的文案，全部保留——它们是对的，只是授权这一步在 macOS 27.2.1 上过不去。

**没做成的是**：让 app 自己在「允许」之后真的拿到 PCM。可能的方向（都未验证）：

1. 等 Apple 修 `TCCAccessCheckAuditToken` 在 audio tap 下的死锁（这是系统 bug 的样子）。
2. 拿 Apple 开发者证书做正式签名 + 公证（`--options runtime` 只有正式签名才不崩），看授权是否变成可持久。
3. 改走 BlackHole 虚拟声卡：`src/line-in.ts` 的 `cablePattern` 改成也认 BlackHole，走已有的 `openCable()` 路径。这条不碰 TCC audio tap，但要用户装驱动 + 建多输出设备。

**不要因为这一节之前的措辞「能实现了」就以为已经能用。** 现在产品层面的真实状态是：Mac 上打开「外部音乐」能显示歌名和封面（`media-control` 那条链与 audio tap 无关，已验），但环境音避让在这台 macOS 27.2.1 上待解。

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
