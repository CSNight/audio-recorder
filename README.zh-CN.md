# @csnight/audio-recorder

[English](./README.md) | [中文](./README.zh-CN.md)

面向浏览器端麦克风和 `MediaStream` 输入的 TypeScript 录音库。适合在现代 Web 应用中构建音频录制、PCM 处理、流式导出、插件扩展、持久化存储，以及 WAV、MP3、Opus、FLAC、AAC、AMR、G.711 等格式输出能力。

## 目录

- [概览](#概览)
- [快速开始](#快速开始)
- [功能](#功能)
- [API](#api)
- [插件](#插件)
- [`level-meter`](#level-meter)
- [`streaming-export`](#streaming-export)
- [`asr-export`](#asr-export)
- [存储](#存储)
- [`storage/opfs`](#storageopfs)
- [`storage/indexeddb`](#storageindexeddb)
- [编码器](#编码器)
- [开发](#开发)
- [浏览器支持](#浏览器支持)
- [基准测试](#基准测试)
- [架构](#架构)
- [引用](#引用)

## 概览

`@csnight/audio-recorder` 提供一套面向 Web 应用的浏览器录音能力，适合以下场景：

- 麦克风录音或外部 `MediaStream` 输入
- 浏览器输入后端自动降级与回退
- PCM 帧事件与内存内音频处理
- 录音快照导出与流式音频分片导出
- 面向电平检测、播放、ASR 的插件扩展
- 使用 OPFS 和 IndexedDB 的长时录音持久化能力

构建目标：`es2022`。

## 安装

```bash
npm install @csnight/audio-recorder
```

也可以使用：

```bash
pnpm add @csnight/audio-recorder
yarn add @csnight/audio-recorder
```

## 快速开始

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

## 功能

- 录音生命周期：`open / start / pause / resume / stop / close / destroy`
- 输入策略：`media-recorder`、`audio-worklet`、`script-processor`
- 设备枚举：`listMicrophoneDevices()`
- 能力检测：`checkRecorderCapability()`
- 录音事件：`statechange`、`frame:async`、`issue`
- 快照导出：`pcm`、`wav`、`mp3`、`flac`、`ogg`、`webm`、`g711`、`aac`、`amr`
- 持久化后端：`storage/opfs`、`storage/indexeddb`
- 内置插件：`level-meter`、`streaming-export`、`asr-export`

## API

### 主入口

```ts
import {
  createRecorder,
  listMicrophoneDevices,
  checkRecorderCapability,
  RecorderController,
} from "@csnight/audio-recorder"
```

导出项：

| Export | Description |
|---|---|
| `createRecorder(options?)` | 创建录音控制器 |
| `listMicrophoneDevices()` | 枚举麦克风设备 |
| `checkRecorderCapability()` | 返回浏览器能力报告 |
| `RecorderController` | 录音控制器类 |
| `resample()` | PCM 重采样工具 |
| `serializePcmSnapshot()` / `deserializePcmSnapshot()` | PCM 快照编解码 |
| `RecorderState` | 录音状态枚举 |
| `RecorderWarningCode` | 告警码枚举 |
| `RecorderInputSource` | 输入来源枚举 |

### `createRecorder(options?)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `sampleRate` | `number` | `-` | 期望输入采样率 |
| `channelCount` | `number` | `-` | 期望声道数 |
| `echoCancellation` | `boolean` | `true` | 输入约束 |
| `noiseSuppression` | `boolean` | `true` | 输入约束 |
| `autoGainControl` | `boolean` | `true` | 输入约束 |
| `deviceId` | `string` | `-` | 目标麦克风设备 |
| `disableFrameLossCompensation` | `boolean` | `false` | 跳过静音补帧 |
| `inputStrategy` | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | 输入后端选择 |
| `storage` | `RecorderStorageOptions` | `-` | 缓冲持久化策略 |
| `encoders` | `ExportEncoderDefinition[]` | `[]` | 快照编码器 |

返回值：

| Type | Description |
|---|---|
| `RecorderController` | 录音控制器实例 |

### `storage`

通过 `createRecorder({ storage })` 配置持久化。

`RecorderStorageOptions`：

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | `"memory" \| "persistent" \| "auto"` | `-` | 缓冲模式 |
| `memoryThresholdBytes` | `number` | `-` | `auto` 模式切换阈值 |
| `persistenceChunkBytes` | `number` | `-` | 持久化写入目标块大小 |
| `persistencePlugin` | `RecorderPersistencePlugin` | `-` | 持久化后端 |

### `RecorderController`

#### `on(event, listener)`

订阅录音器或插件事件。

参数：

| Name | Type | Description |
|---|---|---|
| `event` | `keyof RecorderEventMap` | 事件名 |
| `listener` | `(payload) => void` | 事件监听器 |

返回值：

| Type | Description |
|---|---|
| `() => void` | 取消订阅函数 |

#### `off(event, listener)`

移除事件监听器。

参数：

| Name | Type | Description |
|---|---|---|
| `event` | `keyof RecorderEventMap` | 事件名 |
| `listener` | `(payload) => void` | 要移除的监听器 |

返回值：

| Type | Description |
|---|---|
| `void` | 无返回值 |

#### `getState()`

返回值：

| Type | Description |
|---|---|
| `RecorderState` | 当前录音状态 |

#### `getRuntimeInfo()`

返回值：

| Type | Description |
|---|---|
| `RecorderRuntimeInfo` | 请求值与实际输入运行时信息 |

#### `getLatestSummary()`

返回值：

| Type | Description |
|---|---|
| `RecorderSessionSummary` | 当前会话摘要 |

#### `use(plugin)`

注册插件。

参数：

| Name | Type | Description |
|---|---|---|
| `plugin` | `RecorderPlugin` | 插件实例 |

返回值：

| Type | Description |
|---|---|
| `Promise<void>` | 插件初始化完成后 resolve |

#### `registerEncoder(definition)`

注册快照编码器。

参数：

| Name | Type | Description |
|---|---|---|
| `definition` | `ExportEncoderDefinition` | 供 `exportEncoded()` 使用的编码器定义 |

返回值：

| Type | Description |
|---|---|
| `void` | 无返回值 |

#### `exportEncoded(type, options?)`

使用已注册编码器导出当前 PCM 快照。

参数：

| Name | Type | Description |
|---|---|---|
| `type` | `keyof EncoderMap \| string` | 编码器类型 |
| `options` | encoder-specific | 对应编码器的导出参数 |

返回值：

| Type | Description |
|---|---|
| `Promise<TResult>` | 所选编码器返回的编码结果 |

常见内置结果类型：

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

打开录音会话。

参数：

| Name | Type | Description |
|---|---|---|
| `options` | `RecorderOpenOptions` | 每次会话的输入覆盖项 |

`RecorderOpenOptions` 字段：

| Field | Type | Default | Description |
|---|---|---|---|
| `sampleRate` | `number` | `-` | 期望采样率 |
| `channelCount` | `number` | `-` | 期望声道数 |
| `echoCancellation` | `boolean` | `true` | 启用回声消除 |
| `noiseSuppression` | `boolean` | `true` | 启用降噪 |
| `autoGainControl` | `boolean` | `true` | 启用自动增益 |
| `deviceId` | `string` | `-` | 目标麦克风设备 |
| `disableFrameLossCompensation` | `boolean` | `false` | 禁用丢帧静音补偿 |
| `inputStrategy` | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | 首选输入后端 |

返回值：

| Type | Description |
|---|---|
| `Promise<RecorderRuntimeInfo>` | 会话打开后的实际运行时信息 |

#### `start()`

返回值：

| Type | Description |
|---|---|
| `Promise<RecorderRuntimeInfo>` | 更新后的运行时信息 |

#### `pause()`

返回值：

| Type | Description |
|---|---|
| `void` | 无返回值 |

#### `resume()`

返回值：

| Type | Description |
|---|---|
| `Promise<RecorderRuntimeInfo>` | 更新后的运行时信息 |

#### `stop()`

返回值：

| Type | Description |
|---|---|
| `Promise<RecorderSessionSummary>` | 最终会话摘要 |

#### `close()`

返回值：

| Type | Description |
|---|---|
| `Promise<void>` | 会话资源关闭后 resolve |

#### `destroy()`

返回值：

| Type | Description |
|---|---|
| `Promise<void>` | 销毁完成后 resolve |

### 子路径

| Package path | Exports |
|---|---|
| `@csnight/audio-recorder/codecs/base` | PCM / WAV 编码器与解码器 |
| `@csnight/audio-recorder/codecs/mp3` | MP3 编码器 |
| `@csnight/audio-recorder/codecs/flac` | FLAC 编码器 |
| `@csnight/audio-recorder/codecs/opus` | Opus 编码器 |
| `@csnight/audio-recorder/codecs/aac` | AAC 编码器 |
| `@csnight/audio-recorder/codecs/amr` | AMR 编码器 |
| `@csnight/audio-recorder/codecs/g711` | G.711 编码器 |
| `@csnight/audio-recorder/plugins/level-meter` | `createLevelMeterPlugin()` |
| `@csnight/audio-recorder/plugins/streaming-export` | `createStreamingExportPlugin()` |
| `@csnight/audio-recorder/plugins/asr-export` | `createAsrExportPlugin()` |
| `@csnight/audio-recorder/storage/opfs` | `createOpfsPersistencePlugin()` |
| `@csnight/audio-recorder/storage/indexeddb` | `createIndexedDbPersistencePlugin()` |

### 事件

#### `statechange`

录音状态变化时触发。

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | 录音器实例 |
| `sessionId` | `string` | 当前会话 ID |
| `emittedAt` | `number` | 毫秒时间戳 |
| `previousState` | `RecorderState` | 之前状态 |
| `state` | `RecorderState` | 新状态 |
| `runtimeInfo` | `RecorderRuntimeInfo` | 运行时信息快照 |
| `summary` | `RecorderSessionSummary` | 会话摘要快照 |

#### `frame:async`

异步 PCM 帧事件。

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | 录音器实例 |
| `sessionId` | `string` | 当前会话 ID |
| `emittedAt` | `number` | 毫秒时间戳 |
| `frame` | `AudioFrame` | PCM 帧 |
| `runtimeInfo` | `RecorderRuntimeInfo` | 运行时信息快照 |
| `summary` | `RecorderSessionSummary` | 会话摘要快照 |

`frame` 字段：

| Field | Type | Description |
|---|---|---|
| `channels` | `number` | 声道数 |
| `sampleRate` | `number` | 帧采样率 |
| `timestamp` | `number` | 帧时间戳（毫秒） |
| `durationMs` | `number` | 帧时长（毫秒） |
| `planar` | `Int16Array[]` | 按声道拆分的 PCM 样本 |

#### `issue`

告警或错误事件。

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | 录音器实例 |
| `sessionId` | `string` | 当前会话 ID |
| `emittedAt` | `number` | 毫秒时间戳 |
| `issue` | `RecorderIssue` | 告警或错误负载 |
| `runtimeInfo` | `RecorderRuntimeInfo` | 运行时信息快照 |
| `summary` | `RecorderSessionSummary` | 会话摘要快照 |

`issue` 变体：

| Variant | Fields |
|---|---|
| `warning` | `{ kind: "warning", warning: { code, message } }` |
| `error` | `{ kind: "error", error: Error }` |

## 插件

### `level-meter`

#### Introduction

实时电平插件。消费录音帧，输出整体与分声道 `peak / rms`。

事件：

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

| Export | Description |
|---|---|
| `createLevelMeterPlugin()` | 创建电平插件 |

Options:

None.

Event payload: `plugin:level`

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | 录音器实例 |
| `sessionId` | `string` | 当前会话 ID |
| `emittedAt` | `number` | 毫秒时间戳 |
| `pluginName` | `string` | 插件名 |
| `runtimeInfo` | `RecorderRuntimeInfo` | 运行时信息快照 |
| `summary` | `RecorderSessionSummary` | 会话摘要快照 |
| `payload` | `RecorderLevelEvent` | 电平负载 |

`payload.level` 字段：

| Field | Type | Description |
|---|---|---|
| `peak` | `number` | `0..1` 范围峰值 |
| `rms` | `number` | `0..1` 范围 RMS |
| `channels` | `RecorderLevelChannel[]` | 分声道电平数组 |

### `streaming-export`

#### Introduction

实时分片导出插件。录音过程中将 PCM 帧经 `ChunkedEncoderBridge` 送入 `StreamEncoderDefinition`，持续产出标准化流式 packet。

当前行为：

- 目前只支持 `pcm` 和 `wav`
- 必须由调用方通过 `encoders` 显式传入匹配格式的编码器
- 整个插件生命周期内复用同一个 bridge，并在 `start()` 时重置
- 优先使用 Worker 编码，必要时可降级到主线程编码
- `stop()` 时若编码器仍有缓冲，会额外 `flush()` 出一个最终 packet

事件：

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

| Export | Description |
|---|---|
| `createStreamingExportPlugin(options)` | 创建实时分片导出插件 |
| `StreamEncoderDefinition` | 由调用方传入的公开编码器定义 |
| `StreamingPacketPayload` | 流式 packet 负载 |
| `StreamingExportPluginOptions` | 插件选项 |

Options: `StreamingExportPluginOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `format` | `"pcm" \| "wav"` | `-` | 输出 chunk 格式 |
| `encoderOptions` | `unknown` | `-` | 传给 `definition.create(options)` 和 `bridge.reset(options)` 的编码参数 |
| `encoders` | `StreamEncoderDefinition[]` | `-` | 可用流式编码器，必须包含选中的 `format` |
| `allowMainThreadFallback` | `boolean` | `true` | Worker 不可用时退回主线程编码 |

`StreamEncoderDefinition` 字段：

| Field | Type | Description |
|---|---|---|
| `format` | `string` | 编码格式键 |
| `workerFactory` | `() => Worker` | `ChunkedEncoderBridge` 使用的可选 Worker 工厂 |
| `preload` | `() => Promise<void>` | 在插件 `setup()` 中调用的可选预加载钩子 |
| `create` | `(options?) => StreamEncoder` | 创建编码器实例 |

Event payload: `plugin:stream`

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | 录音器实例 |
| `sessionId` | `string` | 当前会话 ID |
| `emittedAt` | `number` | 毫秒时间戳 |
| `pluginName` | `string` | 插件名 |
| `runtimeInfo` | `RecorderRuntimeInfo` | 运行时信息快照 |
| `summary` | `RecorderSessionSummary` | 会话摘要快照 |
| `payload` | `StreamingPacketPayload` | 编码流式 packet 负载 |

`StreamingPacketPayload` 字段：

| Field | Type | Description |
|---|---|---|
| `sessionId` | `string` | 每次 `start()` 生成的流式会话 ID |
| `sequenceIndex` | `number` | 会话内单调递增的 packet 序号 |
| `timestampMs` | `number` | 来源帧时间戳；最终 packet 为 `flush()` 时刻时间戳 |
| `durationMs` | `number` | 当前 packet 覆盖的累计源帧时长 |
| `sampleRate` | `number` | packet 采样率 |
| `channels` | `number` | packet 声道数 |
| `format` | `"pcm" \| "wav"` | packet 格式 |
| `chunk` | `Uint8Array` | 编码后的字节 |
| `isFinal` | `boolean` | 是否为由 `flush()` 产出的最终 packet |
| `discontinuity` | `boolean \| undefined` | 供传输层或播放层识别 gap 的可选标记 |
| `metadata` | `Record<string, unknown> \| undefined` | 预留扩展字段 |

### `asr-export`

#### Introduction

面向 ASR 的分片导出插件。会先下混到单声道，再按固定时长切片并编码。

事件：

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
  console.log(payload.sequenceIndex, payload.chunk.byteLength, payload.isFinal)
})
```

#### API

| Export | Description |
|---|---|
| `createAsrExportPlugin(options)` | 创建 ASR 分片导出插件 |
| `AsrChunkPayload` | ASR chunk 负载 |
| `AsrExportPluginOptions` | 插件选项 |

Options: `AsrExportPluginOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `format` | `"pcm" \| "wav"` | `"pcm"` | chunk 输出格式 |
| `encoders` | `ExportEncoderDefinition[]` | `-` | 可用快照编码器 |
| `sampleRate` | `8000 \| 16000 \| 24000 \| 32000 \| 48000` | `16000` | 输出采样率 |
| `channels` | `1` | `-` | 仅支持单声道 |
| `chunkDurationMs` | `number` | `40` | chunk 时长（毫秒） |
| `bitsPerSample` | `16` | `16` | 当前固定为 16-bit 输出 |

Event payload: `plugin:asr:chunk`

| Field | Type | Description |
|---|---|---|
| `controller` | `RecorderController` | 录音器实例 |
| `sessionId` | `string` | 当前会话 ID |
| `emittedAt` | `number` | 毫秒时间戳 |
| `pluginName` | `string` | 插件名 |
| `runtimeInfo` | `RecorderRuntimeInfo` | 运行时信息快照 |
| `summary` | `RecorderSessionSummary` | 会话摘要快照 |
| `payload` | `AsrChunkPayload` | ASR chunk 负载 |

`AsrChunkPayload` 字段：

| Field | Type | Description |
|---|---|---|
| `format` | `"pcm" \| "wav"` | 输出格式 |
| `chunk` | `Uint8Array` | 编码后的字节 |
| `sequenceIndex` | `number` | 单调递增序号 |
| `timestampMs` | `number` | chunk 时间戳（毫秒） |
| `durationMs` | `number` | chunk 时长 |
| `sampleRate` | `number` | 输出采样率 |
| `channels` | `1` | 固定单声道 |
| `isFinal` | `boolean` | 是否为最终 chunk |

## 存储

### `storage/opfs`

#### Introduction

OPFS 持久化后端。按 chunk 文件写入快照，适合长录音和更大的本地缓存。

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
| `createOpfsPersistencePlugin()` | 创建 OPFS 持久化插件 |

通过主录音器 `storage` 选项使用：

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

IndexedDB 持久化后端。按 chunk 写入 object store，适合更通用的兼容路径。

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
| `createIndexedDbPersistencePlugin()` | 创建 IndexedDB 持久化插件 |

通过主录音器 `storage` 选项使用：

```ts
createRecorder({
  storage: {
    mode: "auto",
    persistencePlugin: createIndexedDbPersistencePlugin(),
  },
})
```

## 编码器

### `codecs/base`

核心 PCM / WAV 支持。

- `pcmExportEncoder`：导出原始 PCM 快照
- `wavExportEncoder`：导出 WAV 文件
- `pcmStreamEncoder`：实时输出 PCM chunk
- `wavStreamEncoder`：实时输出 WAV chunk

### `codecs/mp3`

基于 WASM 编码器的 MP3 导出。

- 适合更广泛的播放兼容性
- 独立子路径暴露，避免增大根包体积

### `codecs/flac`

基于 WASM 编码器的无损 FLAC 导出。

- 适合归档或后处理流程
- 保持无损，但输出通常大于有损编码

### `codecs/opus`

基于 WASM 编码器的 Opus 导出。

- 支持 `ogg` 和 `webm` 容器
- 适合高压缩率的语音和通用音频场景

### `codecs/aac`

基于 WASM 编码器的 AAC 导出。

- 适合需要 AAC elementary stream 的流程
- 通过独立子路径暴露

### `codecs/amr`

基于 WASM 编码器的 AMR 导出。

- 支持 `nb` 和 `wb`
- 面向电话语音和 speech pipeline

### `codecs/g711`

纯 TypeScript 实现的 G.711 导出。

- 支持 `alaw` 和 `ulaw`
- 适合电话互通场景

## 开发

### 安装

```bash
npm install
```

### 常用命令

```bash
npm run dev
npm run build
npm run typecheck
npm run test
```

### 编译全部 WASM 编码器

```bash
npm run build:wasm
```

该命令会通过 Docker 触发所有 WASM 编码器的构建流程。

### 按需编译部分 WASM 编码器

```bash
npm run build:wasm:select -- --codec=mp3
npm run build:wasm:select -- --codec=flac,opus
npm run build:wasm:select -- --codec=aac,amr
```

可选项由构建脚本驱动，当前对应 `scripts/wasm/` 下的各编码器构建入口。

### 相关脚本

| Command | Description |
|---|---|
| `npm run build:wasm` | 编译全部 WASM 编码器 |
| `npm run build:wasm:select -- --codec=<list>` | 只编译指定 WASM 编码器 |
| `npm run benchmark:codecs` | 运行编码器基准测试 |
| `npm run verify:exports` | 校验包导出入口 |

### 脚本入口

| Path | Description |
|---|---|
| `scripts/wasm/build-docker.mjs` | 基于 Docker 的 WASM 主构建入口 |
| `scripts/wasm/build.mjs` | 通用 WASM 构建编排 |
| `scripts/wasm/build-aac.mjs` | AAC 构建 |
| `scripts/wasm/build-amr.mjs` | AMR 构建 |
| `scripts/wasm/build-flac.mjs` | FLAC 构建 |
| `scripts/wasm/build-mp3.mjs` | MP3 构建 |
| `scripts/wasm/build-opus.mjs` | Opus 构建 |

## 浏览器支持

基于 `src/` 中的实际 API 使用和 `vite.config.ts` 的 `es2022` 目标。

### 主库

| Module | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| Core recorder | 66 | 76 | 14.1 | `AudioWorkletNode` 是稳定基线 |
| Auto input fallback | 66 | 76 | 14.1 | PCM `MediaRecorder` 不可用时回退到 `audio-worklet` |
| `media-recorder` path | 105 | - | - | 使用 `MediaRecorder.isTypeSupported("audio/webm; codecs=pcm")` |
| `script-processor` fallback | 35 | 25 | 6 | 仅保底 |

### 插件

| Plugin | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| `level-meter` | 66 | 76 | 14.1 | PCM 帧消费者 |
| `streaming-export` | 66 | 76 | 14.1 | Worker 分片导出 |
| `asr-export` | 66 | 76 | 14.1 | PCM 切块 + 编码器 |

### 编码器

| Codec | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| PCM | 57 | 52 | 11 | 纯 typed array 处理 |
| WAV | 57 | 52 | 11 | 纯文件封装 |
| G.711 | 57 | 52 | 11 | 纯算术 |
| MP3 | 57 | 52 | 11 | WASM 编码器 |
| FLAC | 57 | 52 | 11 | WASM 编码器 |
| Opus | 57 | 52 | 11 | WASM 编码器 |
| AAC | 57 | 52 | 11 | WASM 编码器 |
| AMR | 57 | 52 | 11 | WASM 编码器 |

### 存储

| Module | Chrome | Firefox | Safari | Notes |
|---|---:|---:|---:|---|
| `storage/indexeddb` | 24 | 16 | 8 | 标准 IndexedDB |
| `storage/opfs` | 102 | 111 | 15.2 | `navigator.storage.getDirectory()` |

## 基准测试

最近一次记录：2026-06-28。

### 汇总

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

## 架构

当前执行链：

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

说明：

- 根入口不会自动注册编码器
- 插件都是显式启用的独立子路径
- `streaming-export`、`asr-export` 是独立扩展
- `opfs` 和 `indexeddb` 是可选持久化后端

详细架构文档：

- [docs/architecture/execution-chain.md](./docs/architecture/execution-chain.md)
- [docs/README.md](./docs/README.md)

## 引用

鸣谢：

- [Recorder](https://github.com/xiangyuecn/Recorder)：录音实现参考
- [Mediabunny](https://github.com/Vanilagy/mediabunny)：编码器与打包参考
- WASM 编译流程所用上游编码库：
  - [libopus](https://github.com/xiph/opus)
  - [LAME](https://sourceforge.net/projects/lame/)
  - [libFLAC](https://github.com/xiph/flac)
  - [FFmpeg](https://ffmpeg.org/)
  - [opencore-amr](https://github.com/mstorsjo/opencore-amr)
  - [vo-amrwbenc](https://sourceforge.net/projects/opencore-amr/)
