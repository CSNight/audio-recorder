# @csnight/audio-recorder

[English](./README.md) | [中文](./README.zh-CN.md)

TypeScript browser audio recorder library for microphone and `MediaStream` input. Build modern web audio recording flows with PCM frame processing, streaming export, plugins, persistence, and codec output including WAV, MP3, Opus, FLAC, AAC, AMR, AC3/E-AC3, and G.711.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Features](#features)
- [API](#api)
- [Plugins](#plugins)
- [`level-meter`](#level-meter)
- [`streaming-export`](#streaming-export)
- [`sonic-export`](#sonic-export)
- [`dsp`](#dsp)
- [`asr-export`](#asr-export)
- [`frequency-histogram`](#frequency-histogram)
- [`dtmf`](#dtmf)
- [`nmn2pcm`](#nmn2pcm)
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
- plugin-based extensions for metering, analysis, playback, ASR, and score-to-PCM generation
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
import {
  pcmExportEncoder,
  wavExportEncoder,
} from "@csnight/audio-recorder/codecs/base"
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
- snapshot export: `pcm`, `wav`, `mp3`, `flac`, `ogg`, `webm`, `g711`, `aac`, `amr`, `ac3`, `eac3`
- persistence backends: `storage/opfs`, `storage/indexeddb`
- bundled plugin subpaths: `level-meter`, `streaming-export`, `sonic-export`, `dsp`, `asr-export`, `frequency-histogram`, `dtmf`, `nmn2pcm`, `streaming-player`

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

| Export                                                | Description                        |
| ----------------------------------------------------- | ---------------------------------- |
| `createRecorder(options?)`                            | Create a recorder controller       |
| `listMicrophoneDevices()`                             | Enumerate microphone devices       |
| `checkRecorderCapability()`                           | Return a browser capability report |
| `RecorderController`                                  | Recorder class                     |
| `resample()`                                          | PCM resampling helper              |
| `serializePcmSnapshot()` / `deserializePcmSnapshot()` | PCM snapshot codec                 |
| `RecorderState`                                       | Recorder state enum                |
| `RecorderWarningCode`                                 | Warning code enum                  |
| `RecorderInputSource`                                 | Input source enum                  |

### `createRecorder(options?)`

| Option                         | Type                                                                  | Default  | Notes                       |
| ------------------------------ | --------------------------------------------------------------------- | -------- | --------------------------- |
| `sampleRate`                   | `number`                                                              | `-`      | Requested input sample rate |
| `channelCount`                 | `number`                                                              | `-`      | Requested channel count     |
| `echoCancellation`             | `boolean`                                                             | `true`   | Input constraint            |
| `noiseSuppression`             | `boolean`                                                             | `true`   | Input constraint            |
| `autoGainControl`              | `boolean`                                                             | `true`   | Input constraint            |
| `deviceId`                     | `string`                                                              | `-`      | Target microphone device    |
| `disableFrameLossCompensation` | `boolean`                                                             | `false`  | Skip silence padding        |
| `inputStrategy`                | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | Input backend selection     |
| `storage`                      | `RecorderStorageOptions`                                              | `-`      | Buffer persistence policy   |
| `encoders`                     | `ExportEncoderDefinition[]`                                           | `[]`     | Snapshot encoders           |

Returns:

| Type                 | Description                  |
| -------------------- | ---------------------------- |
| `RecorderController` | Recorder controller instance |

### `storage`

Recorder persistence is configured through `createRecorder({ storage })`.

`RecorderStorageOptions`:

| Field                   | Type                                 | Default | Description                             |
| ----------------------- | ------------------------------------ | ------- | --------------------------------------- |
| `mode`                  | `"memory" \| "persistent" \| "auto"` | `-`     | Buffer mode                             |
| `memoryThresholdBytes`  | `number`                             | `-`     | Switch threshold for `auto` mode        |
| `persistenceChunkBytes` | `number`                             | `-`     | Target chunk size for persistence flush |
| `persistencePlugin`     | `RecorderPersistencePlugin`          | `-`     | Persistence backend                     |

### `RecorderController`

#### `on(event, listener)`

Subscribe to recorder or plugin events.

Parameters:

| Name       | Type                     | Description    |
| ---------- | ------------------------ | -------------- |
| `event`    | `keyof RecorderEventMap` | Event name     |
| `listener` | `(payload) => void`      | Event listener |

Returns:

| Type         | Description          |
| ------------ | -------------------- |
| `() => void` | Unsubscribe function |

#### `off(event, listener)`

Remove an event listener.

Parameters:

| Name       | Type                     | Description        |
| ---------- | ------------------------ | ------------------ |
| `event`    | `keyof RecorderEventMap` | Event name         |
| `listener` | `(payload) => void`      | Listener to remove |

Returns:

| Type   | Description     |
| ------ | --------------- |
| `void` | No return value |

#### `getState()`

Returns:

| Type            | Description            |
| --------------- | ---------------------- |
| `RecorderState` | Current recorder state |

#### `getRuntimeInfo()`

Returns:

| Type                  | Description                             |
| --------------------- | --------------------------------------- |
| `RecorderRuntimeInfo` | Requested and actual input runtime info |

#### `getLatestSummary()`

Returns:

| Type                     | Description             |
| ------------------------ | ----------------------- |
| `RecorderSessionSummary` | Current session summary |

#### `use(plugin)`

Register a plugin.

Parameters:

| Name     | Type             | Description     |
| -------- | ---------------- | --------------- |
| `plugin` | `RecorderPlugin` | Plugin instance |

Returns:

| Type            | Description                          |
| --------------- | ------------------------------------ |
| `Promise<void>` | Resolves when plugin setup completes |

#### `unuse(name)`

Unregister a plugin or a plugin-family prefix while the recorder is idle.

Parameters:

| Name   | Type     | Description                                                                               |
| ------ | -------- | ----------------------------------------------------------------------------------------- |
| `name` | `string` | Plugin name or family prefix. `streaming-export` / `sonic-export` unload the whole family |

Returns:

| Type            | Description                            |
| --------------- | -------------------------------------- |
| `Promise<void>` | Resolves when plugin dispose completes |

#### `registerEncoder(definition)`

Register a snapshot encoder.

Parameters:

| Name         | Type                      | Description                              |
| ------------ | ------------------------- | ---------------------------------------- |
| `definition` | `ExportEncoderDefinition` | Encoder definition for `exportEncoded()` |

Returns:

| Type   | Description     |
| ------ | --------------- |
| `void` | No return value |

#### `exportEncoded(type, options?)`

Export the current PCM snapshot with a registered encoder.

Parameters:

| Name      | Type                         | Description                             |
| --------- | ---------------------------- | --------------------------------------- |
| `type`    | `keyof EncoderMap \| string` | Encoder type                            |
| `options` | encoder-specific             | Export options for the selected encoder |

Returns:

| Type               | Description                                     |
| ------------------ | ----------------------------------------------- |
| `Promise<TResult>` | Encoded result returned by the selected encoder |

Common built-in result types:

| Type           | Result             |
| -------------- | ------------------ |
| `pcm`          | `PcmExportResult`  |
| `wav`          | `WavExportResult`  |
| `mp3`          | `Mp3ExportResult`  |
| `flac`         | `FlacExportResult` |
| `ogg` / `webm` | `OpusExportResult` |
| `g711`         | `G711ExportResult` |
| `aac`          | `AacExportResult`  |
| `amr`          | `AmrExportResult`  |
| `ac3` / `eac3` | `Ac3ExportResult`  |

#### `open(options?)`

Open a recorder session.

Parameters:

| Name      | Type                   | Description                 |
| --------- | ---------------------- | --------------------------- |
| `options` | `RecorderInputOptions` | Per-session input overrides |

`RecorderInputOptions` fields:

| Field                          | Type                                                                  | Default  | Description                                    |
| ------------------------------ | --------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| `sampleRate`                   | `number`                                                              | `-`      | Requested sample rate                          |
| `channelCount`                 | `number`                                                              | `-`      | Requested channel count                        |
| `echoCancellation`             | `boolean`                                                             | `true`   | Enable echo cancellation                       |
| `noiseSuppression`             | `boolean`                                                             | `true`   | Enable noise suppression                       |
| `autoGainControl`              | `boolean`                                                             | `true`   | Enable auto gain control                       |
| `deviceId`                     | `string`                                                              | `-`      | Target microphone device                       |
| `disableFrameLossCompensation` | `boolean`                                                             | `false`  | Disable silence padding on detected frame loss |
| `inputStrategy`                | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | Preferred input backend                        |

Returns:

| Type                           | Description                             |
| ------------------------------ | --------------------------------------- |
| `Promise<RecorderRuntimeInfo>` | Actual runtime info after session opens |

#### `start()`

Returns:

| Type                           | Description          |
| ------------------------------ | -------------------- |
| `Promise<RecorderRuntimeInfo>` | Updated runtime info |

#### `pause()`

Returns:

| Type   | Description     |
| ------ | --------------- |
| `void` | No return value |

#### `resume()`

Returns:

| Type                           | Description          |
| ------------------------------ | -------------------- |
| `Promise<RecorderRuntimeInfo>` | Updated runtime info |

#### `stop()`

Returns:

| Type                              | Description           |
| --------------------------------- | --------------------- |
| `Promise<RecorderSessionSummary>` | Final session summary |

#### `close()`

Returns:

| Type            | Description                                |
| --------------- | ------------------------------------------ |
| `Promise<void>` | Resolves when session resources are closed |

#### `destroy()`

Returns:

| Type            | Description                      |
| --------------- | -------------------------------- |
| `Promise<void>` | Resolves when teardown completes |

### Subpaths

| Package path                                          | Exports                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `@csnight/audio-recorder/codecs/base`                 | PCM and WAV encoders / decoders                                                |
| `@csnight/audio-recorder/codecs/mp3`                  | MP3 encoder                                                                    |
| `@csnight/audio-recorder/codecs/flac`                 | FLAC encoder                                                                   |
| `@csnight/audio-recorder/codecs/opus`                 | Opus encoder                                                                   |
| `@csnight/audio-recorder/codecs/aac`                  | AAC encoder                                                                    |
| `@csnight/audio-recorder/codecs/amr`                  | AMR encoder                                                                    |
| `@csnight/audio-recorder/codecs/ac3`                  | AC3 / E-AC3 encoders                                                           |
| `@csnight/audio-recorder/codecs/g711`                 | G.711 encoder                                                                  |
| `@csnight/audio-recorder/plugins/level-meter`         | `createLevelMeterPlugin()`                                                     |
| `@csnight/audio-recorder/plugins/streaming-export`    | `createStreamingExportPlugin()`                                                |
| `@csnight/audio-recorder/plugins/sonic-export`        | `createSonicExportPlugin()`                                                    |
| `@csnight/audio-recorder/plugins/dsp`                 | `createHighpassPlugin()` / `createLowpassPlugin()` / `createNoiseGatePlugin()` |
| `@csnight/audio-recorder/plugins/asr-export`          | `createAsrExportPlugin()`                                                      |
| `@csnight/audio-recorder/plugins/frequency-histogram` | `createFrequencyHistogramPlugin()`                                             |
| `@csnight/audio-recorder/plugins/dtmf`                | `encodeDtmf()` / `lookupDtmfFrequencies()` / `createDtmfDecoderPlugin()`       |
| `@csnight/audio-recorder/plugins/nmn2pcm`             | `nmn2pcm()` / `DEFAULT_NMN_OPTIONS` / `DYNAMIC_VELOCITY` / `NMN_KEY_OFFSETS`   |
| `@csnight/audio-recorder/plugins/streaming-player`    | `createStreamingPlayer()`                                                      |
| `@csnight/audio-recorder/storage/opfs`                | `createOpfsPersistencePlugin()`                                                |
| `@csnight/audio-recorder/storage/indexeddb`           | `createIndexedDbPersistencePlugin()`                                           |

### Events

#### `statechange`

Fired when recorder state changes.

| Field           | Type                     | Description                |
| --------------- | ------------------------ | -------------------------- |
| `controller`    | `RecorderController`     | Recorder instance          |
| `sessionId`     | `string`                 | Current session identifier |
| `emittedAt`     | `number`                 | Event timestamp in ms      |
| `previousState` | `RecorderState`          | Previous state             |
| `state`         | `RecorderState`          | Next state                 |
| `runtimeInfo`   | `RecorderRuntimeInfo`    | Runtime info snapshot      |
| `summary`       | `RecorderSessionSummary` | Session summary snapshot   |

#### `frame:async`

Fired asynchronously for accepted PCM frames.

| Field         | Type                     | Description                |
| ------------- | ------------------------ | -------------------------- |
| `controller`  | `RecorderController`     | Recorder instance          |
| `sessionId`   | `string`                 | Current session identifier |
| `emittedAt`   | `number`                 | Event timestamp in ms      |
| `frame`       | `AudioFrame`             | PCM frame                  |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot      |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot   |

`frame` fields:

| Field        | Type           | Description             |
| ------------ | -------------- | ----------------------- |
| `channels`   | `number`       | Channel count           |
| `sampleRate` | `number`       | Frame sample rate       |
| `timestamp`  | `number`       | Frame timestamp in ms   |
| `durationMs` | `number`       | Frame duration in ms    |
| `planar`     | `Int16Array[]` | Per-channel PCM samples |

#### `issue`

Fired for warnings and errors.

| Field         | Type                     | Description                |
| ------------- | ------------------------ | -------------------------- |
| `controller`  | `RecorderController`     | Recorder instance          |
| `sessionId`   | `string`                 | Current session identifier |
| `emittedAt`   | `number`                 | Event timestamp in ms      |
| `issue`       | `RecorderIssue`          | Warning or error payload   |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot      |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot   |

`issue` variants:

| Variant   | Fields                                            |
| --------- | ------------------------------------------------- |
| `warning` | `{ kind: "warning", warning: { code, message } }` |
| `error`   | `{ kind: "error", error: Error }`                 |

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
| -------------------------- | --------------------------------- |
| `createLevelMeterPlugin()` | Create the level meter plugin     |
| `RecorderLevel`            | Level payload body type           |
| `RecorderLevelChannel`     | Per-channel level type            |
| `RecorderLevelEvent`       | `plugin:level` event payload type |

Options:

None.

Event payload: `plugin:level`

| Field         | Type                     | Description                |
| ------------- | ------------------------ | -------------------------- |
| `controller`  | `RecorderController`     | Recorder instance          |
| `sessionId`   | `string`                 | Current session identifier |
| `emittedAt`   | `number`                 | Event timestamp in ms      |
| `pluginName`  | `string`                 | Plugin name                |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot      |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot   |
| `payload`     | `RecorderLevelEvent`     | Level payload              |

`payload.level` fields:

| Field      | Type                     | Description                           |
| ---------- | ------------------------ | ------------------------------------- |
| `peak`     | `number`                 | Frame peak value normalized to `0..1` |
| `rms`      | `number`                 | Frame RMS value normalized to `0..1`  |
| `channels` | `RecorderLevelChannel[]` | Per-channel level array               |

### `streaming-export`

#### Introduction

Real-time chunk export plugin. Feeds PCM frames into a `StreamEncoderDefinition` through `ChunkedEncoderBridge` and emits standardized stream packets while recording. Built-in base codecs provide `pcm` and `wav`; callers pass matching encoders through `encoders`. The plugin reuses one bridge instance across recorder sessions, resets it on `start()`, prefers Worker encoding with optional main-thread fallback, and flushes one final packet on `stop()` only when buffered output remains.

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

| Export                                 | Description                      |
| -------------------------------------- | -------------------------------- |
| `createStreamingExportPlugin(options)` | Create a streaming export plugin |
| `StreamingExportPluginOptions`         | Plugin options                   |

Options: `StreamingExportPluginOptions`

| Field                     | Type                        | Default | Description                                                                                                             |
| ------------------------- | --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `format`                  | `string`                    | `-`     | Output format key; must match a `StreamEncoderDefinition` in `encoders`                                                 |
| `encoderOptions`          | `unknown`                   | `-`     | Encoder-specific options passed to `definition.create(options)` and `bridge.reset(options)`                             |
| `encoders`                | `StreamEncoderDefinition[]` | `-`     | Available stream encoders; must include the selected `format`                                                           |
| `allowMainThreadFallback` | `boolean`                   | `true`  | Fall back to main-thread encoding when Worker execution is unavailable                                                  |
| `streamId`                | `string`                    | auto    | Fixed logical stream ID; stable across sessions. When omitted, evaluated once from `createStreamId()` or auto-generated |
| `createStreamId`          | `() => string`              | `-`     | Lazy stream ID factory called once at plugin creation time; ignored when `streamId` is set                              |
| `createSessionId`         | `() => string`              | auto    | Session ID factory called on each `start()`; defaults to `crypto.randomUUID()`-based ID                                 |
| `metadata`                | `Record<string, unknown>`   | `-`     | Static metadata attached to every emitted packet                                                                        |

`StreamEncoderDefinition` fields:

| Field           | Type                          | Description                                            |
| --------------- | ----------------------------- | ------------------------------------------------------ |
| `format`        | `string`                      | Encoder format key                                     |
| `workerFactory` | `() => Worker`                | Optional Worker factory used by `ChunkedEncoderBridge` |
| `preload`       | `() => Promise<void>`         | Optional preload hook called during plugin `setup()`   |
| `create`        | `(options?) => StreamEncoder` | Create encoder instance                                |

Event payload: `plugin:stream`

| Field         | Type                     | Description                   |
| ------------- | ------------------------ | ----------------------------- |
| `controller`  | `RecorderController`     | Recorder instance             |
| `sessionId`   | `string`                 | Current session identifier    |
| `emittedAt`   | `number`                 | Event timestamp in ms         |
| `pluginName`  | `string`                 | Plugin name                   |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot         |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot      |
| `payload`     | `StreamingPacketPayload` | Encoded stream packet payload |

`StreamingPacketPayload` fields:

| Field           | Type                                   | Description                                                                               |
| --------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
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

### `sonic-export`

#### Introduction

Real-time Sonic transform plugin. Accumulates PCM frames on a side path, applies Sonic speed / pitch / rate / volume processing, then emits standardized stream packets through a matching `StreamEncoderDefinition`. Real-time output supports `pcm` and `wav`, keeps the original channel layout, runs one main-thread Sonic pass after buffered source audio reaches `blockMs`, and emits `plugin:stream` packets without mutating the recorder core buffer. The same plugin instance also exposes offline transform helpers for snapshots or arbitrary PCM, and it is mutually exclusive with `streaming-export`; switch families only while idle via `recorder.unuse("streaming-export")` or `recorder.unuse("sonic-export")`.

Event:

- `plugin:stream`

#### Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import { wavStreamEncoder } from "@csnight/audio-recorder/codecs/base"
import { createSonicExportPlugin } from "@csnight/audio-recorder/plugins/sonic-export"

const recorder = createRecorder()
const sonic = createSonicExportPlugin({
  format: "wav",
  encoders: [wavStreamEncoder],
  speed: 1.25,
  blockMs: 200,
})

await recorder.use(sonic)

recorder.on("plugin:stream", ({ payload }) => {
  console.log(
    payload.format,
    payload.channels,
    payload.chunk.byteLength,
    payload.isFinal
  )
})
```

Offline transform example:

```ts
import { deserializePcmSnapshot } from "@csnight/audio-recorder"

const snapshot = deserializePcmSnapshot(savedSnapshotBuffer)
const processed = await sonic.transformSnapshot(snapshot, { speed: 0.85 })

console.log(processed instanceof Int16Array, processed.length)
```

#### API

| Export                             | Description                              |
| ---------------------------------- | ---------------------------------------- |
| `createSonicExportPlugin(options)` | Create a Sonic export plugin             |
| `SonicExportFormat`                | Real-time output format union            |
| `SonicExportOptions`               | Plugin options                           |
| `SonicTransformOptions`            | Shared transform options                 |
| `SonicExportPlugin`                | Plugin instance type with transform APIs |

Options: `SonicExportOptions`

| Field                     | Type                        | Default | Description                                                                                                             |
| ------------------------- | --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `format`                  | `"pcm" \| "wav"`            | `-`     | Real-time output format                                                                                                 |
| `speed`                   | `number`                    | `1`     | Time-stretch without pitch shift                                                                                        |
| `pitch`                   | `number`                    | `1`     | Pitch shift without time-stretch                                                                                        |
| `rate`                    | `number`                    | `1`     | Combined rate change affecting both speed and pitch                                                                     |
| `volume`                  | `number`                    | `1`     | Output gain multiplier                                                                                                  |
| `blockMs`                 | `number`                    | `200`   | Source audio accumulated before one Sonic transform pass                                                                |
| `encoders`                | `StreamEncoderDefinition[]` | `-`     | Available stream encoders; must include the selected `format`                                                           |
| `encoderOptions`          | `unknown`                   | `-`     | Encoder-specific options passed to `ChunkedEncoderBridge`                                                               |
| `allowMainThreadFallback` | `boolean`                   | `true`  | Fall back to main-thread chunk encoding when Worker execution is unavailable                                            |
| `streamId`                | `string`                    | auto    | Fixed logical stream ID; stable across sessions. When omitted, evaluated once from `createStreamId()` or auto-generated |
| `createStreamId`          | `() => string`              | `-`     | Lazy stream ID factory called once at plugin creation time; ignored when `streamId` is set                              |
| `createSessionId`         | `() => string`              | auto    | Session ID factory called on each `start()`; defaults to `crypto.randomUUID()`-based ID                                 |
| `metadata`                | `Record<string, unknown>`   | `-`     | Static metadata attached to every emitted packet                                                                        |

Instance methods:

| Member                                                     | Type                  | Description                                                                                               |
| ---------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `transformSnapshot(snapshot, options?)`                    | `Promise<Int16Array>` | Transform a `PcmBufferSnapshot` and return interleaved `Int16Array` PCM with the same channel layout      |
| `transform(pcm, sampleRate, channelsOrOptions?, options?)` | `Promise<Int16Array>` | Transform arbitrary interleaved PCM. Defaults to mono; pass `channels` explicitly for multi-channel input |

Event payload: `plugin:stream`

| Field         | Type                     | Description                   |
| ------------- | ------------------------ | ----------------------------- |
| `controller`  | `RecorderController`     | Recorder instance             |
| `sessionId`   | `string`                 | Current session identifier    |
| `emittedAt`   | `number`                 | Event timestamp in ms         |
| `pluginName`  | `string`                 | Plugin name                   |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot         |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot      |
| `payload`     | `StreamingPacketPayload` | Encoded stream packet payload |

`StreamingPacketPayload` fields are identical to the `streaming-export` section above.

### `dsp`

#### Introduction

Main-path DSP plugin family. These plugins run synchronously in `onBeforeFrame()` before accepted PCM frames enter the recorder buffer, session summary, `frame:async`, snapshot export, and downstream plugin `onFrame()` hooks. The built-in set currently includes `highpass`, `lowpass`, and `noise-gate`.

`highpass` and `lowpass` also implement `onFlush()`, so stop-time tail frames are committed back into the same recorder pipeline before `stop()` finalizes. The first release only supports frame-length-preserving transforms; variable-length effects such as reverb/echo tails, lookahead compressors, time-stretch, or FFT reconstruction are intentionally out of scope.

Events:

- none

#### Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import { wavExportEncoder } from "@csnight/audio-recorder/codecs/base"
import {
  createHighpassPlugin,
  createNoiseGatePlugin,
} from "@csnight/audio-recorder/plugins/dsp"

const recorder = createRecorder({
  encoders: [wavExportEncoder],
})

await recorder.use(createHighpassPlugin({ cutoffHz: 120 }))
await recorder.use(createNoiseGatePlugin({ thresholdDb: -42 }))

await recorder.open()
await recorder.start()

const summary = await recorder.stop()
const wav = await recorder.exportEncoded("wav", { bitRate: 16 })

console.log(summary.durationMs, wav.arrayBuffer.byteLength)
```

#### API

The following APIs are exported from `@csnight/audio-recorder/plugins/dsp`.

| Export                    | Description                      |
| ------------------------- | -------------------------------- |
| `createHighpassPlugin()`  | Create a high-pass filter plugin |
| `createLowpassPlugin()`   | Create a low-pass filter plugin  |
| `createNoiseGatePlugin()` | Create a noise-gate plugin       |
| `DspFilterOptions`        | Shared cutoff options type       |
| `NoiseGatePluginOptions`  | Noise-gate options type          |

`createHighpassPlugin(options?)`

| Field      | Type     | Default | Description                      |
| ---------- | -------- | ------- | -------------------------------- |
| `cutoffHz` | `number` | `120`   | High-pass cutoff frequency in Hz |

`createLowpassPlugin(options?)`

| Field      | Type     | Default | Description                     |
| ---------- | -------- | ------- | ------------------------------- |
| `cutoffHz` | `number` | `3400`  | Low-pass cutoff frequency in Hz |

`createNoiseGatePlugin(options?)`

| Field         | Type     | Default | Description                                       |
| ------------- | -------- | ------- | ------------------------------------------------- |
| `thresholdDb` | `number` | `-45`   | RMS threshold below which the frame is attenuated |
| `attackMs`    | `number` | `10`    | Gain opening smoothing time                       |
| `releaseMs`   | `number` | `80`    | Gain closing smoothing time                       |

Introduction:

- Multiple DSP plugins are chained in `recorder.use()` order.
- `onBeforeFrame()` must preserve frame timing and layout. The host keeps `timestamp`, `durationMs`, `sampleRate`, `channels`, and per-channel length stable, and only accepts transformed PCM sample data.
- If a DSP plugin throws in `onBeforeFrame()`, the host emits an `issue` error and falls back to the pre-plugin frame.
- `onFlush()` tail frames are validated against the current session format, then routed through downstream `onBeforeFrame()` plugins before they are committed.
- `highpass` and `lowpass` emit bounded tail frames only; `noise-gate` does not emit flush frames.

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
| -------------------------------- | --------------------------- |
| `createAsrExportPlugin(options)` | Create an ASR export plugin |
| `AsrChunkPayload`                | ASR chunk payload           |
| `AsrExportPluginOptions`         | Plugin options              |

Options: `AsrExportPluginOptions`

| Field             | Type                                       | Default | Description                      |
| ----------------- | ------------------------------------------ | ------- | -------------------------------- |
| `format`          | `"pcm" \| "wav"`                           | `"pcm"` | Chunk output format              |
| `encoders`        | `ExportEncoderDefinition[]`                | `-`     | Available snapshot encoders      |
| `sampleRate`      | `8000 \| 16000 \| 24000 \| 32000 \| 48000` | `16000` | Output sample rate               |
| `channels`        | `1`                                        | `-`     | Mono only                        |
| `chunkDurationMs` | `number`                                   | `40`    | Chunk duration in milliseconds   |
| `bitsPerSample`   | `16`                                       | `16`    | Currently fixed to 16-bit output |

Event payload: `plugin:asr:chunk`

| Field         | Type                     | Description                |
| ------------- | ------------------------ | -------------------------- |
| `controller`  | `RecorderController`     | Recorder instance          |
| `sessionId`   | `string`                 | Current session identifier |
| `emittedAt`   | `number`                 | Event timestamp in ms      |
| `pluginName`  | `string`                 | Plugin name                |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot      |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot   |
| `payload`     | `AsrChunkPayload`        | ASR chunk payload          |

`AsrChunkPayload` fields:

| Field         | Type             | Description           |
| ------------- | ---------------- | --------------------- |
| `format`      | `"pcm" \| "wav"` | Output format         |
| `chunk`       | `Uint8Array`     | Encoded bytes         |
| `seq`         | `number`         | Monotonic chunk index |
| `timestampMs` | `number`         | Chunk timestamp in ms |
| `durationMs`  | `number`         | Chunk duration        |
| `sampleRate`  | `number`         | Output sample rate    |
| `channels`    | `1`              | Always mono           |
| `isFinal`     | `boolean`        | Final chunk flag      |

### `frequency-histogram`

#### Introduction

Realtime FFT analysis plugin. Buffers PCM from `frame.planar[0]`, runs a pure TypeScript radix-2 FFT over fixed windows, and emits normalized spectrum bars for UI consumers.

Event:

- `plugin:fft`

#### Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import { createFrequencyHistogramPlugin } from "@csnight/audio-recorder/plugins/frequency-histogram"

const recorder = createRecorder()

await recorder.use(
  createFrequencyHistogramPlugin({
    fftSize: 2048,
    barCount: 48,
    frameInterval: 1,
  })
)

recorder.on("plugin:fft", ({ payload }) => {
  console.log(payload.bars.length, payload.timestampMs, payload.sampleRate)
})
```

#### API

Exports from `@csnight/audio-recorder/plugins/frequency-histogram`:

| Export                                    | Description                   |
| ----------------------------------------- | ----------------------------- |
| `createFrequencyHistogramPlugin(options)` | Create an FFT analysis plugin |
| `FrequencyHistogramOptions`               | Plugin options                |
| `FrequencyFftEvent`                       | `plugin:fft` payload type     |

Options: `FrequencyHistogramOptions`

| Field           | Type                          | Default | Description                             |
| --------------- | ----------------------------- | ------- | --------------------------------------- |
| `fftSize`       | `512 \| 1024 \| 2048 \| 4096` | `2048`  | FFT window size; must be a power of two |
| `barCount`      | `number`                      | `64`    | Output spectrum bar count               |
| `frameInterval` | `number`                      | `1`     | Analyze every N accepted PCM frames     |

Event payload: `plugin:fft`

| Field         | Type                     | Description                |
| ------------- | ------------------------ | -------------------------- |
| `controller`  | `RecorderController`     | Recorder instance          |
| `sessionId`   | `string`                 | Current session identifier |
| `emittedAt`   | `number`                 | Event timestamp in ms      |
| `pluginName`  | `string`                 | Plugin name                |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot      |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot   |
| `payload`     | `FrequencyFftEvent`      | FFT payload                |

`FrequencyFftEvent` fields:

| Field         | Type           | Description                              |
| ------------- | -------------- | ---------------------------------------- |
| `bars`        | `Float32Array` | Normalized spectrum bars in `[0, 1]`     |
| `timestampMs` | `number`       | End timestamp of the analyzed FFT window |
| `fftSize`     | `number`       | Effective FFT size used by the plugin    |
| `sampleRate`  | `number`       | Sample rate of the analyzed PCM window   |

### `dtmf`

#### Introduction

DTMF helper subpath with two capabilities: offline tone generation through `encodeDtmf()` and realtime keypad-tone detection through `createDtmfDecoderPlugin()`. The decoder plugin downmixes input to mono, runs a Goertzel detector, and emits recognized keys through the plugin event bus.

Event:

- `plugin:dtmf:detect`

#### Quick Start

```ts
import { createRecorder } from "@csnight/audio-recorder"
import {
  createDtmfDecoderPlugin,
  encodeDtmf,
} from "@csnight/audio-recorder/plugins/dtmf"

const recorder = createRecorder()
const tone = encodeDtmf(["1", "2", "3"], { sampleRate: 8000 })

await recorder.use(
  createDtmfDecoderPlugin({
    frameWindowMs: 40,
    minToneMs: 60,
    minGapMs: 30,
  })
)

recorder.on("plugin:dtmf:detect", ({ payload }) => {
  console.log(payload.key, payload.durationMs, tone.length)
})
```

#### API

Exports from `@csnight/audio-recorder/plugins/dtmf`:

| Export                             | Description                                 |
| ---------------------------------- | ------------------------------------------- |
| `encodeDtmf(keys, options)`        | Generate DTMF PCM tones                     |
| `lookupDtmfFrequencies(key)`       | Return the row/column frequencies for a key |
| `createDtmfDecoderPlugin(options)` | Create a realtime DTMF detector plugin      |
| `DtmfKey`                          | Supported keypad key union                  |
| `DtmfEncodeOptions`                | Tone generation options                     |
| `DtmfDecodeOptions`                | Detector options                            |
| `DtmfDetectEvent`                  | `plugin:dtmf:detect` payload type           |

Options: `DtmfEncodeOptions`

| Field        | Type     | Default | Description                            |
| ------------ | -------- | ------- | -------------------------------------- |
| `sampleRate` | `number` | `8000`  | Output PCM sample rate                 |
| `toneMs`     | `number` | `100`   | Per-key tone duration in milliseconds  |
| `gapMs`      | `number` | `50`    | Silence between adjacent keys          |
| `amplitude`  | `number` | `0.7`   | Synthesized tone amplitude in `[0, 1]` |

Options: `DtmfDecodeOptions`

| Field             | Type     | Default | Description                                 |
| ----------------- | -------- | ------- | ------------------------------------------- |
| `frameWindowMs`   | `number` | `40`    | Goertzel analysis window duration           |
| `minToneMs`       | `number` | `60`    | Minimum stable tone duration before emit    |
| `minGapMs`        | `number` | `30`    | Minimum silence gap before resetting a tone |
| `energyThreshold` | `number` | `0.03`  | RMS gate applied before running detection   |

Event payload: `plugin:dtmf:detect`

| Field         | Type                     | Description                |
| ------------- | ------------------------ | -------------------------- |
| `controller`  | `RecorderController`     | Recorder instance          |
| `sessionId`   | `string`                 | Current session identifier |
| `emittedAt`   | `number`                 | Event timestamp in ms      |
| `pluginName`  | `string`                 | Plugin name                |
| `runtimeInfo` | `RecorderRuntimeInfo`    | Runtime info snapshot      |
| `summary`     | `RecorderSessionSummary` | Session summary snapshot   |
| `payload`     | `DtmfDetectEvent`        | Detection payload          |

`DtmfDetectEvent` fields:

| Field         | Type      | Description                        |
| ------------- | --------- | ---------------------------------- |
| `key`         | `DtmfKey` | Detected keypad key                |
| `startedAtMs` | `number`  | Start timestamp of the stable tone |
| `endedAtMs`   | `number`  | End timestamp of the stable tone   |
| `durationMs`  | `number`  | Stable detected duration           |
| `rowHz`       | `number`  | Matched row frequency              |
| `colHz`       | `number`  | Matched column frequency           |

### `nmn2pcm`

#### Introduction

Standalone numbered-musical-notation to PCM converter. It parses NMN score strings, compiles key/transpose-aware note events, and synthesizes mono PCM in pure TypeScript without touching the recorder lifecycle.

#### Quick Start

```ts
import { nmn2pcm } from "@csnight/audio-recorder/plugins/nmn2pcm"

const result = nmn2pcm("!mf! [1 3 5]- 1 ~ 1 0 6.", {
  sampleRate: 16000,
  bpm: 96,
  volume: 0.6,
  key: "C",
  transpose: 0,
})

console.log(result.sampleRate, result.durationMs, result.channels)
```

#### API

Exports from `@csnight/audio-recorder/plugins/nmn2pcm`:

| Export                    | Description                                |
| ------------------------- | ------------------------------------------ |
| `nmn2pcm(score, options)` | Convert an NMN score into mono PCM         |
| `DEFAULT_NMN_OPTIONS`     | Default NMN conversion options             |
| `DYNAMIC_VELOCITY`        | Built-in dynamic-to-velocity map           |
| `NMN_KEY_OFFSETS`         | Supported tonic names and semitone offsets |
| `NmnConvertOptions`       | Conversion options                         |
| `NmnConvertResult`        | Conversion result                          |

Options: `NmnConvertOptions`

| Field        | Type     | Default | Description                                  |
| ------------ | -------- | ------- | -------------------------------------------- |
| `sampleRate` | `number` | `16000` | Output PCM sample rate                       |
| `bpm`        | `number` | `60`    | Tempo in beats per minute                    |
| `volume`     | `number` | `0.5`   | Master volume in `[0, 1]`                    |
| `key`        | `string` | `"C"`   | Major/minor tonic such as `C`, `F#`, `Am`    |
| `transpose`  | `number` | `0`     | Semitone offset applied after key resolution |

Returns: `NmnConvertResult`

| Field        | Type         | Description                  |
| ------------ | ------------ | ---------------------------- |
| `data`       | `Int16Array` | Synthesized mono PCM data    |
| `sampleRate` | `number`     | Effective output sample rate |
| `durationMs` | `number`     | Total rendered duration      |
| `channels`   | `1`          | Always mono                  |

### `streaming-player`

#### Introduction

Standalone streaming audio playback engine. Receives `StreamingPacketPayload` packets from any source (WebSocket, recorder plugin, etc.), buffers them through a reorder and jitter pipeline, decodes them via caller-supplied decoders, and schedules continuous playback on an `AudioContext`. Every `push()` writes to a persist-store, `start()` and `resume()` reset the live pipeline to follow the live edge, `replay()` is only available while paused, `persistMode` supports `"memory"`, `"indexeddb"`, and `"custom"`, and `onPacketDrop` fires when live backlog across `ReorderBuffer + JitterBuffer` exceeds `maxBufferMs`. When the `sessionId` field on an incoming packet differs from the previous session, the player automatically resets its pipeline (reorder buffer, jitter buffer, decode chain, and scheduled audio) and begins buffering for the new session — no external call to `start()` is required between recorder stop and restart cycles.

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
player.replay(5) // replay last 5 seconds (paused state only)
player.setVolume(0.8)
player.destroy()
```

#### API

Exports from `@csnight/audio-recorder/plugins/streaming-player`:

| Export                           | Description                                                             |
| -------------------------------- | ----------------------------------------------------------------------- |
| `createStreamingPlayer(options)` | Create and initialize a streaming player                                |
| `PersistStore`                   | Public history-store interface for custom persist-store implementations |
| `StreamingPlayerOptions`         | Player creation options                                                 |
| `StreamingPlayerHandle`          | Returned player control handle                                          |
| `StreamingPlayerState`           | Player state union type                                                 |
| `PersistMode`                    | Persist-store mode union type: `"memory" \| "indexeddb" \| "custom"`    |

Options: `StreamingPlayerOptions`

| Field             | Type                                                  | Default      | Description                                                                                   |
| ----------------- | ----------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `decoders`        | `AudioDecoderDefinition[]`                            | **required** | Decoder definitions; each maps a `format` string to a decode function                         |
| `targetLatencyMs` | `number`                                              | `300`        | Startup pad and jitter target depth before playback starts                                    |
| `maxBufferMs`     | `number`                                              | `3000`       | Maximum live backlog across `ReorderBuffer + JitterBuffer`; excess triggers drop-old          |
| `volume`          | `number`                                              | `1.0`        | Initial gain `[0, 1]`                                                                         |
| `persistMode`     | `"memory" \| "indexeddb" \| "custom"`                 | `"memory"`   | Select the built-in persist-store backend, or require an external one via `player.use(store)` |
| `persistBufferMs` | `number`                                              | `10000`      | Max history depth retained by the built-in persist-store; ignored in `"custom"` mode          |
| `audioContext`    | `AudioContext`                                        | auto         | External `AudioContext`; if omitted one is created internally                                 |
| `onUnderrun`      | `(detail: { bufferedMs: number }) => void`            | `-`          | Called when the total playback pipeline runs dry during playback                              |
| `onPacketDrop`    | `(detail: { count: number; reason: string }) => void` | `-`          | Called when packets are dropped due to backlog                                                |
| `onStateChange`   | `(state: StreamingPlayerState) => void`               | `-`          | Called on every state transition                                                              |

`persistMode: "indexeddb"` note:

- Packets are mirrored into IndexedDB as a side write.
- `replay()` still reads from the current in-memory history only.
- Rebuilding the player instance does not restore replay history from IndexedDB.

`persistMode: "custom"` note:

- Call `player.use(store)` exactly once before the first `push()` or `start()`.
- The custom store must implement the exported `PersistStore` interface.
- Retention, eviction, and storage limits are fully controlled by user code.
- `destroy()` does not call `clear()` on a custom store.

Handle: `StreamingPlayerHandle`

| Member            | Type                        | Description                                                                                                                   |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `state`           | `StreamingPlayerState`      | Current state: `idle \| buffering \| playing \| paused \| stopped`                                                            |
| `bufferedMs`      | `number`                    | Total playback headroom in milliseconds (`ReorderBuffer + JitterBuffer + pending decode + scheduled audio`)                   |
| `droppedPackets`  | `number`                    | Cumulative dropped packet count                                                                                               |
| `storedMs`        | `number`                    | Audio duration currently held in the persist-store (available for replay)                                                     |
| `use(store)`      | `void`                      | Register a custom `PersistStore`; only valid when `persistMode === "custom"` and before the first `push()` / `start()`        |
| `push(packet)`    | `void`                      | Feed a `StreamingPacketPayload`; always writes to persist-store and only enters the playback pipeline while buffering/playing. If `packet.sessionId` differs from the previous packet's session, the pipeline resets automatically (stop-sources, clear buffers, cut off stale decode tasks) so a recorder stop→start cycle is handled transparently without any extra player call. |
| `start()`         | `Promise<void>`             | Transition from `idle` to `buffering`; start from the live edge and prime playback with the recent startup pad                |
| `pause()`         | `void`                      | Stop pipeline and active sources; if the player created its own `AudioContext`, it also suspends it                           |
| `resume()`        | `void`                      | Reset pipeline backlog and resume from fresh live-edge packets                                                                |
| `setVolume(v)`    | `void`                      | Adjust gain `[0, 1]` at any time                                                                                              |
| `replay(seconds)` | `void`                      | Play back the last N seconds from persist-store; only valid when paused                                                       |
| `destroy()`       | `void`                      | Release all resources                                                                                                         |
| `onStateChange`   | `((state) => void) \| null` | Assignable after creation; `null` to unsubscribe                                                                              |

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

| Export                          | Description                       |
| ------------------------------- | --------------------------------- |
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

| Export                               | Description                            |
| ------------------------------------ | -------------------------------------- |
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

Export encoders resolve `sampleRate` with the same rule:

- if `options.sampleRate` is provided and supported by the encoder, it is used directly
- if `options.sampleRate` is provided but not supported, the encoder uses the nearest supported sample rate
- if `options.sampleRate` is omitted and the input snapshot sample rate is supported, the input sample rate is reused
- if `options.sampleRate` is omitted and the input snapshot sample rate is not supported, the encoder uses the nearest supported sample rate

For codecs whose supported sample-rate set depends on other options, the nearest-match lookup is constrained by those options, for example `amr` with `bandMode: "nb" | "wb"` and `ac3` vs `eac3`.

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
- sample-rate resolution is constrained by `bandMode`: `nb` resolves within 8 kHz and `wb` resolves within 16 kHz
- intended for telephony and speech-oriented pipelines

### `codecs/ac3`

AC3 / E-AC3 export based on a WASM encoder.

- exposes both `ac3` and `eac3` snapshot encoders from one subpath
- sample-rate resolution is constrained by the selected codec, so `ac3` and `eac3` may resolve to different nearest supported rates
- intended for Dolby Digital compatible delivery and transcoding workflows

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
npm run build:wasm:select -- --codec=aac,amr,ac3
```

Available selections are driven by the build script and currently map to the dedicated codec builders under `scripts/wasm/`.

### Relevant scripts

| Command                                       | Description                       |
| --------------------------------------------- | --------------------------------- |
| `npm run build:wasm`                          | Build all WASM codecs             |
| `npm run build:wasm:select -- --codec=<list>` | Build only selected WASM codecs   |
| `npm run benchmark:codecs`                    | Run codec benchmarks              |
| `npm run verify:exports`                      | Verify package export entrypoints |

### Script entrypoints

| Path                            | Description                        |
| ------------------------------- | ---------------------------------- |
| `scripts/wasm/build-docker.mjs` | Main Docker-based WASM build entry |
| `scripts/wasm/build.mjs`        | Shared WASM build orchestration    |
| `scripts/wasm/build-ac3.mjs`    | AC3 / E-AC3 build                  |
| `scripts/wasm/build-aac.mjs`    | AAC build                          |
| `scripts/wasm/build-amr.mjs`    | AMR build                          |
| `scripts/wasm/build-flac.mjs`   | FLAC build                         |
| `scripts/wasm/build-mp3.mjs`    | MP3 build                          |
| `scripts/wasm/build-opus.mjs`   | Opus build                         |

## Browser Support

Based on direct API usage in `src/` and `vite.config.ts` target `es2022`.

### Main library

| Module                      | Chrome | Firefox | Safari | Notes                                                                 |
| --------------------------- | -----: | ------: | -----: | --------------------------------------------------------------------- |
| Core recorder               |     66 |      76 |   14.1 | `AudioWorkletNode` path is the stable baseline                        |
| Auto input fallback         |     66 |      76 |   14.1 | Falls back to `audio-worklet` when PCM `MediaRecorder` is unavailable |
| `media-recorder` path       |    105 |       - |      - | Uses `MediaRecorder.isTypeSupported("audio/webm; codecs=pcm")`        |
| `script-processor` fallback |     35 |      25 |      6 | Legacy fallback only                                                  |

### Plugins

| Plugin                | Chrome | Firefox | Safari | Notes                                           |
| --------------------- | -----: | ------: | -----: | ----------------------------------------------- |
| `level-meter`         |     66 |      76 |   14.1 | PCM frame consumer                              |
| `streaming-export`    |     66 |      76 |   14.1 | Worker-based chunk export                       |
| `sonic-export`        |     66 |      76 |   14.1 | Bypass Sonic transform + chunk export           |
| `dsp`                 |     66 |      76 |   14.1 | Main-path frame DSP + bounded flush tail        |
| `asr-export`          |     66 |      76 |   14.1 | PCM chunking and registered encoders            |
| `frequency-histogram` |     66 |      76 |   14.1 | Pure TypeScript FFT analysis on recorder frames |
| `dtmf`                |     66 |      76 |   14.1 | Realtime DTMF detector + offline tone synthesis |
| `nmn2pcm`             |     57 |      52 |     11 | Pure TypeScript score-to-PCM conversion         |

### Codecs

| Codec | Chrome | Firefox | Safari | Notes                       |
| ----- | -----: | ------: | -----: | --------------------------- |
| PCM   |     57 |      52 |     11 | Pure typed-array processing |
| WAV   |     57 |      52 |     11 | Pure file packaging         |
| G.711 |     57 |      52 |     11 | Pure arithmetic             |
| MP3   |     57 |      52 |     11 | WASM encoder                |
| FLAC  |     57 |      52 |     11 | WASM encoder                |
| Opus  |     57 |      52 |     11 | WASM encoder                |
| AAC   |     57 |      52 |     11 | WASM encoder                |
| AMR   |     57 |      52 |     11 | WASM encoder                |
| AC3   |     57 |      52 |     11 | WASM encoder                |
| E-AC3 |     57 |      52 |     11 | WASM encoder                |

### Storage

| Module              | Chrome | Firefox | Safari | Notes                              |
| ------------------- | -----: | ------: | -----: | ---------------------------------- |
| `storage/indexeddb` |     24 |      16 |      8 | Standard IndexedDB                 |
| `storage/opfs`      |    102 |     111 |   15.2 | `navigator.storage.getDirectory()` |

## Benchmarks

Latest recorded run: 2026-06-28.

### Summary

| Codec | Variant | Scenario  | Avg ms |    RTF x |   Bytes |
| ----- | ------- | --------- | -----: | -------: | ------: |
| pcm   | default | snapshot  |   0.48 | 31493.03 | 1440000 |
| pcm   | default | streaming |   3.82 |  3987.75 | 1440000 |
| wav   | default | snapshot  |   1.06 | 14286.82 | 1440044 |
| wav   | default | streaming |   2.12 |  8476.78 | 1440352 |
| mp3   | default | snapshot  | 208.64 |    74.52 |  240384 |
| mp3   | default | streaming | 202.66 |    77.35 |  240384 |
| flac  | default | snapshot  |  11.04 |  1374.19 |  679568 |
| flac  | default | streaming |  10.37 |  1447.88 |  679568 |
| opus  | ogg     | snapshot  |  49.84 |   305.77 |  262774 |
| opus  | ogg     | streaming |  49.66 |   307.30 |  263229 |
| opus  | webm    | snapshot  |  48.38 |   314.75 |  246569 |
| opus  | webm    | streaming |  48.40 |   315.27 |  246569 |
| aac   | default | snapshot  |  94.14 |   159.52 |  245066 |
| aac   | default | streaming |  96.38 |   155.70 |  245066 |
| amr   | nb      | snapshot  |  29.05 |   516.49 |   24006 |
| amr   | nb      | streaming |  29.09 |   515.67 |   24006 |
| amr   | wb      | snapshot  |  59.24 |   253.26 |   45759 |
| amr   | wb      | streaming |  59.31 |   252.93 |   45759 |

### SIMD

| Codec | Variant | Scenario  | off/on |
| ----- | ------- | --------- | -----: |
| flac  | default | snapshot  |  1.370 |
| flac  | default | streaming |  1.305 |
| opus  | ogg     | snapshot  |  1.130 |
| opus  | ogg     | streaming |  1.118 |
| opus  | webm    | snapshot  |  1.215 |
| opus  | webm    | streaming |  1.264 |
| aac   | default | snapshot  |  1.377 |
| aac   | default | streaming |  1.361 |
| amr   | nb      | snapshot  |  1.055 |
| amr   | nb      | streaming |  1.097 |
| amr   | wb      | snapshot  |  1.107 |
| amr   | wb      | streaming |  1.126 |

## Architecture

Current execution chain:

```text
createRecorder
  -> RecorderController
  -> BrowserInputAdapter
  -> BrowserInputSession
  -> input backend
  -> PluginHost.onBeforeFrame
  -> PcmFramePipeline
  -> PcmBufferStore
  -> onFrame / encoders / persistence
```

Notes:

- the root entry does not auto-register encoders
- plugins are opt-in and live under dedicated subpaths
- `dsp` plugins mutate accepted PCM on the main path and may append bounded tail frames on `stop()`
- `streaming-export`, `sonic-export`, `asr-export`, `frequency-histogram`, and `dtmf` are independent extensions
- `nmn2pcm` is a standalone score-to-PCM helper under the plugin subpath family
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
