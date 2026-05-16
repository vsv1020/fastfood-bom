#!/usr/bin/env bash
# 部署 fastfood-bom 到 node-6 (43.239.84.26),域名 bom.dogevideo.tech
# 用法:
#   ./server/scripts/deploy.sh              # 完整流程(打包+上传+安装+nginx+SSL)
#   ./server/scripts/deploy.sh nopack       # 跳过打包(用现有 /tmp/fastfood-bom-deploy.tar.gz)
#   ./server/scripts/deploy.sh nopack noscp # 假定 tarball 已在 node-6 上,直接远程操作
#
# 前置:
#   1. 本机能 ssh root@43.239.84.26 (需要 ssh-copy-id 或预置 key)
#   2. bom.dogevideo.tech 的 DNS A 记录已指向 43.239.84.26
#      (在 dogevideo.tech 的 DNS provider 加一条 A 记录:
#        Name: bom    Type: A    Value: 43.239.84.26    TTL: 3600 )

set -euo pipefail

HOST=43.239.84.26
USER=root
APP_DIR=/opt/apps/fastfood-bom
DOMAIN=bom.dogevideo.tech
EMAIL=admin@dogevideo.tech   # certbot 注册邮箱

ssh_run() { ssh "${USER}@${HOST}" "$@"; }
scp_to()  { scp "$1" "${USER}@${HOST}:$2"; }

# 1. 打包
if [[ "${1:-}" != "nopack" ]]; then
  echo '== Pack =='
  cd "$(dirname "$0")/../.."
  (cd web && npm run build)
  tar -czf /tmp/fastfood-bom-deploy.tar.gz \
    --exclude='server/node_modules' \
    --exclude='server/data.sqlite*' \
    --exclude='web/node_modules' \
    --exclude='web/src' \
    --exclude='.git' \
    server web/dist
fi

# 2. 上传
if [[ "${2:-}" != "noscp" ]]; then
  echo '== Upload =='
  ssh_run "mkdir -p ${APP_DIR}"
  scp_to /tmp/fastfood-bom-deploy.tar.gz "${APP_DIR}/deploy.tar.gz"
fi

# 3. 远程安装 + 启动
echo '== Remote install =='
ssh_run "bash -s" <<REMOTE
set -euo pipefail
cd ${APP_DIR}
mkdir -p current && cd current
tar -xzf ../deploy.tar.gz

# 安装 server 依赖
cd server
npm install --omit=dev --silent
cd ..

# 写 .env (可选)
[ -f .env ] || cat > .env <<ENVEOF
PORT=3001
BOM_DB=${APP_DIR}/data.sqlite
ENVEOF

# pm2 (重启或新启)
export BOM_DB=${APP_DIR}/data.sqlite
export PORT=3001
if pm2 describe fastfood-bom > /dev/null 2>&1; then
  pm2 restart fastfood-bom --update-env
else
  cd server
  pm2 start index.js --name fastfood-bom --update-env
  cd ..
fi
pm2 save
REMOTE

# 4. nginx 配置 (含 SSL 由 certbot 后续添加)
echo '== Nginx config =='
ssh_run "cat > /etc/nginx/sites-available/fastfood-bom" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    root ${APP_DIR}/current/web/dist;
    index index.html;

    client_max_body_size 10M;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # cookie 中间件配合
        proxy_pass_request_headers on;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

ssh_run "ln -sf /etc/nginx/sites-available/fastfood-bom /etc/nginx/sites-enabled/fastfood-bom && nginx -t && systemctl reload nginx"

# 5. 申请 SSL (cert-bot)
echo '== Certbot (HTTPS) =='
ssh_run "certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${EMAIL} --redirect"

echo
echo '✅ Deploy complete. Visit:'
echo "   https://${DOMAIN}/"
echo
echo 'Access codes (10) — check server/data.sqlite settings.access_codes_json:'
echo '   Q36S3539  YYV5AQXQ  BKN75C3J  G56TJV95  48LAACNS'
echo '   2KZ7XK52  JXGXY3F3  KSCDZFUG  Y4WSJQ9C  W9X7AALE'
