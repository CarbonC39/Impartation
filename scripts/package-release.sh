#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

mkdir -p "$staging/impartation/apps/backend" \
  "$staging/impartation/apps/frontend" \
  "$staging/impartation/packages/shared" \
  "$root/release"
cp "$root/package.json" "$root/package-lock.json" "$root/.env.example" "$staging/impartation/"
cp "$root/apps/backend/package.json" "$staging/impartation/apps/backend/"
cp "$root/apps/frontend/package.json" "$staging/impartation/apps/frontend/"
cp "$root/packages/shared/package.json" "$staging/impartation/packages/shared/"
cp -a "$root/apps/backend/build" "$staging/impartation/apps/backend/"
cp -a "$root/apps/frontend/dist" "$staging/impartation/apps/frontend/"
cp -a "$root/packages/shared/dist" "$staging/impartation/packages/shared/"
cp -a "$root/assets" "$staging/impartation/"
tar -C "$staging" -czf "$root/release/impartation.tar.gz" impartation
