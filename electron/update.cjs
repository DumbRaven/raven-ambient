/**
 * 检查更新。
 *
 * 只做一件事：问一次 GitHub「最新发布是哪个版本」，跟本机版本比一下，把结果交回页面。
 * **下载不在这里做**——用户点「去下载」时交给系统浏览器，这样不用签名、
 * 不会触发 SmartScreen 对未知安装程序的拦截，也不需要处理断点续传。
 *
 * ## 为什么放主进程而不是页面里
 *
 * `index.html` 的 CSP 是 `default-src 'self'`。页面侧要联网就得放开 `connect-src`，
 * 那等于让整个渲染进程都能往任意地址发请求。放主进程之后，页面连一条通道都发不出去，
 * 只有「请你查一下」这个动作，地址由这里决定。
 *
 * 这也是安全审计里「electron 那 14 个 advisory 不可达」这个判断的前提之一：
 * 它们全都与「加载外部页面」有关，本模块发的是一个 HTTPS 请求，不开页面、不执行对方内容。
 *
 * ## 镜像
 *
 * GitHub 的 API 与下载地址在国内常常连不上，所以所有请求都套一层代理。
 * 换源只改下面这两个常量。
 */

const { net, shell } = require('electron');

/**
 * 镜像。API 与下载地址都要套这一层——实测直连 GitHub 下载在国内是不通的
 * （本机测 `release/download/...zip` 直连超时 0 字节，走镜像 206 正常）。
 *
 * 为什么是 `gh-proxy.com` 而不是更常见的 `ghproxy.net`：2026-11-18 实测
 * `ghproxy.net` 对 `api.github.com` 的路径一律返回 `403 Invalid input.`
 * （它的 API 转发是关的），只有下载与 raw 能用。`gh-proxy.com` 两样都通，
 * 连测三次 API 都是 1.0~1.1 秒返回。
 *
 * 换源只改这一行。置空字符串就是不套代理、直连 github.com。
 */
const MIRROR = 'https://gh-proxy.com/';

/** 仓库。写死在这里而不是从 package.json 读，因为打包后的 package.json 可能被裁。 */
const REPO = 'DumbRaven/raven-ambient';

/**
 * 一次请求最多等多久。
 *
 * 3 秒是刻意的：这个动作发生在打开设置面板时，用户没有主动等待它。
 * 网络不通是常态（公司网、代理、DNS 污染），不该让人盯着一个转圈的按钮。
 * 超时就当「查不到」，静默失败。
 */
const TIMEOUT_MS = 3000;

/** 把 `https://x` 套上镜像。空 MIRROR 时原样返回。 */
function viaMirror(url) {
  return MIRROR ? MIRROR + url : url;
}

/**
 * 发一个 GET 并把响应体读完。超时或非 200 一律 reject。
 *
 * 用 Electron 的 `net` 而不是 Node 的 `https`：前者走 Chromium 的网络栈，
 * 会跟着系统的代理设置走，也能复用系统证书库。用 Node 的 https 在不挂代理的
 * 境内外混合网络里很难排查。
 */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { request.abort(); } catch { /* 已经结束了 */ }
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => done(new Error('timeout')), TIMEOUT_MS);

    request.setHeader('Accept', 'application/vnd.github+json');
    request.setHeader('User-Agent', 'Raven-Ambient-Updater');
    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        done(new Error('http ' + response.statusCode));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          done(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          done(error);
        }
      });
      response.on('error', done);
    });
    request.on('error', done);
    request.end();
  });
}

/** 从 Release 的 assets 里挑出分发包。没有就返回 null。 */
function pickAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  // 分发包命名是 `Raven-Ambient-v0.4.0-win-x64.zip`。按后缀挑而不是写死文件名，
  // 这样改版本号时这里不用跟着动。
  const zip = assets.find((asset) => typeof asset?.name === 'string' && asset.name.endsWith('-win-x64.zip'));
  if (!zip) return null;
  // 优先用 package.json 里给的那个直链；没有就按 tag 拼一个。
  const url = typeof zip.browser_download_url === 'string' && zip.browser_download_url
    ? zip.browser_download_url
    : `https://github.com/${REPO}/releases/download/${release.tag_name}/${zip.name}`;
  return { name: zip.name, url };
}

/**
 * 问一次最新版本。
 *
 * 返回值形状固定，方便页面判：
 *   { status: 'current' }                                    已经是最新
 *   { status: 'newer', version, notes, url }                 有新版本
 *   { status: 'unknown', reason }                            查不到（网络、格式、限流）
 *
 * 永远 resolve，不 reject —— 调用方是打开设置面板这种地方，不该被一个网络问题打断。
 */
async function checkForUpdate(currentVersion) {
  const api = `https://api.github.com/repos/${REPO}/releases/latest`;

  // 先走镜像，镜像挂了再直连一次。两条都失败才算查不到。
  //
  // 为什么要这层回退：镜像站是第三方服务，会挂、会限流、会换域名。只写一条的话，
  // 那一家出问题的日子所有人都会看到「检查更新」毫无反应，而直连其实还能用
  // （本机实测 api.github.com 直连是通的，只有 releases/download 不通）。
  let release = null;
  let reason = 'network';
  for (const url of [viaMirror(api), api]) {
    try {
      release = await getJson(url);
      break;
    } catch (error) {
      reason = error?.message === 'timeout' ? 'timeout' : 'network';
    }
  }
  if (!release) return { status: 'unknown', reason };

  const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
  if (!tag) return { status: 'unknown', reason: 'no-tag' };

  const { compareVersion } = require('./version.cjs');
  const verdict = compareVersion(tag, currentVersion);
  if (verdict <= 0) return { status: 'current' };

  const asset = pickAsset(release);
  if (!asset) return { status: 'unknown', reason: 'no-asset' };

  return {
    status: 'newer',
    version: tag.replace(/^v/i, ''),
    notes: typeof release.body === 'string' ? release.body : '',
    url: viaMirror(asset.url),
  };
}

/**
 * 接上检查更新。返回一个函数给主进程注册通道时用。
 *
 * `openDownload` 只接受**这里缓存的**地址。页面传来什么 URL 一律丢掉——
 * 否则这个通道就成了「打开任意网址」，是最容易被利用的形状。
 */
function attachUpdate(getWindow) {
  /** 上一次查到的下载地址，按版本号索引。 */
  let downloadUrl = '';

  return {
    async check(currentVersion) {
      const result = await checkForUpdate(currentVersion);
      downloadUrl = result.status === 'newer' ? result.url : '';
      return result;
    },
    /** 打开浏览器下载。没有缓存的地址就什么都不做。 */
    open() {
      if (!downloadUrl) return false;
      shell.openExternal(downloadUrl);
      return true;
    },
  };
}

module.exports = { attachUpdate, checkForUpdate, viaMirror, MIRROR, REPO, TIMEOUT_MS };
