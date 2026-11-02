# C3 Quiz - 单容器部署
# 支持 Render / Railway / Fly.io / 任意 Docker 主机
# 构建上下文 = 仓库根目录
FROM node:20-alpine

WORKDIR /app

# 题库数据(9.8MB)
COPY data/ ./data/
COPY sets_c3_2025.json ./

# 后端代码
COPY server.js ./
COPY auth.js ./
COPY store.js ./

# 前端 + 管理后台
COPY web/ ./web/

ENV PORT=8787
ENV HOST=0.0.0.0
ENV NODE_ENV=production
# 注意: ADMIN_USER / ADMIN_PASS 请在平台环境变量里设置,不要写在这里。
# 管理员账号在首次启动时自动创建。

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "server.js"]
