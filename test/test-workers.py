"""Cloudflare Workers 部署的完整端到端测试"""
import json
import subprocess
import sys

U = "https://c3-quiz.694708034.workers.dev"
PASS, FAIL = 0, 0


def call(method, path, body=None, token=None):
    cmd = ["curl", "-sS", "-m", "40", "-w", "\\n__STATUS__%{http_code}"]
    cmd += ["-X", method]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    cmd += [U + path]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    if "__STATUS__" not in out:
        return 0, out, ""
    payload, _, status = out.rpartition("\n__STATUS__")
    try:
        return int(status.strip()), payload, ""
    except ValueError:
        return 0, payload, out


def ok(msg):
    global PASS
    print(f"  ✅ {msg}")
    PASS += 1


def bad(msg, extra=""):
    global FAIL
    print(f"  ❌ {msg} {extra}")
    FAIL += 1


def main():
    print("=" * 62)
    print("  Cloudflare Workers 端到端测试")
    print(f"  {U}")
    print("=" * 62)

    # 1. 公开端点
    print("\n=== 1. 公开端点 ===")
    for p in ["/api/health", "/", "/admin", "/api/sets", "/admin.css", "/manifest.json"]:
        s, body, _ = call("GET", p)
        if s == 200 and body:
            ok(f"{p} → {s} ({len(body)}B)")
        else:
            bad(f"{p} → {s}")

    # 2. 题库
    print("\n=== 2. 题库 ===")
    # 未登录取题必须 401
    s, body, _ = call("GET", "/api/questions/final?page=1&size=3")
    if s == 401:
        ok("未登录取题 → 401(必须登录才能刷题)")
    else:
        bad(f"未登录取题未被拦截 → {s}")

    s, body, _ = call("GET", "/api/questions/final/random?count=5")
    if s == 401:
        ok("未登录随机组卷 → 401")
    else:
        bad(f"未登录随机组卷未被拦截 → {s}")

    # 题库索引可以公开看(但不泄露题目)
    s, body, _ = call("GET", "/api/sets")
    idx = json.loads(body)
    banks = idx.get("sets", []) if isinstance(idx, dict) else idx
    total_q = idx.get("total", 0) if isinstance(idx, dict) else sum(b["count"] for b in banks)
    ok(f"题库索引 {len(banks)} 个,合计 {total_q} 题")

    # 登录后取题
    s, body, _ = call(
        "POST", "/api/auth/login", {"username": "admin", "password": "C3@Quiz2026"}
    )
    adm_tok = json.loads(body).get("token") if s == 200 else None
    s, body, _ = call("GET", "/api/questions/final?page=1&size=3", token=adm_tok)
    try:
        d = json.loads(body)
        if s == 200 and d.get("total") == 994 and len(d.get("items", [])) == 3:
            q = d["items"][0]
            has_av = bool(q.get("av"))
            ok(f"登录后取题正常 total=994,首题有题干+解析={has_av}")
        else:
            bad("取题异常", str(d)[:120])
    except Exception as e:
        bad("取题 JSON 解析失败", str(e))

    s, body, _ = call("GET", "/api/questions/sd_c/random?count=5", token=adm_tok)
    try:
        d = json.loads(body)
        if s == 200 and len(d.get("items", [])) == 5:
            ok("登录后随机组卷 5 题正常")
        else:
            bad("随机组卷异常", str(d)[:100])
    except Exception as e:
        bad("随机组卷失败", str(e))

    # 3. 注册
    print("\n=== 3. 注册 ===")
    import time
    uname = f"test_{int(time.time()) % 100000}"
    s, body, _ = call(
        "POST",
        "/api/auth/register",
        {"username": uname, "password": "pass123456", "name": "测试工"},
    )
    if s == 200 and json.loads(body).get("ok"):
        ok(f"注册成功 ({uname})")
    else:
        bad("注册失败", f"{s} {body[:120]}")

    # 重复注册
    s, body, _ = call(
        "POST",
        "/api/auth/register",
        {"username": uname, "password": "pass123456", "name": "dup"},
    )
    if s == 400 and "已存在" in body:
        ok("重复注册被拒")
    else:
        bad("重复注册未拦截", f"{s} {body[:80]}")

    # 弱密码
    s, body, _ = call(
        "POST", "/api/auth/register", {"username": "weakpwd", "password": "123"}
    )
    if s == 400:
        ok("弱密码被拒")
    else:
        bad("弱密码未拦截", f"{s}")

    # 4. 登录
    print("\n=== 4. 登录 ===")
    s, body, _ = call(
        "POST", "/api/auth/login", {"username": uname, "password": "pass123456"}
    )
    token = json.loads(body).get("token") if s == 200 else None
    if token:
        ok("登录成功,拿到 token")
    else:
        bad("登录失败", f"{s} {body[:120]}")
        print("\n无法继续")
        return

    # 错密码
    s, body, _ = call(
        "POST", "/api/auth/login", {"username": uname, "password": "wrongpass"}
    )
    if s == 401:
        ok("错误密码被拒")
    else:
        bad("错误密码未拦截", f"{s}")

    # 4b. 先拿 admin token(第 5 段要用)
    atoken = None
    s, body, _ = call(
        "POST", "/api/auth/login", {"username": "admin", "password": "C3@Quiz2026"}
    )
    if s == 200:
        atoken = json.loads(body).get("token")

    # 5. 进度
    print("\n=== 5. 进度(按用户隔离)===")
    s, body, _ = call(
        "POST",
        "/api/progress",
        {"stats": {"answered": 200, "correct": 168, "sessions": 9}, "wrong": {"q1": 2, "q2": 1}},
        token=token,
    )
    if s == 200:
        ok("上报进度")
    else:
        bad("上报进度失败", f"{s} {body[:100]}")

    s, body, _ = call("GET", "/api/progress", token=token)
    d = json.loads(body)
    if d.get("stats", {}).get("answered") == 200:
        ok("读回进度 answered=200")
    else:
        bad("读回进度异常", str(d)[:120])

    # 伪造 uid —— 登录用户应被强制用自己的用户名
    # 上报时带别人的 uid + stats,验证:自己的 stats 变了(正常上报),
    # 但别人的进度文件没被创建
    other = "someone_else_should_not_exist"
    s, body, _ = call(
        "POST",
        "/api/progress",
        {"uid": other, "stats": {"answered": 7777}},
        token=token,
    )
    s2, body2, _ = call("GET", "/api/progress", token=token)
    d2 = json.loads(body2)
    if d2.get("stats", {}).get("answered") == 7777:
        ok("登录用户上报落到自己名下")
    else:
        bad("自己的进度没更新", str(d2.get("stats")))

    # 用 admin 查:别人的进度不该存在
    if atoken:
        s3, body3, _ = call("GET", f"/api/admin/user/{other}", token=atoken)
        if s3 == 404:
            ok("伪造 uid 未污染他人进度(404 用户不存在)")
        else:
            bad("伪造 uid 污染了他人!", f"{s3} {body3[:100]}")

    # 6. me
    print("\n=== 6. 当前用户 ===")
    s, body, _ = call("GET", "/api/auth/me", token=token)
    if s == 200 and json.loads(body).get("user", {}).get("username") == uname:
        ok("/api/auth/me 正确")
    else:
        bad("/api/auth/me 异常", f"{s} {body[:100]}")

    # 7. 越权
    print("\n=== 7. 越权防护 ===")
    for ep in ["/api/admin/stats", "/api/admin/users"]:
        s, body, _ = call("GET", ep, token=token)
        if s == 403:
            ok(f"普通用户访问 {ep} → 403")
        else:
            bad(f"普通用户访问 {ep} → {s}(应 403)")

    # 无 token
    s, body, _ = call("GET", "/api/admin/stats")
    if s == 401:
        ok("无 token 访问 admin → 401")
    else:
        bad(f"无 token 访问 admin → {s}")

    # 8. 管理员
    print("\n=== 8. 管理员后台 ===")
    if not atoken:
        for pw in ["admin123", "admin", "123456"]:
            s, body, _ = call(
                "POST", "/api/auth/login", {"username": "admin", "password": pw}
            )
            if s == 200:
                atoken = json.loads(body).get("token")
                ok(f"admin 用密码 {pw} 登录成功")
                break
    else:
        ok("admin 登录成功")
    if atoken:
        s, body, _ = call("GET", "/api/admin/stats", token=atoken)
        try:
            d = json.loads(body)
            rows = d.get("rows", [])
            ok(f"后台统计 {len(rows)} 个用户,合计答题 {d['summary']['totalAnswered']}")
            for r in rows[:4]:
                print(f"       {r['name']:10s} @{r['username']:16s} "
                      f"答题{r['answered']:5d} 正确率{r['accuracy']}%" if isinstance(r.get("accuracy"), int)
                      else f"       {r['name']:10s} @{r['username']:16s} 答题{r['answered']}")
        except Exception as e:
            bad("后台统计解析失败", str(e))

        # 用户详情
        s, body, _ = call("GET", f"/api/admin/user/{uname}", token=atoken)
        if s == 200:
            d = json.loads(body)
            ok(f"用户详情: 错题 {len(d.get('wrong', {}))} 条")
        else:
            bad("用户详情失败", f"{s} {body[:100]}")

    # 9. 登出
    print("\n=== 9. 登出 ===")
    s, body, _ = call("POST", "/api/auth/logout", token=token)
    if s == 200:
        ok("登出成功")
    else:
        bad("登出失败", f"{s}")
    s, body, _ = call("GET", "/api/auth/me", token=token)
    if s == 401:
        ok("登出后 token 失效")
    else:
        bad(f"登出后 token 仍有效 → {s}")

    print()
    print("=" * 62)
    print(f"  {'✅ 全部通过' if FAIL == 0 else '❌ 有失败'}  ({PASS} 项通过, {FAIL} 项失败)")
    print("=" * 62)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
