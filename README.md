# @csnight/audio-recorder

[English](./README.md) | [中文](./README.zh-CN.md)

TypeScript browser audio recorder library for microphone and `MediaStream` input. Build modern web audio recording flows with PCM frame processing, streaming export, plugins, persistence, and codec output including WAV, MP3, Opus, FLAC, AAC, AMR, and G.711.

## Contents

- [Overview](#overview)
- [Installation](#installation)
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

`@csnight/audio-recorder` is a browser audio recording library for web apps that need:

- microphone recording or external `MediaStream` input
- automatic browser input backend fallback
- PCM frame events and in-memory processing
- snapshot export and streaming audio chunk export
- plugin-based extensions for metering, playback, and ASR pipelines
- optional OPFS and IndexedDB persistence for longer recording sessions

Build target: `es2022`.

## Installation

```bash
npm install @csnight/audio-recorder
```

You can also use:

```bash
pnpm add @csnight/audio-recorder
yarn add @csnight/audio-recorder
```

## Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import { pcmExportEncoder, wavExportEncoder } from "@csnight/audio-recorder/codecs/base"
import { createLevelMeterPlugin } from "@csnight/audio-recorder/plugins/level-meter"

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
- bundled plugins: `level-meter`, `streaming-export`, `asr-export`

## API

### Main entry

```ts
import {
  createRecorder,
  listMicrophoneDevices,
  checkRecorderCapability,
  RecorderController,
} from "@csnight/audio-recorder"
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

| Name      | Type                   | Description                 |
|-----------|------------------------|-----------------------------|
| `options` | `RecorderInputOptions` | Per-session input overrides |

`RecorderInputOptions` fields:

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
| `@csnight/audio-recorder/codecs/base` | PCM and WAV encoders / decoders |
| `@csnight/audio-recorder/codecs/mp3` | MP3 encoder |
| `@csnight/audio-recorder/codecs/flac` | FLAC encoder |
| `@csnight/audio-recorder/codecs/opus` | Opus encoder |
| `@csnight/audio-recorder/codecs/aac` | AAC encoder |
| `@csnight/audio-recorder/codecs/amr` | AMR encoder |
| `@csnight/audio-recorder/codecs/g711` | G.711 encoder |
| `@csnight/audio-recorder/plugins/level-meter` | `createLevelMeterPlugin()` |
| `@csnight/audio-recorder/plugins/streaming-export` | `createStreamingExportPlugin()` |
| `@csnight/audio-recorder/plugins/asr-export` | `createAsrExportPlugin()` |
| `@csnight/audio-recorder/plugins/streaming-player` | `createStreamingPlayer()` |
| `@csnight/audio-recorder/storage/opfs` | `createOpfsPersistencePlugin()` |
| `@csnight/audio-recorder/storage/indexeddb` | `createIndexedDbPersistencePlugin()` |

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
import { createRecorder } from "@csnight/audio-recorder"
import { createLevelMeterPlugin } from "@csnight/audio-recorder/plugins/level-meter"

const recorder = createRecorder()

await recorder.use(createLevelMeterPlugin())

recorder.on("plugin:level", ({ payload }) => {
  console.log(payload.level.peak, payload.level.rms)
})
```

#### API

The following runtime and event types are exported from `@csnight/audio-recorder/plugins/level-meter`.

| Export                     | Description                       |
|----------------------------|-----------------------------------|
| `createLevelMeterPlugin()` | Create the level meter plugin     |
| `RecorderLevel`            | Level payload body type           |
| `RecorderLevelChannel`     | Per-channel level type            |
| `RecorderLevelEvent`       | `plugin:level` event payload type |

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

Real-time chunk export plugin. Feeds PCM frames into a `StreamEncoderDefinition` through `ChunkedEncoderBridge` and emits standardized stream packets while recording.

Current behavior:

- Supports any format with a matching `StreamEncoderDefinition`; built-in base codecs provide `pcm` and `wav`
- Requires the caller to pass a matching encoder via `encoders`
- Reuses one bridge instance across recorder sessions and resets it on `start()`
- Prefers Worker encoding and can fall back to main-thread encoding when enabled
- Flushes one final packet on `stop()` if the encoder still has buffered output; emits nothing if the encoder has no
  remaining output

Event:

- `plugin:stream`

#### Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import { pcmStreamEncoder } from "@csnight/audio-recorder/codecs/base"
import { createStreamingExportPlugin } from "@csnight/audio-recorder/plugins/streaming-export"

const recorder = createRecorder()

await recorder.use(
  createStreamingExportPlugin({
    format: "pcm",
    encoders: [pcmStreamEncoder],
  })
)

recorder.on("plugin:stream", ({ payload }) => {
  console.log(payload.format, payload.chunk.byteLength, payload.isFinal)
})
```

#### API

The following types are exported from `@csnight/audio-recorder/plugins/streaming-export`.

| Export                                 | Description                                           |
|----------------------------------------|-------------------------------------------------------|
| `createStreamingExportPlugin(options)` | Create a streaming export plugin                      |
| `StreamEncoderDefinition`              | Public stream encoder definition passed by the caller |
| `StreamingPacketPayload`               | Stream packet payload                                 |
| `StreamingExportPluginOptions`         | Plugin options                                        |

Options: `StreamingExportPluginOptions`

| Field                     | Type                        | Default | Description                                                                                                             |
|---------------------------|-----------------------------|---------|-------------------------------------------------------------------------------------------------------------------------|
| `format`                  | `string`                    | `-`     | Output format key; must match a `StreamEncoderDefinition` in `encoders`                                                 |
| `encoderOptions`          | `unknown`                   | `-`     | Encoder-specific options passed to `definition.create(options)` and `bridge.reset(options)`                             |
| `encoders`                | `StreamEncoderDefinition[]` | `-`     | Available stream encoders; must include the selected `format`                                                           |
| `allowMainThreadFallback` | `boolean`                   | `true`  | Fall back to main-thread encoding when Worker execution is unavailable                                                  |
| `streamId`                | `string`                    | auto    | Fixed logical stream ID; stable across sessions. When omitted, evaluated once from `createStreamId()` or auto-generated |
| `createStreamId`          | `() => string`              | `-`     | Lazy stream ID factory called once at plugin creation time; ignored when `streamId` is set                              |
| `createSessionId`         | `() => string`              | auto    | Session ID factory called on each `start()`; defaults to `crypto.randomUUID()`-based ID                                 |
| `metadata`                | `Record<string, unknown>`   | `-`     | Static metadata attached to every emitted packet                                                                        |

`StreamEncoderDefinition` fields:

| Field | Type | Description |
|---|---|---|
| `format` | `string` | Encoder format key |
| `workerFactory` | `() => Worker` | Optional Worker factory used by `ChunkedEncoderBridge` |
| `preload` | `() => Promise<void>` | Optional preload hook called during plugin `setup()` |
| `create` | `(options?) => StreamEncoder` | Create encoder instance |

Event payload: `plugin:stream`

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | Recorder instance |
| `sessionId` | `string` | Current session identifier |
| `emittedAt` | `number` | Event timestamp in ms |
| `pluginName` | `string` | Plugin name |
| `runtimeInfo` | `RecorderRuntimeInfo` | Runtime info snapshot |
| `summary` | `RecorderSessionSummary` | Session summary snapshot |
| `payload` | `StreamingPacketPayload` | Encoded stream packet payload |

`StreamingPacketPayload` fields:

| Field           | Type                                   | Description                                                                               |
|-----------------|----------------------------------------|-------------------------------------------------------------------------------------------|
| `streamId`      | `string`                               | Logical stream ID; stable across sessions and reconnects                                  |
| `sessionId`     | `string`                               | Streaming session ID generated on each `start()`                                          |
| `seq`           | `number`                               | Monotonic packet index within the session                                                 |
| `timestampMs`   | `number`                               | Source frame timestamp, or flush timestamp for the final packet                           |
| `durationMs`    | `number`                               | Accumulated source-frame duration represented by this packet                              |
| `sampleRate`    | `number`                               | Packet sample rate                                                                        |
| `channels`      | `number`                               | Packet channel count                                                                      |
| `format`        | `string`                               | Packet format (matches the `format` option)                                               |
| `chunk`         | `Uint8Array`                           | Encoded bytes                                                                             |
| `isFinal`       | `boolean`                              | Final packet emitted from `flush()`; not emitted when the encoder has no remaining output |
| `discontinuity` | `boolean \| undefined`                 | Gap marker set on the first packet after a `resume()`; for transport or playback layers   |
| `metadata`      | `Record<string, unknown> \| undefined` | Reserved extensibility field                                                              |

### `asr-export`

#### Introduction

Chunk export plugin for ASR pipelines. Downmixes input to mono, slices it into fixed-duration chunks, then encodes each chunk.

Event:

- `plugin:asr:chunk`

#### Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import { pcmExportEncoder } from "@csnight/audio-recorder/codecs/base"
import { createAsrExportPlugin } from "@csnight/audio-recorder/plugins/asr-export"

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
  console.log(payload.seq, payload.chunk.byteLength, payload.isFinal)
})
```

#### API

The following types are exported from `@csnight/audio-recorder/plugins/asr-export`.

| Export                           | Description                 |
|----------------------------------|-----------------------------|
| `createAsrExportPlugin(options)` | Create an ASR export plugin |
| `AsrChunkPayload`                | ASR chunk payload           |
| `AsrExportPluginOptions`         | Plugin options              |

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

| Field         | Type             | Description           |
|---------------|------------------|-----------------------|
| `format`      | `"pcm" \| "wav"` | Output format         |
| `chunk`       | `Uint8Array`     | Encoded bytes         |
| `seq`         | `number`         | Monotonic chunk index |
| `timestampMs` | `number`         | Chunk timestamp in ms |
| `durationMs`  | `number`         | Chunk duration        |
| `sampleRate`  | `number`         | Output sample rate    |
| `channels`    | `1`              | Always mono           |
| `isFinal`     | `boolean`        | Final chunk flag      |

### `streaming-player`

#### Introduction

Standalone streaming audio playback engine. Receives `StreamingPacketPayload` packets from any source (WebSocket, recorder plugin, etc.), buffers them through a reorder and jitter pipeline, decodes them via caller-supplied decoders, and schedules continuous playback on an `AudioContext`.

Key behaviors:

- **Double-write**: every `push()` writes to a persist-store for replay history AND feeds the playback pipeline
- **Pause/resume without delay**: on `resume()` the pipeline is reset so backlogged packets are discarded; fresh packets flow immediately
- **Replay**: only available while paused; plays back the last N seconds from the persist-store and returns to paused state when done
- **Persist-store modes**: `persistMode: "memory"` (default) or `"indexeddb"`; the IndexedDB mode writes packets to IndexedDB but replay still reads from the in-memory history of the current player instance
- **Drop-old backlog policy**: when buffered audio exceeds `maxBufferMs`, oldest packets are dropped to keep latency stable

#### Quick Start

```ts
import { createStreamingPlayer } from "@csnight/audio-recorder/plugins/streaming-player"
import { pcmDecoderDefinition } from "@csnight/audio-recorder/codecs/base"

const player = await createStreamingPlayer({
  decoders: [pcmDecoderDefinition],
  targetLatencyMs: 300,
  onStateChange: (s) => console.log("state →", s),
})

await player.start()

// Feed packets from any source
websocket.onmessage = ({ data }) => player.push(JSON.parse(data))

// Controls
player.pause()
player.resume()
player.replay(5)        // replay last 5 seconds (paused state only)
player.setVolume(0.8)
player.destroy()
```

#### API

Exports from `@csnight/audio-recorder/plugins/streaming-player`:

| Export | Description |
|---|---|
| `createStreamingPlayer(options)` | Create and initialize a streaming player |
| `StreamingPlayerOptions` | Player creation options |
| `StreamingPlayerHandle` | Returned player control handle |
| `StreamingPlayerState` | Player state union type |
| `PersistMode` | Persist-store mode union type: `"memory" \| "indexeddb"` |

Options: `StreamingPlayerOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `decoders` | `AudioDecoderDefinition[]` | **required** | Decoder definitions; each maps a `format` string to a decode function |
| `targetLatencyMs` | `number` | `300` | Jitter buffer target depth before playback starts |
| `maxBufferMs` | `number` | `3000` | Maximum buffered audio; excess triggers drop-old |
| `volume` | `number` | `1.0` | Initial gain `[0, 1]` |
| `persistMode` | `"memory" \| "indexeddb"` | `"memory"` | Select the built-in persist-store backend |
| `persistBufferMs` | `number` | `10000` | Max history depth retained by the built-in persist-store |
| `audioContext` | `AudioContext` | auto | External `AudioContext`; if omitted one is created internally |
| `onUnderrun` | `(detail: { bufferedMs: number }) => void` | `-` | Called when the decode queue empties during playback |
| `onPacketDrop` | `(detail: { count: number; reason: string }) => void` | `-` | Called when packets are dropped due to backlog |
| `onStateChange` | `(state: StreamingPlayerState) => void` | `-` | Called on every state transition |

`persistMode: "indexeddb"` note:

- Packets are mirrored into IndexedDB as a side write.
- `replay()` still reads from the current in-memory history only.
- Rebuilding the player instance does not restore replay history from IndexedDB.

Handle: `StreamingPlayerHandle`

| Member | Type | Description |
|---|---|---|
| `state` | `StreamingPlayerState` | Current state: `idle \| buffering \| playing \| paused \| stopped` |
| `bufferedMs` | `number` | Current pipeline buffer depth in milliseconds |
| `droppedPackets` | `number` | Cumulative dropped packet count |
| `storedMs` | `number` | Audio duration currently held in the persist-store (available for replay) |
| `push(packet)` | `void` | Feed a `StreamingPacketPayload`; always writes to persist-store, skips pipeline while paused |
| `start()` | `Promise<void>` | Transition from `idle` to `buffering`; begins accumulating packets |
| `pause()` | `void` | Stop pipeline and active sources; if the player created its own `AudioContext`, it also suspends it |
| `resume()` | `void` | Reset pipeline backlog and resume from fresh packets |
| `setVolume(v)` | `void` | Adjust gain `[0, 1]` at any time |
| `replay(seconds)` | `void` | Play back the last N seconds from persist-store; only valid when paused |
| `destroy()` | `void` | Release all resources |
| `onStateChange` | `((state) => void) \| null` | Assignable after creation; `null` to unsubscribe |

## Storage

### `storage/opfs`

#### Introduction

OPFS persistence backend. Stores snapshots as chunk files and is suitable for long recordings or larger local caches.

#### Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import { createOpfsPersistencePlugin } from "@csnight/audio-recorder/storage/opfs"

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
import { createRecorder } from "@csnight/audio-recorder"
import { createIndexedDbPersistencePlugin } from "@csnight/audio-recorder/storage/indexeddb"

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
- `streaming-export` and `asr-export` are independent extensions
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
