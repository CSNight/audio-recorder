# audio-recorder

面向浏览器场景的 TypeScript 录音库，当前已经完成录音主链路、PCM/WAV/MP3 导出、插件事件体系、流式 chunk 导出，以及可插拔的持久化溢写能力。

项目当前实现以 `src/` 为库源码，以 `dist/` 为对外产物；`playground/` 只消费构建后的产物，用来验证真实打包结果而不是源码直连行为。

## 当前能力

- `createRecorder()` 创建录音控制器，支持 `open / start / pause / resume / stop / close / destroy`
- 输入来源支持麦克风和外部 `MediaStream`
- 输入策略支持 `media-recorder`、`audio-worklet`、`script-processor`，默认按兼容性自动降级
- 支持麦克风设备枚举与 `deviceId` 定向选择
- 支持实时 PCM 帧分发、状态事件、告警事件和插件事件
- 支持 `pcm`、`wav`、`mp3` 三种全量导出
- 支持 `streaming-export` 实时 chunk 编码插件
- 支持 `level-meter` 实时电平插件
- 支持 `memory / auto / persistent` 三种缓冲存储模式
- 支持 OPFS 与 IndexedDB 两种持久化后端

## 安装与开发

```bash
npm install
npm run dev
```

常用命令：

- `npm run dev`：启动开发服务器
- `npm run dev:playground`：先构建库，再打开 playground
- `npm run build`：构建库产物与类型声明
- `npm run typecheck`：TypeScript 检查
- `npm run test:unit`：Vitest 单元测试
- `npm run test:functional`：Playwright 功能测试
- `npm run check`：执行 lint、typecheck、测试、build、导出校验

## 快速使用

```ts
import { createRecorder } from "audio-recorder"
import {
  pcmSnapshotEncoderDefinition,
  wavSnapshotEncoderDefinition,
} from "audio-recorder/codecs/base"
import { mp3SnapshotEncoderDefinition } from "audio-recorder/codecs/mp3"

const recorder = createRecorder({
  channelCount: 1,
  inputStrategy: "auto",
  encoders: [
    pcmSnapshotEncoderDefinition,
    wavSnapshotEncoderDefinition,
    mp3SnapshotEncoderDefinition,
  ],
})

await recorder.open()
await recorder.start()

const summary = await recorder.stop()
const wav = await recorder.exportEncoded("wav", { bitRate: 16 })

console.log(summary.durationMs, wav.arrayBuffer.byteLength)
```

## 可选扩展入口

根入口只暴露最小核心 API，扩展能力通过子路径显式引入：

- `audio-recorder/codecs/base`
- `audio-recorder/codecs/mp3`
- `audio-recorder/plugins/streaming-export`
- `audio-recorder/plugins/level-meter`
- `audio-recorder/storage/opfs`
- `audio-recorder/storage/indexeddb`

实时 chunk 导出示例：

```ts
import { createRecorder } from "audio-recorder"
import { createStreamingExportPlugin } from "audio-recorder/plugins/streaming-export"
import { wavChunkedEncoderDefinition } from "audio-recorder/codecs/base"

const recorder = createRecorder()

await recorder.use(
  createStreamingExportPlugin({
    format: "wav",
    encoders: [wavChunkedEncoderDefinition],
  })
)

recorder.on("plugin:encoded-chunk", ({ payload }) => {
  console.log(payload.format, payload.chunk.byteLength, payload.isFinal)
})
```

持久化溢写示例：

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

## 仓库结构

```text
src/
  core/               控制器、事件总线
  input/              浏览器输入适配、后端选择、WebM PCM 提取
  pipeline/           帧管线
  buffer/             内存/持久化缓冲
  codecs/             PCM/WAV/MP3 编解码器
  plugins/            level-meter、streaming-export
  storage/            OPFS / IndexedDB 持久化插件
  workers/            通用 chunk 编码 Worker 桥接
playground/           基于 dist 产物的验证页面
tests/                单元测试与 Playwright 功能测试
docs/                 方案、架构与文档索引
vendor/               上游 Recorder 参考实现
```

## 文档入口

- 文档索引：[`docs/README.md`](./docs/README.md)
- 架构文档：[`docs/architecture/execution-chain.md`](./docs/architecture/execution-chain.md)
- 方案文档：[`docs/plans/recorder-ts-master-plan.md`](./docs/plans/recorder-ts-master-plan.md)

## 测试覆盖现状

- 单元测试覆盖控制器、输入后端选择、PCM/WAV 编码、chunked encoder bridge、插件总线、持久化插件等核心模块
- Playwright 功能测试覆盖 external stream 生命周期、IndexedDB/OPFS 持久化路径和 playground 对 `dist` 产物的真实消费

## 浏览器兼容性

以下数据基于 `src/` 实际代码中使用的 Web API 逐一评估，构建产物以 ES2022 为输出目标（`vite.config.ts: target: "es2022"`）。

### 输入策略

代码在 `media-recorder-backend.ts` 中通过 `MediaRecorder.isTypeSupported("audio/webm; codecs=pcm")` 做严格检测，只有支持 PCM 裸音频录入的浏览器才会走 media-recorder 路径；其他浏览器自动降级。

| 输入策略 | 最低 Chrome | 最低 Firefox | 最低 Safari | 代码依据 |
|---|---|---|---|---|
| `media-recorder`（默认首选） | **105** | ❌ 不支持 | ❌ 不支持 | `MediaRecorder` + `isTypeSupported("audio/webm; codecs=pcm")`，该 MIME 为 Chromium 专属，Firefox/Safari 不支持 |
| `audio-worklet` | **66** | **76** | **14.1** | `AudioWorkletNode` + `audioWorklet.addModule()` |
| `script-processor`（兜底） | **35** | **25** | **6** | `createScriptProcessor()`（已弃用，仅作降级兜底） |
| `auto` 自动降级 | **66** ¹ | **76** | **14.1** | Firefox/Safari 跳过 media-recorder，直接走 audio-worklet |

¹ Chrome 66–104 无 `audio/webm; codecs=pcm` 支持，自动降级为 audio-worklet，不影响可用性。

### 持久化存储

| 存储插件 | 最低 Chrome | 最低 Firefox | 最低 Safari | 代码依据 |
|---|---|---|---|---|
| `storage/indexeddb` | **24** | **16** | **8** | 标准 `indexedDB` API |
| `storage/opfs` | **102** | **111** | **15.2** | `navigator.storage.getDirectory()` + `createWritable()`（async OPFS） |

### 编码器

编码器本身无录音 API 依赖，可独立于录音策略使用。

| 编码器 | 入口 | 最低 Chrome | 最低 Firefox | 最低 Safari | 代码依据 |
|---|---|---|---|---|---|
| PCM（原始） | `codecs/base` | **57** | **52** | **11** | 仅 `Float32Array` / `Int16Array`，ES2022 类型化数组 |
| WAV | `codecs/base` | **57** | **52** | **11** | 同上，无额外 Web API |
| G.711（μ-law / a-law） | `codecs/g711` | **57** | **52** | **11** | 纯算术运算，无额外 Web API |
| MP3（lamejs） | `codecs/mp3` | **57** | **52** | **11** | 纯 JS 实现，无 WASM，无额外 Web API |
| FLAC（libflac WASM） | `codecs/flac` | **57** | **52** | **11** | `WebAssembly.instantiate()`（Emscripten 胶水层）；已移除 `Symbol.dispose` |
| Opus（libopus WASM） | `codecs/opus` | **57** | **52** | **11** | `WebAssembly.instantiate()`（同上）；Opus 编码器使用 `BigInt`（ES2020，Chrome 67+，以 WASM 57 为瓶颈） |

> FLAC / Opus 瓶颈为 `WebAssembly.instantiate`（Chrome 57 / Firefox 52 / Safari 11），不受主库录音路径版本约束，可单独在更低版本中使用。

### 插件

| 插件 | 入口 | 最低 Chrome | 最低 Firefox | 最低 Safari | 代码依据 |
|---|---|---|---|---|---|
| `level-meter` | `plugins/level-meter` | **66** | **76** | **14.1** | 依赖录音帧事件，以 audio-worklet 为基准 |
| `streaming-export` | `plugins/streaming-export` | **66** | **76** | **14.1** | 依赖 `Worker` + `MessageChannel`（ES2022 环境内已有） |

### 综合最低版本汇总

| 使用场景 | 最低 Chrome | 最低 Firefox | 最低 Safari |
|---|---|---|---|
| 核心录音（auto 策略） + 编码器 | **66** | **76** | **14.1** |
| 核心录音（auto 策略） + 编码器 + IndexedDB 持久化 | **66** | **76** | **14.1** |
| 核心录音（auto 策略） + 编码器 + OPFS 持久化 | **102** | **111** | **15.2** |
| 强制使用 `media-recorder` 策略（最高质量采集） | **105** | ❌ | ❌ |
| 仅使用编码器（不录音） | **57** | **52** | **11** |

## 当前边界

- 根入口不会自动注册任何编码器；调用 `exportEncoded()` 前需要显式传入或注册对应 `SnapshotEncoderDefinition`
- MP3 作为可选子路径存在，避免把 `lamejs` 依赖注入主包
- `script-processor` 仅作为兼容性兜底，不建议作为默认录音方案
- Phase 5、Phase 6 中规划的更多编解码器和插件扩展目前尚未开发
