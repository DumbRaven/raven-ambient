/**
 * 媒体白名单的授权台账。
 *
 * 为什么需要独立一个文件：白名单原本只活在内存里，重启就没了，于是页面在启动时
 * 用 `restore` 把 cabinet 里记的路径重新递进主进程。那条路的问题不是「页面不该
 * 参与恢复」，而是**主进程没法分辨「这是用户以前授权过的」还是「页面现在编的」**
 * ——于是 `restore` 事实上等于让页面自己给自己发授权，`media://` 就成了任意读后门。
 *
 * 授权该由有权授权的一方记账。用户点对话框选目录，是唯一真正的授权动作；
 * 台账把它的结果写进 userData，重启后主进程自己读回来。页面从此只说
 * 「我想看这些」，不再说「这些允许看」。
 *
 * 只依赖 node:fs，不碰 electron —— 这样单元测试可以对着临时目录直接跑，
 * 不用起 Electron。
 */
const fs = require('node:fs');
const path = require('node:path');

/** 能授出去的路径必须有这些特征，否则一律拒绝（见 `accept()` 的说明）。 */
function looksLikeFolder(dir) {
  const resolved = path.resolve(dir);
  const trimmed = resolved.replace(/[\\/]+$/, '');
  // 盘根（`C:\` 去掉尾斜杠只剩 `C:`）不收：用户想整理素材不会选区区的整个磁盘，
  // 而误选到盘根会把整个盘变成可读范围。
  if (/^[a-zA-Z]:$/.test(trimmed)) return false;
  // 系统目录不收。用户选中它们，几乎一定是选错了。
  //
  // 比对必须先把「用户可能写出来的等价形式」都摊平：
  //   - 末尾的点号与空格会被文件系统忽略（`C:\Windows.` 打开的就是 `C:\Windows`）；
  //   - `C:\PROGRA~1` 是 `C:\Program Files` 的 8.3 短名。
  // 早先这里是拿 `path.resolve` 的结果直接比，两种写法都能绕过。
  // `realpathOf` 走 `realpathSync.native`，短名与末尾点号都会展开成规范形式。
  const forms = new Set([trimmed.toLowerCase()]);
  // 末尾的点号与空格要自己剥：`realpathOf` 对它解不出来（路径字符串带点号时
  // 系统不认，直接抛错返回空串），于是只剩「c:\windows.」这种比不上的形式。
  // Windows 不允许建以点号或空格结尾的目录，所以剥掉不会误伤真实目录。
  const stripped = trimmed.replace(/[. ]+$/, '');
  if (stripped) forms.add(stripped.toLowerCase());
  const real = realpathOf(resolved);
  if (real) forms.add(real.replace(/[\\/]+$/, '').toLowerCase());
  const blocked = [
    'c:\\windows', 'c:\\program files', 'c:\\program files (x86)',
    'c:\\programdata', 'c:\\$recycle.bin', 'c:\\system volume information',
  ];
  for (const lower of forms) {
    if (blocked.some(prefix => lower === prefix || lower.startsWith(prefix + '\\'))) return false;
  }
  return true;
}

class MediaGrants {
  /**
   * @param {string} file 台账文件路径（`userData/media-grants.json`）
   */
  constructor(file) {
    this.file = file;
    /** 用户选过的目录。 @type {Set<string>} */
    this.dirs = new Set();
    /** 用户单独挑的文件。 @type {Set<string>} */
    this.files = new Set();
    /** 台账是否已经存在过。第一次运行为 false，是迁移旧数据的判定依据。 */
    this.existed = false;
    this.dirty = false;
  }

  /** 读回台账。文件不存在、坏掉、被手改成乱七八糟，都当成「还没有台账」。 */
  load() {
    this.existed = fs.existsSync(this.file);
    if (!this.existed) return this;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const dir of Array.isArray(parsed.dirs) ? parsed.dirs : []) {
        if (typeof dir === 'string' && dir) this.dirs.add(path.resolve(dir));
      }
      for (const file of Array.isArray(parsed.files) ? parsed.files : []) {
        if (typeof file === 'string' && file) this.files.add(path.resolve(file));
      }
    } catch {
      // 台账坏了不能让应用起不来：当作空的，用户下次选目录会重新写一份。
      this.dirs.clear();
      this.files.clear();
    }
    return this;
  }

  /** 落盘。只在真的变过时写，避免每次启动都碰一次磁盘。 */
  save() {
    if (!this.dirty) return false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({
        version: 1,
        dirs: [...this.dirs],
        files: [...this.files],
      }, null, 2));
      this.dirty = false;
      this.existed = true;
      return true;
    } catch {
      // 写不进去（磁盘只读、路径被占）不该打断使用：本次运行的白名单仍然有效，
      // 只是下次启动要重新选。静默失败比弹窗打断更合适。
      return false;
    }
  }

  /**
   * 登记一个目录。**只在用户真的选了它、或它来自固定位置时调用**。
   * 不满足 `looksLikeFolder` 就拒绝，返回 false。
   */
  addDir(dir) {
    if (typeof dir !== 'string' || !dir) return false;
    const resolved = path.resolve(dir);
    if (this.dirs.has(resolved)) return true;
    if (!looksLikeFolder(resolved)) return false;
    this.dirs.add(resolved);
    this.dirty = true;
    return true;
  }

  /** 登记单个文件。调用方已经确认它是文件。 */
  addFile(file) {
    if (typeof file !== 'string' || !file) return false;
    const resolved = path.resolve(file);
    if (this.files.has(resolved)) return true;
    this.files.add(resolved);
    this.dirty = true;
    return true;
  }

  /** 撤销一个目录（用户点了「移出」）。 */
  removeDir(dir) {
    if (typeof dir !== 'string' || !dir) return false;
    const removed = this.dirs.delete(path.resolve(dir));
    if (removed) this.dirty = true;
    return removed;
  }

  /**
   * 撤销单个文件（用户在票根上点了「移出」）。
   *
   * 必须单独开一个，不能靠 `removeDir`：单独导入的文件从来没进过 `dirs`，
   * 那个 Set 里删它是一次空操作，台账里留着的话 `media://` 仍然读得到它，
   * 于是「移出」只从界面消失、文件本身还在可读范围里——和目录那边
   * `forget` 不撤授权是同一个错误（见 media.cjs 里 `forget` 的注释）。
   */
  removeFile(file) {
    if (typeof file !== 'string' || !file) return false;
    // `insideAllowed` 同时比对 `path.resolve(target)` 与 `realpathOf(target)`，
    // 所以两份都要撤。只删 resolved 的话，一条符号链接登记过以后仍然读得到。
    const removed = this.files.delete(path.resolve(file));
    const real = realpathOf(file);
    const removedReal = real ? this.files.delete(real) : false;
    if (removed || removedReal) this.dirty = true;
    return removed || removedReal;
  }

  /**
   * 迁移用：把页面递来的路径补登记进来。
   *
   * 这个口子是**故意留的、也只能开一次**：台账文件还不存在，说明用户是从
   * 没有台账的旧版本升上来的，他的收藏里记着目录、主进程这边一条授权都没有。
   * 不迁就会让他重启后整个媒体库全是 403 —— 为了一个只在首次升级时才有意义的
   * 攻击窗口，去换用户每次都要重新选目录，不划算。
   *
   * 迁移一旦写过台账文件，`existed` 就是 true，这条路永久关闭。另外每个路径
   * 仍然要过 `looksLikeFolder`，所以「选到 C:\ 然后被写进收藏」这种情况也挡住了。
   *
   * @returns {number} 实际补登记的条目数
   */
  migrate(dirs, files) {
    if (this.existed) return 0;
    let count = 0;
    for (const dir of Array.isArray(dirs) ? dirs : []) {
      if (this.addDir(dir)) count += 1;
    }
    for (const file of Array.isArray(files) ? files : []) {
      if (this.addFile(file)) count += 1;
    }
    return count;
  }
}

/** 解析真实路径，失败（不存在、没权限）返回空串。 */
function realpathOf(target) {
  // 用 `realpathSync.native`：它会**展开 8.3 短名**，`C:\PROGRA~1` 得到
  // `C:\Program Files`。普通版原样返回短名，于是黑名单里那串长名永远比不上。
  // 实测 native 在 `C:\PROGRA~1` 上给 `C:\Program Files`，普通版给 `C:\PROGRA~1`。
  try {
    return fs.realpathSync.native(target);
  } catch { /* 退到普通版，见下 */ }
  try {
    return fs.realpathSync(target);
  } catch {
    return '';
  }
}

/**
 * `target` 是否落在 `dirs` 里任意一个目录之下。**两边都解析真实路径**。
 *
 * 为什么非解析不可：Windows 的 junction 和目录符号链接在 `path.resolve` 看来
 * 只是普通路径。存进白名单时是「用户选的目录」，但请求里写
 * `用户选过的目录\链接名\..\..\..\Windows\System32\config\SAM` 时，
 * `path.relative` 会算出「还在目录里面」，系统实际打开的是链接指向的别处。
 * 一条用户目录里的链接，足以把 `media://` 变成整块盘可读。
 *
 * **只认解析后的真实路径，不拿原路径兜底**：早先这里是「真实路径与原路径都试，
 * 命中任一个就算通过」，于是链接恰好落回原路径时（链接本身在用户目录内）
 * 那条链接穿越又成立了。单文件授权（用户直接点文件选的那种）由调用方
 * `media.cjs` 的 `insideAllowed` 用 `g.files` 单独判，不需要这里再兜一次。
 *
 * `target` 解析失败直接判否：文件不存在，调用方本来也会 404，
 * 在这里挡住能少一次 toctou 的机会。
 */
function isWithin(target, dirs) {
  const real = realpathOf(target);
  if (!real) return false;
  for (const dir of dirs) {
    if (!dir) continue;
    // 目录一侧也解析。目录不存在时退回原路径，让「目录被挪走」这类情况
    // 仍然按原样判否，而不是意外变成「全都不能读」。
    const base = path.resolve(realpathOf(dir) || path.resolve(dir));
    const rel = path.relative(base, real);
    // rel 为空 = 就是这个目录本身（目录不是文件，调用方后续会挡掉）
    // 以 `..` 开头或变成绝对路径 = 跳出去了
    // 判 `..` 要连分隔符一起看：`..b\c.png` 是个叫「..b」的子目录，不是越界。
    // 单看 `startsWith('..')` 会把它误判成越界，用户真有个这样的目录就读不了。
    if (!rel) continue;
    if (rel === '..' || rel.startsWith('..' + path.sep)) continue;
    if (path.isAbsolute(rel)) continue;
    return true;
  }
  return false;
}

module.exports = { MediaGrants, looksLikeFolder, isWithin, realpathOf };
