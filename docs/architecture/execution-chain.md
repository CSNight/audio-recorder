# Audio Recorder Execution Chain

本文档描述当前仓库已经落地的执行链路，对应 `src/` 下真实实现，而不是未来规划中的理想形态。

相关文档：

- 总索引：[`docs/README.md`](../README.md)
- 长期方案：[`docs/plans/recorder-ts-master-plan.md`](../plans/recorder-ts-master-plan.md)

---

## 0. 总览

当前架构可以概括为四层：

1. 控制层：`RecorderController` 负责生命周期、状态机、事件分发、编码器注册和插件宿主。
2. 输入层：`BrowserInputAdapter` 负责取流、选择输入后端，并把原始音频帧交给 `BrowserInputSession`。
3. 缓冲与导出层：`PcmFramePipeline + PcmBufferStore` 负责积累 PCM 快照，编码器负责全量导出或实时分片编码。
4. 扩展层：插件、持久化后端、Worker bridge 通过显式子路径接入，不污染根入口。

## 1. 模块职责图

```mermaid
flowchart LR
  A[createRecorder] --> B[RecorderController]
  B --> C[BrowserInputAdapter]
  C --> D[BrowserInputSession]
  C --> E[selectInputBackend]
  E --> E1[MediaRecorderBackend]
  E --> E2[AudioWorkletBackend]
  E --> E3[ScriptProcessorBackend]
  D --> F[createAudioFrame]
  F --> G[PcmFramePipeline]
  G --> H[PcmBufferStore]
  B --> I[EventBus]
  B --> J[PluginHost]
  J --> K[PluginEventBus]
  B --> L[Snapshot Encoders]
  J --> M[ChunkedEncoderBridge]
  H --> N[Persistence Plugin]
  O[playground] --> A
```

## 2. 主入口链路

对外入口在 [`src/index.ts`](/E:/ai-base-workspace/audio-recorder/src/index.ts)。

- `createRecorder(options)` 创建 `RecorderController`
- `options` 由三部分组成：
  - 录音输入默认值，如 `sampleRate`、`channelCount`、`deviceId`、`inputStrategy`
  - `storage`：缓冲与持久化策略
  - `encoders`：供 `exportEncoded()` 使用的快照编码器定义
- 根入口同时导出：
  - `listMicrophoneDevices()`
  - `checkRecorderCapability()`
  - 核心类型、状态枚举、工具函数

根入口不自动注册编码器。`exportEncoded("pcm" | "wav" | "mp3")` 是否可用，取决于调用方是否显式传入相应编码器定义。

## 3. RecorderController 链路

控制器实现位于 [`src/core/recorder-controller.ts`](/E:/ai-base-workspace/audio-recorder/src/core/recorder-controller.ts)。

核心职责：

- 维护状态机：`idle -> ready -> recording -> paused -> stopped -> closed -> destroyed`
- 管理当前输入会话 `RecorderInputSession`
- 持有 `PcmFramePipeline`
- 持有编码器注册表 `Map<string, ExportEncoderDefinition>`
- 持有 `PluginHost`
- 对外暴露统一事件入口 `on/off`

主生命周期：

```mermaid
sequenceDiagram
  participant App as Host App
  participant Controller as RecorderController
  participant Adapter as BrowserInputAdapter
  participant Session as BrowserInputSession

  App->>Controller: open(options)
  Controller->>Adapter: open(request, handlers)
  Adapter->>Session: create + attach backend
  Adapter-->>Controller: RecorderInputSession
  Controller-->>App: runtimeInfo

  App->>Controller: start()
  Controller->>Session: start()
  Session-->>Controller: frame callbacks

  App->>Controller: stop()
  Controller->>Session: stop()
  Session-->>Controller: summary

  App->>Controller: exportEncoded(type, options)
  Controller->>Controller: requirePcmSnapshot()
  Controller-->>App: encoded result
```

几个关键点：

- `open()` 会先重置旧 pipeline，再为新 session 创建新的 buffer store
- `start()` 时缓存是否存在 `frame:async` 监听器，减少热路径开销
- `handleFrame()` 同时推进三条链：
  - 写入 `framePipeline`
  - 更新 `runtimeInfo` 与 `summary`
  - 通知 `PluginHost`
- `issue` 事件会统一通过 `handleIssue()` 发出，warning 同时写 `console.warn`

## 4. 参数合并链路

参数优先级分两层：

1. `createRecorder()` 保存默认输入参数
2. `open()` 传入的字段覆盖默认值

因此真实输入配置来源于：

```ts
const mergedInput = {
  ...defaultInput,
  ...openOptions,
}
```

存储配置与编码器列表只在 `createRecorder()` 时注入，不在 `open()` 阶段动态变更。

## 5. 浏览器输入链路

输入适配器位于 [`src/input/browser-input-adapter.ts`](/E:/ai-base-workspace/audio-recorder/src/input/browser-input-adapter.ts)。

执行顺序：

1. 读取 `RecorderInputOptions`
2. 如果调用方未传 `sourceStream`，则通过 `acquireMicStream()` 获取麦克风流
3. 对自有麦克风流执行约束诊断 `reportUnappliedConstraints()`
4. 用 `track.getSettings().channelCount` 读取实际声道数
5. 创建 `AudioContext`
6. 创建 `BrowserInputSession`
7. 调用 `selectInputBackend()` 选择实际采集后端
8. 通过 `session.attachBackend(backend)` 完成显式装配

这里的设计重点是：

- `BrowserInputAdapter` 只负责装配，不负责状态机
- `BrowserInputSession` 作为 `sink` 接收后端推送的原始帧
- 后端选择失败时会主动关闭 `AudioContext`，防止泄漏

## 6. 输入后端选择与降级

后端编排位于 [`src/input/backends/select.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/select.ts)。

当前支持三种底层采集策略：

- `media-recorder`
- `audio-worklet`
- `script-processor`

默认优先级：

```text
media-recorder -> audio-worklet -> script-processor
```

策略规则：

- `inputStrategy: "auto"` 按标准优先级尝试
- 显式指定某个策略时，会优先尝试该策略；失败后仍继续按剩余标准优先级降级
- 对非最后一个候选失败，会发出降级 warning
- 全部失败时直接抛错

当前 warning 映射：

- `media-recorder` 不可用时发 `MediaRecorderFallback`
- `audio-worklet` 不可用时发 `ScriptProcessorFallback`

## 7. 三种输入后端的职责边界

### 7.1 MediaRecorderBackend

实现位于 [`src/input/backends/media-recorder-backend.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/media-recorder-backend.ts)。

特点：

- 直接消费 `MediaStream`
- 使用 `audio/webm; codecs=pcm`
- 产出 WebM PCM 数据后再交给 `webm-pcm-extractor` 解析为 planar PCM
- 保留浏览器原生 APM 链路

适合浏览器原生支持较好的路径，因此被放在默认优先级第一位。

### 7.2 AudioWorkletBackend

实现位于 [`src/input/backends/audio-worklet-backend.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/audio-worklet-backend.ts)。

特点：

- 基于 Web Audio 图构建
- 通过 `AudioWorkletNode` 把 PCM 帧回传到 session
- 移动端启用批量缓冲，降低消息频率
- 当浏览器支持良好时，适合作为 MediaRecorder 之后的高质量降级路径

### 7.3 ScriptProcessorBackend

实现位于 [`src/input/backends/script-processor-backend.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/script-processor-backend.ts)。

特点：

- 仅作兼容性兜底
- 依赖废弃的 `ScriptProcessorNode`
- 仍通过 `sink` 和 session 走统一帧处理链路

文档与代码都将其视为 fallback，而不是推荐主路径。

## 8. BrowserInputSession 与帧生成

`BrowserInputSession` 位于 [`src/input/browser-input-session.ts`](/E:/ai-base-workspace/audio-recorder/src/input/browser-input-session.ts)。

它是输入层和控制层之间的桥：

- 负责录音态门控
- 负责把 Float32 planar 帧转换成 `AudioFrame`
- 负责丢帧补偿与 frame loss warning（可通过 `disableFrameLossCompensation: true` 禁用静音填补，但 warning 仍会触发）
- 对外提供：
  - `actualSampleRate`
  - `actualChannelCount`
  - `actualInputStrategy`
  - `start / pause / resume / stop / close`

帧对象结构定义在 [`src/types.ts`](/E:/ai-base-workspace/audio-recorder/src/types.ts)：

```ts
interface AudioFrame {
  channels: number
  sampleRate: number
  timestamp: number
  durationMs: number
  planar: Int16Array[]
}
```

## 9. 帧流转链路

帧链路从输入后端进入，到导出或插件消费结束：

```mermaid
flowchart TD
  A[InputBackend] --> B[BrowserInputSession.acceptFrame]
  B --> C[createAudioFrame]
  C --> D[RecorderController.handleFrame]
  D --> E[PcmFramePipeline.acceptFrame]
  D --> F[PluginHost.onFrame]
  D --> G[frame:async event]
  E --> H[PcmBufferStore]
```

其中：

- `PcmFramePipeline` 位于 [`src/pipeline/pcm-frame-pipeline.ts`](/E:/ai-base-workspace/audio-recorder/src/pipeline/pcm-frame-pipeline.ts)
- 真实缓冲实现位于 `src/buffer/`
- `frame:async` 只在存在监听器时才异步派发

## 10. 缓冲与持久化链路

缓冲层支持三种模式：

- `memory`
- `persistent`
- `auto`

接口定义位于 [`src/storage/types.ts`](/E:/ai-base-workspace/audio-recorder/src/storage/types.ts)。

设计原则：

- 核心库只认识持久化协议，不内置具体后端
- OPFS 和 IndexedDB 通过独立子路径插件接入
- `auto` 模式在内存超过阈值后再切换持久化

当前可用持久化插件：

- `audio-recorder/storage/opfs`
- `audio-recorder/storage/indexeddb`

持久化链路如下：

```mermaid
flowchart LR
  A[AudioFrame] --> B[PcmFramePipeline]
  B --> C[PcmBufferStore]
  C --> D{storage mode}
  D -->|memory| E[InMemoryPcmBufferStore]
  D -->|persistent/auto| F[PersistPcmBufferStore]
  F --> G[Persistence Session]
  G --> H[OPFS or IndexedDB]
```

## 11. 事件架构

当前事件分成两类总线：

1. 主控制器事件总线 `EventBus`
2. 插件事件总线 `PluginEventBus`

主事件包括：

- `statechange`
- `frame:async`
- `issue`

插件事件以 `plugin:` 为前缀，例如：

- `plugin:level`
- `plugin:stream`

`RecorderController.on()` 会根据事件名前缀决定路由到哪条总线。

## 12. 插件链路

插件宿主位于 [`src/plugins/plugin-host.ts`](/E:/ai-base-workspace/audio-recorder/src/plugins/plugin-host.ts)。

当前内置且稳定的插件能力有两个：

### 12.1 Level Meter

入口：[`src/plugins/level-meter/index.ts`](/E:/ai-base-workspace/audio-recorder/src/plugins/level-meter/index.ts)

功能：

- 在 `onFrame()` 中计算峰值和 RMS
- 通过 `plugin:level` 向外发事件
- 不修改主链路数据

### 12.2 Streaming Export

入口：[`src/plugins/streaming-export/index.ts`](/E:/ai-base-workspace/audio-recorder/src/plugins/streaming-export/index.ts)

功能：

- 接收实时 PCM 帧
- 通过 `ChunkedEncoderBridge` 驱动 chunk 编码
- 优先走 Worker，失败时可降级回主线程
- 在 `start()` 时重置 bridge，并为本次录音生成新的 stream session
- 通过 `plugin:stream` 输出 `StreamingPacketPayload`
- `stop()` 时通过 `flush()` 补发最终 packet（若编码器仍有剩余输出）

## 13. 导出链路

当前同时存在两类导出路径。

### 13.1 全量快照导出

入口：`recorder.exportEncoded(type, options)`

支持格式：

- `pcm`
- `wav`
- `mp3`

前提是调用方已经注册对应 `ExportEncoderDefinition`。

相关实现：

- [`src/codecs/base/pcm-snapshot-encoder.ts`](/E:/ai-base-workspace/audio-recorder/src/codecs/base/pcm-snapshot-encoder.ts)
- [`src/codecs/base/wav-snapshot-encoder.ts`](/E:/ai-base-workspace/audio-recorder/src/codecs/base/wav-snapshot-encoder.ts)
- [`src/codecs/mp3/mp3-snapshot-exporter.ts`](/E:/ai-base-workspace/audio-recorder/src/codecs/mp3/mp3-snapshot-exporter.ts)

### 13.2 实时 chunk 导出

入口：`createStreamingExportPlugin({ format, encoders })`

支持任意格式，只需在 `encoders` 中传入对应的 `StreamEncoderDefinition`。内置基础编解码器提供：

- `pcmStreamEncoder`
- `wavStreamEncoder`

## 14. Worker bridge 链路

通用 Worker bridge 位于 [`src/workers/chunked-encoder-bridge.ts`](/E:/ai-base-workspace/audio-recorder/src/workers/chunked-encoder-bridge.ts)。

职责：

- 统一管理 chunked encoder 的 Worker/主线程执行模式
- 抽象 `feedFrame()` 与 `flush()` 的异步接口
- 隔离 MP3 等重型编码依赖

当前策略：

- 如果 `StreamEncoderDefinition.workerFactory` 可用，优先创建 Worker
- Worker 不可用且允许降级时，回退到主线程同步编码
- `dispose()` 负责释放 Worker 或主线程 encoder 实例

## 15. 状态机

控制器外部可见的状态机如下：

```text
idle -> ready -> recording -> paused -> recording -> stopped -> closed
```

还有一个终态：

```text
destroyed
```

状态约束由 `assertState()` 强制校验，不合法调用会直接抛错。

## 16. Playground 链路

`playground/` 的职责不是开发源码调试页，而是验证“构建产物是否可用”。

当前特征：

- 页面直接引入 `/dist/index.js`
- Vue 通过 CDN ESM 运行
- 支持麦克风与 external tone 两类输入源
- 可以切换持久化模式和后端
- 支持导出 PCM/WAV/MP3

功能测试 [`tests/functional/app.spec.ts`](/E:/ai-base-workspace/audio-recorder/tests/functional/app.spec.ts) 直接覆盖这条链路。

## 17. 代码定位索引

核心入口：

- [`src/index.ts`](/E:/ai-base-workspace/audio-recorder/src/index.ts)
- [`src/types.ts`](/E:/ai-base-workspace/audio-recorder/src/types.ts)

控制层：

- [`src/core/recorder-controller.ts`](/E:/ai-base-workspace/audio-recorder/src/core/recorder-controller.ts)
- [`src/core/event-bus.ts`](/E:/ai-base-workspace/audio-recorder/src/core/event-bus.ts)

输入层：

- [`src/input/browser-input-adapter.ts`](/E:/ai-base-workspace/audio-recorder/src/input/browser-input-adapter.ts)
- [`src/input/browser-input-session.ts`](/E:/ai-base-workspace/audio-recorder/src/input/browser-input-session.ts)
- [`src/input/backends/select.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/select.ts)
- [`src/input/backends/media-recorder-backend.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/media-recorder-backend.ts)
- [`src/input/backends/audio-worklet-backend.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/audio-worklet-backend.ts)
- [`src/input/backends/script-processor-backend.ts`](/E:/ai-base-workspace/audio-recorder/src/input/backends/script-processor-backend.ts)
- [`src/input/webm-pcm-extractor.ts`](/E:/ai-base-workspace/audio-recorder/src/input/webm-pcm-extractor.ts)

缓冲与导出：

- [`src/pipeline/pcm-frame-pipeline.ts`](/E:/ai-base-workspace/audio-recorder/src/pipeline/pcm-frame-pipeline.ts)
- [`src/buffer/pcm-buffer-store.ts`](/E:/ai-base-workspace/audio-recorder/src/buffer/pcm-buffer-store.ts)
- [`src/codecs/base/index.ts`](/E:/ai-base-workspace/audio-recorder/src/codecs/base/index.ts)
- [`src/codecs/mp3/index.ts`](/E:/ai-base-workspace/audio-recorder/src/codecs/mp3/index.ts)

扩展能力：

- [`src/plugins/plugin-host.ts`](/E:/ai-base-workspace/audio-recorder/src/plugins/plugin-host.ts)
- [`src/plugins/level-meter/index.ts`](/E:/ai-base-workspace/audio-recorder/src/plugins/level-meter/index.ts)
- [`src/plugins/streaming-export/plugin.ts`](/E:/ai-base-workspace/audio-recorder/src/plugins/streaming-export/plugin.ts)
- [`src/storage/opfs/plugin.ts`](/E:/ai-base-workspace/audio-recorder/src/storage/opfs/plugin.ts)
- [`src/storage/indexeddb/plugin.ts`](/E:/ai-base-workspace/audio-recorder/src/storage/indexeddb/plugin.ts)
- [`src/workers/chunked-encoder-bridge.ts`](/E:/ai-base-workspace/audio-recorder/src/workers/chunked-encoder-bridge.ts)
