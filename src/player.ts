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

  constructor(cabinet: Cabinet, listener: (status: RoomStatus) => void, onError: (error: unknown) => void) {
    this.cabinet = cabinet; this.listener = listener; this.onError = onError;
    this.engine.subscribe(status => { this.audio = status; this.emit(); });
    this.engine.onMusicEnded(() => { if (this.running && this.musicOn) this.next(false); });
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
  private wantsMusic() { return this.running && this.musicOn && !this.cabinet.lineMode && this.cabinet.queue.length > 0; }
  private wantsAmbient() { return this.running && this.ambientOn && this.cabinet.ambience.length > 0; }
  start() {
    // 外部音乐模式下本地音乐不参与，「有没有东西可放」只看环境音
    const musicReady = !this.cabinet.lineMode && this.cabinet.queue.length > 0;
    if (!musicReady && !this.cabinet.ambience.length) return;
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
  pause() { this.running = false; ++this.revision; this.pendingTransition = undefined; this.engine.stopAll(); this.emit(); }
  toggle() { if (this.running) this.pause(); else this.start(); }
  /** 单独开关音乐：只影响音乐，环境音继续流动。 */
  toggleMusic() {
    // 外部音乐模式下本地音乐这条路是关着的，按了也不该有任何反应
    if (this.cabinet.lineMode || !this.cabinet.queue.length) return;
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
    this.currentId = id; this.musicOn = true; this.running = true;
    this.armTransition(true, from);
    this.emit(); this.schedule();
  }
  seek(seconds: number) { if (this.loadedId === this.currentId) this.engine.seek(seconds); }
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
      try {
        if (wantsAmbient) await this.engine.start(this.applyMix()); else this.engine.stopAmbience();
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
      } catch (error) { if (valid()) { this.pause(); this.onError(error); } }
    });
  }
  dispose() { this.disposed = true; this.running = false; ++this.revision; this.engine.dispose(); }
}
