export type QueueSlot = { top: number; height: number };

/**
 * 键盘挪一格：把「第几行」换成「挪到第几行」。
 *
 * 拖动那条路径靠像素位置算落点（`queueDropIndex`），键盘没有指针，
 * 直接按索引加减一格更贴切——用户按一次就是「往上/下一位」。
 * 越界时返回 `null` 而不是夹到边上：夹住会让「已经在第一位还按上」变成
 * 一次空的重排，白触发一次存档。
 */
export function nudgeQueueIndex(from: number, length: number, direction: -1 | 1): number | null {
  if (!Number.isInteger(from) || from < 0 || from >= length) return null;
  const to = from + direction;
  if (to < 0 || to >= length) return null;
  return to;
}

/** 所有坐标取自拖动开始时的布局，不读取正在过渡的行位置。 */
export function clampQueueOffset(slots: QueueSlot[], from: number, offset: number): number {
  if (!slots[from] || !Number.isFinite(offset)) return 0;
  const first = slots[0], last = slots[slots.length - 1], source = slots[from];
  const center = source.top + source.height / 2;
  return Math.max(first.top + first.height / 2 - center, Math.min(last.top + last.height / 2 - center, offset));
}

export function queueDropIndex(slots: QueueSlot[], from: number, offset: number): number {
  const source = slots[from];
  if (!source) return from;
  const center = source.top + source.height / 2 + clampQueueOffset(slots, from, offset);
  let to = from;
  if (offset > 0) {
    for (let index = from + 1; index < slots.length; index++) {
      if (center >= slots[index].top + slots[index].height / 2) to = index;
    }
  } else {
    for (let index = from - 1; index >= 0; index--) {
      if (center <= slots[index].top + slots[index].height / 2) to = index;
    }
  }
  return to;
}

/** 按预览顺序计算各行的新位置，支持不同行高；松手后 DOM 只需交换顺序。 */
export function queueOffsets(slots: QueueSlot[], from: number, to: number): number[] {
  const offsets = slots.map(() => 0);
  if (!slots[from] || !slots[to] || from === to) return offsets;
  const order = slots.map((_, index) => index);
  order.splice(to, 0, order.splice(from, 1)[0]);
  let top = slots[0].top;
  order.forEach((index, position) => {
    offsets[index] = top - slots[index].top;
    const gap = slots[position + 1] ? slots[position + 1].top - slots[position].top - slots[position].height : 0;
    top += slots[index].height + gap;
  });
  return offsets;
}
