import { AmbientEngine, type AudioStatus } from './audio.ts';
import { cabinetMix, nextInOrder, previousInOrder, transitionDuration, type Cabinet, type TrackTransition } from './records.ts';
import { readAsset } from './storage.ts';

export type RoomStatus = AudioStatus & {
  running: boolean;
  currentId?: string;
  /** 用户是否希望音乐出声。总开关关闭时为 false，但意图保留。 */
  musicOn: boolean;
  /** 用户是否希望环境音出声。 */
  ambientOn: boolean;
};
export class RoomPlayer {
  private engine = new AmbientEngine();
  private cabinet: Cabinet;
  private running = false;
  private musicOn = true;
  private ambientOn = true;
  private currentId?: string;
  private loadedId?: string;
  private revision = 0;
  private disposed = false;
  private pending = Promise.resolve();
  private pendingTransition?: TrackTransition;
  private audio: AudioStatus = { playing: false, musicPlaying: false, ducked: false, level: 0, currentTime: 0, duration: 0, lineInput: 0, lineLive: false, ambientIds: [] };
  private listener: (status: RoomStatus) => void;
  private onError: (error: unknown) => void;
  /**
   * 试听期间被临时掐掉的东西。
   * 试听要听得清，所以把当前音乐停了、环境音压低；停下之后按这份记录恢复。
   * 记的是「试听之前本来是什么状态」，不是恢复成某个固定状态——
   * 用户本来就没在放音乐的话，试听完也不该自己响起来。
   */
  private previewRestore?: { running: boolean; musicPlaying: boolean };
  /** 试听换段的中间态：此时 previewEnded 不是「真的结束」，不能顺手把音乐恢复起来。 */
  private previewSwitching = false;
  /** 每次试听一个号，异步读文件回来时用它判断这次还算不算数。 */
  private previewToken = 0;
  /**
   * 这一轮里读不出文件的唱片。
   *
   * 只活在内存里，不进存档：用户可能只是暂时拔了移动硬盘，
   * 下次启动该再试一次。
   *
   * 清空它的时机只有「用户明确要求再试一次」——playRecord / 切歌 / 重新按播放。
   * 之前只有 playRecord 会清，于是拔掉硬盘再插回来时，点播放键和「下一首」
   * 都没反应：wantsMusic() 里 queue.some(!broken) 为假，schedule() 直接返回，
   * 连读文件那一步都走不到。用户唯一能自救的方式是恰好点到那张唱片。
   */
  private broken = new Set<string>();

  constructor(cabinet: Cabinet, listener: (status: RoomStatus) => void, onError: (error: unknown) => void) {
    this.cabinet = cabinet; this.listener = listener; this.onError = onError;
    this.engine.subscribe(status => { this.audio = status; this.emit(); });
    this.engine.onMusicEnded(() => { if (this.running && this.musicOn) this.next(false); });
    this.engine.onPreviewEnded(() => { this.restoreAfterPreview(); });
    // 几张环境音起不来时，说清是哪几张。
    // 这条和 onError 分开：onError 表示「这次播放整体失效」，
    // 而这里是「其余照响，只有这几张没了」——用户要的是名字，不是「失败了」。
    this.engine.onAmbientLost(lost => {
      if (this.disposed || !lost.length) return;
      const names = lost.map(track => track.name);
      const detail = names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等 ${names.length} 张`;
      this.onError(new Error(`这几张环境音起不来了：${detail}。文件可能被移走，重新添加一次就好。`));
    });
  }
  private emit() {
    if (!this.disposed) this.listener({ ...this.audio, running: this.running, currentId: this.currentId, musicOn: this.musicOn, ambientOn: this.ambientOn });
  }
  /** 实时电平（原始 RMS），给波形用。不是 state，每帧读一次即可。 */
  get level() { return this.engine.liveLevel; }
  update(cabinet: Cabinet) {
    const selectionChanged = JSON.stringify([this.cabinet.queue, this.cabinet.ambience]) !== JSON.stringify([cabinet.queue, cabinet.ambience]);
    const modeChanged = this.cabinet.lineMode !== cabinet.lineMode;
    this.cabinet = cabinet; this.applyMix();
    // 切换外部音乐模式等于换了音乐源，必须重新排一次，否则会留着上一模式的音乐在响
    if (this.running && (selectionChanged || modeChanged)) this.schedule();
    if (!this.running && this.currentId && !cabinet.queue.includes(this.currentId)) { this.currentId = undefined; this.emit(); }
  }
  private applyMix() {
    const mix = cabinetMix(this.cabinet);
    mix.musicVolume *= (this.cabinet.records.find(r => r.id === this.currentId)?.volume ?? 100) / 100;
    this.engine.setMix(mix);
    return mix;
  }
  /**
   * 跳过读不出文件的唱片，挑下一张还能放的。返回是否真换了一张（false = 一张都放不了）。
   *
   * 只在 schedule() 的 catch 里调。要点：
   *   - 把当前这张记进 broken，下次选曲时绕开；
   *   - 队列里全坏时不要无限重试——直接停掉音乐那一路，
   *     环境音照旧（这里不碰 engine.stopAmbience）。
   *   - 不在这里 emit：调用方自己会 emit。
   *
   * 为什么不用 nextInOrder：它会做 shuffle / repeat-one 的取舍，
   * 而这里要的是「跳过已知坏掉的」，跟播放顺序无关。
   */
  private skipBroken() {
    const failed = this.currentId;
    if (failed) this.broken.add(failed);
    const queue = this.cabinet.queue;
    const left = queue.filter(id => !this.broken.has(id));
    if (!left.length) {
      // 全都没文件了。音乐这一路停掉，别让总播放开关继续「看起来在放」。
      this.currentId = undefined;
      this.musicOn = false;
      this.loadedId = undefined;
      return false;
    }
    // 从坏掉的那张往后找第一张还能用的；走到队尾就绕回开头。
    // 注意顺序要**排除掉 failed 自己**再找：把 failed 放回候选会原地选中它，等于没跳过。
    const at = failed ? queue.indexOf(failed) : -1;
    const order = at >= 0 ? [...queue.slice(at + 1), ...queue.slice(0, at)] : queue;
    this.currentId = order.find(id => left.includes(id)) ?? left[0];
    return true;
  }
  private wantsMusic() {
    return this.running && this.musicOn && !this.cabinet.lineMode
      && this.cabinet.queue.some(id => !this.broken.has(id));
  }
  private wantsAmbient() { return this.running && this.ambientOn && this.cabinet.ambience.length > 0; }
  start() {
    // 外部音乐模式下本地音乐不参与，「有没有东西可放」只看环境音
    const musicReady = !this.cabinet.lineMode && this.cabinet.queue.length > 0;
    if (!musicReady && !this.cabinet.ambience.length) return;
    // 按播放键就是「再来一次」：上一轮全部读不出来的唱片，现在都重新给机会。
    // 不清的话，wantsMusic() 会一直返回假，schedule() 连门都不进。
    this.broken.clear();
    // 队列里还有歌，却因为「全坏」被 skipBroken 关掉了音乐开关——
    // 这时候按播放键，用户要的是把音乐重新打开，而不是只响环境音。
    if (musicReady && !this.musicOn) this.musicOn = true;
    // 两个开关都关着时，总播放按钮把它们一起打开，否则按用户上次的选择恢复
    if (!this.musicOn && !this.ambientOn) { this.musicOn = true; this.ambientOn = true; }
    this.running = true; this.emit(); this.schedule();
  }
  /**
   * 只开环境音、不开本地音乐。
   *
   * 外部音乐模式下用得上：音乐由别的程序提供，我们这边只负责把环境音垫在下面，
   * 并且按外部音乐的响度去压它。这条路上 running 必须为真，否则环境音根本不启动，
   * 避让也就没有任何作用对象。
   */
  startAmbientOnly() {
    if (!this.cabinet.ambience.length) return;
    this.ambientOn = true;
    this.musicOn = false;
    this.running = true;
    this.emit();
    this.schedule();
  }
  /**
   * 总暂停。
   *
   * 末尾的 previewToken++ 是给「试听正读到一半时按了暂停」准备的：preview() 里
   * 有两次 await（读文件、加载音频），暂停发生在这中间时 stopPreview() 还掐不到
   * 任何东西——此时 previewEl 是空的。等 await 回来，声音才凭空响起来。
   * 加号之后 preview() 回来时发现号变了，直接作废。
   */
  pause() { this.running = false; ++this.revision; ++this.previewToken; this.pendingTransition = undefined; this.previewRestore = undefined; this.engine.stopPreview(); this.engine.stopAll(); this.emit(); }
  toggle() { if (this.running) this.pause(); else this.start(); }
  /** 单独开关音乐：只影响音乐，环境音继续流动。 */
  toggleMusic() {
    // 外部音乐模式下本地音乐这条路是关着的，按了也不该有任何反应
    if (this.cabinet.lineMode || !this.cabinet.queue.length) return;
    // 要打开音乐，同样算「再试一次」：全部标坏时用户按的就是这个键。
    if (!this.musicOn) this.broken.clear();
    if (!this.running) { this.musicOn = true; this.ambientOn = false; } else this.musicOn = !this.musicOn;
    if (!this.musicOn) { this.pendingTransition = undefined; this.engine.pauseMusic(); }
    this.syncRunning();
  }
  /** 单独开关环境音：只影响环境音，音乐继续。 */
  toggleAmbient() {
    if (!this.cabinet.ambience.length) return;
    if (!this.running) { this.ambientOn = true; this.musicOn = false; } else this.ambientOn = !this.ambientOn;
    if (!this.ambientOn) this.engine.stopAmbience();
    this.syncRunning();
  }
  private syncRunning() {
    const musicReady = !this.cabinet.lineMode && this.cabinet.queue.length > 0;
    const anyOn = (this.musicOn && musicReady) || (this.ambientOn && this.cabinet.ambience.length > 0);
    if (anyOn) this.running = true;
    this.emit();
    if (anyOn) this.schedule();
    else { this.running = false; ++this.revision; this.engine.stopAll(); this.emit(); }
  }
  next(manual = true) {
    // 用户主动切歌 = 「再试一次」的信号：硬盘可能刚插回来。
    // 自动接下一首（manual=false）不清，否则一个坏文件会让整轮循环反复重试它。
    if (manual) this.broken.clear();
    const from = this.currentId;
    this.currentId = nextInOrder(this.cabinet.queue, from, this.cabinet.order, Math.random, manual);
    this.armTransition(manual, from);
    this.emit(); if (this.running) this.schedule();
  }
  previous() {
    const from = this.currentId;
    this.currentId = previousInOrder(this.cabinet.queue, from, this.cabinet.order);
    this.armTransition(true, from);
    this.emit(); if (this.running) this.schedule();
  }
  /**
   * 只有用户主动切歌才启用过渡：自动接下一首时过渡反而会拖慢节奏。
   * 过渡只在这一首确实在响的时候才安排，冷启动不铺淡入。
   */
  private armTransition(manual: boolean, from?: string) {
    const switched = !!from && !!this.currentId && this.currentId !== from;
    if (manual && switched && this.running && this.musicOn && this.loadedId) this.pendingTransition = this.cabinet.transition;
  }
  playRecord(id: string) {
    if (this.cabinet.lineMode || !this.cabinet.queue.includes(id)) return;
    const from = this.currentId;
    // 用户又主动点了这张：可能是刚把文件补回去。清掉坏标记再试一次，
    // 不然「修好了还是要重启软件」。
    this.broken.delete(id);
    this.currentId = id; this.musicOn = true; this.running = true;
    this.armTransition(true, from);
    this.emit(); this.schedule();
  }
  seek(seconds: number) { if (this.loadedId === this.currentId) this.engine.seek(seconds); }
  /**
   * 试听一张唱片。播一段就停，期间暂停当前音乐，停下后按原样恢复。
   *
   * 为什么要暂停音乐：两首歌同时响，用户分不清听到的是试听还是正在放的那首。
   * 为什么不走 playRecord：试听不该改变「现在在放哪一首」，也不该触发切歌过渡。
   */
  async preview(recordId: string) {
    const record = this.cabinet.records.find(r => r.id === recordId);
    if (!record) throw new Error('这张唱片已经不在了。');
    // 每发起一次试听就换一个号。读文件是异步的，读完时可能：
    //   - 用户已经点了另一张（这次作废）；
    //   - 用户已经按了总暂停（这次不该再响）。
    // 没有这个号的话，慢一点的读取会在两步之后突然把声音放出来。
    const token = ++this.previewToken;
    const blob = await readAsset(record.assetId);
    if (!blob) throw new Error(`找不到「${record.name}」的文件，请重新导入。`);
    if (token !== this.previewToken || this.disposed) return;
    if (!this.previewRestore) this.previewRestore = { running: this.running, musicPlaying: this.audio.musicPlaying };
    if (this.running && this.audio.musicPlaying) this.engine.pauseMusic();
    // engine.preview 第一件事就是 stopPreview()，而那会同步触发 previewEnded →
    // restoreAfterPreview → 把音乐重新放起来。于是「开始试听第二张」这个动作，
    // 会先把背景音乐唤醒，两路声音叠在一起。换段的这一刻必须压住恢复。
    this.previewSwitching = true;
    try {
      await this.engine.preview(blob);
    } catch (error) {
      // 试听失败（文件读不出来、格式不支持）时，engine.preview 的 catch 会调
      // stopPreview()，而那会**同步**触发 previewEnded → restoreAfterPreview。
      // 可这一刻 previewSwitching 还是 true（要到 finally 才复位），恢复被跳过；
      // 等 finally 执行完，就再也没人触发恢复了。
      // 结果：用户试听一张坏唱片，正在放的背景音乐永久停掉，只能自己再点一次播放。
      this.previewSwitching = false;
      this.restoreAfterPreview();
      throw error;
    } finally {
      this.previewSwitching = false;
    }
  }
  stopPreview() { this.previewToken++; this.engine.stopPreview(); }
  private restoreAfterPreview() {
    // 换段中间态：不是真的结束，恢复留到下一段结束时再做（previewRestore 还在）。
    if (this.previewSwitching) return;
    const restore = this.previewRestore;
    this.previewRestore = undefined;
    if (!restore) return;
    // 试听之前音乐是响着的，就把那一首接着放（不是从头）
    if (restore.musicPlaying && restore.running) void this.engine.playMusic().catch(() => undefined);
  }
  /** 接上外部音乐（虚拟声卡抓来的那股声音）。接上后避让就按它的响度来压环境音。 */
  attachLineIn(stream: MediaStream) { this.engine.attachLineIn(stream); this.emit(); }
  detachLineIn() { this.engine.detachLineIn(); this.emit(); }
  private schedule() {
    this.engine.cancelPending();
    const revision = ++this.revision;
    const valid = () => revision === this.revision && this.running && !this.disposed;
    this.pending = this.pending.catch(() => {}).then(async () => {
      if (!valid()) return;
      const wantsMusic = this.wantsMusic(), wantsAmbient = this.wantsAmbient();
      if (!wantsMusic && !wantsAmbient) { this.running = false; this.engine.stopAll(); this.emit(); return; }
      let ambientFailed = false;
      /*
       * 环境音解码与音乐装载**并行**跑，不串成一条链。
       *
       * 原来这里是 `await this.engine.start(...)` 挡在音乐前面：冷启动时环境音
       * 全部要解码（`audio.ts:321` 的并发上限是 3 条），音乐的 readAsset +
       * loadMusic 只能排在最后一条解码完成之后才开始。实测（`tools/probe/play-latency.cjs`，
       * 资产按真实库的 8–16MB 规模造）：
       *
       *   4 条环境音 + 9.4MB 音乐 → 点播放到出声 1136ms，其中 1075ms 在等环境音
       *   8 条环境音 + 同上        → 1622ms
       *
       * 用户库里资产合计 163MB / 27 个文件，感受到的就是「延迟几秒」。
       *
       * 两者本来互不依赖：环境音只要 mix，音乐只要自己的 blob。分开跑之后，
       * 出声时机从「环境音解码完」提前到「音乐文件读完」。
       *
       * 音量提前算：`applyMix()` 是同步的，这里调一次就 setMix 生效，
       * 两条路都拿得到正确音量，不会出现音乐先用旧音量响一下再被改掉。
       * （首帧 ctx 还没 init 时 setMix 会空转，靠下面音乐路径末尾那次再补。）
       */
      if (wantsMusic) {
        if (!this.currentId || !this.cabinet.queue.includes(this.currentId)) this.currentId = this.cabinet.queue[0];
      }
      const mix = this.applyMix();
      const ambientWork = wantsAmbient
        // 环境音起不来和音乐读不出来是两件事，必须分开走。
        // 以前它们共用一个 catch，结果环境音一失败就去 skipBroken()，
        // 而那个函数第一行就把「当前正在播的那首歌」记进 broken——
        // 一首完全正常的歌被冤枉成文件丢失，然后被跳过。
        ? this.engine.start(mix).catch((error: unknown) => { ambientFailed = true; if (valid()) this.onError(error); })
        : (this.engine.stopAmbience(), Promise.resolve());
      try {
        if (!valid()) return;
        if (!wantsMusic) {
          await ambientWork;
          if (!valid()) return;
          this.engine.pauseMusic();
          if (this.musicOn) this.currentId = undefined;
          // 环境音整体失败、又没有音乐可放：屏幕上写着「正在播放」，实际一点声音都没有。
          // 更要命的是这时候按播放键走的是 pause()（running 还是 true），
          // 用户按「播放」，结果是把已经起不来的环境音又停了一遍，屏幕纹丝不动。
          if (ambientFailed) { this.running = false; this.engine.stopAll(); }
          this.emit();
          return;
        }
        const record = this.cabinet.records.find(r => r.id === this.currentId)!;
        // 手动切歌时取走待用的过渡方式；自动接下一首或冷启动都走直接切换
        const transition = this.pendingTransition; this.pendingTransition = undefined;
        if (this.loadedId !== record.id) {
          const blob = await readAsset(record.assetId);
          if (!valid()) return;
          if (!blob) throw new Error(`找不到「${record.name}」的文件，请重新导入。`);
          const hadMusic = !!this.loadedId;
          this.loadedId = undefined;
          if (transition && transition !== 'off' && hadMusic) {
            // 上一首还在响，交给双唱盘推音量，中间不断声
            this.applyMix();
            const completed = await this.engine.swapMusic(blob, transition, transitionDuration);
            if (!valid()) return;
            if (!completed) return;
            this.loadedId = record.id;
            this.emit();
            return;
          }
          // 不再先 pauseMusic：那会让界面闪一下「已暂停」。loadMusic 自己会静音两块唱盘。
          const completed = await this.engine.loadMusic(blob);
          if (!valid() || !completed) return;
          this.loadedId = record.id;
        }
        if (!valid()) { this.engine.pauseMusic(); return; }
        this.applyMix();
        // loadMusic 内部已经按下播放并放回增益，冷启动到这一步通常已经在响；
        // 只有「换歌前本来就在响」之外的情况才需要补一次。
        if (!this.audio.musicPlaying) await this.engine.playMusic();
        if (valid()) this.emit();
      } catch (error) {
        // 音乐先于环境音失败时，ambientFailed 可能还没被置上——
        // 那样会误判成「只有音乐这一路坏了」去 skipBroken()，把一首好歌记进
        // broken；而真正的情形是环境音和音乐两边都没起来（最典型：拔了移动硬盘）。
        // 等环境音这一路落地再判断，结论才和改动前一致。
        await ambientWork;
        if (!valid()) return;
        // 一首歌的文件没了，不该把整间屋子关掉。
        //
        // 原来这里无条件 this.pause()，而 pause() 走的是 engine.stopAll()——
        // 连环境音一起停。用户删了一个 mp3，结果是「雨声也跟着没了」，
        // 而且界面上看是「播放自己停了」，找不到原因。
        //
        // 现在的处理：只掐掉音乐这一路；有下一张能放的就直接接过去，
        // 一张都放不了才把音乐关掉。环境音全程不动。
        this.loadedId = undefined;
        this.engine.pauseMusic();
        // 环境音已经在上面的分支里报过错了，这里再报一次就成了两条提示；
        // 而且不能因此把一首好歌判成坏文件。
        if (ambientFailed) {
          // 但总开关要跟着下来：环境音全没起来、这首歌也放不出来，
          // 屏幕上却写着「正在播放」。这时候按播放键走的是 pause()
          // （running 还是 true），按下去只是把已经起不来的环境音又停一遍，
          // 屏幕纹丝不动——用户反复按，怎么都回不到能播的状态。
          if (!this.audio.musicPlaying && !this.audio.playing) { this.running = false; this.engine.stopAll(); }
          this.emit();
          return;
        }
        const moved = this.skipBroken();
        this.onError(error);
        if (moved) {
          // 还有能放的：接着排下一次。每失败一张就少一个候选，
          // 所以这个循环最多走队列长度那么多次，不会转不出来。
          this.emit();
          this.schedule();
          return;
        }
        this.emit();
      } finally {
        /*
         * 这次 schedule 要等两路都落地才算完。
         *
         * `this.pending` 是外部观察「这一轮排完了没有」的唯一把手
         * （测试 await 它、`App` 里也靠它串行化）。并行之后如果只等音乐，
         * pending 会先于环境音 resolve：那时候 `status.playing` 还是旧值，
         * 测试和界面都会看到「点完了却还没响」。
         *
         * 并行省的是**用户听到声音的时间**，不是这次排程的结束时刻——
         * 这两件事在代码里本来就是两个量，别混成一个。
         */
        await ambientWork;
      }
    });
  }
  dispose() { this.disposed = true; this.running = false; ++this.revision; this.engine.stopPreview(); this.engine.dispose(); }
}
