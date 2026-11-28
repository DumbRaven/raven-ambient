import { tapPlatform } from './audio-tap-bridge.ts';
import { openSystemAudio, type TapReason } from './system-audio.ts';

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
  /**
   * 上一次失败的原因，只对 mac 那条路有意义。
   *
   * Windows 的失败都挂在 DOMException 的 name 上（NotAllowedError 之类），
   * mac 那边是主进程报上来的状态名，两种形状硬塞进一个字段只会让调用方两头猜。
   * 所以 mac 的原因单独放这里，由 App 读出来交给设置面板。
   */
  lastReason: TapReason | null = null;

  get active() { return !!this.stream; }

  /**
   * 接上外部音乐。
   *
   * 两条路，选哪条只看平台，不看设备：
   *   mac   —— 主进程的 Core Audio tap（不需要也没有设备可选）。
   *   其它  —— 虚拟声卡，设备写死成「找 CABLE Output」，调用方不用传。
   *
   * 之所以放在同一个方法里而不是叫 openCable/openTap 两个名字：调用方（App）
   * 关心的是「接上外部音乐」，它不该知道这台机器用哪种方式做到。
   */
  async open(): Promise<MediaStream> {
    this.close();
    this.lastReason = null;
    if (tapPlatform() === 'darwin') {
      const result = await openSystemAudio();
      if (!result.ok) {
        this.lastReason = result.reason;
        // 用 DOMException 而不是自定义类：上层已经有一整套按 name 分支的逻辑
        // （isRetriable / lineInError），这里只需给一个它认识的名字。
        // 三种失败里只有「用户能去设置里打开的那个」算可重试。
        const name = result.reason === 'denied' ? 'NotAllowedError' : 'NotFoundError';
        throw new DOMException(result.detail || '系统音频没接上', name);
      }
      this.stream = result.stream;
      // mac 那条路上没有设备：声音是系统级的，不存在「选哪个输入」。
      // 留一个固定的短名，设置面板拿它占位（那边 mac 分支不会显示设备名）。
      this.device = '系统音频';
      // silent 不是失败：流是通的，只是两秒半内没见到非零字节——
      // 播放器暂停着的时候静音才是对的。所以照常返回，只把原因记下来，
      // 让 App 在设置面板里说一句「如果正在播放还没声音，去开权限」。
      if (result.silent) this.lastReason = 'silent';
      return result.stream;
    }
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

/**
 * 把浏览器抛出的错误翻成用户能看懂的一句话。
 *
 * ⚠ 只用来填「可重试的失败」——设置面板会把它和「再试一次」并排显示。
 * 「没装虚拟声卡」不在此列：那是常态，重试必然再失败，见下面的 `noCableHint`。
 */
export function lineInError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError') return '系统拒绝了录音权限';
  if (name === 'NotReadableError') return '虚拟声卡正被别的程序占用';
  if (name === 'OverconstrainedError') return '虚拟声卡不支持这个采样格式';
  const message = (error as { message?: string })?.message;
  return message || '未知原因';
}

/**
 * 这个失败值不值得让用户点「再试一次」。
 *
 * `NotFoundError` 是唯一不可重试的一种：设备根本没装或没插，重试还是同样的结果。
 * 它属于常态而不是故障，所以界面上走「状态说明」那条路（见 SettingsModal 的电表行），
 * 不占用错误块那个带按钮的位置。
 */
export function isRetriable(error: unknown): boolean {
  return (error as { name?: string })?.name !== 'NotFoundError';
}

/**
 * 没有虚拟声卡时的那句状态说明。
 *
 * 一次说完四件事：现在是什么状态、缺什么、还能用什么、补齐之后怎么让它生效。
 * 不能只说「没接上」——那会让用户以为外部音乐整个不可用，而歌名、封面明明都
 * 来自系统媒体会话，与声卡无关。
 *
 * 最后那半句是必须的：这个场景没有「再试一次」按钮（见 `isRetriable`），
 * 不说清楚怎么重连，用户装完声卡就只能对着这句说明发呆。注意措辞是「关掉再
 * 打开这个开关」而不是「按再试一次」——那个按钮在这里不存在。
 */
export const noCableHint = '没接上虚拟声卡（要装 VB-Cable）。只有歌名，环境音不会自动避让；装好之后关掉再打开这个开关。';
