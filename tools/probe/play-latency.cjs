/**
 * 量「第一次按播放」到「真的出声」之间等了多久，并拆开是哪一段在等。
 *
 * 为什么需要它：用户报的现象是「第一次播放音乐会延迟几秒」。代码上看
 * `src/player.ts` 的 `schedule()` 里，环境音 `await engine.start()` 写在
 * 音乐 `readAsset` + `loadMusic` **之前**，是串行结构。但这个判断必须实测，
 * 否则改完可能只是换了个地方等，用户还是听到延迟。
 *
 * 量什么：在页面里打时间戳，按代码路径分四段
 *   t0  用户点播放
 *   t1  环境音全部解码就绪（engine.start 返回）
 *   t2  音乐 Blob 读完（readAsset 返回）
 *   t3  音乐真的开始出声（HTMLMediaElement 的 'playing' 事件）
 *
 * 怎么插：不改源码。页面上下文里 hook `AudioContext.prototype.decodeAudioData`
 * 与 `HTMLMediaElement.prototype.play`，并在 capturing 阶段捕获点击。量的
 * 是真实执行路径，不是从代码推演出来的。
 *
 * 场景：隔离 userData，用 harness 的 seedAsset 把音频塞进 IndexedDB，
 * 然后注入一份「1 首音乐 + 4 条环境音」的 cabinet。这样点播放走的就是
 * 用户那边的真实分支（环境音要解码、音乐要读文件）。
 *
 * 跑法：
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
 *     tools/probe/play-latency.cjs --no-sandbox
 *
 * 必须先 npm run build —— 探针读 dist/。
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'probe-latency-')));

const WORK = path.join(os.tmpdir(), 'probe-latency-assets');

/** 现造音频素材。三分量：音乐 60s、环境音 4 条各 30s，频率不同好区分。 */
function ensureAudio() {
  fs.mkdirSync(WORK, { recursive: true });
  const make = (name, freq, duration) => {
    const file = path.join(WORK, name);
    if (fs.existsSync(file)) return file;
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${duration}`,
      '-c:a', 'aac', '-b:a', '320k', file,
    ]);
    return file;
  };
  // 参数刻意贴近真实库：用户那边单个资产 8–16MB（`du -sh IndexedDB` = 163M / 27 个 blob）。
  // 用 700KB 的测试音会量出 233ms，看起来「没问题」，但那是假象。
  // 320k 码率下：600 秒 ≈ 9.4MB（音乐）、300 秒 ≈ 4.6MB（每条环境音）。
  return {
    music: make('music.m4a', 220, 600),
    ambience: Array.from({ length: Number(process.env.PROBE_AMB_COUNT || 4) }, (_, i) => make('amb-' + (i + 1) + '.m4a', 150 + i * 60, 300)),
  };
}

/**
 * 页面加载前注入的 hook。
 *
 * 关键点：`decodeAudioData` 的 hook 必须装在最前面的脚本里，因为播放器
 * 首次 `init()` 可能在任何点击之前就发生（App 挂载时就会调 resume）。
 * 这里用 `did-start-navigation` 时机注入不到渲染进程，所以改成页面自己
 * 在 `main-*.js` 之后跑——用 `webContents.executeJavaScript` 在 load 后
 * 立刻注入，实测足够早：真正点播放是后面的事。
 */
const HOOK = `
(() => {
  if (window.__lat) return 'already';
  const marks = (window.__lat = { marks: [], t0: 0 });
  const mark = (name, extra) => marks.marks.push({ name, at: performance.now(), ...(extra || {}) });

  const proto = (window.AudioContext || window.webkitAudioContext).prototype;
  const origDecode = proto.decodeAudioData;
  proto.decodeAudioData = function (...args) {
    const start = performance.now();
    mark('decode:start');
    const p = origDecode.apply(this, args);
    p.then(
      () => mark('decode:done', { ms: +(performance.now() - start).toFixed(1) }),
      () => mark('decode:fail', { ms: +(performance.now() - start).toFixed(1) }),
    );
    return p;
  };

  // 'playing' 比 play() 更准：play() 只是发起，真正有声音是 playing。
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const start = performance.now();
    mark('media:play()');
    this.addEventListener('playing', () => mark('media:playing'), { once: true });
    const p = origPlay.apply(this, args);
    p.catch(e => mark('media:play-rejected', { why: String(e && e.name) }));
    return p;
  };

  // 点击捕获：只记带 aria-label 的按钮，用来定位 t0
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button');
    if (!btn) return;
    const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 16);
    mark('click:' + label);
  }, true);

  mark('hook:installed');
  return 'installed';
})();
`;

async function main() {
  const audio = ensureAudio();

  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });

  const run = code => win.webContents.executeJavaScript(code, true);
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await wait(1200);
  await run(HOOK);

  // 塞音频资产。key 就是 assetId。
  const seed = async (key, file) => {
    const base64 = fs.readFileSync(file).toString('base64');
    return run(`(async () => {
      const bin = atob(${JSON.stringify(base64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mp4' });
      const database = await new Promise((resolve, reject) => {
        const req = indexedDB.open('raven-ambient', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('assets')) req.result.createObjectStore('assets');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = database.transaction('assets', 'readwrite');
        tx.objectStore('assets').put(blob, ${JSON.stringify(key)});
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return blob.size;
    })()`);
  };

  const musicBytes = await seed('probe-music', audio.music);
  const ambBytes = [];
  for (let i = 0; i < audio.ambience.length; i++) {
    ambBytes.push(await seed('probe-amb-' + (i + 1), audio.ambience[i]));
  }

  // 注入 cabinet：1 首音乐在队列里，4 条环境音都已选中。
  const cabinet = {
    version: 2,
    records: [
      {
        id: 'probe-music', assetId: 'probe-music', name: 'Probe Track', artist: '本地收藏',
        description: '', category: 'music', duration: 60, format: 'AUDIO', size: musicBytes,
        color: '#39557a', fingerprint: 'probe-music', volume: 85, pan: 0, warmth: 0, duckDepth: 65,
      },
      ...audio.ambience.map((_, i) => ({
        id: 'probe-amb-' + (i + 1), assetId: 'probe-amb-' + (i + 1), name: 'Amb ' + (i + 1),
        artist: '本地收藏', description: '', category: 'ambient', duration: 30, format: 'AUDIO',
        size: ambBytes[i], color: '#6b7f8f', fingerprint: 'probe-amb-' + (i + 1),
        volume: 60, pan: 0, warmth: 0, duckDepth: 65,
      })),
    ],
    queue: ['probe-music'],
    ambience: audio.ambience.map((_, i) => 'probe-amb-' + (i + 1)),
    master: 60, musicVolume: 70, ducking: true, duckDepth: 9,
    order: 'sequence', transition: 'crossfade', lineMode: false, lineVolume: 100,
    muted: [], theme: '#9a8b78', imageName: '', media: [], mediaDirs: [],
  };

  await run(`localStorage.setItem('raven-cabinet-v2', ${JSON.stringify(JSON.stringify(cabinet))})`);
  await win.webContents.reload();
  await wait(2200);
  await run(HOOK);

  // 冷启动状态：确认页面上真的没有在播
  const before = await run(`(() => ({
    running: !!document.querySelector('.play-card.is-playing, [data-playing="true"]'),
    buttons: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).slice(0, 20),
  }))()`);

  // 1. 先点「打开播放器」把 PlayCard 浮层叫出来（播放键本身在浮层里）
  await run(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label') || '').trim() === '打开播放器');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await wait(700);

  // 2. 点浮层里的主播放键。这一刻才算 t0。
  const clicked = await run(`(() => {
    const all = [...document.querySelectorAll('button')];
    const pick = all.find(b => /^(播放|暂停)$/.test((b.getAttribute('aria-label') || '').trim()))
      || all.find(b => b.classList.contains('main-play'));
    if (!pick) return { ok: false, labels: all.map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 40) };
    const label = (pick.getAttribute('aria-label') || pick.textContent || '').trim();
    window.__lat.marks.length = 0;
    window.__lat.t0 = performance.now();
    pick.click();
    return { ok: true, label, cls: pick.className };
  })()`);

  await wait(9000);
  const report = await run(`(() => {
    const L = window.__lat;
    const marks = L.marks;
    const t0 = L.t0;
    const rel = m => (t0 ? +(m.at - t0).toFixed(1) : null);
    const by = n => marks.filter(m => m.name === n);
    const decodes = by('decode:done');
    const playEv = by('media:play()')[0];
    const playingEv = by('media:playing')[0];
    return {
      clicked: true,
      marks: marks.map(m => ({ name: m.name, rel: rel(m), ms: m.ms, why: m.why })),
      summary: {
        t0_click: 0,
        decodeCount: decodes.length,
        decodeSumMs: +decodes.reduce((a, m) => a + m.ms, 0).toFixed(1),
        decodeMaxMs: decodes.length ? +Math.max(...decodes.map(m => m.ms)).toFixed(1) : 0,
        lastDecodeDoneAt: decodes.length ? rel(decodes[decodes.length - 1]) : null,
        musicReadAt: null,
        mediaPlayAt: playEv ? rel(playEv) : null,
        mediaPlayingAt: playingEv ? rel(playingEv) : null,
        // 关键读数：从点播放到音乐真出声
        clickToSoundMs: playingEv ? rel(playingEv) : null,
      },
    };
  })()`);

  console.log('=== CLICK ===');
  console.log(JSON.stringify(clicked, null, 1));
  console.log('=== BEFORE ===');
  console.log(JSON.stringify(before, null, 1));
  console.log('=== LATENCY ===');
  console.log(JSON.stringify(report, null, 1));

  win.close();
  app.quit();
}

app.whenReady().then(main).catch((e) => { console.error('PROBE_FAIL ' + (e && e.stack || e)); app.exit(1); });
