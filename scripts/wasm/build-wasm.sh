#!/bin/bash
# WASM build helper, run from the project root.
# Usage:
#   ./scripts/wasm/build-wasm.sh
#   ./scripts/wasm/build-wasm.sh opus
#   ./scripts/wasm/build-wasm.sh opus,flac
#   ./scripts/wasm/build-wasm.sh all
#   ./scripts/wasm/build-wasm.sh all --simd-flac=on --simd-opus=off

set -e

CODEC="${1:-all}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$CODEC" in
  opus|flac|aac|amr|all|*,*)
    ;;
  *)
    echo "Unknown codec: $CODEC"
    echo "Usage: ./scripts/wasm/build-wasm.sh [opus|flac|aac|amr|all|comma-separated list]"
    exit 1
    ;;
esac

node ./scripts/wasm/build-docker.mjs --codec="${CODEC}" "$@"
