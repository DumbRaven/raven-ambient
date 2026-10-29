import { type Mix, type Track } from './model.ts';
import { DuckEnvelope, duckGain, duckProfile } from './ducking.ts';
import { readAsset } from './storage.ts';
import { AudioBufferCache } from './audio-buffer-cache.ts';
import { loudnessGain, measureRms } from './loudness.ts';

type Voice = { source: AudioBufferSourceNode; gain: GainNode; duck: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode; clip: WaveShaperNode; envelope: DuckEnvelope; coverId?: string; depth: number; loudness: number };/** 一块唱盘：一个音频元素加它自己的音量，两块交替用来做切歌过渡。 */
type Deck = { el: HTMLAudioElement; gain: GainNode; level: number; url?: string; owner?: number };
export type AudioStatus = { playing: boolean; musicPlaying: boolean; ducked: boolean; level: number; currentTime: number; duration: number; lineInput: number; lineLive: boolean };
const initialStatus: AudioStatus = { playing: false, musicPlaying: false, ducked: false, level: 0, currentTime: 0, duration: 0, lineInput: 0, lineLive: false };

/**
 * 每一路环境音自己的软限幅曲线。
 *
 * 为什么要单独一路限幅：用户上传的素材可能是「峰值已经贴着 0 dB、RMS 只有 -38 dB」
 * 这种动态极大的东西。归一化把响度补了 12 dB 之后，峰值会冲到 +12 dB，
 * 只在总线上限幅的话，压得太狠会把音乐一起带下去。
 *
 * 曲线是软的：|x| < 0.7 原样通过，之后慢慢压弯，到 1.0 附近才收住。
 * 也就是说，正常音量完全不变，只有过界的瞬态被削，听感上不会变成「糊」。
 */
/** 曲线只跟形状有关，算一次就够，不必每建一路声部重算一遍。 */
let clipCurve: Float32Array<ArrayBuffer> | undefined;

function softClipCurve(): Float32Array<ArrayBuffer> {
  if (clipCurve) return clipCurve;
  const size = 2048;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  const knee = 0.7;
  for (let index = 0; index < size; index += 1) {
    const x = (index / (size - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    // 拐点之后按 tanh 压弯，保留一点奇次谐波，比硬切自然得多
    const shaped = magnitude <= knee ? magnitude : knee + (1 - knee) * Math.tanh((magnitude - knee) / (1 - knee));
    curve[index] = Math.sign(x) * shaped;
  }
  clipCurve = curve;
  return curve;
}

export class AmbientEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private ambient?: GainNode;
  private musicGain?: GainNode;
  private analyser?: AnalyserNode;
  private samples?: Float32Array<ArrayBuffer>;
  private decks: Deck[] = [];
  private activeDeck = 0;
  /** 外部音乐（虚拟声卡抓来的那一股声音），和音乐走同一条音量链。 */
  private lineGain?: GainNode;
  private lineAnalyser?: AnalyserNode;
  private lineSamples?: Float32Array<ArrayBuffer>;
  private lineSource?: MediaStreamAudioSourceNode;
  private lineLevel = 0;
  /** 每拍测到的原始 RMS，给界面画波形。status 是节流后给 React 的，不够新。 */
  private live = 0;
  /**
   * 环境音的叠加补偿系数。
   *
   * 几条互不相关的声音叠在一起，响度按根号长：四路并联比单路响一倍。
   * 一到三路是很常见的用法，量过不会撞上限幅器，所以这一段原样不动——
   * 用户把某一路推到 200%，就该结结实实地听到它变响。
   * 超过三路才按 sqrt(3/路数) 折回去：八路全推 200% 时总线会顶到限幅器，
   * 表现为「环境音加得越多，音乐反而越小」。
   */
  private ambientScale = 1;
  /**
   * 外部音乐的底噪追踪值。
   *
   * 本地唱片的 RMS 是我们自己放出来的，绝对值稳定，硬编码 0.011 就够了。
   * 但 CABLE 抓回来的是「别人播放器的音量 × 系统音量」，同一首歌在不同机器上
   * 能差出二三十 dB，拿固定阈值判断必然失灵。
   *
   * 做法是双端追踪：内部音量在响时只往下记最小值（有 2 秒的下降时延，
   * 免得音乐一起播就把底噪定高），长期没声音时慢慢往上抬（避免一次巧合锁死在过低的值）。
   * 外部音乐要高出底噪一截，才算「在响」。
   */
  private lineFloor = 0;
  /** 底噪下降时延：从内部开始出声算起，等这么久才允许刷新底噪。 */
  private floorSettleAt = 0;
  private voices = new Map<string, Voice>();
  private buffers = new AudioBufferCache();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private timer?: ReturnType<typeof setInterval>;
  private mix?: Mix;
  private revision = 0;
  private musicRevision = 0;
  private musicAbort?: AbortController;
  private transitionTimer?: ReturnType<typeof setTimeout>;
  private lastEmitted?: AudioStatus;
  private lastEmissionAt = -Infinity;
  private status: AudioStatus = { ...initialStatus };
  private listeners = new Set<(status: AudioStatus) => void>();
  private endedListeners = new Set<() => void>();
  private destroyed = false;

  subscribe(listener: (status: AudioStatus) => void) { this.listeners.add(listener); listener({ ...this.status }); return () => { this.listeners.delete(listener); }; }
  onMusicEnded(listener: () => void) { this.endedListeners.add(listener); return () => { this.endedListeners.delete(listener); }; }
  private emit() {
    const previous = this.lastEmitted, next = this.status, now = this.ctx?.currentTime ?? 0;
    if (previous && (Object.keys(next) as (keyof AudioStatus)[]).every(key => previous[key] === next[key])) return;
    // 这些字段一变就必须立刻推给界面，不能被 200ms 节流吞掉：
    // lineLive 决定「外部音乐」卡片显不显示，ducked 决定文案，漏一次界面就卡在旧状态。
    const changed = !previous
      || previous.playing !== next.playing
      || previous.musicPlaying !== next.musicPlaying
      || previous.ducked !== next.ducked
      || previous.duration !== next.duration
      || previous.lineLive !== next.lineLive;
    if (!changed && now >= this.lastEmissionAt && now - this.lastEmissionAt < 0.2) return;
    this.lastEmitted = { ...next }; this.lastEmissionAt = now;
    for (const listener of this.listeners) listener({ ...next });
  }
  private init() {
    if (this.destroyed) throw new Error('播放器已关闭。');
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = 0.65;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9; limiter.knee.value = 12; limiter.ratio.value = 12; limiter.attack.value = 0.005; limiter.release.value = 0.25;
    this.master.connect(limiter).connect(ctx.destination);
    this.ambient = ctx.createGain(); this.ambient.connect(this.master);
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.65;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.musicGain.connect(this.analyser).connect(this.master);
    // 外部音乐单独一条线，但和本地音乐用同一把尺子：都乘「音乐总音量」。
    // 以前这里是 1.0 满幅直通，比本地音乐响一倍，环境音被压得几乎听不见。
    this.lineGain = ctx.createGain(); this.lineGain.gain.value = 0.65;
    this.lineAnalyser = ctx.createAnalyser(); this.lineAnalyser.fftSize = 1024;
    this.lineSamples = new Float32Array(this.lineAnalyser.fftSize);
    this.lineGain.connect(this.master);
    // 两块唱盘：一块在响时，另一块在后台把下一首准备好，过渡时只推音量，声音不断
    this.decks = [0, 1].map(() => {
      const el = new Audio(); el.preload = 'metadata';
      const gain = ctx.createGain(); gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.musicGain!);
      const deck: Deck = { el, gain, level: 0 };
      const isActive = () => this.decks[this.activeDeck] === deck;
      el.addEventListener('ended', () => { if (!isActive()) return; this.status.musicPlaying = false; this.tick(); for (const listener of this.endedListeners) listener(); });
      el.addEventListener('pause', () => { if (!isActive() || el.paused === false) return; this.status.musicPlaying = false; this.tick(); });
      el.addEventListener('play', () => { if (!isActive() || el.paused === true) return; this.status.musicPlaying = true; this.tick(); });
      el.addEventListener('error', () => { if (!isActive()) return; this.status.musicPlaying = false; this.tick(); });
      return deck;
    });
  }
  private get music(): HTMLAudioElement | undefined { return this.decks[this.activeDeck]?.el; }
  private get spareDeck(): Deck | undefined { return this.decks[1 - this.activeDeck]; }
  /**
   * 接上外部音乐（虚拟声卡抓来的流）。它和本地音乐共用音乐音量与避让分析，
   * 所以接上之后避让会自动按「外部音乐有多响」来压环境音。
   */
  attachLineIn(stream: MediaStream) {
    this.init();
    // 只在真的要换流时断开旧的，别每次接流都把正在跑的环境音重启一遍
    if (this.lineSource) this.detachLineIn();
    // 用户没播过本地音乐时 AudioContext 可能还挂着 suspended，抓进来的流不会出声
    void this.ctx!.resume().catch(() => undefined);
    this.lineSource = this.ctx!.createMediaStreamSource(stream);
    this.lineSource.connect(this.lineGain!);
    this.lineSource.connect(this.lineAnalyser!);
    this.tick();
  }
  detachLineIn() {
    const had = !!this.lineSource;
    // 注意：这里不能动 this.revision。
    // revision 是「混音启动」代次，engine.start() 拿它判断自己是否还有效；
    // 断开一条外部输入跟环境音要不要继续加载毫无关系，作废了会把正在解码的
    // 环境音一起取消掉，表现就是「接了外部音乐之后环境音再也不响了」。
    this.lineSource?.disconnect();
    this.lineSource = undefined;
    this.lineLevel = 0;
    this.tick();
    // tick 里 emit 有 200ms 节流，而断开后不再需要定时器，
    // 这一下如果被节流吞掉，界面上的电平条会一直留着。这里强制发一次。
    if (had) { this.lastEmitted = undefined; this.emit(); }
  }
  /** 外部输入的电平（0–1），给设置里的电平条用。 */
  get lineInput() { return this.lineLevel; }
  /** 外部输入的原始 RMS，用来在界面上显示 dB，方便用户判断音量是否太小。 */
  get lineRms() { return this.lineLevel / 5; }
  /** 当前校准出来的触发门限（RMS）。 */
  get lineGate() { return Math.max(this.lineFloor * 1.8, 0.011); }
  /**
   * 正在响的那个声音的原始 RMS，给播放卡上的实时波形用。
   *
   * 外部音乐模式下就是虚拟声卡那一路，否则是本地音乐——
   * 波形要代表「用户此刻听到的主导声音」，而不是固定的某一路。
   * 不走 status：那是 200ms 才推一次的节流数据，波形要每帧都新鲜。
   */
  get liveLevel() {
    return this.live;
  }
  private tick() {
    if (!this.ctx || !this.analyser || !this.samples) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    const localRms = Math.sqrt(this.samples.reduce((sum, n) => sum + n * n, 0) / this.samples.length);
    // 接了外部音乐就以它为准：避让要跟的是「用户真正在听的音乐」有多响
    let lineRms = 0;
    if (this.lineSource && this.lineAnalyser && this.lineSamples) {
      this.lineAnalyser.getFloatTimeDomainData(this.lineSamples);
      lineRms = Math.sqrt(this.lineSamples.reduce((sum, n) => sum + n * n, 0) / this.lineSamples.length);
    }
    this.lineLevel = Math.min(1, lineRms * 5);
    this.status.lineInput = this.lineLevel;
    this.status.lineLive = !!this.lineSource;
    // 校准：环境音自己在响、而外部没有音乐时，回环里的电平就是这台机器「安静」的样子。
    if (!this.lineSource) {
      this.lineFloor = 0;
      this.floorSettleAt = 0;
    } else if (localRms * ((this.mix?.musicVolume ?? 70) / 100) > 0.004) {
      const seconds = this.ctx.currentTime;
      if (this.floorSettleAt === 0) this.floorSettleAt = seconds + 2;
      if (seconds > this.floorSettleAt) {
        const sample = lineRms * 0.75;
        this.lineFloor = this.lineFloor === 0 ? sample : Math.min(this.lineFloor, sample);
      }
    } else if (localRms < 0.0005) {
      // 环境音也停了：这一次的观测不可信（回环里可能全是音乐），只把下降时延作废，
      // 底噪本身保持不动。既不往上抬（会把门限推到永远不触发），也不往下记。
      this.floorSettleAt = 0;
    }
    // 外部音乐要高出底噪一截才算「在响」；下限 0.011 保证环境音很轻时判定依然灵敏。
    const lineFloor = Math.max(this.lineFloor * 1.8, 0.011);
    const rms = this.lineSource ? lineRms : localRms;
    const now = this.ctx.currentTime;
    const playing = this.status.musicPlaying || !!this.lineSource;
    const enabled = this.mix?.ducking ?? true;
    // 每个声部按自己的封面手感独立推进包络，互不影响
    let deepest = 0;
    for (const voice of this.voices.values()) {
      const profile = duckProfile(voice.coverId, voice.depth);
      // 外部音乐模式下，门限拉到校准值：底噪抬高时固定阈值会永远不触发
      const tuned = this.lineSource ? { ...profile, threshold: lineFloor, hysteresis: lineFloor * 0.22 } : profile;
      const level = voice.envelope.step(rms, now, playing, enabled, tuned);
      if (level > deepest) deepest = level;
      voice.duck.gain.setTargetAtTime(duckGain(level, voice.depth), now, 0.04);
    }
    // 只要有任一声部在避让，界面上就显示「轻轻退后」
    const ducked = deepest > 0.02;
    this.status.ducked = ducked;
    this.status.level = Math.min(1, rms * 5);
    // 波形用的是「原始 RMS」，不是被撑大过的那份。外部音乐模式下 rms 已经是虚拟声卡的读数。
    this.live = rms;
    this.status.currentTime = this.music?.currentTime ?? 0;
    this.status.duration = Number.isFinite(this.music?.duration) ? this.music!.duration : 0;
    this.emit();
    const needsTick = !this.destroyed && (playing || !!this.lineSource || [...this.voices.values()].some(voice => voice.envelope.active));
    if (needsTick && this.timer === undefined) this.timer = setInterval(() => this.tick(), 80);
    if (!needsTick && this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
  }
  async start(mix: Mix) {
    this.init();
    const revision = ++this.revision;
    const valid = () => !this.destroyed && revision === this.revision;
    try {
      await this.ctx!.resume();
      if (!valid()) return;
      this.setMix(mix);
      // 并发解码（上限 3）：串行要 8 秒，用户等了半天没声音就以为功能坏了。
      // 已有声部无需重新解码，所以热路径上这里通常是空数组。
      const pending = mix.tracks.filter(t => t.enabled && !this.voices.has(t.id));
      const buffers: { track: Track; buffer: AudioBuffer }[] = [];
      const lane = async () => {
        for (let next = pending.shift(); next; next = pending.shift()) {
          const buffer = await this.getBuffer(next);
          if (!valid()) return;
          buffers.push({ track: next, buffer });
        }
      };
      await Promise.all([lane(), lane(), lane()]);
      if (!valid()) return;
      for (const { track, buffer } of buffers) {
        if (this.voices.has(track.id)) continue;
        const ctx = this.ctx!;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
        const gain = ctx.createGain(), duck = ctx.createGain(), filter = ctx.createBiquadFilter(), pan = ctx.createStereoPanner(), clip = ctx.createWaveShaper();
        gain.gain.value = 0; filter.type = 'lowpass'; filter.Q.value = 0.4;
        duck.gain.value = 1;
        // 限幅放在音量之后：补上来的那 12 dB 增益全在这里被削平，总线上就不会再顶。
        clip.curve = softClipCurve(); clip.oversample = '2x';
        source.connect(filter).connect(pan).connect(gain).connect(clip).connect(duck).connect(this.ambient!);
        source.start();
        this.voices.set(track.id, { source, gain, duck, filter, pan, clip, envelope: new DuckEnvelope(), coverId: track.coverId, depth: track.duckDepth, loudness: loudnessGain(measureRms(buffer)) });
      }
      this.status.playing = this.voices.size > 0; this.setMix(this.mix ?? mix); this.tick();
    } catch (error) { if (valid()) { this.stopAmbience(); throw error; } }
  }
  stopAmbience() {
    ++this.revision;
    for (const voice of this.voices.values()) { voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect(); voice.duck.disconnect(); voice.filter.disconnect(); voice.pan.disconnect(); voice.clip.disconnect(); }
    this.voices.clear(); this.status.playing = false; this.status.ducked = false; this.tick(); this.emit();
  }
  stopAll() { this.stopAmbience(); this.pauseMusic(); }
  /** 调度器一接到新意图就取消旧加载，不必等串行队列轮到新任务。 */
  cancelPending() { ++this.revision; this.cancelMusicWork(); }
  private cancelMusicWork() { ++this.musicRevision; this.musicAbort?.abort(); this.musicAbort = undefined; }
  private beginMusicWork() { this.cancelMusicWork(); this.musicAbort = new AbortController(); return { revision: this.musicRevision, signal: this.musicAbort.signal }; }
  private musicValid(revision: number) { return !this.destroyed && revision === this.musicRevision; }
  private clearTransition() { clearTimeout(this.transitionTimer); this.transitionTimer = undefined; }
  private silence(deck: Deck) {
    deck.level = 0; deck.gain.gain.cancelScheduledValues(0); deck.gain.gain.setValueAtTime(0, this.ctx!.currentTime); deck.el.pause();
  }
  setMix(mix: Mix) {
    this.mix = mix;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master!.gain.setTargetAtTime(mix.master / 100, now, 0.05);
    this.musicGain!.gain.setTargetAtTime(mix.musicVolume / 100, now, 0.05);
    // 外部音乐跟着「音乐总音量」走，再乘它自己那档微调；两档相乘，用户看到的每一档都有用。
    this.lineGain?.gain.setTargetAtTime(mix.musicVolume / 100 * (mix.lineVolume ?? 100) / 100, now, 0.05);
    // 只有真正在响的声部算进叠加路数：被单独暂停的不该占一份补偿名额。
    // 一到三路不动（正常用法），超过三路才开始折，见 ambientScale 的注释。
    const live = [...this.voices.entries()].filter(([id]) => mix.tracks.find(t => t.id === id)?.enabled).length;
    this.ambientScale = live > 3 ? Math.sqrt(3 / live) : 1;
    for (const [id, voice] of this.voices) {
      const track = mix.tracks.find(t => t.id === id);
      if (!track) { this.forget(id); continue; }
      // 环境音的基础系数：0.45 时被音乐压得太狠，抬到 0.55 让它站得住。
      // 再按同时叠加的路数做一次功率补偿：几条不相关的声音叠在一起，响度按根号增长，
      // 统一除以 sqrt(路数) 能让「一路 200%」和「八路各 100%」听起来差不多，
      // 而不是路数一多就把总线和音乐一起顶进限幅器。
      // 最后乘上这一路素材自己的响度补偿：用户上传的素材本身就有 ±13 dB 的落差，
      // 滑杆应该调的是「相对比例」，不该拿来补素材的缺陷。
      voice.gain.gain.setTargetAtTime(track?.enabled ? track.volume / 100 * 0.55 * this.ambientScale * voice.loudness : 0, now, 0.15);
      if (track) {
        voice.pan.pan.setTargetAtTime(track.pan / 100, now, 0.08);
        voice.filter.frequency.setTargetAtTime(18000 * Math.pow(0.025, track.warmth / 100), now, 0.12);
        // 深度和封面可能在编辑面板里改过，热更新到声部上，下一拍就按新参数走
        voice.depth = track.duckDepth;
        voice.coverId = track.coverId;
      }
    }
  }
  private async getBuffer(track: Track): Promise<AudioBuffer> {
    const cached = this.buffers.get(track.id);
    if (cached) return cached;
    if (this.loading.has(track.id)) return this.loading.get(track.id)!;
    const pending = (async () => {
      let buffer: AudioBuffer;
      if (track.kind === 'file') {
        const blob = await readAsset(track.id);
        if (!blob) throw new Error(`“${track.name}”的本地文件不可用，请移除后重新导入。`);
        buffer = await this.ctx!.decodeAudioData(await blob.arrayBuffer());
      } else buffer = synthesize(this.ctx!, track.kind);
      if (!this.destroyed) this.buffers.set(track.id, buffer); return buffer;
    })();
    this.loading.set(track.id, pending);
    try { return await pending; } finally { this.loading.delete(track.id); }
  }
  async validateAmbient(file: File) {
    this.init();
    if (file.size > 50 * 1024 * 1024) throw new Error('单张环境音请控制在 50 MB 以内。');
    const buffer = await this.ctx!.decodeAudioData(await file.arrayBuffer()).catch(() => { throw new Error('无法读取这段音频，请使用 MP3、WAV、OGG 或 FLAC。'); });
    if (buffer.duration > 600) throw new Error('单段环境音最长 10 分钟，可循环播放。');
    return buffer;
  }
  cacheBuffer(id: string, buffer: AudioBuffer) { this.buffers.set(id, buffer); }
  forget(id: string) {
    const voice = this.voices.get(id);
    if (voice) { voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect(); voice.duck.disconnect(); voice.filter.disconnect(); voice.pan.disconnect(); voice.clip.disconnect(); this.voices.delete(id); }
    this.buffers.delete(id);
  }
  /**
   * 把一首歌装进指定的唱盘。
   *
   * autoplay 时不等元数据就按下播放：浏览器会在缓冲够的第一刻出声。
   * 原来的写法是「先等 loadedmetadata、再 play、再等缓冲」，三段等待串成一条链，
   * 用户点播放到听见声音之间就空出一段。现在元数据等待和播放并行。
   */
  private async arm(deck: Deck, blob: Blob, signal: AbortSignal, autoplay = false) {
    if (deck.url) URL.revokeObjectURL(deck.url);
    deck.url = URL.createObjectURL(blob);
    // preload 从 metadata 改成 auto：本地 blob 不消耗流量，让它一次性把数据备好
    deck.el.preload = 'auto';
    deck.el.src = deck.url;
    // play() 的 promise 才是「真正开始响」，元数据的 promise 只说明文件认得出来。
    // 失败（编解码不支持等）交给下面的 error 事件统一报，这里只吞掉自己的拒绝。
    const playing = autoplay ? deck.el.play().catch(() => undefined) : Promise.resolve();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('读取音乐超时，请换一个文件。')), 12000);
      const success = () => finish();
      const failure = () => finish(new Error('无法播放这个文件，请尝试 MP3、WAV、OGG 或 FLAC。'));
      const cancel = () => finish();
      const finish = (error?: Error) => {
        clearTimeout(timeout); deck.el.removeEventListener('loadedmetadata', success); deck.el.removeEventListener('error', failure);
        signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve();
      };
      deck.el.addEventListener('loadedmetadata', success, { once: true });
      deck.el.addEventListener('error', failure, { once: true });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel(); else deck.el.load();
    });
    await playing;
  }
  /**
   * 把一首歌装到当前唱盘上并开始播。
   *
   * 这里不再调用 pauseMusic()：它会把 status 置成「已暂停」再 emit，
   * 用户看到的是一小段「已暂停 → 播放中」的闪烁。冷启动时只需要把两块唱盘静音。
   */
  async loadMusic(blob: Blob) {
    this.init();
    this.cancelMusicWork(); this.clearTransition();
    for (const deck of this.decks) this.silence(deck);
    const { revision, signal } = this.beginMusicWork(), deck = this.decks[this.activeDeck];
    deck.owner = revision;
    await this.arm(deck, blob, signal, true);
    if (!this.musicValid(revision)) return false;
    // arm 里已经按下播放，这里把这块唱盘的增益放回来（silence 刚把它清零）
    deck.gain.gain.cancelScheduledValues(this.ctx!.currentTime);
    deck.gain.gain.setValueAtTime(1, this.ctx!.currentTime); deck.level = 1;
    this.status.musicPlaying = true;
    this.tick(); return true;
  }
  /**
   * 换歌：把新的一首装到空闲唱盘上先响起来，再按过渡方式推两块唱盘的音量。
   * crossfade 两块此消彼长；fade 先把旧的推到底再推新的；off 直接切。
   */
  async swapMusic(blob: Blob, mode: 'off' | 'crossfade' | 'fade', seconds: number) {
    this.init();
    const { revision, signal } = this.beginMusicWork();
    await this.ctx!.resume();
    if (!this.musicValid(revision)) return false;
    this.clearTransition();
    const from = this.decks[this.activeDeck];
    const to = this.spareDeck!;
    this.silence(to); to.owner = revision;
    await this.arm(to, blob, signal);
    if (!this.musicValid(revision)) return false;
    // 新唱盘先静音播放，从 0 开始推，避免出现半拍的爆音
    to.level = 0; to.gain.gain.cancelScheduledValues(this.ctx!.currentTime); to.gain.gain.setValueAtTime(0, this.ctx!.currentTime);
    await to.el.play();
    if (!this.musicValid(revision)) { if (to.owner === revision) this.silence(to); return false; }
    this.activeDeck = 1 - this.activeDeck;
    this.status.musicPlaying = true;
    const now = this.ctx!.currentTime;
    const span = mode === 'off' ? 0.02 : Math.max(0.1, seconds);
    const fromLevel = from.gain.gain.value;
    from.gain.gain.cancelScheduledValues(now);
    if (mode === 'crossfade') {
      to.gain.gain.setValueAtTime(0, now);
      to.gain.gain.linearRampToValueAtTime(1, now + span);
      from.gain.gain.setValueAtTime(fromLevel, now);
      from.gain.gain.linearRampToValueAtTime(0, now + span);
      to.level = 1; from.level = 0;
    } else if (mode === 'fade') {
      // 旧的先淡出到安静，新的在后半段再进来，中间留一个干净的呼吸
      const half = span / 2;
      from.gain.gain.setValueAtTime(fromLevel, now);
      from.gain.gain.linearRampToValueAtTime(0, now + half);
      to.gain.gain.setValueAtTime(0, now + half);
      to.gain.gain.linearRampToValueAtTime(1, now + span);
      to.level = 1; from.level = 0;
    } else {
      to.gain.gain.setValueAtTime(1, now);
      from.gain.gain.setValueAtTime(0, now);
      to.level = 1; from.level = 0;
    }
    // 等过渡走完再停掉旧唱盘，中途停会切断淡出
    this.transitionTimer = setTimeout(() => { if (this.decks[this.activeDeck] !== from) this.silence(from); this.transitionTimer = undefined; }, Math.round(span * 1000) + 40);
    this.tick(); return true;
  }
  async toggleMusic() {
    this.init();
    if (!this.music?.src) throw new Error('先导入一首音乐，或试听内置旋律。');
    if (this.music.paused) await this.playMusic();
    else this.pauseMusic();
  }
  async playMusic() {
    this.init();
    const { revision } = this.beginMusicWork();
    await this.ctx!.resume();
    if (!this.musicValid(revision)) return false;
    this.clearTransition(); this.silence(this.spareDeck!);
    // stopAll 会把唱盘推回静音，重新开播时把当前这块放回来
    const deck = this.decks[this.activeDeck];
    deck.owner = revision;
    deck.gain.gain.cancelScheduledValues(this.ctx!.currentTime);
    deck.gain.gain.setValueAtTime(1, this.ctx!.currentTime); deck.level = 1;
    await deck.el.play();
    if (!this.musicValid(revision)) { if (deck.owner === revision) this.silence(deck); return false; }
    this.status.musicPlaying = true; this.tick(); return true;
  }
  pauseMusic() {
    this.cancelMusicWork(); this.clearTransition();
    for (const deck of this.decks) this.silence(deck);
    this.status.musicPlaying = false; this.tick(); this.emit();
  }
  seek(seconds: number) { if (this.music && Number.isFinite(this.music.duration)) { this.music.currentTime = Math.max(0, Math.min(seconds, this.music.duration)); this.lastEmissionAt = -Infinity; this.tick(); } }
  dispose() {
    this.destroyed = true;
    this.stopAll(); clearInterval(this.timer);
    for (const deck of this.decks) {
      deck.el.pause(); deck.el.removeAttribute('src'); deck.el.load();
      if (deck.url) URL.revokeObjectURL(deck.url);
    }
    void this.ctx?.close(); this.listeners.clear(); this.endedListeners.clear(); this.buffers.clear();
  }
}

function synthesize(ctx: AudioContext, kind: 'rain' | 'fire' | 'wind') {
  const seconds = 12, rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(2, seconds * rate, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let brown = 0, smooth = 0, crackle = 0;
    for (let i = 0; i < data.length; i++) {
      const noise = Math.random() * 2 - 1;
      brown = (brown + 0.025 * noise) / 1.025;
      smooth = smooth * 0.985 + noise * 0.015;
      const phase = i / data.length * Math.PI * 2;
      if (kind === 'rain') data[i] = (noise * 0.23 + brown * 1.1) * (0.8 + 0.2 * Math.sin(phase * 3));
      if (kind === 'wind') data[i] = (brown * 2 + smooth) * (0.6 + 0.25 * Math.sin(phase) + 0.12 * Math.sin(phase * 3));
      if (kind === 'fire') {
        if (Math.random() < 0.00014) crackle = 0.4 + Math.random() * 0.5;
        crackle *= 0.995;
        data[i] = brown * 1.5 + noise * crackle;
      }
      // Window the seam to eliminate loop clicks.
      const fade = Math.min(1, i / (rate * 0.08), (data.length - 1 - i) / (rate * 0.08));
      data[i] *= fade;
    }
  }
  return buffer;
}

export function makeDemoMusic(): Blob {
  const rate = 22050, duration = 32, length = rate * duration;
  const data = new Float32Array(length);
  const notes = [261.63, 329.63, 392, 493.88, 440, 392, 329.63, 293.66, 220, 261.63, 329.63, 392, 349.23, 329.63, 293.66, 261.63];
  notes.forEach((freq, n) => {
    // The middle quiet passage makes automatic ducking easy to hear.
    const start = n * 1.6 + (n >= 8 ? 4 : 0);
    for (let i = 0; i < rate * 2.8 && Math.floor(start * rate) + i < length; i++) {
      const t = i / rate;
      const envelope = Math.min(1, t / 0.035) * Math.exp(-t * 1.8);
      data[Math.floor(start * rate) + i] += envelope * (Math.sin(2 * Math.PI * freq * t) * 0.23 + Math.sin(4 * Math.PI * freq * t) * 0.055 + Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.06);
    }
  });
  const bytes = new ArrayBuffer(44 + length * 2), view = new DataView(bytes);
  const text = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
  return new Blob([bytes], { type: 'audio/wav' });
}
