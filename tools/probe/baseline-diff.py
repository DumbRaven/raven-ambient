"""比对两次视觉基线截图，定位「哪里变了、变了多少」。

为什么需要它：`tsc` 和那 342 个单元测试都看不见视觉回归。把 25921 字符的 CSS 单行
拆开、把 176 处 `.template-collage` 重排，任何一处特异性算错，屏幕上的结果就是
「差 2px 的阴影」或「断点下少了一行留白」——只有像素能说出来。

用法：
    python tools/probe/baseline-diff.py                       # 比 .qa/baseline 与 .qa/current
    python tools/probe/baseline-diff.py --tolerance 2         # 允许每通道 ±2 的误差
    python tools/probe/baseline-diff.py --ref A --cur B       # 显式指定两个目录

退出码：0 = 全部一致（或在容差内）；1 = 有差异；2 = 无法比对（缺文件、尺寸不符）。

设计上的两个取舍：

1. **尺寸不符是硬错误，不算「全部像素不同」**。截图尺寸变化只有一种可能：DPR、
   窗口尺寸或 `force-device-scale-factor` 出了问题。这时候报告「680x980 变成了
   1020x1470」比报告「68 万个像素不同」有用得多，也能立刻指出是标尺坏了而不是
   样式坏了。

2. **差异按区块聚簇报告，不给整张 bbox**。一次 CSS 重构通常会同时动好几处，
   整张图的 bbox 会覆盖大半个屏幕、等于没说。16px 网格切块后合并相邻块，
   就能给出「三处改动，分别在左上、中部、底部」这种可操作的结论。
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Windows 控制台默认是 GBK，遇到 ✓/✗ 这类符号会直接抛 UnicodeEncodeError
# 把整个比对挂掉。输出编码在这里钉死，脚本在任何终端里都该能把结论说出来。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# 差异区块的报告上限。超过这个数量通常是「整个布局塌了」，具体数字意义不大。
MAX_CLUSTERS = 8

# 聚簇用的网格边长（像素）。16 足够把「同一条边框上的一段」并成一块，
# 又不会把相邻的两个元素糊成一团。
GRID = 16


def load_manifest(root: Path, required: bool = True):
    """读目录里的 manifest.json。基线必须有，当前这侧可以没有。

    为什么当前这侧允许没有：最常见的用法是「重构前存一版，重构后再拍一版」，
    而人可能只把 PNG 拷出来、没带 manifest。这时按基线自己的文件清单去配对，
    仍然能比——少的信息只有 DPR，而那由基线一侧说了算。
    """
    path = root / "manifest.json"
    if not path.exists():
        if required:
            raise SystemExit(f"[diff] 找不到 {path}，先跑 baseline.cjs 生成基线")
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def clusters_of(mask: np.ndarray):
    """把差异掩码按 GRID 网格聚成区块，返回 [(x0,y0,x1,y1,像素数), ...]。"""
    h, w = mask.shape
    gh, gw = (h + GRID - 1) // GRID, (w + GRID - 1) // GRID
    # 每格先统计差异像素数（pad 到网格整数倍，避免 reshape 报错）。
    padded = np.zeros((gh * GRID, gw * GRID), dtype=np.uint8)
    padded[:h, :w] = mask
    grid = padded.reshape(gh, GRID, gw, GRID).sum(axis=(1, 3))

    hot = grid > 0
    seen = np.zeros_like(hot, dtype=bool)
    found = []

    for gy in range(gh):
        for gx in range(gw):
            if not hot[gy, gx] or seen[gy, gx]:
                continue
            # 四邻域泛洪，把相邻的热格并成一块。
            stack = [(gy, gx)]
            seen[gy, gx] = True
            cells = []
            while stack:
                cy, cx = stack.pop()
                cells.append((cy, cx))
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < gh and 0 <= nx < gw and hot[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))

            ys = [c[0] for c in cells]
            xs = [c[1] for c in cells]
            x0, y0 = min(xs) * GRID, min(ys) * GRID
            x1 = min(w, (max(xs) + 1) * GRID)
            y1 = min(h, (max(ys) + 1) * GRID)
            count = int(sum(grid[c] for c in cells))
            found.append((x0, y0, x1, y1, count))

    found.sort(key=lambda c: c[4], reverse=True)
    return found[:MAX_CLUSTERS]


def compare_one(ref_path: Path, cur_path: Path, tolerance: int, out_dir: Path, label: str):
    """比一张图。返回 (状态字符串, 是否通过)。"""
    ref_img = Image.open(ref_path).convert("RGB")
    cur_img = Image.open(cur_path).convert("RGB")

    if ref_img.size != cur_img.size:
        return (
            f"尺寸不符  基线 {ref_img.size[0]}x{ref_img.size[1]} → 当前 "
            f"{cur_img.size[0]}x{cur_img.size[1]}（标尺本身出了问题，先查 DPR/窗口尺寸）",
            False,
        )

    a = np.asarray(ref_img, dtype=np.int16)
    b = np.asarray(cur_img, dtype=np.int16)
    delta = np.abs(a - b)

    if tolerance <= 0:
        mask = delta.max(axis=2) > 0
    else:
        mask = delta.max(axis=2) > tolerance

    changed = int(mask.sum())
    total = mask.size

    if changed == 0:
        return f"一致      {total} 像素", True

    max_delta = int(delta.max())
    found = clusters_of(mask)

    # 差异图：原图上把不同的像素染成品红，其余压成浅灰，方便一眼看到位置。
    base = np.asarray(cur_img, dtype=np.float32)
    gray = (base.mean(axis=2, keepdims=True) * 0.35 + 255 * 0.65).astype(np.uint8)
    gray = np.repeat(gray, 3, axis=2)
    gray[mask] = (255, 0, 160)

    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(gray).save(out_dir / f"{label}.png")

    lines = [
        f"有差异    {changed}/{total} 像素（{changed / total * 100:.3f}%），最大通道差 {max_delta}",
        f"          差异图 → {out_dir / (label + '.png')}",
    ]
    for x0, y0, x1, y1, n in found:
        lines.append(f"            区块 ({x0},{y0})-({x1},{y1})  {n} 像素")
    return "\n".join(lines), False


def main():
    here = Path(__file__).resolve().parent.parent.parent
    ap = argparse.ArgumentParser(description="比对视觉基线截图")
    ap.add_argument("--ref", default=str(here / ".qa" / "baseline"), help="基线目录")
    ap.add_argument("--cur", default=str(here / ".qa" / "current"), help="当前目录")
    ap.add_argument("--out", default=str(here / ".qa" / "diff"), help="差异图输出目录")
    ap.add_argument("--tolerance", type=int, default=0, help="每通道允许的色阶差，默认 0（逐字节）")
    args = ap.parse_args()

    ref_root = Path(args.ref)
    cur_root = Path(args.cur)
    out_root = Path(args.out)

    if not cur_root.exists():
        raise SystemExit(f"[diff] 找不到 {cur_root}，先跑 baseline.cjs")

    ref_manifest = load_manifest(ref_root)
    cur_manifest = load_manifest(cur_root, required=False)

    dpr_ref = ref_manifest.get("dpr")
    dpr_cur = (cur_manifest or {}).get("dpr")
    if dpr_cur is not None and dpr_ref != dpr_cur:
        raise SystemExit(
            f"[diff] DPR 不一致：基线 {dpr_ref} / 当前 {dpr_cur}。"
            "两次截图必须由同一份 PROBE_DPR 生成，否则像素无从比对齐。"
        )

    # 文件清单以基线为准。当前这侧没有 manifest 时，按同样的 size/name 去磁盘上找。
    ref_files = {(f["size"], f["name"]): f for f in ref_manifest.get("files", [])}
    if cur_manifest:
        cur_files = {(f["size"], f["name"]): f for f in cur_manifest.get("files", [])}
        added = sorted(set(cur_files) - set(ref_files))
    else:
        cur_files = {
            key: {"file": str(cur_root / key[0] / f"{key[1]}.png")}
            for key in ref_files
            if (cur_root / key[0] / f"{key[1]}.png").exists()
        }
        added = []

    missing = sorted(set(ref_files) - set(cur_files))
    if missing:
        print(f"[diff] 当前缺少这些截图：{', '.join('/'.join(k) for k in missing)}")

    print(f"[diff] 基线 {ref_root}  →  当前 {cur_root}  （容差 {args.tolerance} 色阶）")
    print()

    failed = []
    for key in sorted(ref_files):
        if key not in cur_files:
            failed.append(key)
            continue
        size_id, name = key
        label = f"{size_id}/{name}"
        status, ok = compare_one(
            ref_root / size_id / f"{name}.png",
            cur_root / size_id / f"{name}.png",
            args.tolerance,
            out_root / size_id,
            name,
        )
        print(f"  {label:<24} {status}")
        if not ok:
            failed.append(key)

    print()
    if added:
        print(f"[diff] 当前多出这些截图（基线没有，无法判定）：{', '.join('/'.join(k) for k in added)}")

    if failed:
        print(f"[diff] ✗ {len(failed)} 张有差异")
        return 1

    print(f"[diff] ✓ 全部 {len(ref_files)} 张一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
