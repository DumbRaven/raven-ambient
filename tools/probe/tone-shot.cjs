/**
 * 拍两张配色面板的图：一张是自定义配色生效后的放映页，一张是展开后的三组菜单。
 *
 * 注意两件事：
 *   - `shot()` 写文件要**绝对路径**——传相对名会落到进程 cwd（仓库根），
 *     文件会出现在想不到的地方，看起来像「没生成」。
 *   - `patch` 里不要塞 ambience/records。那几个字段只在这个探针里造，
 *     造得不对会把整个柜子写坏（sanitizeCabinet 判成旧数据整份丢掉），
 *     页面就退回空库分支、放映页根本不出现。
 */
const path = require('node:path');
const { launch, guard, wait, MEDIA_DIR, MEDIA_IMG } = require('./harness.cjs');

const TONE = {
  mode: 'custom',
  pick: 1,
  custom: { base: '', panel: '#2b1b4d', onPanel: '#ffe066', bar: '#0f5132', onBar: '#d1f7e0', gold: '#ff3860' },
};

guard(async () => {
  const probe = await launch({
    expand: true,
    patch: {
      media: [{ id: 'image:1', kind: 'image', path: MEDIA_IMG, name: 'Ocean', size: 1 }],
      mediaDirs: [MEDIA_DIR],
    },
  });
  await wait(600);

  await probe.run(`(() => {
    localStorage.setItem('raven-stage-tone', ${JSON.stringify(JSON.stringify(TONE))});
    return 1;
  })()`);
  await probe.win.webContents.reload();
  await wait(2200);
  await probe.run(`(() => {
    [...document.querySelectorAll('.view-tabs > button')].find(b => b.getAttribute('aria-label') === '放映')?.click();
    return 1;
  })()`);
  await wait(1300);
  await probe.run(`(() => { document.querySelector('.theater-expand')?.click(); return 1; })()`);
  await wait(1500);
  await probe.shot(path.join(__dirname, 'tone-custom.png'));

  // 展开配色菜单 → 切到「自己填」，三组控件都在这一屏
  await probe.run(`(() => { document.querySelector('.theater-tone-toggle')?.click(); return 1; })()`);
  await wait(500);
  await probe.run(`(() => {
    const button = [...document.querySelectorAll('.tone-modes button')].find(b => b.textContent.trim() === '自己填');
    button?.click();
    return !!button;
  })()`);
  await wait(500);
  await probe.shot(path.join(__dirname, 'tone-menu.png'));

  probe.close();
});
