import { browserDriver, type StoreDriver } from './store-browser.ts';

export type { StoreDriver };

/**
 * 存储层。业务代码只认这里的接口，不直接碰 localStorage / IndexedDB。
 *
 * 分两类数据，走两条路：
 * - 文本（唱片柜 JSON、番茄钟偏好）：小、要同步读写，因为 React 状态更新链上不能等异步。
 * - 资产（音频、封面、背景图）：大，本来就是异步的。
 *
 * 移植到新平台时，在启动处调用 useStore() 换一个 driver 即可，其余代码不用动。
 * 默认是浏览器实现（localStorage + IndexedDB），Electron 用的也是这一套。
 */

let driver: StoreDriver | undefined;

/** 在应用启动、渲染之前调用。不调用则用浏览器实现。 */
export function useStore(next: StoreDriver) {
  driver = next;
}

function active(): StoreDriver {
  driver ??= browserDriver;
  return driver;
}

/** 驱动名，只用于排查问题。 */
export function storeName(): string {
  return active().name;
}

export function getText(key: string): string | null {
  return active().getText(key);
}

export function setText(key: string, value: string): void {
  const current = active();
  current.setText(key, value);
  // 镜像失败不该影响主流程：主存储已经写成功了。
  void current.mirrorText?.(key, value).catch(() => undefined);
}

export function removeText(key: string): void {
  active().removeText(key);
}

export function readAsset(key: string): Promise<Blob | undefined> {
  return active().readBlob(key);
}

export function storeAsset(key: string, value?: Blob): Promise<void> {
  return active().writeBlob(key, value);
}
