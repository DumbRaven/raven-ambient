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
  private audio: AudioStatus = { playing: false, musicPlaying: false, ducked: false, level: 0, currentTime: 0, duration: 0, lineInput: 0, lineLive: false };
  private listener: (status: RoomStatus) => void;
  private onError: (error: unknown) => void;
  /**
   * 试听期间被临时掐掉的东西。
   * 试听要听得清，所以把当前音乐停了、环境音压低；停下之后按这份记录恢复。
   * 记的是「试听之前本来是什么状态」，不是恢复成某个固定状态——
   * 用户本来就没在放音乐的话，试听完也不该自己响起来。
   */
  private previewRestore?: { running: boolean; musicPlaying: boolean };
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
  pause() { this.running = false; ++this.revision; this.pendingTransition = undefined; this.previewRestore = undefined; this.engine.stopPreview(); this.engine.stopAll(); this.emit(); }
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
    const blob = await readAsset(record.assetId);
    if (!blob) throw new Error(`找不到「${record.name}」的文件，请重新导入。`);
    if (!this.previewRestore) this.previewRestore = { running: this.running, musicPlaying: this.audio.musicPlaying };
    if (this.running && this.audio.musicPlaying) this.engine.pauseMusic();
    await this.engine.preview(blob);
  }
  stopPreview() { this.engine.stopPreview(); }
  private restoreAfterPreview() {
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
      try {
        if (wantsAmbient) {
          try { await this.engine.start(this.applyMix()); }
          // 环境音起不来和音乐读不出来是两件事，必须分开走。
          // 以前它们共用一个 catch，结果环境音一失败就去 skipBroken()，
          // 而那个函数第一行就把「当前正在播的那首歌」记进 broken——
          // 一首完全正常的歌被冤枉成文件丢失，然后被跳过。
          catch (error) { ambientFailed = true; if (valid()) this.onError(error); }
        } else this.engine.stopAmbience();
        if (!valid()) return;
        if (!wantsMusic) {
          this.engine.pauseMusic();
          if (this.musicOn) this.currentId = undefined;
          this.emit();
          return;
        }
        if (!this.currentId || !this.cabinet.queue.includes(this.currentId)) this.currentId = this.cabinet.queue[0];
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
        if (ambientFailed) { this.emit(); return; }
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
      }
    });
  }
  dispose() { this.disposed = true; this.running = false; ++this.revision; this.engine.stopPreview(); this.engine.dispose(); }
}
