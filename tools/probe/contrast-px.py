"""对比度的像素级算账 —— 配合 tools/probe/contrast-px.cjs 使用。

为什么不在 Node 里算：项目约定不新增依赖，而 Node 侧没有 PNG 解码器。
这里用 PIL（本机 python 环境自带），把每个文字元素矩形里出现最多的颜色
当作它实际压着的底色，再拿计算出来的文字色算 WCAG 对比度。

为什么要像素级：tools/probe/contrast.cjs 走「从元素往上找第一个不透明祖先背景」，
而本项目的页签激活态黑胶囊是兄弟元素（.nav-marker / .flip-marker /
.template-marker，都是绝对定位的滑动指示条）画的，不在祖先链上。
那个探针于是量到页面底色 #f0efea，报出「白字 1.15:1」这种假阳性——
视觉上明明是黑底白字。像素不会骗人。

用法：
  env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe \
      tools/probe/contrast-px.cjs --no-sandbox
  <python> tools/probe/contrast-px.py
"""
import json
import os
import sys
from collections import Counter

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 PIL。用 DSH 自带的 python：C:/Users/DumbRaven/.dsh/dsh-runtimes/"
             "dsh-primary-runtime/dependencies/python/python.exe")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", ".qa", "contrast-px")

# WCAG 2.1 相对亮度
def _f(v):
    v /= 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * _f(r) + 0.7152 * _f(g) + 0.0722 * _f(b)


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def dominant(im, box, skip_text_band=True):
    """矩形内出现最多的颜色。

    直接取众数有时会取到文字自己（大字号时笔画占的面积很可观），
    所以先整体取一次；如果众数非常接近文字色，就只在矩形四条边的窄带里取——
    边带基本不会落在字上。两种都算不出来就返回 None。
    """
    x, y, w, h = box
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(im.width, x + w), min(im.height, y + h)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None

    def most(crop):
        counts = Counter(crop.getdata())
        if not counts:
            return None
        color, n = counts.most_common(1)[0]
        return color, n / (crop.width * crop.height)

    got = most(im.crop((x0, y0, x1, y1)))
    if got is None:
        return None

    if skip_text_band:
        band = max(1, min(3, (y1 - y0) // 8))
        strips = [
            im.crop((x0, y0, x1, min(y1, y0 + band))),
            im.crop((x0, max(y0, y1 - band), x1, y1)),
        ]
        merged = Counter()
        for s in strips:
            merged.update(s.getdata())
        if merged:
            edge, edge_n = merged.most_common(1)[0]
            total = sum(merged.values())
            # 边带众数与整体众数不一致时，优先信边带（它更接近「底色」）
            if edge != got[0] and edge_n / total > 0.4:
                return edge, edge_n / total
    return got


def main():
    elements_path = os.path.join(DATA, "elements.json")
    if not os.path.exists(elements_path):
        sys.exit("先跑 tools/probe/contrast-px.cjs 生成 elements.json")

    rows = json.load(open(elements_path, encoding="utf-8"))
    shots = {}
    out = []

    for it in rows:
        name = it["file"]
        if name not in shots:
            shots[name] = Image.open(os.path.join(DATA, name)).convert("RGB")
        im = shots[name]
        got = dominant(im, (it["x"], it["y"], it["w"], it["h"]))
        if got is None:
            continue
        bg, share = got
        fg = tuple(it["fg"])
        r = ratio(fg, bg)
        need = 3.0 if it["large"] else 4.5
        out.append({
            "view": it["view"],
            "el": it["el"],
            "text": it["text"],
            "px": it["px"],
            "weight": it["weight"],
            "fg": "#%02x%02x%02x" % fg,
            "bg": "#%02x%02x%02x" % bg,
            "bgShare": round(share, 2),
            "ratio": round(r, 2),
            "need": need,
            "fail": r + 0.02 < need,
            # 底色占比低 = 那块不是纯色底（照片/渐变/半透明叠加），结论打折
            "bgSuspect": share < 0.45,
        })

    out.sort(key=lambda x: x["ratio"])
    with open(os.path.join(DATA, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)

    fails = [x for x in out if x["fail"]]
    solid_fails = [x for x in fails if not x["bgSuspect"]]
    print("元素数 %d，不达标 %d（其中底色可信 %d）" % (len(out), len(fails), len(solid_fails)))
    for x in solid_fails[:40]:
        print("  %-6s %-24s %-12s %5.2f/%s  fg=%s bg=%s share=%.2f"
              % (x["view"], x["el"][:24], x["text"][:12], x["ratio"], x["need"],
                 x["fg"], x["bg"], x["bgShare"]))
    if len(solid_fails) > 40:
        print("  ... 还有 %d 条，见 report.json" % (len(solid_fails) - 40))


if __name__ == "__main__":
    main()
