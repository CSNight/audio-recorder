# audio-recorder

[English](./README.md) | [中文](./README.zh-CN.md)

Browser audio recorder library for modern web apps. Supports input fallback, PCM frame pipelines, snapshot export, streaming export, plugins, and optional persistence.

## Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
- [API](#api)
- [Plugins](#plugins)
- [`level-meter`](#level-meter)
- [`streaming-export`](#streaming-export)
- [`asr-export`](#asr-export)
- [`streaming-player`](#streaming-player)
- [Storage](#storage)
- [`storage/opfs`](#storageopfs)
- [`storage/indexeddb`](#storageindexeddb)
- [Codecs](#codecs)
- [Development](#development)
- [Browser Support](#browser-support)
- [Benchmarks](#benchmarks)
- [Architecture](#architecture)
- [References](#references)

## Overview

`audio-recorder` provides a browser recording stack with:

- microphone or external `MediaStream` input
- automatic input backend selection
- PCM frame events
- encoder-based export
- plugin-based extensions
- OPFS / IndexedDB persistence

Build target: `es2022`.

## Quick Start

```ts
import { createRecorder } from "audio-recorder"
import { pcmExportEncoder, wavExportEncoder } from "audio-recorder/codecs/base"
import { createLevelMeterPlugin } from "audio-recorder/plugins/level-meter"

const recorder = createRecorder({
  channelCount: 1,
  inputStrategy: "auto",
  encoders: [pcmExportEncoder, wavExportEncoder],
})

await recorder.use(createLevelMeterPlugin())
await recorder.open()
await recorder.start()

const summary = await recorder.stop()
const wav = await recorder.exportEncoded("wav", { bitRate: 16 })

console.log(summary.durationMs, wav.arrayBuffer.byteLength)
```

## Features

- recorder lifecycle: `open / start / pause / resume / stop / close / destroy`
- input strategies: `media-recorder`, `audio-worklet`, `script-processor`
- device enumeration: `listMicrophoneDevices()`
- capability detection: `checkRecorderCapability()`
- recording events: `statechange`, `frame:async`, `issue`
- snapshot export: `pcm`, `wav`, `mp3`, `flac`, `ogg`, `webm`, `g711`, `aac`, `amr`
- persistence backends: `storage/opfs`, `storage/indexeddb`
- bundled plugins: `level-meter`, `streaming-export`, `asr-export`, `streaming-player`

## API

### Main entry

```ts
import {
  createRecorder,
  listMicrophoneDevices,
  checkRecorderCapability,
  RecorderController,
} from "audio-recorder"
```

Exports:

| Export | Description |
|---|---|
| `createRecorder(options?)` | Create a recorder controller |
| `listMicrophoneDevices()` | Enumerate microphone devices |
| `checkRecorderCapability()` | Return a browser capability report |
| `RecorderController` | Recorder class |
| `resample()` | PCM resampling helper |
| `serializePcmSnapshot()` / `deserializePcmSnapshot()` | PCM snapshot codec |
| `RecorderState` | Recorder state enum |
| `RecorderWarningCode` | Warning code enum |
| `RecorderInputSource` | Input source enum |

### `createRecorder(options?)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `sampleRate` | `number` | `-` | Requested input sample rate |
| `channelCount` | `number` | `-` | Requested channel count |
| `echoCancellation` | `boolean` | `true` | Input constraint |
| `noiseSuppression` | `boolean` | `true` | Input constraint |
| `autoGainControl` | `boolean` | `true` | Input constraint |
| `deviceId` | `string` | `-` | Target microphone device |
| `disableFrameLossCompensation` | `boolean` | `false` | Skip silence padding |
| `inputStrategy` | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | Input backend selection |
| `storage` | `RecorderStorageOptions` | `-` | Buffer persistence policy |
| `encoders` | `ExportEncoderDefinition[]` | `[]` | Snapshot encoders |

Returns:

| Type | Description |
|---|---|
| `RecorderController` | Recorder controller instance |

### `storage`

Recorder persistence is configured through `createRecorder({ storage })`.

`RecorderStorageOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | `"memory" \| "persistent" \| "auto"` | `-` | Buffer mode |
| `memoryThresholdBytes` | `number` | `-` | Switch threshold for `auto` mode |
| `persistenceChunkBytes` | `number` | `-` | Target chunk size for persistence flush |
| `persistencePlugin` | `RecorderPersistencePlugin` | `-` | Persistence backend |

### `RecorderController`

#### `on(event, listener)`

Subscribe to recorder or plugin events.

Parameters:

| Name | Type | Description |
|---|---|---|
| `event` | `keyof RecorderEventMap` | Event name |
| `listener` | `(payload) => void` | Event listener |

Returns:

| Type | Description |
|---|---|
| `() => void` | Unsubscribe function |

#### `off(event, listener)`

Remove an event listener.

Parameters:

| Name | Type | Description |
|---|---|---|
| `event` | `keyof RecorderEventMap` | Event name |
| `listener` | `(payload) => void` | Listener to remove |

Returns:

| Type | Description |
|---|---|
| `void` | No return value |

#### `getState()`

Returns:

| Type | Description |
|---|---|
| `RecorderState` | Current recorder state |

#### `getRuntimeInfo()`

Returns:

| Type | Description |
|---|---|
| `RecorderRuntimeInfo` | Requested and actual input runtime info |

#### `getLatestSummary()`

Returns:

| Type | Description |
|---|---|
| `RecorderSessionSummary` | Current session summary |

#### `use(plugin)`

Register a plugin.

Parameters:

| Name | Type | Description |
|---|---|---|
| `plugin` | `RecorderPlugin` | Plugin instance |

Returns:

| Type | Description |
|---|---|
| `Promise<void>` | Resolves when plugin setup completes |

#### `registerEncoder(definition)`

Register a snapshot encoder.

Parameters:

| Name | Type | Description |
|---|---|---|
| `definition` | `ExportEncoderDefinition` | Encoder definition for `exportEncoded()` |

Returns:

| Type | Description |
|---|---|
| `void` | No return value |

#### `exportEncoded(type, options?)`

Export the current PCM snapshot with a registered encoder.

Parameters:

| Name | Type | Description |
|---|---|---|
| `type` | `keyof EncoderMap \| string` | Encoder type |
| `options` | encoder-specific | Export options for the selected encoder |

Returns:

| Type | Description |
|---|---|
| `Promise<TResult>` | Encoded result returned by the selected encoder |

Common built-in result types:

| Type | Result |
|---|---|
| `pcm` | `PcmExportResult` |
| `wav` | `WavExportResult` |
| `mp3` | `Mp3ExportResult` |
| `flac` | `FlacExportResult` |
| `ogg` / `webm` | `OpusExportResult` |
| `g711` | `G711ExportResult` |
| `aac` | `AacExportResult` |
| `amr` | `AmrExportResult` |

#### `open(options?)`

Open a recorder session.

Parameters:

| Name | Type | Description |
|---|---|---|
| `options` | `RecorderOpenOptions` | Per-session input overrides |

`RecorderOpenOptions` fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `sampleRate` | `number` | `-` | Requested sample rate |
| `channelCount` | `number` | `-` | Requested channel count |
| `echoCancellation` | `boolean` | `true` | Enable echo cancellation |
| `noiseSuppression` | `boolean` | `true` | Enable noise suppression |
| `autoGainControl` | `boolean` | `true` | Enable auto gain control |
| `deviceId` | `string` | `-` | Target microphone device |
| `disableFrameLossCompensation` | `boolean` | `false` | Disable silence padding on detected frame loss |
| `inputStrategy` | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | Preferred input backend |

Returns:

| Type | Description |
|---|---|
| `Promise<RecorderRuntimeInfo>` | Actual runtime info after session opens |

#### `start()`

Returns:

| Type | Description |
|---|---|
| `Promise<RecorderRuntimeInfo>` | Updated runtime info |

#### `pause()`

Returns:

| Type | Description |
|---|---|
| `void` | No return value |

#### `resume()`

Returns:

| Type | Description |
|---|---|
| `Promise<RecorderRuntimeInfo>` | Updated runtime info |

#### `stop()`

Returns:

| Type | Description |
|---|---|
| `Promise<RecorderSessionSummary>` | Final session summary |

#### `close()`

Returns:

| Type | Description |
|---|---|
| `Promise<void>` | Resolves when session resources are closed |

#### `destroy()`

Returns:

| Type | Description |
|---|---|
| `Promise<void>` | Resolves when teardown completes |

### Subpaths

| Package path | Exports |
|---|---|
| `audio-recorder/codecs/base` | PCM and WAV encoders / decoders |
| `audio-recorder/codecs/mp3` | MP3 encoder |
| `audio-recorder/codecs/flac` | FLAC encoder |
| `audio-recorder/codecs/opus` | Opus encoder |
| `audio-recorder/codecs/aac` | AAC encoder |
| `audio-recorder/codecs/amr` | AMR encoder |
| `audio-recorder/codecs/g711` | G.711 encoder |
| `audio-recorder/plugins/level-meter` | `createLevelMeterPlugin()` |
| `audio-recorder/plugins/streaming-export` | `createStreamingExportPlugin()` |
| `audio-recorder/plugins/asr-export` | `createAsrExportPlugin()` |
| `audio-recorder/plugins/streaming-player` | `createStreamingPlayerPlugin()` |
| `audio-recorder/storage/opfs` | `createOpfsPersistencePlugin()` |
| `audio-recorder/storage/indexeddb` | `createIndexedDbPersistencePlugin()` |

### Events

#### `statechange`

Fired when recorder state changes.

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | Recorder instance |
| `sessionId` | `string` | Current session identifier |
| `emittedAt` | `number` | Event timestamp in ms |
| `previousState` | `RecorderState` | Previous state |
| `state` | `RecorderState` | Next state |
| `runtimeInfo` | `RecorderRuntimeInfo` | Runtime info snapshot |
| `summary` | `RecorderSessionSummary` | Session summary snapshot |

#### `frame:async`

Fired asynchronously for accepted PCM frames.

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | Recorder instance |
| `sessionId` | `string` | Current session identifier |
| `emittedAt` | `number` | Event timestamp in ms |
| `frame` | `AudioFrame` | PCM frame |
| `runtimeInfo` | `RecorderRuntimeInfo` | Runtime info snapshot |
| `summary` | `RecorderSessionSummary` | Session summary snapshot |

`frame` fields:

| Field | Type | Description |
|---|---|---|
| `channels` | `number` | Channel count |
| `sampleRate` | `number` | Frame sample rate |
| `timestamp` | `number` | Frame timestamp in ms |
| `durationMs` | `number` | Frame duration in ms |
| `planar` | `Int16Array[]` | Per-channel PCM samples |

#### `issue`

Fired for warnings and errors.

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | Recorder instance |
| `sessionId` | `string` | Current session identifier |
| `emittedAt` | `number` | Event timestamp in ms |
| `issue` | `RecorderIssue` | Warning or error payload |
| `runtimeInfo` | `RecorderRuntimeInfo` | Runtime info snapshot |
| `summary` | `RecorderSessionSummary` | Session summary snapshot |

`issue` variants:

| Variant | Fields |
|---|---|
| `warning` | `{ kind: "warning", warning: { code, message } }` |
| `error` | `{ kind: "error", error: Error }` |

## Plugins

### `level-meter`

#### Introduction

Real-time level meter plugin. Consumes recorded frames and emits aggregate and per-channel `peak / rms`.

Event:

- `plugin:level`

#### Quick Start

```ts
import { createRecorder } from "audio-recorder"
import { createLevelMeterPlugin } from "audio-recorder/plugins/level-meter"

const recorder = createRecorder()

await recorder.use(createLevelMeterPlugin())

recorder.on("plugin:level", ({ payload }) => {
  console.log(payload.level.peak, payload.level.rms)
})
```

#### API

| Export | Description |
|---|---|
| `createLevelMeterPlugin()` | Create the level meter plugin |

Options:

None.

Event payload: `plugin:level`

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | Recorder instance |
| `sessionId` | `string` | Current session identifier |
| `emittedAt` | `number` | Event timestamp in ms |
| `pluginName` | `string` | Plugin name |
| `runtimeInfo` | `RecorderRuntimeInfo` | Runtime info snapshot |
| `summary` | `RecorderSessionSummary` | Session summary snapshot |
| `payload` | `RecorderLevelEvent` | Level payload |

`payload.level` fields:

| Field | Type | Description |
|---|---|---|
| `peak` | `number` | Frame peak value normalized to `0..1` |
| `rms` | `number` | Frame RMS value normalized to `0..1` |
| `channels` | `RecorderLevelChannel[]` | Per-channel level array |

### `streaming-export`

#### Introduction

Real-time chunk export plugin. Feeds PCM frames into a `StreamEncoderDefinition` and emits encoded chunks while recording.

Event:

- `plugin:encoded-chunk`

#### Quick Start

```ts
import { createRecorder } from "audio-recorder"
import { pcmStreamEncoder } from "audio-recorder/codecs/base"
import { createStreamingExportPlugin } from "audio-recorder/plugins/streaming-export"

const recorder = createRecorder()

await recorder.use(
  createStreamingExportPlugin({
    format: "pcm",
    encoders: [pcmStreamEncoder],
  })
)

recorder.on("plugin:encoded-chunk", ({ payload }) => {
  console.log(payload.format, payload.chunk.byteLength, payload.isFinal)
})
```

#### API

| Export | Description |
|---|---|
| `createStreamingExportPlugin(options)` | Create a streaming export plugin |
| `StreamEncoderDefinition` | Public stream encoder definition passed by the caller |
| `StreamingChunkPayload` | Chunk event payload |
| `StreamingExportPluginOptions` | Plugin options |

Options: `StreamingExportPluginOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `format` | `"pcm" \| "wav"` | `-` | Output chunk format |
| `encoderOptions` | `unknown` | `-` | Encoder-specific options passed to the public encoder definition |
| `encoders` | `StreamEncoderDefinition[]` | `-` | Available stream encoders |
| `allowMainThreadFallback` | `boolean` | `true` | Fall back to main-thread encoding when Worker execution is unavailable |

`StreamEncoderDefinition` fields:

| Field | Type | Description |
|---|---|---|
| `format` | `string` | Encoder format key |
| `workerFactory` | `() => Worker` | Optional Worker factory |
| `preload` | `() => Promise<void>` | Optional preload hook |
| `create` | `(options?) => StreamEncoder` | Create encoder instance |

Event payload: `plugin:encoded-chunk`

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | Recorder instance |
| `sessionId` | `string` | Current session identifier |
| `emittedAt` | `number` | Event timestamp in ms |
| `pluginName` | `string` | Plugin name |
| `runtimeInfo` | `RecorderRuntimeInfo` | Runtime info snapshot |
| `summary` | `RecorderSessionSummary` | Session summary snapshot |
| `payload` | `StreamingChunkPayload` | Encoded chunk payload |

`StreamingChunkPayload` fields:

| Field | Type | Description |
|---|---|---|
| `chunk` | `Uint8Array` | Encoded bytes |
| `format` | `"pcm" \| "wav"` | Chunk format |
| `timestampMs` | `number` | Frame timestamp for this chunk |
| `sequenceIndex` | `number` | Monotonic chunk index |
| `sampleRate` | `number` | Chunk sample rate |
| `channels` | `number` | Chunk channel count |
| `isFinal` | `boolean` | Final chunk flag |

### `asr-export`

#### Introduction

Chunk export plugin for ASR pipelines. Downmixes input to mono, slices it into fixed-duration chunks, then encodes each chunk.

Event:

- `plugin:asr:chunk`

#### Quick Start

```ts
import { createRecorder } from "audio-recorder"
import { pcmExportEncoder } from "audio-recorder/codecs/base"
import { createAsrExportPlugin } from "audio-recorder/plugins/asr-export"

const recorder = createRecorder()

await recorder.use(
  createAsrExportPlugin({
    format: "pcm",
    encoders: [pcmExportEncoder],
    sampleRate: 16000,
    chunkDurationMs: 40,
  })
)

recorder.on("plugin:asr:chunk", ({ payload }) => {
  console.log(payload.sequenceIndex, payload.chunk.byteLength, payload.isFinal)
})
```

#### API

| Export | Description |
|---|---|
| `createAsrExportPlugin(options)` | Create an ASR export plugin |
| `AsrChunkPayload` | ASR chunk payload |
| `AsrExportPluginOptions` | Plugin options |

Options: `AsrExportPluginOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `format` | `"pcm" \| "wav"` | `"pcm"` | Chunk output format |
| `encoders` | `ExportEncoderDefinition[]` | `-` | Available snapshot encoders |
| `sampleRate` | `8000 \| 16000 \| 24000 \| 32000 \| 48000` | `16000` | Output sample rate |
| `channels` | `1` | `-` | Mono only |
| `chunkDurationMs` | `number` | `40` | Chunk duration in milliseconds |
| `bitsPerSample` | `16` | `16` | Currently fixed to 16-bit output |

Event payload: `plugin:asr:chunk`

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | Recorder instance |
| `sessionId` | `string` | Current session identifier |
| `emittedAt` | `number` | Event timestamp in ms |
| `pluginName` | `string` | Plugin name |
| `runtimeInfo` | `RecorderRuntimeInfo` | Runtime info snapshot |
| `summary` | `RecorderSessionSummary` | Session summary snapshot |
| `payload` | `AsrChunkPayload` | ASR chunk payload |

`AsrChunkPayload` fields:

| Field | Type | Description |
|---|---|---|
| `format` | `"pcm" \| "wav"` | Output format |
| `chunk` | `Uint8Array` | Encoded bytes |
| `sequenceIndex` | `number` | Monotonic chunk index |
| `timestampMs` | `number` | Chunk timestamp in ms |
| `durationMs` | `number` | Chunk duration |
| `sampleRate` | `number` | Output sample rate |
| `channels` | `1` | Always mono |
| `isFinal` | `boolean` | Final chunk flag |

### `streaming-player`

#### Introduction

Real-time playback plugin. Can play PCM frames directly or subscribe to `plugin:encoded-chunk` and decode chunks for playback.

#### Quick Start

```ts
import { createRecorder } from "audio-recorder"
import { createStreamingPlayerPlugin } from "audio-recorder/plugins/streaming-player"

const recorder = createRecorder()

await recorder.use(
  createStreamingPlayerPlugin({
    source: { type: "pcm-frame" },
  })
)
```

#### API

| Export | Description |
|---|---|
| `createStreamingPlayerPlugin(options?)` | Create a streaming player plugin |
| `StreamingPlayerEncoderDefinition` | Public decoder definition passed by the caller |
| `StreamingPlayerPluginOptions` | Plugin options |

Options: `StreamingPlayerPluginOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `volume` | `number` | `1` | Playback gain |
| `autoPlay` | `boolean` | `true` | Auto-resume `AudioContext` |
| `source` | `{ type: "pcm-frame" } \| { type: "plugin-event"; event: "plugin:encoded-chunk"; format: "pcm" \| "wav"; encoders: StreamingPlayerEncoderDefinition[] }` | `{ type: "pcm-frame" }` | Playback source |

`StreamingPlayerEncoderDefinition` fields:

| Field | Type | Description |
|---|---|---|
| `format` | `string` | Encoded chunk format |
| `decode` | `(payload) => Promise<DecodedAudioChunk>` | Decode plugin chunk into PCM |

## Storage

### `storage/opfs`

#### Introduction

OPFS persistence backend. Stores snapshots as chunk files and is suitable for long recordings or larger local caches.

#### Quick Start

```ts
import { createRecorder } from "audio-recorder"
import { createOpfsPersistencePlugin } from "audio-recorder/storage/opfs"

const recorder = createRecorder({
  storage: {
    mode: "auto",
    memoryThresholdBytes: 256 * 1024,
    persistencePlugin: createOpfsPersistencePlugin(),
  },
})
```

#### API

| Export | Description |
|---|---|
| `createOpfsPersistencePlugin()` | Create an OPFS persistence plugin |

Use with the main recorder `storage` option:

```ts
createRecorder({
  storage: {
    mode: "auto",
    persistencePlugin: createOpfsPersistencePlugin(),
  },
})
```

### `storage/indexeddb`

#### Introduction

IndexedDB persistence backend. Stores snapshots as chunk entries in an object store and is suitable for the broad compatibility path.

#### Quick Start

```ts
import { createRecorder } from "audio-recorder"
import { createIndexedDbPersistencePlugin } from "audio-recorder/storage/indexeddb"

const recorder = createRecorder({
  storage: {
    mode: "auto",
    memoryThresholdBytes: 256 * 1024,
    persistencePlugin: createIndexedDbPersistencePlugin(),
  },
})
```

#### API

| Export | Description |
|---|---|
| `createIndexedDbPersistencePlugin()` | Create an IndexedDB persistence plugin |

Use with the main recorder `storage` option:

```ts
createRecorder({
  storage: {
    mode: "auto",
    persistencePlugin: createIndexedDbPersistencePlugin(),
  },
})
```

## Codecs

### `codecs/base`

Core PCM and WAV support.

- `pcmExportEncoder`: export raw PCM snapshots
- `wavExportEncoder`: export WAV files
- `pcmStreamEncoder`: stream PCM chunks
- `wavStreamEncoder`: stream WAV chunks

### `codecs/mp3`

MP3 export based on a WASM encoder.

- suitable for broad playback compatibility
- exposed as a separate subpath to avoid inflating the root bundle

### `codecs/flac`

Lossless FLAC export based on a WASM encoder.

- suitable for archival or post-processing workflows
- keeps source audio lossless at the cost of larger output than lossy codecs

### `codecs/opus`

Opus export based on a WASM encoder.

- supports `ogg` and `webm` container output
- suited for efficient speech and general audio compression

### `codecs/aac`

AAC export based on a WASM encoder.

- useful for workflows that expect AAC elementary streams
- exposed through a dedicated subpath

### `codecs/amr`

AMR export based on a WASM encoder.

- supports `nb` and `wb`
- intended for telephony and speech-oriented pipelines

### `codecs/g711`

G.711 export implemented in pure TypeScript.

- supports `alaw` and `ulaw`
- suited for telephony interoperability

## Development

### Install

```bash
npm install
```

### Common commands

```bash
npm run dev
npm run build
npm run typecheck
npm run test
```

### Build all WASM codecs

```bash
npm run build:wasm
```

This runs the Docker-based WASM build pipeline for all supported WASM codecs.

### Build selected WASM codecs

```bash
npm run build:wasm:select -- --codec=mp3
npm run build:wasm:select -- --codec=flac,opus
npm run build:wasm:select -- --codec=aac,amr
```

Available selections are driven by the build script and currently map to the dedicated codec builders under `scripts/wasm/`.

### Relevant scripts

| Command | Description |
|---|---|
| `npm run build:wasm` | Build all WASM codecs |
| `npm run build:wasm:select -- --codec=<list>` | Build only selected WASM codecs |
| `npm run benchmark:codecs` | Run codec benchmarks |
| `npm run verify:exports` | Verify package export entrypoints |

### Script entrypoints

| Path | Description |
|---|---|
| `scripts/wasm/build-docker.mjs` | Main Docker-based WASM build entry |
| `scripts/wasm/build.mjs` | Shared WASM build orchestration |
| `scripts/wasm/build-aac.mjs` | AAC build |
| `scripts/wasm/build-amr.mjs` | AMR build |
| `scripts/wasm/build-flac.mjs` | FLAC build |
| `scripts/wasm/build-mp3.mjs` | MP3 build |
| `scripts/wasm/build-opus.mjs` | Opus build |

## Browser Support

Based on direct API usage in `src/` and `vite.config.ts` target `es2022`.

### Main library

| Module | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| Core recorder | 66 | 76 | 14.1 | `AudioWorkletNode` path is the stable baseline |
| Auto input fallback | 66 | 76 | 14.1 | Falls back to `audio-worklet` when PCM `MediaRecorder` is unavailable |
| `media-recorder` path | 105 | - | - | Uses `MediaRecorder.isTypeSupported("audio/webm; codecs=pcm")` |
| `script-processor` fallback | 35 | 25 | 6 | Legacy fallback only |

### Plugins

| Plugin | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| `level-meter` | 66 | 76 | 14.1 | PCM frame consumer |
| `streaming-export` | 66 | 76 | 14.1 | Worker-based chunk export |
| `asr-export` | 66 | 76 | 14.1 | PCM chunking and registered encoders |
| `streaming-player` | 66 | 76 | 14.1 | `AudioContext` playback |

### Codecs

| Codec | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| PCM | 57 | 52 | 11 | Pure typed-array processing |
| WAV | 57 | 52 | 11 | Pure file packaging |
| G.711 | 57 | 52 | 11 | Pure arithmetic |
| MP3 | 57 | 52 | 11 | WASM encoder |
| FLAC | 57 | 52 | 11 | WASM encoder |
| Opus | 57 | 52 | 11 | WASM encoder |
| AAC | 57 | 52 | 11 | WASM encoder |
| AMR | 57 | 52 | 11 | WASM encoder |

### Storage

| Module | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| `storage/indexeddb` | 24 | 16 | 8 | Standard IndexedDB |
| `storage/opfs` | 102 | 111 | 15.2 | `navigator.storage.getDirectory()` |

## Benchmarks

Latest recorded run: 2026-06-28.

### Summary

| Codec | Variant | Scenario | Avg ms | RTF x | Bytes |
|---|---|---|---:|---:|---:|
| pcm | default | snapshot | 0.48 | 31493.03 | 1440000 |
| pcm | default | streaming | 3.82 | 3987.75 | 1440000 |
| wav | default | snapshot | 1.06 | 14286.82 | 1440044 |
| wav | default | streaming | 2.12 | 8476.78 | 1440352 |
| mp3 | default | snapshot | 208.64 | 74.52 | 240384 |
| mp3 | default | streaming | 202.66 | 77.35 | 240384 |
| flac | default | snapshot | 11.04 | 1374.19 | 679568 |
| flac | default | streaming | 10.37 | 1447.88 | 679568 |
| opus | ogg | snapshot | 49.84 | 305.77 | 262774 |
| opus | ogg | streaming | 49.66 | 307.30 | 263229 |
| opus | webm | snapshot | 48.38 | 314.75 | 246569 |
| opus | webm | streaming | 48.40 | 315.27 | 246569 |
| aac | default | snapshot | 94.14 | 159.52 | 245066 |
| aac | default | streaming | 96.38 | 155.70 | 245066 |
| amr | nb | snapshot | 29.05 | 516.49 | 24006 |
| amr | nb | streaming | 29.09 | 515.67 | 24006 |
| amr | wb | snapshot | 59.24 | 253.26 | 45759 |
| amr | wb | streaming | 59.31 | 252.93 | 45759 |

### SIMD

| Codec | Variant | Scenario | off/on |
|---|---|---|---:|
| flac | default | snapshot | 1.370 |
| flac | default | streaming | 1.305 |
| opus | ogg | snapshot | 1.130 |
| opus | ogg | streaming | 1.118 |
| opus | webm | snapshot | 1.215 |
| opus | webm | streaming | 1.264 |
| aac | default | snapshot | 1.377 |
| aac | default | streaming | 1.361 |
| amr | nb | snapshot | 1.055 |
| amr | nb | streaming | 1.097 |
| amr | wb | snapshot | 1.107 |
| amr | wb | streaming | 1.126 |

## Architecture

Current execution chain:

```text
createRecorder
  -> RecorderController
  -> BrowserInputAdapter
  -> BrowserInputSession
  -> input backend
  -> PcmFramePipeline
  -> PcmBufferStore
  -> encoders / plugins / persistence
```

Notes:

- the root entry does not auto-register encoders
- plugins are opt-in and live under dedicated subpaths
- `streaming-export`, `asr-export`, and `streaming-player` are independent extensions
- `opfs` and `indexeddb` are optional persistence backends

Detailed chain document:

- [docs/architecture/execution-chain.md](./docs/architecture/execution-chain.md)
- [docs/README.md](./docs/README.md)

## References

Acknowledgements:

- [Recorder](https://github.com/xiangyuecn/Recorder) for recorder implementation reference
- [Mediabunny](https://github.com/Vanilagy/mediabunny) for codec and packaging reference
- upstream codec projects used by the WASM build pipeline:
  - [libopus](https://github.com/xiph/opus)
  - [LAME](https://sourceforge.net/projects/lame/)
  - [libFLAC](https://github.com/xiph/flac)
  - [FFmpeg](https://ffmpeg.org/)
  - [opencore-amr](https://github.com/mstorsjo/opencore-amr)
  - [vo-amrwbenc](https://sourceforge.net/projects/opencore-amr/)
