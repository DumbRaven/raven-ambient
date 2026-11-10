// 相集页上那几处文字：标题与体积。
//
// 单独一个文件，是因为播放台的控制条和票根都要用同一份 ——
// 两边各抄一遍，改了一处另一处就会慢慢对不上。
// 这里不 import React，纯字符串，可以直接跑测试。

/** 文件名去掉扩展名，当标题用。壁纸库的条目标题本来就没有扩展名。 */
export function stem(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 摆出来给人看的标题：普通文件去扩展名，壁纸条目用作品名。 */
export function titleOf(item: { source?: string; name: string }) {
  return item.source ? item.name : stem(item.name);
}

export function sizeOf(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
