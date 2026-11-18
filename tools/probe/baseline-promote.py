"""
把一次抓图结果提升为新基线，替换掉 `.qa/baseline` 里的图与 manifest。

为什么单独写一个脚本、而不是直接把 `PROBE_BASELINE_OUT=.qa/baseline`：
`baseline.cjs` 拍完才写 manifest，中途失败会在基线目录留下一半新一半旧，
而这个目录是唯一的参照物，混了之后所有后续对比都不可信。所以流程固定成
「先拍到临时目录 → 比对确认 → 再整体换过去」。

用法：
    python tools/probe/baseline-promote.py .qa/pix-a

换之前会把旧基线挪到 `.qa/baseline-prev-<时间戳>`，不删。基线目录体积
不大（28 张 PNG），留一份上一版总比丢了强。
"""
import json
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / '.qa' / 'baseline'


def main() -> int:
    if len(sys.argv) != 2:
        print('用法: baseline-promote.py <抓图输出目录>')
        return 2
    src = (ROOT / sys.argv[1]).resolve() if not Path(sys.argv[1]).is_absolute() else Path(sys.argv[1])
    if not src.is_dir():
        print(f'找不到目录: {src}')
        return 2

    manifest_path = src / 'manifest.json'
    if not manifest_path.is_file():
        print(f'{src} 里没有 manifest.json，这个目录不是完整的抓图结果')
        return 2

    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    # manifest 里字段名是 `files`（28 个条目，每条 {size, view, file}），
    # 不是 `shots`。数量对不上说明抓图中途断了，别把半份东西提成基线。
    expected = len(manifest.get('files', []) or [])
    if expected == 0:
        print('manifest 里没有 files 列表，拒绝提升（格式可能变了）')
        return 2

    pngs = sorted(p for p in src.rglob('*.png'))
    if len(pngs) != expected:
        print(f'图数量对不上：manifest 写 {expected}，实际 {len(pngs)}')
        return 2

    stamp = time.strftime('%Y%m%d-%H%M%S')
    keep = ROOT / '.qa' / f'baseline-prev-{stamp}'
    if BASELINE.is_dir():
        shutil.move(str(BASELINE), str(keep))
        print(f'旧基线已挪到 {keep.relative_to(ROOT)}')

    BASELINE.mkdir(parents=True, exist_ok=True)
    for entry in src.iterdir():
        if entry.is_dir():
            shutil.copytree(entry, BASELINE / entry.name)
        else:
            shutil.copy2(entry, BASELINE / entry.name)

    print(f'新基线已就位：{len(pngs)} 张，generatedAt={manifest.get("generatedAt")}')
    print(f'（旧的留在 {keep.relative_to(ROOT)}，确认没问题后可以删）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
