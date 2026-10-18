#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

mkdir -p "$staging/virtual-workspace/apps/backend" \
  "$staging/virtual-workspace/apps/frontend" \
  "$staging/virtual-workspace/packages/shared" \
  "$root/release"
cp "$root/package.json" "$root/package-lock.json" "$root/.env.example" "$staging/virtual-workspace/"
cp "$root/apps/backend/package.json" "$staging/virtual-workspace/apps/backend/"
cp "$root/apps/frontend/package.json" "$staging/virtual-workspace/apps/frontend/"
cp "$root/packages/shared/package.json" "$staging/virtual-workspace/packages/shared/"
cp -a "$root/apps/backend/build" "$staging/virtual-workspace/apps/backend/"
cp -a "$root/apps/frontend/dist" "$staging/virtual-workspace/apps/frontend/"
cp -a "$root/packages/shared/dist" "$staging/virtual-workspace/packages/shared/"
cp -a "$root/assets" "$staging/virtual-workspace/"
tar -C "$staging" -czf "$root/release/virtual-workspace.tar.gz" virtual-workspace
