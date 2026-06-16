#!/usr/bin/env bash
# 停止 fastfood-bom 前后端
# 用法: ./stop.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$ROOT/.run"
API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-5173}"

# 优先按 setsid 进程组杀(pid 即 PGID),兜底按端口杀
for svc in api web; do
  pidf="$RUN/$svc.pid"
  if [ -f "$pidf" ]; then
    pid="$(cat "$pidf")"
    if kill -0 "$pid" 2>/dev/null; then kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null; fi
    rm -f "$pidf"
  fi
done

# 兜底:按端口清理仍在监听的进程
for p in "$API_PORT" "$WEB_PORT"; do
  pids="$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
done

echo "🛑 已停止 (端口 $API_PORT / $WEB_PORT)"
