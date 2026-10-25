export type QueueSlot = { top: number; height: number };

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
