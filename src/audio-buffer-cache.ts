/** 只限制可复用缓存，不限制正在播放的声部；大音频播放完后即可释放。 */
export class AudioBufferCache {
  private entries = new Map<string, AudioBuffer>();
  private bytes = 0;
  private budget: number;
  constructor(budget = 128 * 1024 * 1024) { this.budget = budget; }
  private size(buffer: AudioBuffer) { return buffer.length * buffer.numberOfChannels * 4 || 0; }
  get(id: string) {
    const buffer = this.entries.get(id);
    if (buffer) { this.entries.delete(id); this.entries.set(id, buffer); }
    return buffer;
  }
  set(id: string, buffer: AudioBuffer) {
    this.delete(id);
    const size = this.size(buffer);
    if (size > this.budget) return;
    this.entries.set(id, buffer); this.bytes += size;
    while (this.bytes > this.budget) this.delete(this.entries.keys().next().value!);
  }
  delete(id: string) {
    const buffer = this.entries.get(id);
    if (buffer) this.bytes -= this.size(buffer);
    this.entries.delete(id);
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}
