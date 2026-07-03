# Recorder TS 化长期主文档

## 文档说明

文档结构固定为三部分：

1. 方案
2. 计划
3. 实施

本次整理基于 2026-06-23 仓库实际代码状态完成，目的有三点：

- 让方案文档和当前实现重新对齐
- 保留未来阶段的长期规划，不把未开发内容误写成已落地能力
- 让后续继续开发时能直接以此文档作为阶段边界与恢复入口

约束条件：

- 单仓库
- 单 npm 包
- 单库多入口导出
- Vite 构建
- 不挂载 `window`
- 支持长期演进和中断恢复
- upstream `vendor/Recorder-master` 仅作为源码与行为参考，不做逐行复刻

实施约束：

- 方案、实现、测试三者必须同时成立，不能只凭文档推断行为
- 每个阶段都要结合 `vendor/Recorder-master` 的源码和 demo 校准关键链路
- 对浏览器 `Deprecated` API，只允许作为降级路径，不作为默认主实现
- 写代码时优先保证命名清晰、边界直接，避免为了抽象而抽象
- 类型、状态与生命周期必须可被测试和事件观测验证
- 本次整理中，`Phase 5`、`Phase 6` 未开发内容保持原文不变，`14` 节及之后内容保持原文不变

---

# 第一部分：方案

## 1. 改造目标

本项目的目标是在浏览器录音场景下重建一个模块化、可扩展、可验证的音频录制内核。

当前目标可以概括为三点：

- 易用：根入口能直接完成常见录音流程，生命周期清晰
- 可扩展：编码器、插件、持久化后端、Worker 执行模式都能显式接入
- 可渐进：每一阶段都能独立落地、测试、回归和恢复

第一版实际已经覆盖的核心能力：

- 麦克风录音
- 外部 `MediaStream` 录音
- `open / start / pause / resume / stop / close / destroy`
- PCM 帧管线与快照缓冲
- PCM / WAV / MP3 全量导出
- 实时 chunk 导出插件
- 实时电平插件
- 持久化溢写能力（OPFS / IndexedDB）
- 浏览器输入链路自动降级

当前明确不承诺：

- 全量 vendor demo 迁移
- 小程序 / App / uni-app 全适配
- 所有历史扩展格式的首版等价迁移
- 自研复杂音频后处理算法

## 2. 现有仓库核心结论

### 2.1 当前已实现能力

基于 `src/` 现状，仓库已经形成如下对外能力：

- `createRecorder()` 根入口
- `RecorderController` 生命周期控制与状态机
- `listMicrophoneDevices()` 设备枚举
- `checkRecorderCapability()` 输入能力预检
- `media-recorder / audio-worklet / script-processor` 三种输入策略
- `frame:async`、`statechange`、`issue` 三类核心事件
- `plugin:level`、`plugin:encoded-chunk` 两类稳定插件事件
- `storage/opfs`、`storage/indexeddb` 两个可选持久化子路径
- `codecs/base`、`codecs/mp3` 两组编解码器子路径

### 2.2 当前核心链路

当前仓库最重要的主链路是：

1. `createRecorder()` 注入输入默认值、存储配置、编码器定义
2. `open()` 合并本次输入参数并创建新的录音 session
3. `BrowserInputAdapter` 取流并装配 `BrowserInputSession`
4. `selectInputBackend()` 选择实际输入后端
5. 后端推送原始 PCM 帧给 `BrowserInputSession`
6. `RecorderController.handleFrame()` 同步推进 pipeline、runtime summary、plugin host
7. `stop()` 固化本次会话摘要
8. `exportEncoded()` 基于 PCM snapshot 调用显式注册的编码器导出结果

### 2.3 当前架构问题与整理重点

当前代码已经远离最初的“全局脚本库”形态，但文档仍残留多处过期表述，主要问题有：

| 问题      | 说明                                                        |
|---------|-----------------------------------------------------------|
| 文档与代码脱节 | 文档仍使用 `capture/registry/encoders` 等旧路径或旧抽象名               |
| 阶段描述滞后  | README 仍以 `Phase 3` 为主，而代码已落到输入降级、chunk plugin、MP3、持久化子路径 |
| 当前与规划混写 | 已落地能力和未来阶段能力没有清晰分界                                        |
| 对外边界不清  | 根入口、子路径、插件事件、编码器 DI 的使用方式需要重新收敛                           |

因此本次文档整理的核心原则是：

- 方案文档前半段对齐当前实现
- 未来阶段保留原始规划边界
- 不把计划中的能力写成现状

## 3. 目标架构

### 3.1 总体形态

当前与长期都遵循以下架构方向：

- 单仓库
- 单包多入口
- 核心层最小暴露
- 事件驱动
- 插件宿主与编码器 DI 并存
- Worker 优先但可降级

当前推荐使用形态：

```ts
import { createRecorder } from "/audio-recorder"
import { pcmExportEncoder, wavExportEncoder } from "/audio-recorder/codecs/base"
import { mp3ExportEncoder } from "/audio-recorder/codecs/mp3"

const recorder = createRecorder({
  encoders: [pcmExportEncoder, wavExportEncoder, mp3ExportEncoder],
})

await recorder.open()
await recorder.start()
await recorder.stop()
await recorder.exportEncoded("wav", { bitRate: 16 })
```

禁止回到以下形态：

```ts
window.Recorder = ...
```

### 3.2 单库多入口策略

当前实际导出结构：

- `/audio-recorder`
- `/audio-recorder/codecs/base`
- `/audio-recorder/codecs/mp3`
- `/audio-recorder/plugins/level-meter`
- `/audio-recorder/plugins/streaming-export`
- `/audio-recorder/storage/opfs`
- `/audio-recorder/storage/indexeddb`

设计原则：

- 根入口只保留控制器、输入能力、核心类型、基础工具函数
- 可选能力全部走子路径，避免把重依赖打进主包
- MP3 这类依赖 WASM 编码器资源的能力必须保持可选导入
- playground 只消费 `dist` 产物，验证真实发布面的行为

### 3.3 内部分层

当前实际分层如下：

| 层        | 当前目录           | 职责                                   |
|----------|----------------|--------------------------------------|
| Core     | `src/core`     | 控制器、状态机、事件总线                         |
| Input    | `src/input`    | 取流、约束诊断、后端选择、session 装配              |
| Pipeline | `src/pipeline` | PCM 帧进入缓冲前的统一入口                      |
| Buffer   | `src/buffer`   | 内存缓冲、持久化缓冲、snapshot 合并               |
| Codecs   | `src/codecs`   | PCM/WAV/MP3 快照导出与 chunk 编码定义         |
| Plugins  | `src/plugins`  | level-meter、streaming-export 及插件宿主   |
| Storage  | `src/storage`  | 持久化协议、OPFS / IndexedDB 插件            |
| Workers  | `src/workers`  | chunked encoder bridge 与 Worker core |
| Utils    | `src/utils`    | 音频帧转换、重采样、snapshot 序列化               |

## 4. 参考其他录音库后的实践结论

### 4.1 来自 `extendable-media-recorder`

保留的有效结论：

- 原生 `MediaRecorder` 适合作为优先路径，而不是历史兼容路径
- 输入后端必须有清晰的能力探测与降级机制
- 原生录制能力与自定义 PCM 主链不应混成一套黑盒实现

在当前仓库中的落地形式：

- 默认优先尝试 `media-recorder`
- 失败后降级到 `audio-worklet`，再降级到 `script-processor`
- 失败过程通过 `issue warning` 暴露给上层

### 4.2 来自 `wavesurfer.js record`

保留的有效结论：

- 事件驱动比耦合式回调更适合扩展
- 可视化与录音主链必须解耦
- 插件只消费控制器事件，不反向侵入核心状态机

在当前仓库中的落地形式：

- 控制器事件总线与插件事件总线分离
- `level-meter` 通过 `plugin:level` 暴露结果
- `streaming-export` 通过 `plugin:encoded-chunk` 暴露实时编码分片

### 4.3 来自 `opus-recorder`

保留的有效结论：

- 声道数不能只在导出阶段处理，必须贯穿输入、运行时信息、缓冲和编码
- 采样率、声道和实时输出能力都应该进入类型系统

在当前仓库中的落地形式：

- `RecorderRuntimeInfo` 区分 requested 与 actual
- `AudioFrame` 明确包含 `channels / sampleRate / planar`
- pipeline、buffer、chunk encoder 都直接消费多声道帧结构

### 4.4 来自 `RecordRTC`

保留的有效结论：

- 大而全配置对象不利于长期维护
- 对外可以统一命名，对内必须按格式拆分语义

在当前仓库中的落地形式：

- 输入参数直接平铺在 `CreateRecorderOptions` / `RecorderInputOptions`
- 存储能力收敛到 `storage` 字段
- 导出格式差异通过具体编码器选项定义处理，而不是把所有格式混成一套通用配置

## 5. 多声道支持方案

### 5.1 结论

当前代码层已经允许 `channelCount: number`，但首要支持目标仍应明确为：

- v1 优先稳定单声道与双声道
- PCM / WAV / MP3 全量导出至少正确覆盖 1/2 声道主场景
- 3+ 声道允许在类型层传递，但不承诺所有插件与编码器都完整支持

### 5.2 浏览器现实约束

必须接受以下事实：

- `channelCount` 只是请求值，不是结果保证
- 浏览器和硬件可能忽略双声道请求
- `MediaRecorder`、`AudioWorklet`、`ScriptProcessor` 的可用性在不同环境并不一致
- 多声道支持不能脱离具体后端与编码格式单独讨论

因此实现上必须遵守：

1. 先请求期望声道数
2. 再读取实际声道数
3. 运行时、摘要、导出都以实际值为准
4. 降级或约束未生效时必须有 warning 可观测

### 5.3 多声道数据模型

当前实际内部帧模型为：

```ts
export interface AudioFrame {
  channels: number
  sampleRate: number
  timestamp: number
  durationMs: number
  planar: Int16Array[]
}
```

设计要点：

- 内部统一使用 `planar`，不再默认“单个数组即单声道”
- 控制器、pipeline、插件和编码器都围绕同一帧模型工作
- MP3 当前只输出 `1 | 2` 声道，超过双声道时按前两个声道编码

### 5.4 多声道支持优先级

| 格式/链路           | 优先级 | 当前状态                      |
|-----------------|-----|---------------------------|
| PCM snapshot    | 最高  | 已支持                       |
| WAV snapshot    | 最高  | 已支持                       |
| MP3 snapshot    | 高   | 已支持 1/2 声道主路径             |
| 输入 runtime info | 最高  | 已支持 requested / actual 区分 |
| chunked encoder | 高   | PCM/WAV/MP3 已有实现          |
| 3+ 声道完整生态       | 低   | 暂不作为当前阶段承诺                |

## 6. 浏览器兼容性策略

### 6.1 能力优先级

当前实际录音后端优先级为：

1. `MediaRecorderBackend`
2. `AudioWorkletBackend`
3. `ScriptProcessorBackend`

### 6.2 兼容性结论

当前仓库对浏览器能力采取的立场是：

- `getUserMedia` 是前提能力
- `MediaRecorder` 是优先评估路径
- `AudioWorklet` 是现代降级路径
- `ScriptProcessor` 仅是历史兼容兜底
- 一切降级都必须显式告警

当前代码中的相关能力已经包括：

- `checkRecorderCapability()` 预检
- `selectInputBackend()` 逐级尝试
- `RecorderWarningCode.MediaRecorderFallback`
- `RecorderWarningCode.ScriptProcessorFallback`
- `RecorderWarningCode.AudioConstraintNotApplied`

### 6.3 浏览器兼容设计原则

- 所有能力走运行时探测，不做静态假设
- 所有降级都走 `issue` 事件，并尽量保留 warning code
- 所有录音模式都必须能回退到可导出的 PCM 主链
- 使用过时 API 时必须能说明降级原因和退出条件

## 7. 核心类型与 API

### 7.1 核心类型

当前对外最重要的类型边界包括：

```ts
export interface CreateRecorderOptions extends RecorderInputOptions {
  storage?: RecorderStorageOptions
  encoders?: ExportEncoderDefinition[]
}
```

```ts
export interface RecorderRuntimeInfo {
  requestedSampleRate?: number
  actualSampleRate?: number
  requestedChannelCount: number
  actualChannelCount?: number
  source: RecorderInputSource
  inputStrategy?: RecorderInputStrategy
}
```

```ts
export interface RecorderSessionSummary {
  frames: number
  durationMs: number
  sampleRate: number
  channels: number
}
```

### 7.2 编码器接口

当前仓库采用显式 DI，而不是全局注册表：

```ts
export interface ExportEncoderDefinition<
  TType extends string = string,
  TOptions = unknown,
  TResult = unknown,
> {
  type: TType
  export(snapshot: PcmBufferSnapshot, options?: TOptions): TResult
}
```

对应调用方式：

- `createRecorder({ encoders: [...] })`
- `recorder.registerEncoder(definition)`
- `recorder.exportEncoded(type, options)`

### 7.3 插件接口

当前插件接口：

```ts
export interface RecorderPlugin {
  name: string
  /**
   * 互斥声明：列出与本插件不能同时注册的插件 name。
   * PluginHost 在 use() 时检测冲突并抛出错误。
   */
  exclusiveWith?: string[]
  setup?(context: RecorderPluginContext): void | Promise<void>
  onStart?(): void

  /**
   * 帧预处理 hook（Phase 6 新增）。
   * 在帧进入 buffer / summary / onFrame 之前串联执行。
   * 返回修改后的帧替换原帧；返回 null / undefined 表示丢弃该帧。
   * 约束：
   *   - 返回帧的 sampleRate / channels 必须与输入一致
   *   - 返回帧的 durationMs 必须与 planar 实际采样数保持一致
   *   - 不允许返回多帧（多帧输出场景走旁路插件，不走预处理 hook）
   * 适用场景：DSP 滤波（高通/低通/噪声门）、增益调整等同步单帧处理。
   */
  onBeforeFrame?(frame: AudioFrame): AudioFrame | null | undefined

  onFrame?(frame: AudioFrame): void
  onPause?(): void
  onResume?(): void

  /**
   * stop 前冲刷 hook（Phase 6 新增）。
   * 在控制器固化 SessionSummary 之前调用。
   * 返回的帧会依次经过 buffer / summary 累计 / onFrame 广播，与正常帧处理完全一致。
   * 适用场景：IIR 滤波器等有内部状态的处理器，在 stop 时将残余状态冲刷为最终帧。
   */
  onBeforeStop?(): AudioFrame[] | void

  onStop?(): void
  dispose?(): void | Promise<void>
}
```

控制器 `handleFrame` 处理逻辑（Phase 6 起生效）：

```
原始帧
  → [onBeforeFrame 串联管道]   ← DSP 插件在此修改帧
  → 处理后帧进入 buffer / summary
  → onFrame 广播               ← 所有插件收到已预处理的帧
```

`stop()` 扩展流程（Phase 6 起生效）：

```
1. 依次调用各插件的 onBeforeStop()，将返回帧送入同一 handleFrame 路径
2. 固化 SessionSummary
3. 调用各插件的 onStop()
```

插件上下文负责提供：

- 受限事件总线门面
- 当前 runtime info
- 当前 summary
- issue 上报能力

### 7.4 事件模型

当前建议作为稳定契约维护的事件有：

- `statechange`
- `frame:async`
- `issue`
- `plugin:level`
- `plugin:encoded-chunk`

其中：

- 核心事件由 `RecorderController` 维护
- 插件事件由 `PluginHost` + `PluginEventBus` 维护
- 插件只通过 `plugin:` 前缀事件对外扩展，不要求控制器为每个插件硬编码专用 API

## 8. TypeScript 与工程规范

### 8.1 工程要求

- `strict` 模式开发
- 公开 API 显式声明类型
- 输入层、缓冲层、插件层、编码器层边界清晰
- Worker 协议集中封装，不把消息结构散落业务代码
- 浏览器 API 尽量封装在 `input/`、`storage/` 与 worker 相关模块中
- 代码目标是“优化再实现”，而不是逐行翻译 upstream

### 8.2 工具链

当前工程工具链：

- `vite`
- `typescript`
- `vitest`
- `playwright`
- `eslint`
- `prettier`
- `husky`
- `commitlint`

### 8.3 构建要求

当前构建产物必须满足：

- 输出 ESM
- 输出类型声明
- 输出多入口 `dist` 结构
- `exports` 与 `dist` 一致
- playground 以构建产物为依赖验证面

---

# 第二部分：计划

## 9. 阶段划分

项目仍按六个阶段理解，但当前仓库已经完成前四个阶段的大部分主线，并进入 `Phase 4.6` 的可用基线。

阶段状态建议按以下方式理解：

- `Phase 0`：已完成
- `Phase 1`：已完成
- `Phase 2`：已完成
- `Phase 3`：已完成
- `Phase 4`：已完成主线并沉淀为当前基线
- `Phase 5`：未开发，保持原方案
- `Phase 6`：未开发，保持原方案

## Phase 0：基线与工程初始化

目标：

- 固定行为基线
- 初始化单仓库工程

当前结论：已完成。

已落地产出：

- Vite 工程骨架
- TypeScript、Vitest、Playwright、ESLint、Prettier
- 根入口与多子路径导出
- `scripts/verify-exports.mjs` 导出校验脚本

验收基线：

- `dev/build/typecheck/test` 可运行
- 有自动化测试和 playground 验证面

## Phase 1：录制核心主链路

目标：

- 完成不依赖全局对象的录制主链路

当前结论：已完成。

已落地范围：

- `RecorderController`
- `BrowserInputAdapter`
- `BrowserInputSession`
- 麦克风与外部流输入
- 生命周期状态机
- 运行时信息与会话摘要
- `statechange / issue / frame:async` 事件

验收结论：

- 主链路已能稳定跑通 `open -> start -> stop -> close`
- 外部流与麦克风路径都可进入统一 PCM 帧链路

## Phase 2：缓冲、重采样、PCM/WAV 导出

目标：

- 形成第一批可用于业务的输出能力

当前结论：已完成。

已落地范围：

- `PcmFramePipeline`
- `PcmBufferStore` 及快照模型
- `resample()`
- PCM 快照导出
- WAV 快照导出
- 统一 `exportEncoded()` 导出入口
- 持久化协议与 `memory / auto / persistent` 三种模式

验收结论：

- PCM / WAV 导出链路已形成稳定基线
- 长录音场景不再被限制为“全量常驻内存”单一路径

## Phase 3：注册体系与插件体系

目标：

- 完成编码器与插件的正式扩展机制

当前结论：已完成，但实现形态已经从早期规划中的 `Registry class` 收敛为更轻量的显式 DI。

已落地范围：

- `PluginHost`
- `PluginEventBus`
- `level-meter` 插件
- `registerEncoder()`
- `createRecorder({ encoders })` / `exportEncoded()` 编码器注入模式

阶段结论：

- 插件已不依赖全局对象
- 编码器扩展能力已经可用
- 早期文档中的 `EncoderRegistry` 类不再是当前实现方向

## Phase 4：麦克风设备选择 + 实时 chunk 导出插件 + MP3 编码

目标：

- 支持麦克风设备枚举与选择
- 将实时 chunk 导出从控制器主链路剥离为插件
- 补齐 MP3 编码能力
- 为更重格式建立 Worker 优先、主线程可降级的执行框架

当前结论：已完成主线。

### 4.1 麦克风设备枚举与选择

当前状态：已完成。

已落地能力：

- `listMicrophoneDevices(): Promise<AudioInputDevice[]>`
- `RecorderInputOptions.deviceId?: string`
- playground 支持设备选择与刷新
- 首次无权限时设备 `label` 为空的浏览器行为已被文档化

### 4.2 实时 chunk 导出插件（StreamingExportPlugin）

当前状态：已完成。

当前实现结论：

- 实时 chunk 导出已作为独立插件存在
- 插件不依赖控制器私有状态，只消费 `onStart / onFrame / onStop` 生命周期
- 对外统一通过 `plugin:encoded-chunk` 发出分片事件
- 调用方必须显式传入 `encoders: StreamEncoderDefinition[]`

当前使用方式：

```ts
import { createStreamingExportPlugin } from "/audio-recorder/plugins/streaming-export"
import { wavStreamEncoder } from "/audio-recorder/codecs/base"

await recorder.use(
  createStreamingExportPlugin({
    format: "wav",
    encoders: [wavStreamEncoder],
  })
)
```

### 4.3 统一 Worker Bridge（ChunkedEncoderBridge）

当前状态：已完成。

当前实现结论：

- `ChunkedEncoderBridge` 已成为流式编码的统一执行桥
- 优先走 `workerFactory`
- Worker 不可用时可降级到主线程同步编码
- `ChunkedEncoder` 逻辑本身不依赖浏览器 API，可被 Worker 与主线程共用

### 4.4 MP3 能力

当前状态：已完成。

当前实现结论：

- MP3 通过 `/audio-recorder/codecs/mp3` 子路径提供
- MP3 WASM 编码器依赖被隔离在可选子路径内，不污染主包
- 同时提供：
  - `mp3ExportEncoder`
  - `mp3StreamEncoder`
  - MP3 专属 Worker

### 4.5 子路径导出

当前状态：已完成。

当前导出面已覆盖：

- `./plugins/level-meter`
- `./plugins/streaming-export`
- `./storage/opfs`
- `./storage/indexeddb`
- `./codecs/base`
- `./codecs/mp3`

### 4.6 Codec 插件化架构基线

当前状态：已形成可用基线。

当前实现相对早期规划有两点收敛：

1. 不再依赖全局 `defaultEncoderRegistry` 一类的运行时全局注册表
2. 快照导出与流式编码都改为调用方显式注入定义对象

当前可以把 `Phase 4.6` 的实际成果总结为：

- codec 可按子路径独立引入
- Worker 可按 codec 独立隔离
- 主包不再被 MP3 这类重依赖污染
- export encoder 与 stream encoder 都已具备统一扩展接口
- 后续新增 OGG / AMR / G711 等格式时，可以沿用同一目录与注入模式扩展

## Phase 5：编解码器扩展

目标：

- 在 MP3 codec 插件化模式基础上，按需补齐 AMR / OGG / WebM / G711 编码器，并为所有格式（含已有的 PCM / WAV / MP3）建立统一的解码入口。

### 5.1 现状确认（Phase 4.6 完成后基线）

已实现（无需重复）：

- PCM 编解码：`src/codecs/pcm/`（`pcmExportEncoder` 从 `codecs/base/index` 导出，用户显式传入）
- WAV 编解码：`src/codecs/wav/`（`wavExportEncoder` 从 `codecs/base/index` 导出，用户显式传入；`codecs/base/index` 为 PCM+WAV 合并入口）
- MP3 编码：`src/codecs/mp3/`（`mp3ExportEncoder` + `mp3StreamEncoder`，用户显式 `registerEncoder`）
- streaming-export 插件 PCM / WAV 流式：`src/plugins/streaming-export/`

尚未实现（本阶段目标）：

| 格式               | 编码    | 解码 | 说明                                           |
|------------------|-------|----|----------------------------------------------|
| AMR              | ✗     | ✗  | vendor `engine/beta-amr*.js`，约 626KB         |
| OGG/Opus         | ✗     | ✗  | vendor `engine/beta-ogg*.js`，约 1.2MB         |
| WebM             | ✗（导出） | 部分 | 当前 `webm-pcm-extractor.ts` 仅用于采集解析，不是导出编码器   |
| G711 A-law/U-law | ✗     | ✗  | vendor `engine/g711x.js`，纯 JS 实现，无需大型 engine |
| 统一解码入口           | —     | ✗  | PCM / WAV / MP3 解码 API 尚不存在                  |

### 5.2 各格式编码器实施规范

#### 5.2.1 G711（优先，无外部 engine 依赖）

G711 是纯数学变换（A-law / U-law），不依赖大型外部 engine，可完全自实现。

目录结构：

```
src/codecs/g711/
  index.ts              ← Vite entry，副作用注册流式 + 全量快照
  g711-encoder.ts       ← A-law / U-law 编码实现（参照 vendor/engine/g711x.js）
  g711-chunked-encoder.ts  ← 流式 ChunkedEncoder（每帧直接编码输出）
  g711-snapshot-exporter.ts  ← 全量快照导出
  g711-worker.ts        ← G711 专属 Worker 入口
  types.ts              ← G711ExportOptions / G711ExportResult
```

设计约束：

- 支持 A-law 和 U-law 两种子格式，通过 `lawType: "alaw" | "ulaw"` 区分
- 默认单声道（G711 协议本身为单声道，双声道时取 `planar[0]`）
- 输出为 8-bit 字节流（每个采样一个字节），无文件头（裸 G711 流）
- 可选：支持 G711 over WAV 封装（WAV header + G711 data），通过 `wrapInWav?: boolean` 控制
- 参照 `Recorder-master/src/engine/g711x.js` 校准编码算法

用户侧：

```ts
import "audio-recorder/codecs/g711"

const result = await recorder.export("g711", {
  lawType: "alaw",
  wrapInWav: true,
})
```

#### 5.2.2 OGG/Opus（中优先，依赖大型 engine）

目录结构：

```
src/codecs/ogg/
  index.ts              ← Vite entry，副作用注册
  ogg-engine-loader.ts  ← 封装 vendor beta-ogg-engine.js，ESM 化，Worker 安全
  ogg-chunked-encoder.ts
  ogg-snapshot-exporter.ts
  ogg-worker.ts
  types.ts              ← OggExportOptions / OggExportResult
```

设计约束：

- OGG engine（约 1.2MB）只打包进 `ogg-worker.ts` blob，不进入主线程 bundle
- 支持双声道（Opus 原生支持立体声）
- `OggExportOptions`: `{ bitrateKbps?, sampleRate?, channels? }`
- WebM/Opus 原生导出路径（`MediaRecorder` 后端）评估：若浏览器原生支持 `audio/webm;codecs=opus`，可提供原生路径作为 OGG 的替代导出（通过 `native?: boolean` 选项切换）

#### 5.2.3 AMR（低优先，按需实现）

目录结构：

```
src/codecs/amr/
  index.ts
  amr-engine-loader.ts  ← 封装 vendor beta-amr-engine.js（约 626KB）
  amr-chunked-encoder.ts
  amr-snapshot-exporter.ts
  amr-worker.ts
  types.ts              ← AmrExportOptions / AmrExportResult
```

设计约束：

- AMR engine（约 626KB）只在 `amr-worker.ts` blob 内打包
- 默认单声道（AMR 标准为单声道）
- `AmrExportOptions`: `{ sampleRate?: 8000 | 16000 }` — AMR 对采样率有严格要求，需在编码前重采样

#### 5.2.4 WebM 原生导出（作为独立能力，非 OGG 附属）

当前 `webm-pcm-extractor.ts` 只用于采集解析，不是导出编码器。WebM 作为导出格式的两条路径：

- **路径 A（原生）**：`MediaRecorder` 直接录制为 `audio/webm`，无需编码器。适合不需要后处理的场景。实现为独立导出辅助函数，不走 `ChunkedEncoderRegistry`。
- **路径 B（编码器）**：通过 OGG codec entry 的 `native?: true` 选项触发，使用浏览器原生 WebM/Opus 能力。
- **建议路径B**

WebM 原生导出辅助函数（可选，单独评估）：

```ts
// src/utils/webm-native-export.ts
export async function exportWebmNative(
  stream: MediaStream,
  options?: { durationMs?: number }
): Promise<Blob>
```

### 5.3 统一解码入口

新建 `src/decoders/` 目录，提供统一解码 API：

```
src/decoders/
  index.ts              ← 解码入口，导出 decodeAudio()
  types.ts              ← AudioDecodeResult / AudioDecodeOptions
  pcm-decoder.ts        ← PCM 软解码（直接转换，无需 engine）
  wav-decoder.ts        ← WAV 软解码（解析 header + 提取 PCM）
  native-decoder.ts     ← 封装浏览器 AudioContext.decodeAudioData
```

统一解码 API：

```ts
// src/decoders/index.ts
export interface AudioDecodeResult {
  sampleRate: number
  channels: 1 | 2
  durationMs: number
  planar: Float32Array[] // 解码后的浮点 PCM（各声道独立）
}

export interface AudioDecodeOptions {
  format?: "pcm" | "wav" | "mp3" | "ogg" | "amr" | "g711" | "auto"
  // 仅 PCM/G711 软解码时需要
  sampleRate?: number
  channels?: 1 | 2
  lawType?: "alaw" | "ulaw" // G711 专用
}

/**
 * 统一解码入口：
 * - format="pcm" | "wav" | "g711" → 软解码（无 AudioContext 依赖）
 * - format="mp3" | "ogg" | "auto" → 调用浏览器 AudioContext.decodeAudioData
 * - format="auto" → 根据数据头部自动探测格式
 */
export async function decodeAudio(
  data: ArrayBuffer | Uint8Array,
  options?: AudioDecodeOptions
): Promise<AudioDecodeResult>
```

解码器分层：

| 格式               | 解码方式                                 | 依赖             |
|------------------|--------------------------------------|----------------|
| PCM              | 软解码（类型转换）                            | 无              |
| WAV              | 软解码（header 解析 + PCM 提取）              | 无              |
| G711             | 软解码（A-law/U-law 反变换）                 | 无（与编码器同文件）     |
| MP3 / OGG / WebM | 原生 `decodeAudioData`                 | `AudioContext` |
| AMR              | 原生 `decodeAudioData` 或 AMR engine 解码 | 视浏览器支持         |

设计约束：

- 软解码路径（PCM / WAV / G711）不依赖 `AudioContext`，可在 Worker 中运行
- 原生解码路径封装 `AudioContext.decodeAudioData`，返回统一 `AudioDecodeResult`
- `format="auto"` 时按以下顺序探测：检查 WAV header magic（`RIFF`）→ G711 头（裸流无法自动识别，需显式指定）→ 其他格式走原生解码

### 5.4 streaming-export 多格式扩展

streaming-export 插件当前只内置 PCM / WAV，MP3 通过 codec entry 注册。本阶段同步支持 G711 / OGG / AMR 的流式编码：

- G711 流式：`import "audio-recorder/codecs/g711"` → 注册 `format: "g711"`
- OGG 流式：`import "audio-recorder/codecs/ogg"` → 注册 `format: "ogg"`
- AMR 流式：`import "audio-recorder/codecs/amr"` → 注册 `format: "amr"`

所有新 codec 均遵循 Phase 4.6 确立的模式：独立 Vite entry + 专属 Worker blob + 双注册（流式 + 全量快照）。

### 5.5 构建配置新增 entry

```ts
// vite.config.ts 新增
"codecs/g711/index": fileURLToPath(new URL("./src/codecs/g711/index.ts", import.meta.url)),
"codecs/ogg/index": fileURLToPath(new URL("./src/codecs/ogg/index.ts", import.meta.url)),
"codecs/amr/index": fileURLToPath(new URL("./src/codecs/amr/index.ts", import.meta.url)),
"decoders/index": fileURLToPath(new URL("./src/decoders/index.ts", import.meta.url)),
```

### 5.6 子路径导出（package.json exports）

新增：

- `audio-recorder/codecs/g711`
- `audio-recorder/codecs/ogg`
- `audio-recorder/codecs/amr`
- `audio-recorder/decoders`

### 验收标准

- G711 编码器：A-law / U-law 编码正确（与 vendor g711x.js 输出一致）
- OGG 编码器：build 产物包含 OGG engine，主包不含 OGG engine（bundle 分析验证）
- AMR 编码器：同上（AMR engine 只在 AMR codec bundle 内）
- `decodeAudio("wav", data)` 返回正确 PCM 数据
- `decodeAudio("pcm", data, { sampleRate: 16000, channels: 1 })` 返回正确 Float32Array
- `decodeAudio("mp3", data)` 通过浏览器原生 `decodeAudioData` 成功返回
- `decodeAudio("auto", wavData)` 自动识别 WAV 格式并软解码
- streaming-export：注册 g711/ogg codec 后可正常产出对应格式 chunk
- `npm run typecheck` 通过，`npm run build` 成功

## Phase 6：插件扩展

目标：

- 实现六类增强插件：流播放器、变速变调、频谱 FFT、DTMF、简谱转 PCM，并补齐 DSP 滤波器插件。
- 所有插件遵循现有 `RecorderPlugin` 接口，独立启停，不污染核心控制器。

### 6.1 插件总览

| 编号 | 插件名                        | 子路径                           | vendor 参照                                                          | 优先级 |
|----|----------------------------|-------------------------------|--------------------------------------------------------------------|-----|
| ①  | 流播放器（StreamingPlayer）      | `plugins/streaming-player`    | `extensions/buffer_stream.player.js`                               | 高   |
| ②  | 变速变调导出（SonicExport）        | `plugins/sonic-export`        | `extensions/sonic.js` + `teach.sonic.transform.js`                 | 中   |
| ③  | 频谱 FFT（FrequencyHistogram） | `plugins/frequency-histogram` | `extensions/frequency.histogram.view.js` + `extensions/lib.fft.js` | 中   |
| ④  | DTMF 编解码                   | `plugins/dtmf`                | `extensions/dtmf.encode.js` + `extensions/dtmf.decode.js`          | 中   |
| ⑤  | 简谱转 PCM                    | `plugins/nmn2pcm`             | `extensions/create-audio.nmn2pcm.js`                               | 低   |
| ⑥  | DSP 滤波器                    | `plugins/dsp`                 | 无直接参照（高通/低通/噪声门算法）                                                 | 中   |

### 6.2 流播放器插件（StreamingPlayer）

**功能**：接收任意来源的 `StreamingPacketPayload`，经乱序重排、抖动缓冲、解码和 `AudioContext` 调度后连续播放。当前实现已落地为独立子路径
`@csnight/audio-recorder/plugins/streaming-player`，不是挂在 `RecorderPlugin` 生命周期里的 `onFrame` 型插件。

**参照**：`vendor/Recorder-master/src/extensions/buffer_stream.player.js`

目录结构：

```text
src/plugins/streaming-player/
  index.ts            // 子路径导出入口
  player.ts           // createStreamingPlayer 主实现
  types.ts            // StreamingPlayerOptions / Handle / State
  reorder-buffer.ts   // 按 seq 排序，缺包超时后强制放行
  jitter-buffer.ts    // 抖动缓冲，达到 targetLatencyMs 后按需释放
  persist-store.ts    // 历史缓存：memory / indexeddb
```

核心 API：

```ts
export interface PersistStore {
  readonly storedMs: number
  push(packet: StreamingPacketPayload): void
  recent(durationMs: number): StreamingPacketPayload[]
  clear(): void
}

export interface StreamingPlayerOptions {
  decoders: AudioDecoderDefinition[]
  targetLatencyMs?: number
  maxBufferMs?: number
  volume?: number
  persistMode?: "memory" | "indexeddb" | "custom"
  persistBufferMs?: number
  audioContext?: AudioContext
  onUnderrun?: (detail: { bufferedMs: number }) => void
  onPacketDrop?: (detail: { count: number; reason: string }) => void
  onStateChange?: (state: StreamingPlayerState) => void
}

export interface StreamingPlayerHandle {
  readonly state: "idle" | "buffering" | "playing" | "paused" | "stopped"
  readonly bufferedMs: number
  readonly droppedPackets: number
  readonly storedMs: number
  use(store: PersistStore): void
  push(packet: StreamingPacketPayload): void
  start(): Promise<void>
  pause(): void
  resume(): void
  replay(seconds: number): void
  setVolume(volume: number): void
  destroy(): void
  onStateChange: ((state: StreamingPlayerState) => void) | null
}

export function createStreamingPlayer(
  options: StreamingPlayerOptions
): Promise<StreamingPlayerHandle>
```

当前落地链路：

```text
push(packet)
  -> persistStore.push(packet)                       // 始终双写，用于历史重播
  -> (仅 buffering / playing 时)
     ReorderBuffer
       -> JitterBuffer
         -> decodePacket()
           -> scheduleAudioBuffer()
             -> AudioContext.destination
```

当前行为与设计决策：

1. **live-edge start**

- `idle` 阶段 `push()` 只写历史缓存，不进入播放管线。
- `start()` 会先清空旧播放积压，再从 `persistStore.recent(targetLatencyMs)` 回灌最近一个小窗口作为启动垫片。
- 这样不会因为“创建播放器后迟迟不 `start()`”而永久落后于实时流。

2. **暂停 / 恢复**

- `pause()` 停止 drainLoop 和所有已调度但未播完的 source。
- `resume()` 清空旧 live backlog，从新的 live 数据重新缓冲，而不是追赶暂停期间积累的旧包。
- 暂停期间新包仍会写入 `persistStore`，供后续 `replay()` 使用。

3. **乱序 + 抖动缓冲**

- `ReorderBuffer` 负责按 `seq` 排序；缺包时等待 `timeoutMs`，超时后强制放行。
- `JitterBuffer` 在累计到 `targetLatencyMs` 后开始出队，不再按固定速率抽干，而是按当前调度余量按需释放。
- `packet.discontinuity` 会重置旧的 reorder 等待状态，避免在明确断点后再白等缺口超时。

4. **缓冲与欠载口径**

- `bufferedMs` 表示整条播放管线的总余量：`reorder + jitter + pending decode + scheduled audio`。
- `onUnderrun` 只在整条播放管线确实见底时触发，而不是仅凭单个子缓冲为空就误判。

5. **maxBufferMs 的真实含义**

- `maxBufferMs` 约束的是 `ReorderBuffer + JitterBuffer` 的总 live 积压，而不是只约束 `JitterBuffer`。
- 超限时优先丢弃 `JitterBuffer` 中最旧的已排序数据；若仍超限，再丢弃 `ReorderBuffer` 中最旧的乱序数据。
- 这样 `droppedPackets` / `onPacketDrop` 反映的是整条 live 管线的真实过载，而不是某一个局部缓冲的偶然状态。

6. **历史重播边界**

- `replay(seconds)` 只能在暂停状态下调用。
- `persistMode: "memory"` 为默认路径，重播历史完全来自当前实例内存。
- `persistMode: "indexeddb"` 当前只是旁路写入 IndexedDB；`replay()` 仍只读取当前实例内存镜像，不支持跨页面刷新恢复历史。

7. **custom persist-store**

- `persistMode: "custom"` 时，播放器不会自动创建内置 store。
- 调用方必须在首次 `push()` / `start()` 之前通过 `player.use(store)` 显式注册一个实现了 `PersistStore` 接口的外部 store。
- `persistBufferMs` 对 custom store 不生效；保留时长、容量上限、淘汰策略全部由用户自己控制。
- `destroy()` 不会自动 `clear()` custom store，生命周期由调用方自己管理。

与现有录音链路的衔接方式：

- `createStreamingExportPlugin()` 负责产出 `StreamingPacketPayload`。
- 业务层通过 `recorder.on("plugin:stream", ...)` 或 WebSocket 等来源拿到 packet。
- 将 packet 传给 `player.push(payload)` 即可，不需要 `StreamingPlayer` 直接持有 `RecorderController`。

当前交付状态：

- 已实现 `memory / indexeddb` 历史缓存
- 已实现 `custom` 外部 PersistStore 注入
- 已实现 `reorder + jitter + decode + AudioBufferSourceNode` 连续调度
- 已实现 `live-edge start + startup pad`
- 已实现 `pause / resume / replay / setVolume / destroy`
- 已实现 `storedMs / bufferedMs / droppedPackets / onPacketDrop / onUnderrun / onStateChange`
- 已提供 `playground/src/StreamingPlayerDemo.vue` 作为演示页

### 6.3 变速变调导出插件（SonicExport）

**功能**：对录音 PCM 做变速（timeStretch）或变调（pitchShift）处理，提供两种能力：

1. **离线转换**：录音完成后，对 PCM snapshot 或任意 PCM 数据做一次性 Sonic 处理，返回处理后的 PCM 供调用方编码导出。
2. **实时推流**：在录音进行中，在旁路中对每帧 PCM 积累 → Sonic 处理 → 编码 → 通过 `plugin:stream` 事件对外推出变速音频流。

**设计原则**：

- Sonic 处理完全在旁路进行，`onFrame` 只读消费帧，**不修改主链路 buffer**，主录音结果始终是原始 PCM。
- 与 `streaming-export` 互斥（两者都做实时推流，同时注册会产生重复流）。互斥通过 `exclusiveWith` 声明，`PluginHost` 在
  `use()` 时校验。
- 参照 vendor `teach.sonic.transform.js`：实时处理用 Sonic.Async（Worker），离线处理用同步切片模式，块大小建议 ≥ 200ms
  以避免引入杂音。

**参照**：`vendor/Recorder-master/src/extensions/sonic.js` + `assets/runtime-codes/teach.sonic.transform.js`

目录结构：

```
src/plugins/sonic-export/
  index.ts              ← 子路径导出入口
  plugin.ts             ← createSonicExportPlugin()，实现 SonicExportPlugin
  sonic-processor.ts    ← Sonic 算法封装（参照 vendor sonic.js 移植）
  stream-bridge.ts      ← 帧积累 + Sonic 处理 + 编码推流逻辑
  types.ts              ← SonicExportOptions / SonicTransformOptions / SonicExportPlugin
  public.ts             ← 对外类型导出
```

核心 API：

```ts
export interface SonicTransformOptions {
  speed?: number // 变速不变调，默认 1.0
  pitch?: number // 变调不变速，默认 1.0
  rate?: number // 变速变调，默认 1.0
  volume?: number // 音量，默认 1.0
  /** 每次送入 Sonic 的块大小（ms），建议 ≥ 200ms，默认 200 */
  blockMs?: number
}

export interface SonicExportOptions extends SonicTransformOptions {
  /** 实时推流编码格式 */
  format: "pcm" | "wav" | "mp3"
  /** 流式编码器，必须显式传入（与 streaming-export 一致） */
  encoders: StreamEncoderDefinition[]
}

/** SonicExportPlugin 同时是 RecorderPlugin 和对外工具方法的持有者 */
export interface SonicExportPlugin extends RecorderPlugin {
  name: "sonic-export"
  exclusiveWith: ["streaming-export"]

  /**
   * 离线转换：对录音结果 PCM snapshot 做 Sonic 处理，返回处理后的 Int16Array。
   * 调用方拿到 Int16Array 后自行传给编码器导出。
   * 可独立于录音流程调用，不依赖当前录音状态。
   */
  transformSnapshot(
    snapshot: PcmSnapshot,
    options?: SonicTransformOptions
  ): Promise<Int16Array>

  /**
   * 离线转换：对任意 PCM 数据做 Sonic 处理，返回处理后的 Int16Array。
   */
  transform(
    pcm: Int16Array,
    sampleRate: number,
    options?: SonicTransformOptions
  ): Promise<Int16Array>
}

export function createSonicExportPlugin(
  options: SonicExportOptions
): SonicExportPlugin
```

实现要点：

- Sonic 算法完全参照 `vendor/sonic.js` 移植为 TypeScript，不引入外部依赖
- `onFrame` 时将帧数据累积到内部缓冲，达到 `blockMs` 后送 Sonic 处理，处理结果送流式编码器，编码产物通过 `plugin:stream`
  事件发出
- `onStop` 时冲刷 Sonic 内部残余缓冲，发送最后一个 `isFinal: true` 的 chunk
- `transformSnapshot` 内部将 snapshot 展平为 `Int16Array` 后调用 `transform`，`transform` 用同步切片 + Promise
  模式实现，避免主线程卡顿
- 离线转换方法可在录音开始前/录音中/录音后任意时刻调用，与插件生命周期解耦

事件格式（与 `streaming-export` 的 `plugin:encoded-chunk` 对齐命名语义）：

```ts
recorder.on("plugin:stream", (chunk: EncodedStreamChunk) => {
  chunk.data // Uint8Array，编码后的音频数据
  chunk.format // "wav" | "mp3" | ...
  chunk.isFinal // true 表示录音已结束，这是最后一帧
})
```

使用示例：

```ts
import { createSonicExportPlugin } from "audio-recorder/plugins/sonic-export"
import { wavStreamEncoder } from "audio-recorder/codecs/base"

const sonicPlugin = createSonicExportPlugin({
  speed: 1.5,
  format: "wav",
  encoders: [wavStreamEncoder],
  blockMs: 200,
})

await recorder.use(sonicPlugin) // 注册，会检测与 streaming-export 互斥

// 实时推流
recorder.on("plugin:stream", ({ data, isFinal }) => {
  socket.send(data)
})

await recorder.stop()

// 离线转换（用同一插件实例）
const snapshot = await recorder.getSnapshot()
const processed = await sonicPlugin.transformSnapshot(snapshot, { speed: 0.8 })
// processed 为 Int16Array，再自行编码导出
```

### 6.4 频谱 FFT 插件（FrequencyHistogram）

**功能**：对实时 PCM 帧做 FFT 分析，输出频率域幅度数据，供可视化消费（如频谱直方图渲染）。

**参照**：`vendor/Recorder-master/src/extensions/frequency.histogram.view.js` + `extensions/lib.fft.js`

目录结构：

```
src/plugins/frequency-histogram/
  index.ts
  plugin.ts             ← createFrequencyHistogramPlugin()
  fft.ts                ← FFT 算法实现（参照 vendor lib.fft.js）
  types.ts              ← FrequencyHistogramOptions / FrequencyData
  public.ts
```

核心 API：

```ts
export interface FrequencyHistogramOptions {
  /** FFT 窗口大小，必须为 2 的幂次，默认 2048 */
  fftSize?: 512 | 1024 | 2048 | 4096
  /** 输出频率组数（直方图柱数），默认 64 */
  barCount?: number
  /** 帧采样间隔（每隔 N 帧分析一次），默认 1 */
  frameInterval?: number
}

export interface FrequencyData {
  /** 各频率组的幅度（0-1 归一化） */
  bars: Float32Array
  /** 分析时间戳 */
  timestampMs: number
}

export function createFrequencyHistogramPlugin(
  options?: FrequencyHistogramOptions
): RecorderPlugin
// 插件通过 "plugin:frequency-histogram:data" 事件发出 FrequencyData
```

实现要点：

- FFT 算法参照 `vendor/lib.fft.js` 移植为 TypeScript
- `onFrame` 时累积 PCM 数据，满足 `fftSize` 窗口后执行 FFT
- 输出频率幅度数组，按 `barCount` 分组（对数刻度分组，参照 vendor 实现）
- 多声道时取 `planar[0]`（左声道）做分析，不混合双声道

### 6.5 DTMF 插件（DTMFCodec）

**功能**：双向能力：① DTMF 编码：将按键序列（0-9, \*, #, A-D）合成为 PCM 音频；② DTMF 解码：从录音 PCM 帧中识别 DTMF 音调序列。

**参照**：`vendor/Recorder-master/src/extensions/dtmf.encode.js` + `dtmf.decode.js`

目录结构：

```
src/plugins/dtmf/
  index.ts
  encode.ts             ← DTMF 编码（按键 → PCM）
  decode.ts             ← DTMF 解码（PCM → 按键序列，实时识别）
  plugin.ts             ← createDtmfDecoderPlugin()（录音时实时解码插件）
  types.ts              ← DtmfKey / DtmfEncodeOptions / DtmfDecodeResult
  public.ts
```

核心 API：

```ts
export type DtmfKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "*"
  | "#"
  | "A"
  | "B"
  | "C"
  | "D"

// 编码：独立函数，不是插件（生成 PCM 数据）
export function encodeDtmf(
  keys: DtmfKey[],
  options?: DtmfEncodeOptions
): Int16Array

// 解码插件：在录音时实时识别 DTMF 音调
export function createDtmfDecoderPlugin(): RecorderPlugin
// 通过 "plugin:dtmf:detected" 事件发出识别到的按键
```

实现要点：

- 编码：每个 DTMF 音调由两个正弦波叠加（行频 + 列频），参照 vendor `dtmf.encode.js` 频率表
- 解码：Goertzel 算法检测 8 个 DTMF 频率的能量，参照 vendor `dtmf.decode.js`
- 解码插件 `onFrame` 时对每帧做 Goertzel 检测，识别到完整按键时发出事件

### 6.6 简谱转 PCM 插件（NMN2PCM）

**功能**：将简谱字符串（数字简谱 ABC 记谱法）转换为 PCM 音频数据，作为音频素材生成工具。

**参照**：`vendor/Recorder-master/src/extensions/create-audio.nmn2pcm.js`

目录结构：

```
src/plugins/nmn2pcm/
  index.ts
  nmn2pcm.ts            ← 简谱解析 + 正弦波合成（参照 vendor create-audio.nmn2pcm.js）
  types.ts              ← NmnNote / NmnScore / NmnConvertOptions / NmnConvertResult
  public.ts
```

核心 API（独立函数，不是 RecorderPlugin）：

```ts
export interface NmnConvertOptions {
  sampleRate?: number // 默认 16000
  bpm?: number // 每分钟拍数，默认 60
  volume?: number // 0-1，默认 0.5
}

export interface NmnConvertResult {
  data: Int16Array // 生成的 PCM 数据
  sampleRate: number
  durationMs: number
}

/**
 * 将简谱字符串转换为 PCM 音频
 * 简谱格式：使用数字 1-7 表示 do-si，0 表示休止符，
 * 高音点（·）低音点（,）、时值（-）等参照 vendor 格式
 */
export function nmn2pcm(
  score: string,
  options?: NmnConvertOptions
): NmnConvertResult
```

实现约束：

- 纯 JS 实现，无外部依赖
- 正弦波合成，不使用 Web Audio API（输出为内存 PCM，可直接喂给 StreamPlayer 或写入 WAV）

### 6.7 DSP 滤波器插件

**功能**：可组合的 DSP 处理插件，通过 `onBeforeFrame` hook 在帧进入 buffer 前对 PCM 做滤波处理，处理结果直接影响主链路
buffer 和最终录音导出。

目录结构：

```
src/plugins/dsp/
  index.ts
  highpass.ts           ← 高通滤波（去除低频噪声）
  lowpass.ts            ← 低通滤波（去除高频噪声）
  noise-gate.ts         ← 噪声门（静音段静音化）
  types.ts              ← DspFilterOptions
  public.ts
```

核心 API：

```ts
// 各滤波器均返回 RecorderPlugin，通过 onBeforeFrame 介入帧管线
export function createHighpassPlugin(options?: {
  cutoffHz?: number
}): RecorderPlugin

export function createLowpassPlugin(options?: {
  cutoffHz?: number
}): RecorderPlugin

export function createNoiseGatePlugin(options?: {
  thresholdDb?: number
  attackMs?: number
  releaseMs?: number
}): RecorderPlugin
```

实现要点：

- 高通 / 低通：实现 `onBeforeFrame`，内部维护 IIR 滤波器状态（`prevInput` / `prevOutput`），对 `frame.planar`
  做原地滤波后返回修改后的帧。公式参照 `y[n] = α * (y[n-1] + x[n] - x[n-1])`（高通）
- 噪声门：实现 `onBeforeFrame`，计算当前帧 RMS 能量，低于阈值时将 `frame.planar` 置零后返回帧（不丢帧，保持时间轴连续）
- 高通 / 低通有内部跨帧状态（IIR 状态），需实现 `onBeforeStop` 以冲刷最后一帧的滤波残余
- 插件可独立启停：`plugin.enabled = false` 时 `onBeforeFrame` 直接返回原帧，跳过处理
- 多个 DSP 插件按 `recorder.use()` 调用顺序串联，前一个插件的输出是下一个插件的输入

### 6.8 构建配置新增 entry

```ts
// vite.config.ts 新增
"plugins/streaming-player/index": fileURLToPath(new URL("./src/plugins/streaming-player/index.ts", import.meta.url)),
  "plugins/sonic-export/index"
:
fileURLToPath(new URL("./src/plugins/sonic-export/index.ts", import.meta.url)),
"plugins/frequency-histogram/index": fileURLToPath(new URL("./src/plugins/frequency-histogram/index.ts", import.meta.url)),
"plugins/dtmf/index": fileURLToPath(new URL("./src/plugins/dtmf/index.ts", import.meta.url)),
"plugins/nmn2pcm/index": fileURLToPath(new URL("./src/plugins/nmn2pcm/index.ts", import.meta.url)),
"plugins/dsp/index": fileURLToPath(new URL("./src/plugins/dsp/index.ts", import.meta.url)),
```

### 6.9 streaming-export 多格式检查结论

当前 streaming-export 插件（`src/plugins/streaming-export/`）仅内置 PCM / WAV 两种格式编码器，MP3 通过 Phase 4.6 的 codec 插件化机制注册。

**其他格式（G711 / OGG / AMR）的流式支持路径**：与 MP3 完全对称。`createStreamingExportPlugin` 不再依赖任何全局注册表，而是通过 `encoders: StreamEncoderDefinition[]` 显式 DI 传入；各自 codec entry（Phase 5 实现）导出对应的 `StreamEncoderDefinition`，调用方显式传入即可：`createStreamingExportPlugin({ format: "g711" | "ogg" | "amr", encoders: [g711StreamEncoder] })`。streaming-export 插件本身**无需修改**。

### 验收标准

- 流播放器：录音时可实时听到录音声音，暂停/恢复/停止行为正确
- 变速变调导出（SonicExport）：
    - **互斥检测**：`use(sonicExportPlugin)` 与 `use(streamingExportPlugin)` 同时注册时，`PluginHost` 在 `setup`
      阶段抛出互斥错误，录音无法启动
    - **实时流**：录音过程中 `plugin:stream` 事件持续触发，携带经 Sonic 处理后的编码分片（≥200ms 累积后推送）；停止录音时
      `onStop` 刷出残余帧，最终分片正常发出
    - **离线转换**：录音结束后调用 `transformSnapshot(snapshot, { speed: 0.5 })`，返回 `Int16Array` 时长约为原始时长 2
      倍，音调保持不变（WSOLA 算法）；调用 `transform(pcm, sampleRate, { pitch: 1.5 })` 同样能独立工作
    - **bypass 验证**：`SonicExportPlugin` 的 `onFrame` 不修改主缓冲区，录音核心的 `PcmSnapshot` 保存的是原始
      PCM，与未挂载插件时完全一致
- 频谱 FFT：录音时每帧可收到 `plugin:frequency-histogram:data` 事件，数组长度符合 `barCount`
- DTMF 编码：`encodeDtmf(["1","2","3"])` 输出可被电话系统识别的 DTMF 音频
- DTMF 解码：播放标准 DTMF 音频时插件能正确识别按键序列
- 简谱转 PCM：`nmn2pcm("1234567")` 输出可播放的 PCM 数据
- DSP 滤波器：
    - **onBeforeFrame 链路**：挂载高通滤波插件后，录音导出的 PCM/WAV/MP3 文件中低频噪声明显衰减（与未挂载对比可量化），而非仅影响监听播放
    - **onBeforeStop 冲洗**：停止录音时 `onBeforeStop` 被调用，IIR 滤波器残余状态被正确冲洗并附加到末尾帧，导出文件结尾无截断失真
    - **噪声门**：静音段（低于阈值）被正确置零，动态段正常通过；噪声门 `enabled=false` 时 `onBeforeFrame` 直接透传原帧，不产生任何副作用
    - **多插件串联**：同时挂载高通 + 噪声门时，`onBeforeFrame` 按注册顺序依次调用，前一插件的输出帧作为下一插件的输入帧，最终写入缓冲的帧是经所有
      DSP 处理后的结果
- 所有插件独立启停，不影响核心控制器和其他插件
- `npm run typecheck` 通过，`npm run build` 成功

## 10. 测试计划

### 10.1 单元测试重点

必须覆盖：

- 状态机
- 事件系统
- PCM 标准化
- 缓冲
- 重采样
- WAV 头
- PCM/WAV 编码
- 注册体系
- 插件生命周期
- WorkerBridge
- 多声道数据处理

### 10.2 功能测试重点

必须覆盖：

- 麦克风录音主流程
- 暂停恢复
- 外部流录制
- PCM/WAV/MP3 导出
- 双声道请求与回退
- 解码
- 插件接收 frame
- 错误场景

### 10.3 完成标准

每阶段必须满足：

1. 功能实现完成
2. 单元测试通过
3. 功能测试通过
4. `lint/typecheck/build` 通过
5. 文档和导出清单更新

## 11. 推荐排期

推荐顺序：

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6

推荐理由：

- 先稳定主链路
- 先做可观察、可验证的 WAV/PCM
- 再上插件和 MP3
- 解码与 DSP 后置，避免早期系统复杂度过高

---

# 第三部分：实施

## 12. 仓库结构

推荐目录结构：

```text
recorder-ts/
  src/
    core/
    capture/
    pipeline/
    buffer/
    codecs/
      pcm/
      wav/
      mp3/
      g711/
    decoders/
    plugins/
      level-meter/
      streaming-player/
      dsp/
    registry/
    workers/
    utils/
    types/
    index.ts
  tests/
    unit/
    functional/
    fixtures/
    helpers/
  playground/
  scripts/
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  tsconfig.json
  tsconfig.build.json
  package.json
```

## 13. 任务拆分

### 13.1 第一批必须先写的模块

- `RecorderController`
- `EventBus`
- `CaptureAdapter`
- `FrameDispatcher`
- `PcmBufferStore`
- 多声道数据模型
- 基线测试

### 13.2 各阶段最小任务

#### Phase 0

- 初始化 Vite
- 配置 TS
- 配置 Vitest
- 配置 Playwright
- 建立导出规则
- 建立基线样本

#### Phase 1

- 状态机
- 生命周期 API
- 采集适配器
- PCM 帧标准化
- 声道协商与实际值回写

#### Phase 2

- 缓冲
- Pipeline 与 buffer 挂接
- 重采样
- PCM 导出
- WAV 导出
- 双声道 WAV
- `RecorderController.exportEncoded(type, options)`（统一导出入口，`pcm`/`wav` 通过内置编码器注册后由此调用，不再单独暴露 `exportPCM()`/`exportWAV()` 便捷方法）
- `RecorderPersistencePlugin` 接口
- `memoryThresholdBytes` 溢写控制

Phase 2 实施顺序补充：

1. `buffer`
2. `pipeline`
3. `snapshot -> resample -> interleaved PCM export`
4. `wav header + wav export`
5. `controller export api + root export surface`

其中第三步优先保证：

- 内部缓冲仍保留 `planar`
- 对外 PCM 导出统一转换为 `interleaved`
- 允许导出配置继续使用统一 `bitRate` 输入，但 `pcm/wav` 内部一律转换为 `bitsPerSample`

其中第四步和第五步补充约束：

- WAV 先只支持 PCM WAV，不提前引入实时编码壳层
- 控制器导出接口直接读取内部 pipeline snapshot，不再额外包一层只转发参数的 service
- 持久化后端不内置在核心默认路径里，只通过可选模块提供 OPFS / IndexedDB 实现
- 任何持久化实现都必须包含 session 级 cleanup 语义，不能把缓存无限积累在浏览器存储里

#### Phase 3

- 编码器注册
- 插件宿主
- 音量插件
- 插件自定义事件总线
- 预览降混

#### Phase 4

- MP3 session
- Worker bridge
- 实时 chunk

#### Phase 5

- 解码器
- 流播放器

#### Phase 6

- DSP 插件
- G711

## 14. 浏览器兼容实施规则

实现时必须遵守：

1. 所有浏览器能力先探测再启用
2. 所有降级都要发出 `warning`
3. 所有不支持格式都要显式报错
4. 双声道请求失败时必须自动回落并记录实际结果
5. 采集主路径优先采用非过时能力，当前优先级为 `MediaRecorder` 评估 > `AudioWorklet` > `ScriptProcessor fallback`
6. `AudioWorklet` 不可用时允许走 `ScriptProcessor`
7. 使用过时 API 时必须写清楚降级原因和退出条件，不能把降级实现写成长期默认实现
8. `MediaRecorder` 可用时优先评估原生后端

## 15. 自检清单

每次阶段结束前必须自检：

### 15.1 架构完整性

- 是否仍然没有全局挂载
- 是否仍然是单仓库单库多入口
- 核心模块是否被插件反向依赖

### 15.2 细节完整性

- 类型是否覆盖声道数
- 是否区分请求声道数与实际声道数
- WAV 头是否正确写入 `numChannels`
- 实时事件是否完整
- Worker 错误是否可回传

### 15.3 测试完整性

- 单元测试是否覆盖新增核心逻辑
- 功能测试是否覆盖新增浏览器行为
- 是否补了双声道场景

### 15.4 兼容性检查

- Chromium 是否可用
- WebKit 是否至少手工验证关键流程
- `MediaRecorder` 不可用时是否能降级
- `AudioWorklet` 不可用时是否能降级

## 16. 开发日志与进度记录模板

这是长期任务，实施部分必须支持中断恢复。每次开发结束都要更新以下记录，并统一写入当天的 `logs/YYYY-MM-DD.md`。

### 16.1 阶段状态模板

```md
## 当前阶段

- 阶段：Phase X
- 状态：未开始 / 进行中 / 已完成 / 阻塞
- 开始日期：YYYY-MM-DD
- 最近更新：YYYY-MM-DD

## 已完成

-

## 进行中

-

## 下一步

-

## 风险/阻塞

-
```

### 16.2 开发日志模板

```md
## YYYY-MM-DD

- 目标：
- 完成：
- 变更文件：
- 测试结果：
- 遗留问题：
- 下次恢复入口：
```

### 16.3 回归恢复检查单

中断恢复时按这个顺序检查：

1. 当前处于哪个阶段
2. 上次最后完成的模块是什么
3. 当前分支是否有未提交变更
4. 最近一次 `typecheck` 是否通过
5. 最近一次 `unit` 是否通过
6. 最近一次 `functional` 是否通过
7. 当前阻塞点是什么
8. 下一步是否仍符合阶段边界

## 17. 实施建议

真正开工时，不要先做 MP3，也不要先做 UI。

第一批实施顺序应当是：

1. 工程骨架
2. 录制主链路
3. PCM/WAV
4. 注册体系
5. MP3
6. 解码
7. DSP

这样能保证每一阶段都可验证、可发布、可恢复。

---

## 18. 最终结论

这次改造的正确方向不是“把旧代码改成 TS”，而是：

- 从全局脚本库迁移到模块化音频内核
- 用单仓库承载长期演进
- 用单库多入口实现按需增强
- 用注册式编码器和插件体系替代副作用挂载
- 用测试和日志机制保证长期任务可以中断后恢复

只要始终坚持三点，方案就不会跑偏：

- 易用：根入口简单，默认路径可用
- 可扩展：编码器、插件、后端都能独立接入
- 可渐进：每个阶段都可交付、可测试、可恢复

## 19. 日志执行约束

- 每完成一个大步骤，必须在 `logs/YYYY-MM-DD.md` 追加当日记录。
- 同一天内的多个大步骤统一写入同一个日期日志文件，不新建重复日期文件。
- 日志内容至少包含目标、完成、变更文件、测试结果、遗留问题、下次恢复入口。
- 每个日志文件顶部应维护”当前阶段 / 已完成 / 进行中 / 下一步 / 风险或阻塞”，用于中断恢复；不再维护单独的 `IMPLEMENTATION-LOG.md`。
