#!/bin/sh
# Volumes (Fly, Docker named volumes) are mounted root-owned. Fix that once, then run as `node`.
set -eu
DATA="${NAZAR_DATA_DIR:-/app/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  if [ "$(stat -c %U "$DATA")" != "node" ]; then chown -R node:node "$DATA"; fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
