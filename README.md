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
import { createRecorder } from "@scope/audio-recorder"
import {
  pcmSnapshotEncoderDefinition,
  wavSnapshotEncoderDefinition,
} from "@scope/audio-recorder/codecs/base"
import { mp3SnapshotEncoderDefinition } from "@scope/audio-recorder/codecs/mp3"

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

- `@scope/audio-recorder/codecs/base`
- `@scope/audio-recorder/codecs/mp3`
- `@scope/audio-recorder/plugins/streaming-export`
- `@scope/audio-recorder/plugins/level-meter`
- `@scope/audio-recorder/storage/opfs`
- `@scope/audio-recorder/storage/indexeddb`

实时 chunk 导出示例：

```ts
import { createRecorder } from "@scope/audio-recorder"
import { createStreamingExportPlugin } from "@scope/audio-recorder/plugins/streaming-export"
import { wavChunkedEncoderDefinition } from "@scope/audio-recorder/codecs/base"

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
import { createRecorder } from "@scope/audio-recorder"
import { createIndexedDbPersistencePlugin } from "@scope/audio-recorder/storage/indexeddb"

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

## 当前边界

- 根入口不会自动注册任何编码器；调用 `exportEncoded()` 前需要显式传入或注册对应 `SnapshotEncoderDefinition`
- MP3 作为可选子路径存在，避免把 `lamejs` 依赖注入主包
- `script-processor` 仅作为兼容性兜底，不建议作为默认录音方案
- Phase 5、Phase 6 中规划的更多编解码器和插件扩展目前尚未开发
