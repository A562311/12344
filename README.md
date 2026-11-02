<div align="center">

# C3 安全员刷题

建筑施工企业综合类专职安全生产管理人员(C3)考试刷题工具
**18 个题库 · 6880 道题** · 手机/电脑都能刷 · 带管理后台

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/A562311/12344)

</div>

---

## 一键部署(Render,免费)

点上面的按钮,或访问 [render.com](https://render.com):

1. 用 **GitHub 账号**登录
2. 选这个仓库
3. 点 **Create Web Service**

`render.yaml` 已经写好所有配置,一般不用改。

### ⚠️ 部署后必须设置管理员密码

Render 后台 → **Environment** → 加两个变量:

```
ADMIN_USER = 你想要的管理员用户名
ADMIN_PASS = 你的密码(至少 6 位)
```

点 **Save & Deploy**。管理员账号在首次启动时自动创建。

> 免费版 15 分钟无访问会休眠,有人访问自动唤醒(第一次要等 30-50 秒)。

---

## 三个入口

| 用途 | 地址 |
|---|---|
| 刷题页 | `https://<你的域名>.onrender.com/` |
| 管理后台 | `https://<你的域名>.onrender.com/admin.html` |
| 健康检查 | `https://<你的域名>.onrender.com/api/health` |

---

## 功能

### 刷题

- 18 个题库,共 6880 道题(含从山东省题库 PDF 解析的 1824 道)
- 三种模式:**即时** / **考试**(计时模拟)/ **看题**(自动翻页)
- 错题本、收藏、进度统计
- PWA —— 可"添加到主屏幕"当 App,全屏无地址栏
- 离线回退 —— 后端挂了自动用本地缓存,刷题不中断
- 手机省流量 —— 首屏只下 2.1KB 题库索引,分批取题

### 账号

- 自助注册(用户名 + 密码 + 姓名)
- 进度按用户隔离,换设备不丢
- 登录后进度自动同步到云端

### 管理后台

- 刷题进度看板:答题数、正确率、刷题次数、错题数、最后登录
- 汇总统计:总用户数、已登录人数、累计答题、平均正确率
- 用户详情:各题库刷题量 + 错题清单(题干、正确答案、错了几次)
- 用户管理:禁用/启用、重置密码、设为管理员/降级、删除
- 搜索过滤

---

## 接口

### 公开

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/sets` | 题库索引(2.1 KB) |
| `GET /api/questions/:bank?page&size&shuffle` | 分页取题 |
| `GET /api/questions/:bank/random?count` | 随机组卷 |

### 需登录

| 接口 | 说明 |
|---|---|
| `POST /api/auth/register` | 注册 |
| `POST /api/auth/login` | 登录 → 返回 token |
| `POST /api/auth/logout` | 登出 |
| `GET /api/auth/me` | 当前用户 |
| `GET /api/progress` | 读进度 |
| `POST /api/progress` | 存进度 |

### 需管理员

| 接口 | 说明 |
|---|---|
| `GET /api/admin/users` | 用户列表 + 进度 |
| `GET /api/admin/stats` | 汇总统计 |
| `GET /api/admin/user/:username` | 用户详情(含错题) |
| `POST /api/admin/user/active` | 禁用/启用 |
| `POST /api/admin/user/role` | 设管理员/降级 |
| `POST /api/admin/user/reset-password` | 重置密码 |
| `POST /api/admin/user/reset-progress` | 清空进度 |
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
| 静态资源 | ETag / 304 |

---

## 本地运行

```bash
node server.js          # http://127.0.0.1:8787
```

改管理员密码(首次启动前):
```bash
ADMIN_USER=admin ADMIN_PASS=你的密码 node server.js
```

---

## 目录结构

```
.
├── server.js            # 主服务(零依赖 Node)
├── auth.js              # 用户/会话/密码
├── store.js             # 存储适配层(Node fs / Cloudflare KV)
├── worker.js            # Cloudflare Workers 入口
├── data/                # 18 个题库 JSON (9.8MB)
├── web/                 # 前端(index.html / admin.html / admin.css)
├── Dockerfile           # 单容器部署
├── render.yaml          # Render 部署配置
├── wrangler.toml        # Cloudflare Workers 配置
├── .github/workflows/   # CI(题库校验 + 冒烟 + auth 流程 + Docker)
└── push_to_github.py    # 一键推送脚本
```

零运行时依赖 —— 只需要 Node.js 18+。

---

题库来源:[linbenyi/Construction-Safety-Officer](https://github.com/linbenyi/Construction-Safety-Officer)
(另含从山东省安全员考试 PDF 解析的 1824 道题)
