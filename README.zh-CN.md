# @csnight/audio-recorder

[English](./README.md) | [中文](./README.zh-CN.md)

面向浏览器端麦克风和 `MediaStream` 输入的 TypeScript 录音库。适合在现代 Web 应用中构建音频录制、PCM 处理、流式导出、插件扩展、持久化存储，以及 WAV、MP3、Opus、FLAC、AAC、AMR、AC3/E-AC3、G.711 等格式输出能力。

## 目录

- [概览](#概览)
- [快速开始](#快速开始)
- [功能](#功能)
- [API](#api)
- [插件](#插件)
- [`level-meter`](#level-meter)
- [`streaming-export`](#streaming-export)
- [`sonic-export`](#sonic-export)
- [`dsp`](#dsp)
- [`asr-export`](#asr-export)
- [`frequency-histogram`](#frequency-histogram)
- [`dtmf`](#dtmf)
- [`nmn2pcm`](#nmn2pcm)
- [`streaming-player`](#streaming-player)
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
- 面向电平检测、频谱分析、播放、ASR 与简谱转 PCM 的插件扩展
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

## 功能

- 录音生命周期：`open / start / pause / resume / stop / close / destroy`
- 输入策略：`media-recorder`、`audio-worklet`、`script-processor`
- 设备枚举：`listMicrophoneDevices()`
- 能力检测：`checkRecorderCapability()`
- 录音事件：`statechange`、`frame:async`、`issue`
- 快照导出：`pcm`、`wav`、`mp3`、`flac`、`ogg`、`webm`、`g711`、`aac`、`amr`、`ac3`、`eac3`
- 持久化后端：`storage/opfs`、`storage/indexeddb`
- 内置插件子路径：`level-meter`、`streaming-export`、`sonic-export`、`dsp`、`asr-export`、`frequency-histogram`、`dtmf`、`nmn2pcm`、`streaming-player`

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

| Export                                                | Description        |
| ----------------------------------------------------- | ------------------ |
| `createRecorder(options?)`                            | 创建录音控制器     |
| `listMicrophoneDevices()`                             | 枚举麦克风设备     |
| `checkRecorderCapability()`                           | 返回浏览器能力报告 |
| `RecorderController`                                  | 录音控制器类       |
| `resample()`                                          | PCM 重采样工具     |
| `serializePcmSnapshot()` / `deserializePcmSnapshot()` | PCM 快照编解码     |
| `RecorderState`                                       | 录音状态枚举       |
| `RecorderWarningCode`                                 | 告警码枚举         |
| `RecorderInputSource`                                 | 输入来源枚举       |

### `createRecorder(options?)`

| Option                         | Type                                                                  | Default  | Notes          |
| ------------------------------ | --------------------------------------------------------------------- | -------- | -------------- |
| `sampleRate`                   | `number`                                                              | `-`      | 期望输入采样率 |
| `channelCount`                 | `number`                                                              | `-`      | 期望声道数     |
| `echoCancellation`             | `boolean`                                                             | `true`   | 输入约束       |
| `noiseSuppression`             | `boolean`                                                             | `true`   | 输入约束       |
| `autoGainControl`              | `boolean`                                                             | `true`   | 输入约束       |
| `deviceId`                     | `string`                                                              | `-`      | 目标麦克风设备 |
| `disableFrameLossCompensation` | `boolean`                                                             | `false`  | 跳过静音补帧   |
| `inputStrategy`                | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | 输入后端选择   |
| `storage`                      | `RecorderStorageOptions`                                              | `-`      | 缓冲持久化策略 |
| `encoders`                     | `ExportEncoderDefinition[]`                                           | `[]`     | 快照编码器     |

返回值：

| Type                 | Description    |
| -------------------- | -------------- |
| `RecorderController` | 录音控制器实例 |

### `storage`

通过 `createRecorder({ storage })` 配置持久化。

`RecorderStorageOptions`：

| Field                   | Type                                 | Default | Description          |
| ----------------------- | ------------------------------------ | ------- | -------------------- |
| `mode`                  | `"memory" \| "persistent" \| "auto"` | `-`     | 缓冲模式             |
| `memoryThresholdBytes`  | `number`                             | `-`     | `auto` 模式切换阈值  |
| `persistenceChunkBytes` | `number`                             | `-`     | 持久化写入目标块大小 |
| `persistencePlugin`     | `RecorderPersistencePlugin`          | `-`     | 持久化后端           |

### `RecorderController`

#### `on(event, listener)`

订阅录音器或插件事件。

参数：

| Name       | Type                     | Description |
| ---------- | ------------------------ | ----------- |
| `event`    | `keyof RecorderEventMap` | 事件名      |
| `listener` | `(payload) => void`      | 事件监听器  |

返回值：

| Type         | Description  |
| ------------ | ------------ |
| `() => void` | 取消订阅函数 |

#### `off(event, listener)`

移除事件监听器。

参数：

| Name       | Type                     | Description    |
| ---------- | ------------------------ | -------------- |
| `event`    | `keyof RecorderEventMap` | 事件名         |
| `listener` | `(payload) => void`      | 要移除的监听器 |

返回值：

| Type   | Description |
| ------ | ----------- |
| `void` | 无返回值    |

#### `getState()`

返回值：

| Type            | Description  |
| --------------- | ------------ |
| `RecorderState` | 当前录音状态 |

#### `getRuntimeInfo()`

返回值：

| Type                  | Description                |
| --------------------- | -------------------------- |
| `RecorderRuntimeInfo` | 请求值与实际输入运行时信息 |

#### `getLatestSummary()`

返回值：

| Type                     | Description  |
| ------------------------ | ------------ |
| `RecorderSessionSummary` | 当前会话摘要 |

#### `use(plugin)`

注册插件。

参数：

| Name     | Type             | Description |
| -------- | ---------------- | ----------- |
| `plugin` | `RecorderPlugin` | 插件实例    |

返回值：

| Type            | Description              |
| --------------- | ------------------------ |
| `Promise<void>` | 插件初始化完成后 resolve |

#### `unuse(name)`

在录音器处于 idle 时卸载插件或插件族前缀。

参数：

| Name   | Type     | Description                                                          |
| ------ | -------- | -------------------------------------------------------------------- |
| `name` | `string` | 插件名或插件族前缀。`streaming-export` / `sonic-export` 会卸载整个族 |

返回值：

| Type            | Description            |
| --------------- | ---------------------- |
| `Promise<void>` | 插件释放完成后 resolve |

#### `registerEncoder(definition)`

注册快照编码器。

参数：

| Name         | Type                      | Description                           |
| ------------ | ------------------------- | ------------------------------------- |
| `definition` | `ExportEncoderDefinition` | 供 `exportEncoded()` 使用的编码器定义 |

返回值：

| Type   | Description |
| ------ | ----------- |
| `void` | 无返回值    |

#### `exportEncoded(type, options?)`

使用已注册编码器导出当前 PCM 快照。

参数：

| Name      | Type                         | Description          |
| --------- | ---------------------------- | -------------------- |
| `type`    | `keyof EncoderMap \| string` | 编码器类型           |
| `options` | encoder-specific             | 对应编码器的导出参数 |

返回值：

| Type               | Description              |
| ------------------ | ------------------------ |
| `Promise<TResult>` | 所选编码器返回的编码结果 |

常见内置结果类型：

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

打开录音会话。

参数：

| Name      | Type                   | Description          |
| --------- | ---------------------- | -------------------- |
| `options` | `RecorderInputOptions` | 每次会话的输入覆盖项 |

`RecorderInputOptions` 字段：

| Field                          | Type                                                                  | Default  | Description      |
| ------------------------------ | --------------------------------------------------------------------- | -------- | ---------------- |
| `sampleRate`                   | `number`                                                              | `-`      | 期望采样率       |
| `channelCount`                 | `number`                                                              | `-`      | 期望声道数       |
| `echoCancellation`             | `boolean`                                                             | `true`   | 启用回声消除     |
| `noiseSuppression`             | `boolean`                                                             | `true`   | 启用降噪         |
| `autoGainControl`              | `boolean`                                                             | `true`   | 启用自动增益     |
| `deviceId`                     | `string`                                                              | `-`      | 目标麦克风设备   |
| `disableFrameLossCompensation` | `boolean`                                                             | `false`  | 禁用丢帧静音补偿 |
| `inputStrategy`                | `"auto" \| "media-recorder" \| "audio-worklet" \| "script-processor"` | `"auto"` | 首选输入后端     |

返回值：

| Type                           | Description                |
| ------------------------------ | -------------------------- |
| `Promise<RecorderRuntimeInfo>` | 会话打开后的实际运行时信息 |

#### `start()`

返回值：

| Type                           | Description        |
| ------------------------------ | ------------------ |
| `Promise<RecorderRuntimeInfo>` | 更新后的运行时信息 |

#### `pause()`

返回值：

| Type   | Description |
| ------ | ----------- |
| `void` | 无返回值    |

#### `resume()`

返回值：

| Type                           | Description        |
| ------------------------------ | ------------------ |
| `Promise<RecorderRuntimeInfo>` | 更新后的运行时信息 |

#### `stop()`

返回值：

| Type                              | Description  |
| --------------------------------- | ------------ |
| `Promise<RecorderSessionSummary>` | 最终会话摘要 |

#### `close()`

返回值：

| Type            | Description            |
| --------------- | ---------------------- |
| `Promise<void>` | 会话资源关闭后 resolve |

#### `destroy()`

返回值：

| Type            | Description        |
| --------------- | ------------------ |
| `Promise<void>` | 销毁完成后 resolve |

### 子路径

| Package path                                          | Exports                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `@csnight/audio-recorder/codecs/base`                 | PCM / WAV 编码器与解码器                                                       |
| `@csnight/audio-recorder/codecs/mp3`                  | MP3 编码器                                                                     |
| `@csnight/audio-recorder/codecs/flac`                 | FLAC 编码器                                                                    |
| `@csnight/audio-recorder/codecs/opus`                 | Opus 编码器                                                                    |
| `@csnight/audio-recorder/codecs/aac`                  | AAC 编码器                                                                     |
| `@csnight/audio-recorder/codecs/amr`                  | AMR 编码器                                                                     |
| `@csnight/audio-recorder/codecs/ac3`                  | AC3 / E-AC3 编码器                                                             |
| `@csnight/audio-recorder/codecs/g711`                 | G.711 编码器                                                                   |
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

### 事件

#### `statechange`

录音状态变化时触发。

| Field           | Type                     | Description    |
| --------------- | ------------------------ | -------------- |
| `controller`    | `RecorderController`     | 录音器实例     |
| `sessionId`     | `string`                 | 当前会话 ID    |
| `emittedAt`     | `number`                 | 毫秒时间戳     |
| `previousState` | `RecorderState`          | 之前状态       |
| `state`         | `RecorderState`          | 新状态         |
| `runtimeInfo`   | `RecorderRuntimeInfo`    | 运行时信息快照 |
| `summary`       | `RecorderSessionSummary` | 会话摘要快照   |

#### `frame:async`

异步 PCM 帧事件。

| Field         | Type                     | Description    |
| ------------- | ------------------------ | -------------- |
| `controller`  | `RecorderController`     | 录音器实例     |
| `sessionId`   | `string`                 | 当前会话 ID    |
| `emittedAt`   | `number`                 | 毫秒时间戳     |
| `frame`       | `AudioFrame`             | PCM 帧         |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照 |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照   |

`frame` 字段：

| Field        | Type           | Description           |
| ------------ | -------------- | --------------------- |
| `channels`   | `number`       | 声道数                |
| `sampleRate` | `number`       | 帧采样率              |
| `timestamp`  | `number`       | 帧时间戳（毫秒）      |
| `durationMs` | `number`       | 帧时长（毫秒）        |
| `planar`     | `Int16Array[]` | 按声道拆分的 PCM 样本 |

#### `issue`

告警或错误事件。

| Field         | Type                     | Description    |
| ------------- | ------------------------ | -------------- |
| `controller`  | `RecorderController`     | 录音器实例     |
| `sessionId`   | `string`                 | 当前会话 ID    |
| `emittedAt`   | `number`                 | 毫秒时间戳     |
| `issue`       | `RecorderIssue`          | 告警或错误负载 |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照 |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照   |

`issue` 变体：

| Variant   | Fields                                            |
| --------- | ------------------------------------------------- |
| `warning` | `{ kind: "warning", warning: { code, message } }` |
| `error`   | `{ kind: "error", error: Error }`                 |

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

以下运行时与事件类型从 `@csnight/audio-recorder/plugins/level-meter` 子路径导出。

| Export                     | Description                 |
| -------------------------- | --------------------------- |
| `createLevelMeterPlugin()` | 创建电平插件                |
| `RecorderLevel`            | 电平负载主体类型            |
| `RecorderLevelChannel`     | 分声道电平类型              |
| `RecorderLevelEvent`       | `plugin:level` 事件负载类型 |

Options:

None.

Event payload: `plugin:level`

| Field         | Type                     | Description    |
| ------------- | ------------------------ | -------------- |
| `controller`  | `RecorderController`     | 录音器实例     |
| `sessionId`   | `string`                 | 当前会话 ID    |
| `emittedAt`   | `number`                 | 毫秒时间戳     |
| `pluginName`  | `string`                 | 插件名         |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照 |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照   |
| `payload`     | `RecorderLevelEvent`     | 电平负载       |

`payload.level` 字段：

| Field      | Type                     | Description     |
| ---------- | ------------------------ | --------------- |
| `peak`     | `number`                 | `0..1` 范围峰值 |
| `rms`      | `number`                 | `0..1` 范围 RMS |
| `channels` | `RecorderLevelChannel[]` | 分声道电平数组  |

### `streaming-export`

#### Introduction

实时分片导出插件。录音过程中将 PCM 帧经 `ChunkedEncoderBridge` 送入 `StreamEncoderDefinition`，持续产出标准化流式 packet。内置基础编解码器提供 `pcm` 和 `wav`，调用方通过 `encoders` 传入匹配编码器。插件会在多个录音会话之间复用同一个 bridge，在 `start()` 时重置，优先使用 Worker 编码，必要时可降级到主线程；`stop()` 时只有在编码器仍有缓冲输出时才会额外 `flush()` 一个最终 packet。

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

| Export                                 | Description          |
| -------------------------------------- | -------------------- |
| `createStreamingExportPlugin(options)` | 创建实时分片导出插件 |
| `StreamingExportPluginOptions`         | 插件选项             |

Options: `StreamingExportPluginOptions`

| Field                     | Type                        | Default | Description                                                                     |
| ------------------------- | --------------------------- | ------- | ------------------------------------------------------------------------------- |
| `format`                  | `string`                    | `-`     | 输出 chunk 格式                                                                 |
| `encoderOptions`          | `unknown`                   | `-`     | 传给 `definition.create(options)` 和 `bridge.reset(options)` 的编码参数         |
| `encoders`                | `StreamEncoderDefinition[]` | `-`     | 可用流式编码器，必须包含选中的 `format`                                         |
| `allowMainThreadFallback` | `boolean`                   | `true`  | Worker 不可用时退回主线程编码                                                   |
| `streamId`                | `string`                    | 自动    | 固定逻辑流 ID；跨会话保持稳定。未传时从 `createStreamId()` 求值一次，或自动生成 |
| `createStreamId`          | `() => string`              | `-`     | 懒生成流 ID 的工厂函数，在插件创建时调用一次；设置了 `streamId` 时忽略          |
| `createSessionId`         | `() => string`              | 自动    | 每次 `start()` 时调用的会话 ID 工厂；默认基于 `crypto.randomUUID()` 生成        |
| `metadata`                | `Record<string, unknown>`   | `-`     | 附加到每个 packet 的静态元数据                                                  |

`StreamEncoderDefinition` 字段：

| Field           | Type                          | Description                                   |
| --------------- | ----------------------------- | --------------------------------------------- |
| `format`        | `string`                      | 编码格式键                                    |
| `workerFactory` | `() => Worker`                | `ChunkedEncoderBridge` 使用的可选 Worker 工厂 |
| `preload`       | `() => Promise<void>`         | 在插件 `setup()` 中调用的可选预加载钩子       |
| `create`        | `(options?) => StreamEncoder` | 创建编码器实例                                |

Event payload: `plugin:stream`

| Field         | Type                     | Description          |
| ------------- | ------------------------ | -------------------- |
| `controller`  | `RecorderController`     | 录音器实例           |
| `sessionId`   | `string`                 | 当前会话 ID          |
| `emittedAt`   | `number`                 | 毫秒时间戳           |
| `pluginName`  | `string`                 | 插件名               |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照       |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照         |
| `payload`     | `StreamingPacketPayload` | 编码流式 packet 负载 |

`StreamingPacketPayload` 字段：

| Field           | Type                                   | Description                                       |
| --------------- | -------------------------------------- | ------------------------------------------------- |
| `streamId`      | `string`                               | 逻辑流 ID；跨会话保持稳定                         |
| `sessionId`     | `string`                               | 每次 `start()` 生成的流式会话 ID                  |
| `seq`           | `number`                               | 会话内单调递增的 packet 序号                      |
| `timestampMs`   | `number`                               | 来源帧时间戳；最终 packet 为 `flush()` 时刻时间戳 |
| `durationMs`    | `number`                               | 当前 packet 覆盖的累计源帧时长                    |
| `sampleRate`    | `number`                               | packet 采样率                                     |
| `channels`      | `number`                               | packet 声道数                                     |
| `format`        | `string`                               | packet 格式                                       |
| `chunk`         | `Uint8Array`                           | 编码后的字节                                      |
| `isFinal`       | `boolean`                              | 是否为由 `flush()` 产出的最终 packet              |
| `discontinuity` | `boolean \| undefined`                 | 供传输层或播放层识别 gap 的可选标记               |
| `metadata`      | `Record<string, unknown> \| undefined` | 预留扩展字段                                      |

### `sonic-export`

#### Introduction

实时 Sonic 变速变调插件。在旁路中累积 PCM 帧，执行 Sonic 的速度 / 音调 / rate / 音量处理，再通过匹配的 `StreamEncoderDefinition` 输出标准化流式 packet。实时输出只支持 `pcm` 和 `wav`，保留原始声道布局，并在累计源音频达到 `blockMs` 后于主线程执行一次 Sonic 处理，再把结果送入 `ChunkedEncoderBridge`。插件只通过 `plugin:stream` 输出处理后的实时流，不会改写录音核心 buffer；快照和 `exportEncoded()` 仍然基于原始 PCM。同一个插件实例也提供离线转换方法，可直接处理 snapshot 或任意 PCM，并且与 `streaming-export` 互斥；切换插件族只允许在 idle 状态下通过 `recorder.unuse("streaming-export")` 或 `recorder.unuse("sonic-export")` 完成。

事件：

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

离线转换示例：

```ts
import { deserializePcmSnapshot } from "@csnight/audio-recorder"

const snapshot = deserializePcmSnapshot(savedSnapshotBuffer)
const processed = await sonic.transformSnapshot(snapshot, { speed: 0.85 })

console.log(processed instanceof Int16Array, processed.length)
```

#### API

| Export                             | Description                   |
| ---------------------------------- | ----------------------------- |
| `createSonicExportPlugin(options)` | 创建 Sonic 导出插件           |
| `SonicExportFormat`                | 实时输出格式联合类型          |
| `SonicExportOptions`               | 插件选项                      |
| `SonicTransformOptions`            | Sonic 处理参数                |
| `SonicExportPlugin`                | 带离线转换 API 的插件实例类型 |

Options: `SonicExportOptions`

| Field                     | Type                        | Default | Description                                                                     |
| ------------------------- | --------------------------- | ------- | ------------------------------------------------------------------------------- |
| `format`                  | `"pcm" \| "wav"`            | `-`     | 实时输出格式                                                                    |
| `speed`                   | `number`                    | `1`     | 变速不变调                                                                      |
| `pitch`                   | `number`                    | `1`     | 变调不变速                                                                      |
| `rate`                    | `number`                    | `1`     | 同时影响速度和音调                                                              |
| `volume`                  | `number`                    | `1`     | 输出音量倍率                                                                    |
| `blockMs`                 | `number`                    | `200`   | 触发一次 Sonic 处理前累计的源音频时长                                           |
| `encoders`                | `StreamEncoderDefinition[]` | `-`     | 可用流式编码器，必须包含选中的 `format`                                         |
| `encoderOptions`          | `unknown`                   | `-`     | 传给 `ChunkedEncoderBridge` 的编码器参数                                        |
| `allowMainThreadFallback` | `boolean`                   | `true`  | Worker 不可用时回退到主线程执行 chunk 编码                                      |
| `streamId`                | `string`                    | 自动    | 固定逻辑流 ID；跨会话保持稳定。未传时从 `createStreamId()` 求值一次，或自动生成 |
| `createStreamId`          | `() => string`              | `-`     | 懒生成流 ID 的工厂函数，在插件创建时调用一次；设置了 `streamId` 时忽略          |
| `createSessionId`         | `() => string`              | 自动    | 每次 `start()` 时调用的会话 ID 工厂；默认基于 `crypto.randomUUID()` 生成        |
| `metadata`                | `Record<string, unknown>`   | `-`     | 附加到每个 packet 的静态元数据                                                  |

实例方法：

| Member                                                     | Type                  | Description                                                         |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| `transformSnapshot(snapshot, options?)`                    | `Promise<Int16Array>` | 处理 `PcmBufferSnapshot`，返回保持原声道布局的交织 `Int16Array` PCM |
| `transform(pcm, sampleRate, channelsOrOptions?, options?)` | `Promise<Int16Array>` | 处理任意交织 PCM。默认按单声道解释；多声道输入需要显式传 `channels` |

Event payload: `plugin:stream`

| Field         | Type                     | Description          |
| ------------- | ------------------------ | -------------------- |
| `controller`  | `RecorderController`     | 录音器实例           |
| `sessionId`   | `string`                 | 当前会话 ID          |
| `emittedAt`   | `number`                 | 毫秒时间戳           |
| `pluginName`  | `string`                 | 插件名               |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照       |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照         |
| `payload`     | `StreamingPacketPayload` | 编码流式 packet 负载 |

`StreamingPacketPayload` 字段与上面的 `streaming-export` 一致。

### `dsp`

#### Introduction

主链路 DSP 插件族。这组插件会在 `onBeforeFrame()` 中同步运行，位置在 PCM 帧进入录音 buffer、会话摘要、`frame:async`、快照导出以及后续插件 `onFrame()` 之前。当前内置三种实现：`highpass`、`lowpass`、`noise-gate`。

其中 `highpass` 和 `lowpass` 还实现了 `onFlush()`，因此在 `stop()` 阶段产生的尾帧会重新写回同一条录音主链。当前这一版只支持“长度不变”的逐帧处理；混响/回声尾音、lookahead 压缩、变速类变长输出、FFT 重建类效果器都不在当前支持范围内。

事件：

- 无

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

以下 API 从 `@csnight/audio-recorder/plugins/dsp` 子路径导出。

| Export                    | Description         |
| ------------------------- | ------------------- |
| `createHighpassPlugin()`  | 创建高通滤波插件    |
| `createLowpassPlugin()`   | 创建低通滤波插件    |
| `createNoiseGatePlugin()` | 创建噪声门插件      |
| `DspFilterOptions`        | cutoff 参数共享类型 |
| `NoiseGatePluginOptions`  | 噪声门参数类型      |

`createHighpassPlugin(options?)`

| Field      | Type     | Default | Description        |
| ---------- | -------- | ------- | ------------------ |
| `cutoffHz` | `number` | `120`   | 高通截止频率（Hz） |

`createLowpassPlugin(options?)`

| Field      | Type     | Default | Description        |
| ---------- | -------- | ------- | ------------------ |
| `cutoffHz` | `number` | `3400`  | 低通截止频率（Hz） |

`createNoiseGatePlugin(options?)`

| Field         | Type     | Default | Description                 |
| ------------- | -------- | ------- | --------------------------- |
| `thresholdDb` | `number` | `-45`   | 低于该 RMS 阈值时衰减当前帧 |
| `attackMs`    | `number` | `10`    | 增益打开平滑时间            |
| `releaseMs`   | `number` | `80`    | 增益关闭平滑时间            |

介绍：

- 多个 DSP 插件按 `recorder.use()` 注册顺序串联执行。
- `onBeforeFrame()` 必须保持帧时间轴和格式稳定。宿主会强制保留 `timestamp`、`durationMs`、`sampleRate`、`channels` 以及每声道长度，只接收变换后的 PCM 样本数据。
- DSP 插件在 `onBeforeFrame()` 中抛错时，宿主会发出 `issue` 错误，并回退到该插件处理前的帧。
- `onFlush()` 产出的尾帧会先校验当前录音会话的采样率与声道数，再继续经过下游 `onBeforeFrame()` 插件，最后才写入主链路。
- `highpass` 和 `lowpass` 只会输出有界尾帧；`noise-gate` 不会产出 flush 帧。

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
  console.log(payload.seq, payload.chunk.byteLength, payload.isFinal)
})
```

#### API

以下类型从 `@csnight/audio-recorder/plugins/asr-export` 子路径导出。

| Export                           | Description           |
| -------------------------------- | --------------------- |
| `createAsrExportPlugin(options)` | 创建 ASR 分片导出插件 |
| `AsrChunkPayload`                | ASR chunk 负载        |
| `AsrExportPluginOptions`         | 插件选项              |

Options: `AsrExportPluginOptions`

| Field             | Type                                       | Default | Description            |
| ----------------- | ------------------------------------------ | ------- | ---------------------- |
| `format`          | `"pcm" \| "wav"`                           | `"pcm"` | chunk 输出格式         |
| `encoders`        | `ExportEncoderDefinition[]`                | `-`     | 可用快照编码器         |
| `sampleRate`      | `8000 \| 16000 \| 24000 \| 32000 \| 48000` | `16000` | 输出采样率             |
| `channels`        | `1`                                        | `-`     | 仅支持单声道           |
| `chunkDurationMs` | `number`                                   | `40`    | chunk 时长（毫秒）     |
| `bitsPerSample`   | `16`                                       | `16`    | 当前固定为 16-bit 输出 |

Event payload: `plugin:asr:chunk`

| Field         | Type                     | Description    |
| ------------- | ------------------------ | -------------- |
| `controller`  | `RecorderController`     | 录音器实例     |
| `sessionId`   | `string`                 | 当前会话 ID    |
| `emittedAt`   | `number`                 | 毫秒时间戳     |
| `pluginName`  | `string`                 | 插件名         |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照 |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照   |
| `payload`     | `AsrChunkPayload`        | ASR chunk 负载 |

`AsrChunkPayload` 字段：

| Field         | Type             | Description          |
| ------------- | ---------------- | -------------------- |
| `format`      | `"pcm" \| "wav"` | 输出格式             |
| `chunk`       | `Uint8Array`     | 编码后的字节         |
| `seq`         | `number`         | 单调递增序号         |
| `timestampMs` | `number`         | chunk 时间戳（毫秒） |
| `durationMs`  | `number`         | chunk 时长           |
| `sampleRate`  | `number`         | 输出采样率           |
| `channels`    | `1`              | 固定单声道           |
| `isFinal`     | `boolean`        | 是否为最终 chunk     |

### `frequency-histogram`

#### Introduction

实时 FFT 分析插件。会从 `frame.planar[0]` 累积 PCM 样本，用纯 TypeScript 的 radix-2 FFT 做定长窗口分析，并向 UI 或其他消费方发出归一化频谱柱数据。

事件：

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

`@csnight/audio-recorder/plugins/frequency-histogram` 导出：

| Export                                    | Description               |
| ----------------------------------------- | ------------------------- |
| `createFrequencyHistogramPlugin(options)` | 创建 FFT 分析插件         |
| `FrequencyHistogramOptions`               | 插件选项                  |
| `FrequencyFftEvent`                       | `plugin:fft` 事件负载类型 |

选项：`FrequencyHistogramOptions`

| Field           | Type                          | Default | Description                    |
| --------------- | ----------------------------- | ------- | ------------------------------ |
| `fftSize`       | `512 \| 1024 \| 2048 \| 4096` | `2048`  | FFT 窗口大小，必须为 2 的幂    |
| `barCount`      | `number`                      | `64`    | 输出频谱柱数量                 |
| `frameInterval` | `number`                      | `1`     | 每隔 N 个已接收 PCM 帧分析一次 |

Event payload: `plugin:fft`

| Field         | Type                     | Description    |
| ------------- | ------------------------ | -------------- |
| `controller`  | `RecorderController`     | 录音器实例     |
| `sessionId`   | `string`                 | 当前会话 ID    |
| `emittedAt`   | `number`                 | 毫秒时间戳     |
| `pluginName`  | `string`                 | 插件名         |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照 |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照   |
| `payload`     | `FrequencyFftEvent`      | FFT 负载       |

`FrequencyFftEvent` 字段：

| Field         | Type           | Description               |
| ------------- | -------------- | ------------------------- |
| `bars`        | `Float32Array` | `[0, 1]` 归一化频谱柱数据 |
| `timestampMs` | `number`       | 当前 FFT 窗口结束时刻     |
| `fftSize`     | `number`       | 实际使用的 FFT 窗口大小   |
| `sampleRate`  | `number`       | 被分析 PCM 的采样率       |

### `dtmf`

#### Introduction

DTMF 辅助子路径，包含两类能力：通过 `encodeDtmf()` 离线合成电话按键音，以及通过 `createDtmfDecoderPlugin()` 在录音过程中实时识别按键音。解码插件会先下混到单声道，再使用 Goertzel 检测器识别稳定音调，并通过插件事件总线输出结果。

事件：

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

`@csnight/audio-recorder/plugins/dtmf` 导出：

| Export                             | Description                   |
| ---------------------------------- | ----------------------------- |
| `encodeDtmf(keys, options)`        | 生成 DTMF PCM 按键音          |
| `lookupDtmfFrequencies(key)`       | 返回某个按键对应的行/列频率   |
| `createDtmfDecoderPlugin(options)` | 创建实时 DTMF 检测插件        |
| `DtmfKey`                          | 支持的按键联合类型            |
| `DtmfEncodeOptions`                | 合成选项                      |
| `DtmfDecodeOptions`                | 检测选项                      |
| `DtmfDetectEvent`                  | `plugin:dtmf:detect` 负载类型 |

选项：`DtmfEncodeOptions`

| Field        | Type     | Default | Description               |
| ------------ | -------- | ------- | ------------------------- |
| `sampleRate` | `number` | `8000`  | 输出 PCM 采样率           |
| `toneMs`     | `number` | `100`   | 单个按键音时长（毫秒）    |
| `gapMs`      | `number` | `50`    | 相邻按键之间的静音间隔    |
| `amplitude`  | `number` | `0.7`   | `[0, 1]` 范围内的合成振幅 |

选项：`DtmfDecodeOptions`

| Field             | Type     | Default | Description                  |
| ----------------- | -------- | ------- | ---------------------------- |
| `frameWindowMs`   | `number` | `40`    | Goertzel 分析窗口时长        |
| `minToneMs`       | `number` | `60`    | 触发事件前所需的最短稳定时长 |
| `minGapMs`        | `number` | `30`    | 清空当前候选音调前的最短静音 |
| `energyThreshold` | `number` | `0.03`  | 执行检测前的 RMS 能量门限    |

Event payload: `plugin:dtmf:detect`

| Field         | Type                     | Description    |
| ------------- | ------------------------ | -------------- |
| `controller`  | `RecorderController`     | 录音器实例     |
| `sessionId`   | `string`                 | 当前会话 ID    |
| `emittedAt`   | `number`                 | 毫秒时间戳     |
| `pluginName`  | `string`                 | 插件名         |
| `runtimeInfo` | `RecorderRuntimeInfo`    | 运行时信息快照 |
| `summary`     | `RecorderSessionSummary` | 会话摘要快照   |
| `payload`     | `DtmfDetectEvent`        | 检测负载       |

`DtmfDetectEvent` 字段：

| Field         | Type      | Description      |
| ------------- | --------- | ---------------- |
| `key`         | `DtmfKey` | 识别到的按键     |
| `startedAtMs` | `number`  | 稳定音调起始时间 |
| `endedAtMs`   | `number`  | 稳定音调结束时间 |
| `durationMs`  | `number`  | 稳定识别时长     |
| `rowHz`       | `number`  | 匹配到的行频     |
| `colHz`       | `number`  | 匹配到的列频     |

### `nmn2pcm`

#### Introduction

独立的简谱转 PCM 工具。它会解析数字简谱字符串，结合调号和移调信息编译音符事件，再用纯 TypeScript 合成单声道 PCM，不依赖录音器生命周期。

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

`@csnight/audio-recorder/plugins/nmn2pcm` 导出：

| Export                    | Description                |
| ------------------------- | -------------------------- |
| `nmn2pcm(score, options)` | 将简谱转换为单声道 PCM     |
| `DEFAULT_NMN_OPTIONS`     | 默认简谱转换选项           |
| `DYNAMIC_VELOCITY`        | 内置力度到速度映射表       |
| `NMN_KEY_OFFSETS`         | 支持的调名与半音偏移映射表 |
| `NmnConvertOptions`       | 转换选项                   |
| `NmnConvertResult`        | 转换结果                   |

选项：`NmnConvertOptions`

| Field        | Type     | Default | Description                    |
| ------------ | -------- | ------- | ------------------------------ |
| `sampleRate` | `number` | `16000` | 输出 PCM 采样率                |
| `bpm`        | `number` | `60`    | 每分钟拍数                     |
| `volume`     | `number` | `0.5`   | `[0, 1]` 范围内的主音量        |
| `key`        | `string` | `"C"`   | 调号，如 `C`、`F#`、`Am`       |
| `transpose`  | `number` | `0`     | 在调号解析后再叠加的半音移调量 |

返回值：`NmnConvertResult`

| Field        | Type         | Description        |
| ------------ | ------------ | ------------------ |
| `data`       | `Int16Array` | 合成后的单声道 PCM |
| `sampleRate` | `number`     | 实际输出采样率     |
| `durationMs` | `number`     | 总时长             |
| `channels`   | `1`          | 固定单声道         |

### `streaming-player`

#### Introduction

独立流式音频播放引擎。接收来自任意来源（WebSocket、录音插件等）的 `StreamingPacketPayload` 数据包，经重排与抖动缓冲管线处理后，通过调用方提供的解码器解码，并在 `AudioContext` 上调度连续播放。每次 `push()` 都会写入持久化存储，`start()` 和 `resume()` 会重置 live 播放管线并回到 live edge，`replay()` 仅在暂停状态下可用，`persistMode` 支持 `"memory"`、`"indexeddb"` 和 `"custom"`，而当 `ReorderBuffer + JitterBuffer` 的 live 积压超过 `maxBufferMs` 时会触发 `onPacketDrop`。播放器通过 `StreamingPacketPayload.sessionId` 自动检测录音会话切换：当推入的数据包携带与当前不同的 `sessionId` 时，播放器会自动重置管线并从新会话的 live edge 重新起播，无需调用方手动干预，适用于录音器 stop→start 多轮录音场景。

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

// 从任意来源推入数据包
websocket.onmessage = ({ data }) => player.push(JSON.parse(data))

// 控制
player.pause()
player.resume()
player.replay(5) // 重播最近 5 秒（仅暂停状态下可用）
player.setVolume(0.8)
player.destroy()
```

#### API

`@csnight/audio-recorder/plugins/streaming-player` 导出：

| 导出                             | 说明                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `createStreamingPlayer(options)` | 创建并初始化流式播放器                                    |
| `PersistStore`                   | 自定义持久化存储需要实现的公开接口                        |
| `StreamingPlayerOptions`         | 播放器创建选项                                            |
| `StreamingPlayerHandle`          | 播放器控制句柄                                            |
| `StreamingPlayerState`           | 播放器状态联合类型                                        |
| `PersistMode`                    | 持久化模式联合类型：`"memory" \| "indexeddb" \| "custom"` |

选项：`StreamingPlayerOptions`

| 字段              | 类型                                                  | 默认值     | 说明                                                                                    |
| ----------------- | ----------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `decoders`        | `AudioDecoderDefinition[]`                            | **必填**   | 解码器定义列表，每项将 `format` 字符串映射到解码函数                                    |
| `targetLatencyMs` | `number`                                              | `300`      | 起播垫片和抖动缓冲的目标深度（毫秒）                                                    |
| `maxBufferMs`     | `number`                                              | `3000`     | `ReorderBuffer + JitterBuffer` 的最大 live 积压时长，超出后触发丢弃旧数据               |
| `volume`          | `number`                                              | `1.0`      | 初始增益 `[0, 1]`                                                                       |
| `persistMode`     | `"memory" \| "indexeddb" \| "custom"`                 | `"memory"` | 选择内置持久化存储后端，或在 `"custom"` 模式下要求通过 `player.use(store)` 注入外部实现 |
| `persistBufferMs` | `number`                                              | `10000`    | 使用内置存储时的最大历史时长（毫秒）；`"custom"` 模式下忽略                             |
| `audioContext`    | `AudioContext`                                        | 自动       | 外部 `AudioContext`；未传则内部创建                                                     |
| `onUnderrun`      | `(detail: { bufferedMs: number }) => void`            | `-`        | 整条播放管线在播放中见底时触发                                                          |
| `onPacketDrop`    | `(detail: { count: number; reason: string }) => void` | `-`        | 数据包因积压被丢弃时触发                                                                |
| `onStateChange`   | `(state: StreamingPlayerState) => void`               | `-`        | 每次状态变化时触发                                                                      |

`persistMode: "indexeddb"` 说明：

- 数据包会旁路镜像写入 IndexedDB。
- `replay()` 仍只读取当前实例的内存历史。
- 重建播放器实例后，不会从 IndexedDB 恢复重播历史。

`persistMode: "custom"` 说明：

- 必须在首次 `push()` / `start()` 之前调用一次 `player.use(store)`。
- 自定义 store 需要实现公开导出的 `PersistStore` 接口。
- 保留时长、淘汰策略、容量上限完全由用户代码自己控制。
- `destroy()` 不会对自定义 store 自动调用 `clear()`。

句柄：`StreamingPlayerHandle`

| 成员              | 类型                        | 说明                                                                                                  |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `state`           | `StreamingPlayerState`      | 当前状态：`idle \| buffering \| playing \| paused \| stopped`                                         |
| `bufferedMs`      | `number`                    | 当前整条播放管线的总余量（毫秒），包含 `ReorderBuffer + JitterBuffer + 待解码时长 + 已调度未播完音频` |
| `droppedPackets`  | `number`                    | 累计丢弃数据包数量                                                                                    |
| `storedMs`        | `number`                    | 持久化存储中的音频时长（毫秒），可用于展示可重播时长                                                  |
| `use(store)`      | `void`                      | 注册自定义 `PersistStore`；仅 `persistMode === "custom"` 且首次 `push()` / `start()` 之前可调用       |
| `push(packet)`    | `void`                      | 推入一个 `StreamingPacketPayload`；始终写入持久化存储，只有 `buffering / playing` 时才进入播放管线；若检测到 `sessionId` 变化（录音停止后重新开始），自动重置整条播放管线并丢弃旧 session 的积压数据，无需重新调用 `start()` |
| `start()`         | `Promise<void>`             | 从 `idle` 切换到 `buffering`；从 live edge 起播，并用最近一小段历史作为启动垫片                       |
| `pause()`         | `void`                      | 暂停 `AudioContext` 并停止管线；新数据包仍写入持久化存储                                              |
| `resume()`        | `void`                      | 重置管线积压并从新的 live 数据包恢复播放                                                              |
| `setVolume(v)`    | `void`                      | 随时调整增益 `[0, 1]`                                                                                 |
| `replay(seconds)` | `void`                      | 从持久化存储播放最近 N 秒；仅暂停状态下有效                                                           |
| `destroy()`       | `void`                      | 释放所有资源                                                                                          |
| `onStateChange`   | `((state) => void) \| null` | 创建后可直接赋值；`null` 表示取消监听                                                                 |

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

| Export                          | Description          |
| ------------------------------- | -------------------- |
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

| Export                               | Description               |
| ------------------------------------ | ------------------------- |
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

所有导出编码器在 `sampleRate` 上都遵循同一套解析规则：

- 如果显式传入了 `options.sampleRate`，且当前编码器支持该采样率，则直接使用
- 如果显式传入了 `options.sampleRate`，但当前编码器不支持，则自动选择最近的受支持采样率
- 如果没有传入 `options.sampleRate`，且输入快照的实际采样率受支持，则沿用实际采样率
- 如果没有传入 `options.sampleRate`，且输入快照的实际采样率不受支持，则自动选择最近的受支持采样率

对于“受支持采样率集合会被其他选项约束”的编码器，最近值的选择会在该受限集合内进行，例如 `amr` 的 `bandMode: "nb" | "wb"`，以及 `ac3` 和 `eac3` 两种模式。

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
- 采样率解析受 `bandMode` 约束：`nb` 只会解析到 8 kHz，`wb` 只会解析到 16 kHz
- 面向电话语音和 speech pipeline

### `codecs/ac3`

基于 WASM 编码器的 AC3 / E-AC3 导出。

- 同一子路径同时暴露 `ac3` 和 `eac3` 两种快照编码器
- 采样率解析受所选 codec 约束，因此 `ac3` 和 `eac3` 可能会解析到不同的最近受支持采样率
- 适合 Dolby Digital 兼容分发或转码流程

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
npm run build:wasm:select -- --codec=aac,amr,ac3
```

可选项由构建脚本驱动，当前对应 `scripts/wasm/` 下的各编码器构建入口。

### 相关脚本

| Command                                       | Description            |
| --------------------------------------------- | ---------------------- |
| `npm run build:wasm`                          | 编译全部 WASM 编码器   |
| `npm run build:wasm:select -- --codec=<list>` | 只编译指定 WASM 编码器 |
| `npm run benchmark:codecs`                    | 运行编码器基准测试     |
| `npm run verify:exports`                      | 校验包导出入口         |

### 脚本入口

| Path                            | Description                    |
| ------------------------------- | ------------------------------ |
| `scripts/wasm/build-docker.mjs` | 基于 Docker 的 WASM 主构建入口 |
| `scripts/wasm/build.mjs`        | 通用 WASM 构建编排             |
| `scripts/wasm/build-ac3.mjs`    | AC3 / E-AC3 构建               |
| `scripts/wasm/build-aac.mjs`    | AAC 构建                       |
| `scripts/wasm/build-amr.mjs`    | AMR 构建                       |
| `scripts/wasm/build-flac.mjs`   | FLAC 构建                      |
| `scripts/wasm/build-mp3.mjs`    | MP3 构建                       |
| `scripts/wasm/build-opus.mjs`   | Opus 构建                      |

## 浏览器支持

基于 `src/` 中的实际 API 使用和 `vite.config.ts` 的 `es2022` 目标。

### 主库

| Module                      | Chrome | Firefox | Safari | Notes                                                          |
| --------------------------- | -----: | ------: | -----: | -------------------------------------------------------------- |
| Core recorder               |     66 |      76 |   14.1 | `AudioWorkletNode` 是稳定基线                                  |
| Auto input fallback         |     66 |      76 |   14.1 | PCM `MediaRecorder` 不可用时回退到 `audio-worklet`             |
| `media-recorder` path       |    105 |       - |      - | 使用 `MediaRecorder.isTypeSupported("audio/webm; codecs=pcm")` |
| `script-processor` fallback |     35 |      25 |      6 | 仅保底                                                         |

### 插件

| Plugin                | Chrome | Firefox | Safari | Notes                       |
| --------------------- | -----: | ------: | -----: | --------------------------- |
| `level-meter`         |     66 |      76 |   14.1 | PCM 帧消费者                |
| `streaming-export`    |     66 |      76 |   14.1 | Worker 分片导出             |
| `sonic-export`        |     66 |      76 |   14.1 | 旁路 Sonic 处理 + 分片导出  |
| `dsp`                 |     66 |      76 |   14.1 | 主链路逐帧 DSP + 有界尾帧   |
| `asr-export`          |     66 |      76 |   14.1 | PCM 切块 + 编码器           |
| `frequency-histogram` |     66 |      76 |   14.1 | 录音帧上的纯 TS FFT 分析    |
| `dtmf`                |     66 |      76 |   14.1 | 实时 DTMF 检测 + 离线按键音 |
| `nmn2pcm`             |     57 |      52 |     11 | 纯 TypeScript 简谱转 PCM    |

### 编码器

| Codec | Chrome | Firefox | Safari | Notes               |
| ----- | -----: | ------: | -----: | ------------------- |
| PCM   |     57 |      52 |     11 | 纯 typed array 处理 |
| WAV   |     57 |      52 |     11 | 纯文件封装          |
| G.711 |     57 |      52 |     11 | 纯算术              |
| MP3   |     57 |      52 |     11 | WASM 编码器         |
| FLAC  |     57 |      52 |     11 | WASM 编码器         |
| Opus  |     57 |      52 |     11 | WASM 编码器         |
| AAC   |     57 |      52 |     11 | WASM 编码器         |
| AMR   |     57 |      52 |     11 | WASM 编码器         |
| AC3   |     57 |      52 |     11 | WASM 编码器         |
| E-AC3 |     57 |      52 |     11 | WASM 编码器         |

### 存储

| Module              | Chrome | Firefox | Safari | Notes                              |
| ------------------- | -----: | ------: | -----: | ---------------------------------- |
| `storage/indexeddb` |     24 |      16 |      8 | 标准 IndexedDB                     |
| `storage/opfs`      |    102 |     111 |   15.2 | `navigator.storage.getDirectory()` |

## 基准测试

最近一次记录：2026-06-28。

### 汇总

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

## 架构

当前执行链：

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

说明：

- 根入口不会自动注册编码器
- 插件都是显式启用的独立子路径
- `dsp` 插件会直接改写主链路 PCM，并可在 `stop()` 时补出有界尾帧
- `streaming-export`、`sonic-export`、`asr-export`、`frequency-histogram`、`dtmf` 都是独立扩展
- `nmn2pcm` 是位于插件子路径体系下的独立简谱转 PCM 工具
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
