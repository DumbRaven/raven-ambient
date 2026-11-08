/**
 * 两种石纹的「纹理自身均值 / 标准差」。
 *
 * 为什么要单独量：`amount` 与 `center` 是**按纹理的实际分布标定的**，
 * 我原先把两处都写成 0.54 / 1.6，但那是玉石的数。浪脊换成等值带之后
 * 分布不同，沿用同一组就整块发白——实机 `mean 202 / sd 5.54`（玉石 125 / 11.4）。
 *
 * 做法：把管线在 `mix` 之后截断（去掉亮度映射与乘底色），
 * 屏幕上看到的就是纹理本身；量胶囊内段的均值与标准差。
 *
 * 跑法：node_modules/electron/dist/electron.exe tools/probe/stone-mix2.cjs --no-sandbox
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { launch, report, guard, wait } = require('./harness.cjs');

const ROOT = path.join(__dirname, '..', '..');

/** 点胶囊切到指定风格：顺序是 sea → jade → sea，最多点两次。 */
const clickTag = `(() => {
  const tag = document.querySelector('.tpl-tag');
  if (!tag) return { error: 'no tag' };
  tag.click();
  return { ok: true };
})()`;

const STONE = `(() => document.querySelector('.template-collage')?.getAttribute('data-stone') ?? null)()`;

guard(async () => {
  const { marbleFilterMarkup } = await import(pathToFileURL(path.join(ROOT, 'src', 'marble.ts')).href);

  const probe = await launch({ expand: true, settle: 900 });
  const run = code => probe.run(code);

  const rect = await run(`(() => {
    const r = document.querySelector('.tpl-tag').getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  })()`);
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];

  /** 统计胶囊内段（内缩 25% 宽 / 20% 高），跳过金色字母。 */
  const sample = async () => {
    const image = await probe.win.webContents.capturePage({
      x: Math.round(x + w * 0.25), y: Math.round(y + h * 0.2),
      width: Math.max(1, Math.round(w * 0.5)), height: Math.max(1, Math.round(h * 0.6)),
    });
    const { width } = image.getSize();
    const bitmap = image.toBitmap();
    const values = [];
    for (let i = 0; i < bitmap.length; i += 4) {
      const red = bitmap[i + 2], green = bitmap[i + 1], blue = bitmap[i];
      if (red - blue > 26 && red > 96) continue;
      values.push(0.299 * red + 0.587 * green + 0.114 * blue);
    }
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return { n, mean: +mean.toFixed(2), sd: +sd.toFixed(2) };
  };

  /** 把某风格的滤镜截断成「只输出纹理」。 */
  const truncate = markup =>
    markup
      .replace(/<feComponentTransfer in="mix"[\s\S]*?<\/feComponentTransfer>/, '')
      .replace(/<feComposite in="SourceGraphic"[^>]*\/>/, '')
      .replace('result="mix"', 'result="out"');

  const apply = async (label, markup) => {
    const flat = markup.replace(/\s+/g, ' ').trim();
    await run(`(() => {
      document.querySelectorAll('[data-tpl-marble]').forEach(n => n.remove());
      const host = document.createElement('div');
      host.setAttribute('data-tpl-marble', ${JSON.stringify(label)});
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0';
      host.innerHTML = ${JSON.stringify(flat)};
      document.body.appendChild(host);
    })()`);
    await wait(220);
  };

  const out = [];
  for (const style of ['sea', 'jade']) {
    await apply(style, truncate(marbleFilterMarkup(style)));
    const texture = await sample();
    // 纹理占 0~1，乘 255 换算成屏幕亮度口径，方便和 tag-stats 对数。
    out.push({ style, stone: await run(STONE), texture, texture255: { mean: +(texture.mean * 255 / 255).toFixed(1), sd: +(texture.sd).toFixed(2) } });
    fs.writeFileSync(
      path.join(__dirname, `mix-${style}.png`),
      (await probe.win.webContents.capturePage({ x, y, width: w, height: h })).toPNG(),
    );
  }

  const row = path.join(__dirname, 'mix-row.png');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...['sea', 'jade'].map(s => ['-i', path.join(__dirname, `mix-${s}.png`)]).flat(),
    '-filter_complex',
    '[0:v]scale=-2:600:flags=lanczos[a];[1:v]scale=-2:600:flags=lanczos[b];[a][b]hstack=inputs=2',
    '-frames:v', '1', row,
  ]);

  report({ samples: out, rect, row });
});
