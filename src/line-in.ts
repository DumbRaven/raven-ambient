/** 一个可以拿来当「外部音乐」的音频输入设备。 */
export type InputDevice = { id: string; label: string };

/**
 * 浏览器默认会给麦克风开三项处理：回声消除、降噪、自动增益。
 * 它们会让电平不再线性（实测同一段声音 10 倍音量差只测出 5.86 倍），
 * 而避让包络是靠电平判断「音乐响不响」的，所以必须全部关掉。
 * 这些约束只能在 getUserMedia 时一次传入，事后 applyConstraints 会抛
 * OverconstrainedError，所以这里写成常量，不允许调用方漏传。
 */
export const rawAudio: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
};

/**
 * 虚拟声卡的名字特征。
 * 不写死设备 id：每台机器上 VB-Cable 的 id 都不一样，而且重装驱动会变；
 * 但驱动装好后设备名固定是「CABLE Output (VB-Audio Virtual Cable)」，
 * 按名字找比按 id 找稳。装的是 VB-Cable 的 A+ 版也带同样的字样。
 */
export const cablePattern = /cable\s*(output|out)|vb-?audio\s*(virtual\s*)?cable/i;

const fallbackName = (index: number) => `音频输入 ${index + 1}`;

/**
 * 列出所有音频输入。
 * 没有拿到录音权限时浏览器会隐藏设备名，这里给出占位名。
 */
export async function listInputs(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(device => device.kind === 'audioinput')
    .map((device, index) => ({ id: device.deviceId, label: device.label || fallbackName(index) }));
}

/**
 * 找出虚拟声卡的输出端点。
 * 优先精确匹配「CABLE Output」，退而求其次接受任何 VB-Audio 的输入端点，
 * 免得用户装的是 A+ 版或者换了驱动包就找不到。
 */
export function findCable(devices: InputDevice[]): InputDevice | undefined {
  const exact = devices.find(device => /cable\s*output/i.test(device.label));
  if (exact) return exact;
  return devices.find(device => cablePattern.test(device.label));
}

/**
 * 打开虚拟声卡。
 * 设备写死成「找 CABLE Output」，用户不需要选，也就没有选错的可能。
 * 第一次调用时浏览器还没给权限、设备名是空的，这时先请求一次默认输入拿到权限，
 * 再重新枚举——这是唯一能让 label 显示出来的办法。
 */
export async function openCable(): Promise<MediaStream> {
  const attempt = async () => findCable(await listInputs());
  let target = await attempt();
  if (!target) {
    // 没权限时 label 是空的，先开一次默认设备把权限要下来
    const probe = await navigator.mediaDevices.getUserMedia({ audio: rawAudio, video: false });
    for (const track of probe.getTracks()) track.stop();
    target = await attempt();
  }
  if (!target) throw new DOMException('没有找到虚拟声卡', 'NotFoundError');
  return navigator.mediaDevices.getUserMedia({
    audio: { ...rawAudio, deviceId: { exact: target.id } },
    video: false,
  });
}

/** 一条抓取中的外部音频流，负责开和关，不碰音频图。 */
export class LineIn {
  private stream?: MediaStream;
  /** 当前这条流对应的设备 id。 */
  device = '';

  get active() { return !!this.stream; }

  /** 接上虚拟声卡。设备是写死的，调用方不需要传。 */
  async open(): Promise<MediaStream> {
    this.close();
    const stream = await openCable();
    this.stream = stream;
    this.device = stream.getAudioTracks()[0]?.label ?? 'CABLE Output';
    return stream;
  }

  close() {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
    this.device = '';
  }
}

/** 把浏览器抛出的错误翻成用户能看懂的一句话。 */
export function lineInError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError') return '系统拒绝了录音权限';
  if (name === 'NotFoundError') return '没找到虚拟声卡，先装好 VB-Cable 再打开这个开关';
  if (name === 'NotReadableError') return '虚拟声卡正被别的程序占用';
  if (name === 'OverconstrainedError') return '虚拟声卡不支持这个采样格式';
  const message = (error as { message?: string })?.message;
  return message || '未知原因';
}
