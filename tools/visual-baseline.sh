#!/usr/bin/env bash
#
# 在固定容器里重写 L4 基线（SPEC §13）。宿主机的 node_modules 装的是本机平台的
# esbuild / Playwright 二进制，直接挂进 linux 容器会炸，所以用一个匿名卷把它盖掉、
# 在容器里重装一份；宿主机那份原封不动。写出来的 PNG 落在 bind mount 上，跑完 chown
# 回当前用户，免得留一堆 root 拥有的文件。
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.62.1-noble"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="$(id -u):$(id -g)"

exec docker run --rm --init --ipc=host \
  -v "$REPO":/w \
  -v /w/node_modules \
  -w /w \
  -e CI=1 \
  "$IMAGE" \
  bash -c "set -o pipefail
           npm ci --no-audit --no-fund
           status=0
           npx playwright test --project=visual-chromium --update-snapshots || status=\$?
           chown -R ${OWNER} browser/__screenshots__ || true
           exit \$status"
