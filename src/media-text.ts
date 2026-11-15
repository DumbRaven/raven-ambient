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

/**
 * 文件所在的目录名。票根上「FROM」那一行印的就是它：这份素材从哪个相册来。
 *
 * 壁纸库的条目调用方应该优先传 `source`（作品目录），普通文件传 `path`。
 * 只取倒数第二段：最后一段是文件名，再往上拼整条路径票根里放不下。
 */
export function folderOf(path: string) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}
