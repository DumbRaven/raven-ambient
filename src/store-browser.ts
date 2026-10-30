/**
 * 浏览器 / Electron 的存储实现：文本走 localStorage，资产走 IndexedDB。
 *
 * 这是所有平台里最"零依赖"的一套，也是现在的默认值。
 * 移动端如果 WebView 存储不可靠，可以换成原生驱动，接口一样。
 */

export type StoreDriver = {
  /** 驱动名，只用于排查问题。 */
  name: string;
  getText(key: string): string | null;
  setText(key: string, value: string): void;
  removeText(key: string): void;
  readBlob(key: string): Promise<Blob | undefined>;
  /** 不传 value 表示删除。 */
  writeBlob(key: string, value?: Blob): Promise<void>;
  /**
   * 可选：列出所有资产 key。
   * 只有「清理缓存」用得上——要删掉不再被引用的图，就得先知道库里都有什么。
   * 驱动不实现时返回空数组，清理功能会安静地什么都不做，而不是报错。
   */
  listKeys?(): Promise<string[]>;
  /**
   * 可选：把文本快照镜像到更持久的地方。
   * 移动端 WebView 的 localStorage 在系统存储紧张时可能被清掉，
   * 原生驱动可以在这里把副本写进文件系统，下次启动再从镜像恢复。
   */
  mirrorText?(key: string, value: string): Promise<void>;
};

const DB_NAME = 'raven-ambient';
const DB_STORE = 'assets';
let connection: Promise<IDBDatabase> | undefined;

function db() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      // 老版本可能已经建过这个 store，重复创建会抛错。
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { connection = undefined; reject(req.error); };
  });
}

export const browserDriver: StoreDriver = {
  name: 'browser',

  getText(key) {
    return localStorage.getItem(key);
  },

  setText(key, value) {
    localStorage.setItem(key, value);
  },

  removeText(key) {
    localStorage.removeItem(key);
  },

  async readBlob(key) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const req = database.transaction(DB_STORE).objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
  },

  async listKeys() {
    const database = await db();
    return new Promise<string[]>((resolve, reject) => {
      const req = database.transaction(DB_STORE).objectStore(DB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result.filter((key): key is string => typeof key === 'string'));
      req.onerror = () => reject(req.error);
    });
  },

  async writeBlob(key, value) {
    const database = await db();
    return new Promise<void>((resolve, reject) => {
      const tx = database.transaction(DB_STORE, 'readwrite');
      if (value) tx.objectStore(DB_STORE).put(value, key);
      else tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('保存被中断'));
    });
  },
};
