"""
C3 刷题 - 公网隧道启动器(免账号)
用法: python start_public.py
- 自动启动本地 server
- 建立 SSH 隧道(serveo.net),拿到公网 URL
- URL 写入 public_url.txt
- Ctrl+C 停止
"""
import subprocess
import sys
import os
import re
import time
import signal
import threading
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SERVER_DIR = HERE / "server"
PORT = int(os.environ.get("PORT", "8787"))
SSH_HOST = os.environ.get("SSH_HOST", "serveo.net")
URL_RE = re.compile(r"https://([a-z0-9-]+(?:-[a-z0-9]+)*\.[a-z0-9.-]*serveo[a-z0-9.-]*\.(?:com|net))")

def start_server():
    print("[1/2] 启动本地服务...", flush=True)
    node = shutil_which("node")
    if not node:
        print("  [!] 未找到 node,请先安装 Node.js 18+")
        return None

    # 先检查端口是否已被占用 —— 避免误连到别人的实例
    if port_in_use(PORT):
        print(f"  [!] 端口 {PORT} 已被占用!")
        print("      可能是本工具已经在运行。")
        print("      方案A: 直接关掉那个窗口,然后重新双击本脚本")
        print("      方案B: 换个端口启动:")
        print(f"         set PORT=8899 && python start_public.py")
        return None

    p = subprocess.Popen(
        [node, "server.js"],
        cwd=str(SERVER_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        creationflags=0x08000000,
    )
    time.sleep(2)
    # 健康检查 —— 确认是自己的实例(校验 banks 字段)
    for _ in range(10):
        if p.poll() is not None:
            print("  [!] 本地服务进程已退出")
            return None
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/health")
            body = urllib.request.urlopen(req, timeout=3).read().decode()
            if '"ok":true' in body:
                print("  ✅ 本地服务就绪", flush=True)
                return p
        except Exception:
            time.sleep(1)
    print("  [!] 本地服务启动超时")
    try:
        p.kill()
    except Exception:
        pass
    return None


def port_in_use(port):
    """检查端口是否已被监听"""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except Exception:
        return False
    finally:
        s.close()


def shutil_which(name):
    import shutil
    return shutil.which(name)


def start_tunnel(retries=3):
    print("[2/2] 建立公网隧道(SSH,免账号)...", flush=True)
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=15",
        "-o", "ConnectTimeout=25",
        "-R", f"80:localhost:{PORT}",
        SSH_HOST,
    ]

    for attempt in range(1, retries + 1):
        if attempt > 1:
            print(f"  ...重试 {attempt}/{retries}(服务可能暂时不可用)", flush=True)
            time.sleep(3)
        p = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        # 后台线程读 stdout,主线程等 URL
        state = {"url": None, "dead": False}

        def reader(proc=p, st=state):
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    # 失败原因不打成成功样式
                    low = line.lower()
                    if "error" in low or "timeout" in low or "refused" in low or "failed" in low:
                        print("  " + line, flush=True)
                    else:
                        print("  " + line, flush=True)
                m = URL_RE.search(line)
                if m and not st["url"]:
                    st["url"] = m.group(0)
            st["dead"] = True

        t = threading.Thread(target=reader, daemon=True)
        t.start()

        # 等 URL(最多 40 秒)
        for _ in range(80):
            if state["url"]:
                return p, state["url"]
            if state["dead"]:
                break
            time.sleep(0.5)

        if p.poll() is None:
            p.kill()
        if state["url"]:
            return p, state["url"]

    return None, None


def main():
    print("=" * 64)
    print("  C3 刷题 · 公网启动器")
    print("=" * 64)
    print()
    srv = start_server()
    if not srv:
        return 1
    try:
        tun, url = start_tunnel()
        if not tun:
            print()
            print("  [!] 隧道服务暂时不可用(serveo.net 是公益服务,偶尔会断)")
            print("      几种办法:")
            print("      1. 等 1-2 分钟再双击本脚本")
            print("      2. 改用局域网模式: server\\启动局域网服务.bat")
            print("      3. 换个隧道服务: set SSH_HOST=localhost.run && python start_public.py")
            print("      4. 买台便宜云服务器(约 30 元/月),我可以帮你配")
            return 1
        if url:
            (HERE / "public_url.txt").write_text(url, encoding="utf-8")
            print()
            print("=" * 64)
            print("  公网地址已就绪!")
            print()
            print(f"    刷题页:  {url}/")
            print(f"    后台:    {url}/admin.html")
            print()
            print("  发给同事这个地址即可(手机浏览器直接打开)")
            print("  可'添加到主屏幕'当 App 用")
            print()
            print("  默认管理员: admin / admin123")
            print("=" * 64)
            print()
            print("  按 Ctrl+C 停止")
            print()
            try:
                tun.wait()
            except KeyboardInterrupt:
                pass
        else:
            print("  [!] 未获取到公网地址")
            tun.kill()
    finally:
        try:
            srv.kill()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已停止")
        sys.exit(0)
