#!/usr/bin/env bash
# 后台启动 fastfood-bom 前后端,脱离当前终端会话(窗口关了也继续跑)
# 用法: ./run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$ROOT/.run"
mkdir -p "$RUN"

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-5173}"

# 若端口已被占用,先提示(避免重复起)
for p in "$API_PORT" "$WEB_PORT"; do
  if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "⚠️  端口 $p 已被占用,可能已在运行。先执行 ./stop.sh 再启动。"
    exit 1
  fi
done

# setsid 在 macOS 无此命令,用 perl 调 setsid(2) 让进程成为新会话首进程,彻底脱离终端
# 后端:node index.js(稳定长跑)
( cd "$ROOT/server" && PORT="$API_PORT" nohup perl -MPOSIX=setsid -e 'setsid; exec(@ARGV)' npm start </dev/null > "$RUN/api.log" 2>&1 & echo $! > "$RUN/api.pid" )

# 前端:vite dev
( cd "$ROOT/web" && nohup perl -MPOSIX=setsid -e 'setsid; exec(@ARGV)' npm run dev </dev/null > "$RUN/web.log" 2>&1 & echo $! > "$RUN/web.pid" )

sleep 2
echo "✅ 已后台启动"
echo "   后端  http://localhost:$API_PORT   (pid $(cat "$RUN/api.pid"), 日志 $RUN/api.log)"
echo "   前端  http://localhost:$WEB_PORT   (pid $(cat "$RUN/web.pid"), 日志 $RUN/web.log)"
echo "   停止: ./stop.sh    看日志: tail -f $RUN/api.log"
