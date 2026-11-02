"""
推送到 GitHub —— 需要你的 GitHub 用户名和 PAT
用法:
    python push_to_github.py <你的GitHub用户名> <仓库名>
例:
    python push_to_github.py zhangwei c3-quiz-server

会提示你输入 PAT(个人访问令牌),不会保存。
PAT 权限勾选: repo (读写所有仓库)
获取地址: https://github.com/settings/tokens
"""
import subprocess
import sys
import os
import getpass
from pathlib import Path

HERE = Path(__file__).parent
PROXY = os.environ.get("HTTPS_PROXY", "http://127.0.0.1:7897")


def run(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)


def main():
    if len(sys.argv) < 3:
        print("用法: python push_to_github.py <GitHub用户名> <仓库名>")
        print("例:  python push_to_github.py zhangwei c3-quiz-server")
        sys.exit(1)

    user = sys.argv[1]
    repo = sys.argv[2]
    url = f"https://github.com/{user}/{repo}.git"

    print("=" * 60)
    print("  推送到 GitHub")
    print("=" * 60)
    print()
    print(f"  用户名: {user}")
    print(f"  仓库:   {url}")
    print()
    print("  需要 PAT(个人访问令牌):")
    print("    https://github.com/settings/tokens")
    print("    勾选 'repo' 权限,有效期选 30 天或 90 天")
    print()
    print("  ⚠️ 令牌只用于这次推送,不会被保存")
    print()

    token = getpass.getpass("  请输入 PAT(粘贴后回车,不会显示): ").strip()
    if not token:
        print("  已取消")
        sys.exit(1)

    # 远程地址(带 token,仅本次)
    auth_url = f"https://{user}:{token}@github.com/{user}/{repo}.git"

    env = dict(os.environ)
    env["HTTPS_PROXY"] = PROXY
    env["HTTP_PROXY"] = PROXY
    env["GIT_TERMINAL_PROMPT"] = "0"

    print()
    print("  [1/3] 设置远程仓库...")
    r = run(f'git remote remove origin 2>nul & git remote add origin "{auth_url}"', cwd=str(HERE), env=env)
    if r.returncode != 0:
        print("      " + (r.stderr or r.stdout).strip()[:200])

    print("  [2/3] 推送代码...")
    r = subprocess.run(
        ["git", "push", "-u", "origin", "main"],
        cwd=str(HERE), env=env, capture_output=True, text=True
    )
    out = (r.stdout or "") + (r.stderr or "")
    print("      " + out.strip()[-300:])

    if r.returncode != 0:
        print()
        print("  ❌ 推送失败。常见原因:")
        print("     - PAT 错��或没勾 repo 权限")
        print("     - 仓库名不存在(先在 GitHub 网页建一个空仓库)")
        print("     - 代理不通")
        print()
        sys.exit(1)

    # 清掉带 token 的 remote
    run(f'git remote set-url origin "{url}"', cwd=str(HERE), env=env)

    print()
    print("  [3/3] ✅ 推送成功!")
    print()
    print("  下一步:")
    print(f"    1. 打开 https://github.com/{user}/{repo} 确认文件都在")
    print()
    print("    2. 部署到 Render(免费,推荐):")
    print(f"       https://render.com/deploy?repo=https://github.com/{user}/{repo}")
    print("       Build: echo ok   Start: node server.js   Health: /api/health")
    print()
    print("    3. 部署后设置管理员密码:")
    print("       Render 后台 → Environment → ADMIN_USER / ADMIN_PASS")
    print()
    print(f"    4. 装完后打开 https://<你的域名>.onrender.com/admin.html")
    print()


if __name__ == "__main__":
    main()
