"""
C3 刷题 · Cloudflare Pages 一键部署
===================================

为什么用 Pages 而不是 Workers:
  workers.dev 域名在���内被 DNS 污染 → 手机打不开
  pages.dev  域名正常        → 国内直连 200 ✅

用法:
  python deploy_pages.py              # 构建 + 部署
  python deploy_pages.py --build-only # 只构建
  python deploy_pages.py --status     # 看当前部署状态

需要环境变量:
  CLOUDFLARE_API_TOKEN   (CF API Token)
  CLOUDFLARE_ACCOUNT_ID  (CF Account ID)
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "deploy"          # 源码(前后端都在这)
OUT = HERE / "pages_build"     # 构建产物
PROJECT = "c3-quiz"
PAGES_DOMAIN = "c3-quiz-ceq.pages.dev"

TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")


def find_wrangler():
    """找 wrangler 可执行文件(Windows 上是 .cmd)"""
    import shutil
    p = shutil.which("wrangler")
    if p:
        return p
    # npm 全局目录
    try:
        r = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, timeout=30)
        root = r.stdout.strip()
        for cand in (Path(root) / "wrangler" / "bin" / "wrangler.js",):
            if cand.exists():
                return ["node", str(cand)]
    except Exception:
        pass
    # 常见位置
    for p in ["D:/node_global/wrangler.cmd", "C:/Program Files/nodejs/wrangler.cmd"]:
        if Path(p).exists():
            return p
    return None


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def build():
    """从 deploy/ 构建 Pages 目录"""
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    # 静态资源(前端 + 题库)
    for name in ("index.html", "admin.html", "admin.css", "manifest.json",
                 "icon.svg", "sets_c3_2025.json"):
        src = SRC / "web" / name
        if src.exists():
            shutil.copy2(src, OUT / name)

    # 题库
    data_out = OUT / "data"
    data_out.mkdir(exist_ok=True)
    total = 0
    for f in sorted((SRC / "data").glob("*.json")):
        shutil.copy2(f, data_out / f.name)
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            n = len(j) if isinstance(j, list) else (
                len(j.get("questions", [])) if isinstance(j.get("questions"), list) else len(j)
            )
            total += n
        except Exception:
            pass

    # Functions
    fn_src = HERE / "pages_functions" / "api" / "[[path]].js"
    fn_dst = OUT / "functions" / "api" / "[[path]].js"
    fn_dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(fn_src, fn_dst)

    # wrangler.toml
    shutil.copy2(HERE / "pages_build" / "wrangler.toml", OUT / "wrangler.toml") \
        if (HERE / "pages_build" / "wrangler.toml").exists() and \
        (HERE / "pages_build" / "wrangler.toml") != (OUT / "wrangler.toml") else None

    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    log(f"构建完成: {total} 题, {size / 1024 / 1024:.1f} MB")
    return total


def deploy():
    if not TOKEN or not ACCOUNT:
        log("[!] 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID")
        return 1

    env = dict(os.environ)
    wrangler = find_wrangler()
    if not wrangler:
        log("[!] 找不到 wrangler,先 npm i -g wrangler")
        return 1
    r = subprocess.run(
        [wrangler, "pages", "deploy", ".", f"--project-name={PROJECT}", "--branch=main"],
        cwd=str(OUT), env=env, capture_output=True, text=True, timeout=900,
    )
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    if r.returncode != 0:
        log("[x] 部署失败:")
        print(out[-1500:])
        return 1

    for line in out.split("\n"):
        if "pages.dev" in line or "Success" in line or "Deployment" in line:
            log(line.strip())

    # 拿正式地址
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        d = json.loads(op.open(req, timeout=30).read().decode())
        url = d["result"].get("canonical_deployment_url") or f"https://{PAGES_DOMAIN}"
        log(f"正式地址: {url}")
    except Exception:
        log(f"正式地址: https://{PAGES_DOMAIN}")

    return 0


def status():
    if not TOKEN or not ACCOUNT:
        print("缺少 token")
        return 1
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    d = json.loads(op.open(req, timeout=30).read().decode())
    r = d["result"]
    print(f"  项目: {r.get('name')}")
    print(f"  子域名: {r.get('subdomain')}")
    print(f"  正式地址: {r.get('canonical_deployment_url')}")
    prod = r.get("deployment_configs", {}).get("production", {})
    print(f"  KV 绑定: {list((prod.get('kv_namespaces') or {}).keys())}")
    print(f"  环境变量: {list((prod.get('env_vars') or {}).keys())}")
    return 0


def main():
    if "--status" in sys.argv:
        return status()
    if "--build-only" in sys.argv:
        build()
        return 0
    build()
    return deploy()


if __name__ == "__main__":
    sys.exit(main())
