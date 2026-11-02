<div align="center">

# C3 安全员刷题 · 后端 + 管理后台

建筑施工企业综合类专职安全生产管理人员(C3)考试刷题工具
**18 个题库 · 6880 道题** · 手机/电脑都能刷 · 带后台管理

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR_USER/c3-quiz-server)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button.svg)](https://deploy.workers.cloudflare.com/?worker=https://github.com/YOUR_USER/c3-quiz-server)

</div>

---

## 一键部署

### 方式 ① Render(推荐,免费)

1. 点上面的 **Deploy to Render** 按钮,或访问 [render.com](https://render.com)
2. 用 **GitHub 账号**登录
3. 填这些设置:

| 设置 | 值 |
|---|---|
| Build Command | `echo ok` |
| Start Command | `node server.js` |
| Health Check Path | `/api/health` |

4. 点 **Create Web Service**
5. 部署完会给你一个 `https://xxx.onrender.com` 网址

> ⚠️ 免费版**15 分钟无访问就休眠**,有人访问会自动唤醒(第一次要等 30-50 秒)。

6. **设置管理员密码**(重要!):
   Render 后台 → Environment → 加两个变量:
   ```
   ADMIN_USER = 你的管理员用户名
   ADMIN_PASS = 你的管理员密码
   ```
   设完点 **Save & Deploy**。

### 方式 ② Cloudflare Workers(更快的国内访问)

需要 Cloudflare 账号(免费)。`wrangler.toml` 已配好。

### 方式 ③ 自己的服务器

```bash
git clone https://github.com/YOUR_USER/c3-quiz-server.git
cd c3-quiz-server
ADMIN_USER=admin ADMIN_PASS=你的密码 node server.js
```

---

## 接口

### 公开

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/sets` | 题库索引(2.1 KB,手机省流量) |
| `GET /api/questions/:bank?page&size&shuffle` | 分页取题 |
| `GET /api/questions/:bank/random?count` | 随机组卷 |

### 需登录

| 接口 | 说明 |
|---|---|
| `POST /api/auth/register` | 注册 |
| `POST /api/auth/login` | 登录 → 返回 token |
| `POST /api/auth/logout` | 登出 |
| `GET /api/auth/me` | 当前用户 |
| `GET /api/progress` | 读自己的进度 |
| `POST /api/progress` | 存自己的进度 |

### 需管理员

| 接口 | 说明 |
|---|---|
| `GET /api/admin/users` | 用户列表 + 刷题进度 |
| `GET /api/admin/stats` | 汇总统计 |
| `GET /api/admin/user/:username` | 用户详情(含错题) |
| `POST /api/admin/user/active` | 禁用/启用 |
| `POST /api/admin/user/role` | 设管理员/降级 |
| `POST /api/admin/user/reset-password` | 重置密码 |
| `POST /api/admin/user/delete` | 删除用户 |

---

## 安全

| 项 | 实现 |
|---|---|
| 密码 | scrypt(N=16384) + 32B 随机 salt,不存明文 |
| 密码比对 | `timingSafeEqual` 恒定时间 |
| Token | 32B 随机,DB 里只存 sha256 |
| 会话 | 30 天过期,每小时清理 |
| 越权 | 每个 admin 接口校验 role |
| 进度隔离 | uid 强制取登录用户名,伪造无效 |
| 目录穿越 | uid 过滤 + 路径 normalize + 前缀校验 |
| 原子写 | 先写 `.tmp` 再 rename |

---

## 开发

```bash
cd server
node server.js          # http://127.0.0.1:8787
```

测试:
```bash
cd test
node test-e2e.js       # 桌面版 23 项
node test-web.js       # 移动版 12 项
node test-auth.js      # auth/admin API 40+ 断言
node test-admin-ui.js  # 后台 UI
```

---

## 目录结构

```
.
├── server/
│   ├── server.js         # 主服务(零依赖)
│   ├── auth.js           # 用户/会话/密码
│   ├── data/             # 题库(18 个 JSON)
│   ├── web/              # 前端(index.html / admin.html)
│   ├── Dockerfile
│   ├── render.yaml
│   └── .github/workflows/deploy.yml
├── test/                 # 测试套件
├── start_public.py       # 免服务器公网启动器
└── README.md
```

---

题库来源:[linbenyi/Construction-Safety-Officer](https://github.com/linbenyi/Construction-Safety-Officer)
