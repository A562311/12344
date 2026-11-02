"""
构建 Cloudflare Workers 的静态资源目录

public/ 需要包含:
  index.html, admin.html, admin.css, manifest.json, icon.svg  ← 前端
  sets_c3_2025.json                                       ← 题库索引
  data/questions_*.json                                   ← 18 个题库

题库只有一份(data/),构建时复制进 public/。
"""
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).parent
WEB = HERE / "web"
DATA = HERE / "data"
PUBLIC = HERE / "public"
SETS = HERE / "sets_c3_2025.json"


def main():
    if not WEB.exists():
        print(f"[!] 找不到 {WEB}")
        return 1

    # 清空 public(保留 .gitkeep)
    if PUBLIC.exists():
        for item in PUBLIC.iterdir():
            if item.name == ".gitkeep":
                continue
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
    else:
        PUBLIC.mkdir(parents=True)

    # 前端
    n = 0
    for f in WEB.iterdir():
        if f.is_file():
            shutil.copy2(f, PUBLIC / f.name)
            n += 1
    print(f"  前端文件 {n} 个")

    # 题库索引
    if SETS.exists():
        shutil.copy2(SETS, PUBLIC / SETS.name)
        print(f"  题库索引 {SETS.name}")

    # 题库数据
    out = PUBLIC / "data"
    out.mkdir(exist_ok=True)
    n = 0
    total = 0
    for f in sorted(DATA.glob("*.json")):
        shutil.copy2(f, out / f.name)
        n += 1
        try:
            with open(f, "r", encoding="utf-8") as fp:
                j = json.load(fp)
            cnt = len(j) if isinstance(j, list) else (
                len(j.get("questions", [])) if isinstance(j.get("questions"), list)
                else len(j)
            )
            total += cnt
        except Exception:
            pass
    print(f"  题库 {n} 个文件,共 {total} 题")

    size = sum(f.stat().st_size for f in PUBLIC.rglob("*") if f.is_file())
    print(f"  public/ 总大小 {size / 1024 / 1024:.1f} MB")
    print()
    print("  ✅ 构建完成,现在可以 wrangler deploy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
