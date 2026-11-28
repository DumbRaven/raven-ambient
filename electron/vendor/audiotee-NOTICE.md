# 第三方组件：audiotee

本目录下的 `audiotee` 是一个预编译的 macOS 可执行文件，用来抓取系统音频输出。
它**不是本项目自己的代码**，按 MIT 许可证随本项目一起分发。

## 它是什么

`audiotee` 用 macOS 14.2 引入的 [Core Audio taps API](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)
把系统正在播放的声音「旁听」下来，以裸 PCM 写到 stdout。

我们用它，是因为 macOS 上没有 VB-Cable 那样的虚拟声卡可装，而 Electron 的
`audio: 'loopback'` 在 darwin 上不接受（`node_modules/electron/electron.d.ts` 原文写明
"currently only supported on Windows"）。这两条路都实测排除了，见
`docs/macOS-实测记录.md` 第 5.4 节。

## 来源与版本

- 上游仓库：<https://github.com/makeusabrew/audiotee>
- npm 包：<https://www.npmjs.com/package/audiotee> v0.0.7
- 取用路径：`https://registry.npmjs.org/audiotee/-/audiotee-0.0.7.tgz` 里的 `bin/audiotee`
- 大小：604760 字节
- 校验值：`sha256 = 10b1763bbe57062d58d89704b3a8ee49267763f60919fb0b51e84f2686bcb8e7`
- 架构：Mach-O universal binary（x86_64 + arm64）

**为什么仓库里直接放二进制，而不是构建时下载**：这个产品的播放链路一直是纯本地的，
让「能不能听外部音乐」依赖网络下载不符合它的性格；604 KB 也不算大。代价是仓库
多一个二进制文件，Windows 侧会白白多下载 604 KB（它在 Windows 上不会被用到）。

## 许可证

上游 npm 包的 `package.json` 声明 `"license": "MIT"`，但**包里没有附带 LICENSE 文件**
（`LICENSE` / `LICENSE.md` / `LICENSE.txt` 在 `main` 与 `master` 两个分支上都是 404），
仓库 README 里只有三行：

```
## License

### The MIT License

Copyright (C) 2025 Nick Payne.
```

MIT 要求再分发时附上版权声明与许可声明，所以下面按 MIT 标准文本补全正文
（正文本身不含版权人姓名，那部分单独写在上面的版权行里）：

```
MIT License

Copyright (C) 2025 Nick Payne

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 升级时要注意

上游 README 自己挂着一条警告：**API 不稳定，可能不通知就改**。它输出的 PCM 格式
（采样率、位深、声道数）与命令行参数是我们依赖的部分，升级前先看这几个：

- `--sample-rate` 的可选值有没有变（当前：8000/16000/22050/24000/32000/44100/48000）
- `--chunk-duration` 的默认值（当前 200ms）
- stdout 是否仍然**只**是裸 PCM（日志一律走 stderr）——这条最关键，混进来任何
  非 PCM 字节都会让我们的解析错位
- 权限要求有没有变（当前需要「系统设置 → 隐私与安全性 → 录屏与系统录音 →
  仅系统录音」里的授权）

升级后记得同步更新上面的校验值。
