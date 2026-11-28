/**
 * `MediaStreamTrackGenerator` 的类型声明。
 *
 * 这个 API 属于 WebCodecs 的 Streams 扩展，TS 自带的 `lib.dom` 里还没有
 * （`AudioData` 有，`MediaStreamTrackGenerator` 没有），所以自己补一份最小定义。
 *
 * 只声明我们真的用到的部分：构造、`writable`、`kind`、`stop()`。
 * 别在这里补全整份规范——多出来的成员没人用，只会让人以为它是可依赖的。
 *
 * 运行时是否可用要单独判断（见 src/audio-tap.ts 的 `open()`）：
 * Electron 40 上有，但探针自己建的窗口、或将来某个版本去掉它，都要能优雅退化。
 */
interface MediaStreamTrackGeneratorInit {
  kind: 'audio' | 'video';
}

declare class MediaStreamTrackGenerator<T = AudioData> extends MediaStreamTrack {
  constructor(init: MediaStreamTrackGeneratorInit);
  readonly writable: WritableStream<T>;
  readonly readable: ReadableStream<T>;
}
