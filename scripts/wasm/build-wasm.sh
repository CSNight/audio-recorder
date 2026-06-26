#!/bin/bash
# WASM 构建脚本 - 从项目根目录运行
# Usage:
#   ./scripts/wasm/build-wasm.sh
#   ./scripts/wasm/build-wasm.sh opus
#   ./scripts/wasm/build-wasm.sh opus,flac
#   ./scripts/wasm/build-wasm.sh flac
#   ./scripts/wasm/build-wasm.sh aac
#   ./scripts/wasm/build-wasm.sh amr
#   ./scripts/wasm/build-wasm.sh all

set -e

CODEC="${1:-all}"

case "$CODEC" in
  opus|flac|aac|amr|all|*,*)
    ;;
  *)
    echo "Unknown codec: $CODEC"
    echo "Usage: ./scripts/wasm/build-wasm.sh [opus|flac|aac|amr|all|comma-separated list]"
    exit 1
    ;;
esac

node ./scripts/wasm/build-docker.mjs --codec="${CODEC}"
