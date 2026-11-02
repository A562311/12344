"""
推送到 GitHub —— 需要你的 GitHub 用户名 + PAT
用法:
    python push_to_github.py <GitHub用户名> <仓库名>
例:
    python push_to_github.py A562311 12344

PAT 获取: https://github.com/settings/tokens/new
  - Note: 随便填
  - Expiration: 90 days
  - Scopes: 勾选 repo
令牌只用于这一次推送,不会被保存到磁盘。
"""
import subprocess
import sys
import os
import getpass
from pathlib import Path

HERE = Path(__file__).parent
PROXY = os.environ.get("HTTPS_PROXY", "http://127.0.0.1:7897")


def sh(cmd, cwd=None, env=None):
    return subprocess.run(cmd, shell=True, cwd=cwd, env=env,
                          capture_output=True, text=True)


def main():
    if len(sys.argv) < 3:
        print("用法: python push_to_github.py <GitHub用户名> <仓库名>")
        print("例:  python push_to_github.py A562311 12344")
        sys.exit(1)

    user = sys.argv[1]
    repo = sys.argv[2]
    clean_url = f"https://github.com/{user}/{repo}.git"

    print("=" * 62)
    print("  推送到 GitHub")
    print("=" * 62)
    print()
    print(f"  仓库: {clean_url}")
    print()
    print("  需要 PAT(个人访问令牌):")
    print("    1. 打开 https://github.com/settings/tokens/new")
    print("    2. Note 随便填, Expiration 选 90 days")
    print("    3. Scopes 里勾选 repo")
    print("    4. 点 Generate token,复制 github_pat_... 那串")
    print()
    print("  ⚠️ 令牌只用于这次推送,不会保存到磁盘")
    print()

    token = getpass.getpass("  请粘贴 PAT(输入不回显,直接粘贴然后回车): ").strip()
    if not token:
        print("  已取消")
        sys.exit(1)

    auth_url = f"https://{user}:{token}@github.com/{user}/{repo}.git"

    env = dict(os.environ)
    env["HTTPS_PROXY"] = PROXY
    env["HTTP_PROXY"] = PROXY
    env["GIT_TERMINAL_PROMPT"] = "0"

    print()
    print("  [1/3] 设置远程地址...")
    sh('git remote remove origin 2>nul', cwd=str(HERE), env=env)
    r = sh(f'git remote add origin "{auth_url}"', cwd=str(HERE), env=env)
    if r.returncode != 0:
        print("      " + (r.stderr or r.stdout).strip()[:200])

    print("  [2/3] 推送代码(13MB,可能要 1-2 分钟)...")
    r = subprocess.run(
        ["git", "push", "-u", "origin", "main"],
        cwd=str(HERE), env=env, capture_output=True, text=True
    )
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    print("      " + out[-400:])

    # 无条件把 remote 还原成不含 token 的地址
    sh(f'git remote set-url origin "{clean_url}"', cwd=str(HERE), env=env)

    if r.returncode != 0:
        print()
        print("  ❌ 推送失败。常见原因:")
        print("     - PAT 错误 / 没勾 repo 权限")
        print("     - 仓库名不对(先在 GitHub 网页确认)")
        print("     - 代理不通(检查 7897 是否在监听)")
        print()
        print("  试完把报错发我,我来看。")
        sys.exit(1)

    print()
    print("  [3/3] ✅ 推送成功!")
    print()
    print("  下一步:")
    print(f"    1. 打开 {clean_url.replace('.git','')} 确认文件都在")
    print()
    print("    2. 部署到 Render(免费,推荐):")
    print(f"       https://render.com/deploy?repo=https://github.com/{user}/{repo}")
    print("       或 render.com → New → Web Service → 连仓库")
    print("       Build: echo ok | Start: node server.js | Health: /api/health")
    print()
    print("    3. 设置管理员密码(Render 后台 → Environment):")
    print("       ADMIN_USER = 你想要的管理员名")
    print("       ADMIN_PASS = 你的密码")
    print()
    print("    4. 装好后打开 https://<域名>.onrender.com/admin.html")
    print()


if __name__ == "__main__":
    main()
