#!/usr/bin/env python3
"""Phase 0 辅助：把 svg_final/ 里的 SVG 字体栈补上 macOS 实际能用的 CJK 字体，
然后用 cairosvg 重新出 .phase0_preview/ 下的 PNG。

为什么需要：
  ppt-master 的 Executor 默认把标题字体写成 "SimHei, Microsoft YaHei, Arial, sans-serif"。
  SimHei/Microsoft YaHei 是 Windows 字体，macOS 上 fontconfig 给的 fallback 没有 CJK 字形，
  渲染出来就是 "豆腐块"。直接 cairocffi 验证过 STHeiti、PingFang SC 在本机可用，
  所以在字体栈前面加这俩（保留 Windows 字体不破坏 PPTX 兼容性）。

用法：python3 phase0/fix_preview_fonts.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROJECT_DIR = PROJECT_ROOT / "ppt-master" / "projects" / "phase0_demo_ppt169_20260619"
SVG_FINAL = PROJECT_DIR / "svg_final"
PREVIEW_DIR = PROJECT_ROOT / ".phase0_preview"

# 跨平台 CJK 字体栈（按可用性从高到低）：
#   1. PingFang SC    — 现代 macOS (10.11+) 默认简体
#   2. STHeiti        — 老 macOS 默认简体
#   3. Hiragino Sans GB — 旧 macOS 备选
#   4. Microsoft YaHei / SimHei — Windows
#   5. sans-serif     — 兜底（很多渲染器不补 CJK）
CJK_FONT_STACK = "PingFang SC, STHeiti, Hiragino Sans GB, Microsoft YaHei, SimHei"

# 匹配 font-family="..." 或 font-family='...' 整个属性的 pattern。
# 值内部可能含 &quot; / &apos; 实体，宽松一点：把 [^\s>] 之外的合法属性边界当分隔。
FONT_ATTR_RE = re.compile(r"""font-family=(?:"([^"]+)"|'([^']+)')""")

# 已经被打过补丁（"PingFang SC" 在最前）的字体栈标识
PATCHED_MARKER = "PingFang SC, STHeiti"


def _has_cjk_font(value: str) -> bool:
    """判断字体栈里是否已经有可用的 CJK 字体（避免重复补丁）。"""
    for keep in ("PingFang SC", "STHeiti", "Hiragino Sans GB", "WenQuanYi"):
        if keep in value:
            return True
    return False


def patch_svg_fonts(svg_path: Path) -> bool:
    """把 svg 文件里所有 font-family 属性的值前面塞上 CJK 字体栈。
    支持双引号和单引号（根 <svg> 常用单引号）。返回是否做了修改。"""
    text = svg_path.read_text(encoding="utf-8")
    original = text

    def repl(m: re.Match) -> str:
        existing = (m.group(1) or m.group(2)).strip()
        # 只检查我加的前缀 marker，不查任意 CJK 字体名
        # —— 否则根 <svg font-family="...PingFang SC..."> 会因为"已经有 PingFang SC"被跳过
        if PATCHED_MARKER in existing:
            return m.group(0)
        # 保持原引号风格
        quote = '"' if m.group(1) is not None else "'"
        return f"font-family={quote}{CJK_FONT_STACK}, {existing}{quote}"

    text = FONT_ATTR_RE.sub(repl, text)
    if text != original:
        svg_path.write_text(text, encoding="utf-8")
        return True
    return False


def render_preview(svg_path: Path, out_path: Path) -> None:
    """用 cairosvg 把 svg 渲染成 1280×720 PNG（viewBox 自然尺寸）。"""
    import cairosvg  # 延迟 import：脚本可以 dry-run 不装 cairosvg
    cairosvg.svg2png(url=str(svg_path), write_to=str(out_path),
                     output_width=1280, output_height=720)


def main() -> int:
    if not SVG_FINAL.exists():
        print(f"✗ 找不到 {SVG_FINAL}", file=sys.stderr)
        return 1
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    svgs = sorted(SVG_FINAL.glob("*.svg"))
    if not svgs:
        print(f"✗ {SVG_FINAL} 下没有 svg", file=sys.stderr)
        return 1

    for svg in svgs:
        patched = patch_svg_fonts(svg)
        out = PREVIEW_DIR / (svg.stem + ".png")
        render_preview(svg, out)
        flag = "patched" if patched else "kept   "
        print(f"  {flag}  {svg.name:30s} → {out.name}")

    print(f"\n✅ 重新生成 {len(svgs)} 张预览到 {PREVIEW_DIR}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
