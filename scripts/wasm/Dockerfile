# Dockerfile for building WASM modules
FROM emscripten/emsdk:3.1.74

WORKDIR /build
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Preserve directory structure so build scripts can resolve paths correctly
COPY package.json package-lock.json ./
COPY .cache/ ./.cache/
COPY scripts/wasm/ ./scripts/wasm/
COPY scripts/native/ ./scripts/native/

RUN npm ci --omit=dev --ignore-scripts

ENTRYPOINT ["node", "scripts/wasm/build.mjs"]
