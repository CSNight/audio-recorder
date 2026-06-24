#!/bin/bash
# WASM 构建脚本 - 从项目根目录运行
# Usage: ./scripts/wasm/build-wasm.sh

set -e

# Ensure we're in project root
if [ ! -f "package.json" ]; then
  echo "Error: Must run from project root directory"
  exit 1
fi

# Build Docker image if not exists
if ! docker images | grep -q "audio-recorder-wasm"; then
  echo "=== Building Docker image ==="
  docker build -f scripts/wasm/Dockerfile -t audio-recorder-wasm .
fi

echo ""
echo "=== Building Opus WASM module ==="
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd)/.cache:/build/.cache" \
  -v "$(pwd)/src/codecs/opus:/build/src/codecs/opus" \
  audio-recorder-wasm --codec=opus

echo ""
echo "=== Building FLAC WASM module ==="
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd)/.cache:/build/.cache" \
  -v "$(pwd)/src/codecs/flac:/build/src/codecs/flac" \
  audio-recorder-wasm --codec=flac

echo ""
echo "✓ WASM modules built successfully"
echo ""
echo "Generated files:"
echo "  - src/codecs/opus/libopus.wasm.mjs"
echo "  - src/codecs/flac/libflac.wasm.mjs"
