# macOS 第一次上手

这份是给「在 Mac mini 上把它跑起来」看的。仓库侧已经做完了（提交 `5fa8bae`），
下面全是在 Mac 上要做的事。

## 1. 装工具

```bash
# Node.js 22 或更高（brew 装最省事）
brew install node

# 外部音乐的数据源。没有它也能用，只是看不到别的播放器在放什么
brew install media-control
```

`media-control` 一定要用 brew 装到标准位置——代码里写的是绝对路径
（`/opt/homebrew/bin/media-control`，Intel Mac 是 `/usr/local/bin/`），
因为 GUI 启动的 app 拿不到终端里的 PATH。装在别处就得改
`electron/now-playing-mac.cjs` 顶部的 `TOOL_CANDIDATES`。

## 2. 拉代码、打包

```bash
git clone https://github.com/DumbRaven/raven-ambient.git
cd raven-ambient
npm ci
npm run package:mac
```

产物在 `release/mac-arm64/Raven Ambient.app`。

第一次打开会被 Gatekeeper 拦（没有 Apple 开发者证书，只能 ad-hoc 签名）：

- **右键 → 打开**，弹窗里再点「打开」；或者
- `xattr -dr com.apple.quarantine "release/mac-arm64/Raven Ambient.app"`

## 3. 先确认这三件事有效

打开之后按顺序试，有问题就停在那儿报给我：

1. **唱片柜能出声**——随便点一张唱片，能播就说明 Web Audio 那条路是通的。
2. **番茄钟小窗**——进专注页，小窗要浮在别的窗口上面。如果它跑到后面去了，
   是我给的 `'floating'` 档位不对，不是逻辑错。
3. **外部音乐**——在 Spotify 或 Apple Music 里放一首，回到唱片柜看有没有显示歌名。
   没显示就先单独验上游：

   ```bash
   media-control get
   ```

   能吐出 `{"title":...}` 说明是代码的问题；报错或空就是 media-control 在这版
   系统上失效了（它依赖系统实现细节，Apple 补掉就会坏）。

## 4. 顺手记三个数

这三个数是用来回答「要不要改成原生开发」的，直接决定后面做什么：

| 记什么 | 怎么量 |
| --- | --- |
| 冷启动到能点 | 秒表，双击图标 → 界面出来能点为止 |
| 空转内存 | 活动监视器里找 Raven Ambient，「内存」那一列 |
| 切歌掉不掉帧 | 看唱盘转动和封套换色有没有顿感 |

**别用「感觉快/慢」回答**，给具体数字。Windows 那份我可以随时量出来对比。

## 5. 如果要我远程看

需要你在 Mac 上开两件事：

```bash
# 系统设置 → 通用 → 共享 → 远程登录，打开
# 然后在终端里看自己的局域网地址
ipconfig getifaddr en0
```

然后把地址（形如 `192.168.1.x`）发我，并允许 SSH 用密钥登录。

**注意**：SSH 能做的只有「跑命令、看报错、改代码」。`tools/probe/` 那套像素基线
需要图形界面，SSH 跑不出来——视觉验收只能在真机前做。

## 已知的三个不确定

1. **图标可能糊**。用的 `build/icon.png` 是 512×512，electron-builder 会自己转
   `.icns`，但 retina 的槽位要 1024。上手看一眼 Dock 图标，糊就告诉我，得重画源图。
2. **`backgroundMaterial` 与窗口 `icon` 现在只在 Windows 上传**。理论上不影响 mac，
   但这条是「按平台条件展开」的写法，没在真机验过。
3. **桌面放映窗**（`desktop.html`）在 mac 上的多屏/全屏行为没测过。它的定位是
   「桌面上的画」，Windows 上靠「不做 alwaysOnTop」实现，mac 上的表现要试。
