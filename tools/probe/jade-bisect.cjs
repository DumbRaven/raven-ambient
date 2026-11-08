/**
 * 玉石探针为什么报「Script failed to execute」——逐段二分。
 *
 * 语法在 Node 里已经验证过（`.tools/jade-syntax.cjs` 报 OK），
 * 所以问题出在渲染端的运行时：DOM 没准备好、选择器没命中、
 * 或者某个 API 在这个上下文里不存在。
 *
 * 每段只做一件事，报回成功/失败与错误消息。
 */
const { launch, report, guard, wait } = require('./harness.cjs');

guard(async () => {
  const probe = await launch({ expand: true, settle: 900 });
  const steps = [];

  const run = async (label, script) => {
    try {
      const value = await probe.run(script);
      steps.push({ label, ok: true, value });
    } catch (e) {
      steps.push({ label, ok: false, error: String(e.message || e).slice(0, 240) });
    }
  };

  await run('queryTag', `(() => {
    const n = document.querySelector('.tpl-tag');
    return { found: !!n, cls: n ? n.className : null };
  })()`);

  await run('openMenu', `(() => {
    const b = document.querySelector('button[aria-label="配色"]');
    if (!b) return { error: 'no tone button' };
    b.click();
    return { clicked: true };
  })()`);
  await wait(300);

  await run('menus', `(() => ({
    stones: document.querySelectorAll('.tone-stones button').length,
    labels: [...document.querySelectorAll('.tone-stones button')].map(n => n.textContent),
  }))()`);

  await run('pickCloud', `(() => {
    const b = [...document.querySelectorAll('.tone-stones button')].find(n => n.textContent.includes('云雾'));
    if (!b) return { error: 'no cloud' };
    b.click();
    return { clicked: true };
  })()`);
  await wait(400);

  await run('readStone', `(() => ({
    attr: document.querySelector('.template-collage').getAttribute('data-stone'),
  }))()`);

  await run('injectStyleOnly', `(() => {
    const s = document.createElement('style');
    s.id = 'jade-style';
    s.textContent = '.template-collage[data-stone="cloud"] .tpl-tag::before { background: #ffffff !important; }';
    document.head.appendChild(s);
    return { ok: true };
  })()`);

  await run('injectHostOnly', `(() => {
    const h = document.createElement('div');
    h.id = 'jade-host';
    document.body.appendChild(h);
    return { ok: true, appended: !!document.getElementById('jade-host') };
  })()`);

  await run('injectSvg', `(() => {
    const h = document.getElementById('jade-host');
    h.innerHTML = '<svg width="0" height="0"><filter id="tpl-jade-try"><feTurbulence type="fractalNoise" baseFrequency="0.025 0.0177" numOctaves="4" seed="23"/></filter></svg>';
    return { has: !!document.getElementById('tpl-jade-try') };
  })()`);

  await run('readBefore', `(() => {
    const s = getComputedStyle(document.querySelector('.tpl-tag'), '::before');
    return { filter: s.filter, bg: s.backgroundColor };
  })()`);

  report({ steps });
});
