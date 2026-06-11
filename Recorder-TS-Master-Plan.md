# Recorder TS 化长期主文档

## 文档说明

本文档用于指导 `xiangyuecn/Recorder` 核心能力的渐进式 TypeScript 重构。文档结构固定为三部分：

1. 方案
2. 计划
3. 实施

目标是让项目长期可推进、可中断、可恢复，避免方案分散、阶段重复和执行失真。

本次改造的总目标只有三个：

- 易用
- 可扩展
- 可渐进

约束条件：

- 单仓库
- 单 npm 包
- 单库多入口导出
- Vite 构建
- 不挂载 `window`
- 支持长期演进和中断恢复

---

# 第一部分：方案

## 1. 改造目标

目标不是完整复刻原仓库所有能力，而是抽取并重构以下核心能力：

- 浏览器录音
- 实时 PCM 数据处理
- 可选编码与导出
- 可选解码
- 插件加载与增强能力

第一版优先支持：

- 麦克风录音
- 外部 `MediaStream` 录音
- PCM
- WAV
- MP3
- 浏览器原生 AEC / ANS / AGC
- 实时事件与插件
- 基础解码

第一版不承诺：

- 全量 Demo 迁移
- i18n 迁移
- App / 小程序 / uni-app 全适配
- 所有 beta 编码器
- 自研复杂回声消除

## 2. 现有仓库核心结论

### 2.1 现有能力

原仓库已具备：

- `getUserMedia` 录音
- `sourceStream` 录音
- `open/start/pause/resume/stop/close`
- 实时 `onProcess`
- PCM 缓冲
- 采样率转换
- PCM / WAV / MP3 / G711 / OGG / AMR / WebM 等格式能力
- 波形、频谱、流播放、变速变调等扩展

### 2.2 现有核心链路

原仓库最重要的主链路是：

1. `open`
2. 权限申请或接入外部流
3. `Connect`
4. 采集音频数据
5. `onReceive`
6. 转成 PCM
7. `envIn`
8. 缓冲、补偿、实时回调、实时编码
9. `stop`
10. 汇总导出

### 2.3 当前架构问题

当前问题集中在四类：

| 问题              | 说明                                      |
| ----------------- | ----------------------------------------- |
| 全局耦合          | `UMD + window/Object + Recorder` 全局状态 |
| 扩展方式粗糙      | 编码器和插件靠副作用挂到 `Recorder` 上    |
| 边界不清晰        | 采集、缓冲、导出、插件、播放混在一起      |
| TypeScript 价值低 | 现有 TS 示例几乎只是 `any` 包装           |

结论：

- 不建议原地把 `recorder-core.js` 改成 `.ts`
- 应先重构边界，再迁移语言

## 3. 目标架构

### 3.1 总体形态

采用：

- 单仓库
- 单库多入口
- 核心与增强能力分层
- 事件驱动
- 注册式编码器与插件

对外使用形态：

```ts
import { createRecorder } from "@scope/recorder"
import { wavEncoder } from "@scope/recorder/encoders/wav"
import { mp3Encoder } from "@scope/recorder/encoders/mp3"
import { waveformPlugin } from "@scope/recorder/plugins/waveform"

const recorder = createRecorder()
recorder.setEncoder(wavEncoder())
recorder.use(waveformPlugin())
```

禁止使用：

```ts
window.Recorder = ...
```

### 3.2 单库多入口策略

推荐导出结构：

- `@scope/recorder`
- `@scope/recorder/encoders/pcm`
- `@scope/recorder/encoders/wav`
- `@scope/recorder/encoders/mp3`
- `@scope/recorder/plugins/level-meter`
- `@scope/recorder/plugins/waveform`
- `@scope/recorder/plugins/stream-player`

原则：

- 根入口只暴露最小核心 API
- 编码器和插件走子路径
- 避免根入口强绑定所有增强模块

### 3.3 内部分层

| 层       | 职责                       |
| -------- | -------------------------- |
| Core     | 状态机、生命周期、事件系统 |
| Capture  | 麦克风、外部流、约束协商   |
| Pipeline | PCM 标准化、分发、缓存     |
| Codecs   | 编码器实现                 |
| Decoders | 解码实现                   |
| Plugins  | 波形、音量、流播放、DSP    |
| Registry | 编码器与插件注册           |
| Workers  | Worker 桥接与实时编码      |
| Utils    | 重采样、音量、错误、兼容性 |

## 4. 参考其他录音库后的改进建议

### 4.1 来自 `extendable-media-recorder`

可借鉴点：

- 优先复用原生 `MediaRecorder`
- 自定义编码器要有明确注册机制
- 采样率控制最好通过前置音频处理而不是直接依赖浏览器录制参数

改进建议：

- 新架构采用双后端：
  - `PcmPipelineBackend`
  - `MediaRecorderBackend`
- 原生支持的格式优先走 `MediaRecorder`
- 需要精细控制的格式走 PCM 主链

### 4.2 来自 `wavesurfer.js record`

可借鉴点：

- 事件驱动清晰
- 实时波形和录音逻辑解耦
- 插件边界明确

改进建议：

- 统一事件模型
- 可视化全部插件化
- 进度、分片、状态都做一等事件

### 4.3 来自 `opus-recorder`

可借鉴点：

- 明确暴露声道数配置
- 明确编码采样率和流式输出能力

改进建议：

- 从第一版开始让类型系统支持 `1/2` 声道
- 多声道支持不能只在编码器阶段考虑，必须贯通采集、缓存、导出、插件

### 4.4 来自 `RecordRTC`

可借鉴点：

- 配置面完整
- 录音分片、通道数、采样率、比特率等都能表达

改进建议：

- 采用分层配置，而不是一个大对象塞满底层参数

建议配置结构：

```ts
type RecorderOptions = {
  capture?: AudioCaptureOptions
  pipeline?: AudioPipelineOptions
  encoder?: EncoderOptions
}
```

## 5. 多声道支持方案

### 5.1 结论

可以支持多声道，但建议按以下边界执行：

- v1 支持 `1` 和 `2` 声道
- v1 不承诺任意多声道
- 先支持立体声 PCM / WAV
- 再支持原生 `WebM/Opus`
- 最后再评估 MP3 立体声

### 5.2 浏览器现实约束

浏览器层面存在几个事实：

- `channelCount` 是可请求约束，但并非所有浏览器都稳定支持
- 某些浏览器可能忽略该约束
- 即使请求 `2` 声道，最终实际拿到的也可能是 `1`
- `AudioWorklet` 并非所有环境都同样稳定
- `ScriptProcessor` 已过时，但仍可能需要作为兼容降级路径

因此必须采用“请求值 != 实际值”的设计：

1. 先检查能力支持
2. 再请求期望声道数
3. 启动后读取实际声道数
4. 内部一律以实际结果为准

### 5.3 多声道数据模型

内部帧模型建议：

```ts
export interface AudioFrame {
  channels: 1 | 2
  sampleRate: number
  timestamp: number
  durationMs: number
  planar: Int16Array[]
}
```

不能继续使用“单个 `Int16Array` 默认就是单声道”的模型。

### 5.4 多声道支持优先级

| 格式/路径   | 建议             |
| ----------- | ---------------- |
| PCM         | 必须支持         |
| WAV         | 必须支持         |
| WebM/Opus   | 强烈建议支持     |
| MP3         | 可选，第二优先级 |
| G711A/G711U | 默认单声道       |
| AMR         | 默认单声道       |

## 6. 浏览器兼容性策略

### 6.1 能力优先级

录音后端优先级建议：

1. `MediaRecorderBackend`
2. `AudioWorklet`
3. `ScriptProcessor` fallback

### 6.2 兼容性结论

需要明确接受的现实：

- `getUserMedia` 是前提，没有它就无法录音
- `MediaRecorder` 适合原生编码和分片，但格式能力受浏览器约束
- `AudioWorklet` 更现代，但移动端稳定性要单独验证
- `ScriptProcessor` 已过时，但短期内仍是降级路径
- `channelCount` 不能假设所有浏览器可靠支持

### 6.3 浏览器兼容设计原则

- 所有能力都走运行时探测，不做静态假设
- 所有降级都要发出 `warning`
- 所有录制模式都要能回退到“单声道 PCM 主链”
- 所有编码器入口都要在不支持时给出明确错误

## 7. 核心类型与 API

### 7.1 核心类型

```ts
export interface AudioCaptureOptions {
  sampleRate?: number
  channelCount?: 1 | 2
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}
```

```ts
export interface RecordingResult {
  blob?: Blob
  arrayBuffer: ArrayBuffer
  mimeType: string
  durationMs: number
  sampleRate: number
  channels: 1 | 2
}
```

### 7.2 编码器接口

```ts
export interface EncoderDefinition {
  type: string
  mimeType: string
  canRealtime?: boolean
  createSession(options: EncoderOptions): EncoderSession | Promise<EncoderSession>
}
```

### 7.3 插件接口

```ts
export interface RecorderPlugin {
  name: string
  setup(ctx: RecorderPluginContext): void | Promise<void>
  onStart?(): void
  onFrame?(frame: AudioFrame): void
  onPause?(): void
  onResume?(): void
  onStop?(): void
  dispose?(): void | Promise<void>
}
```

### 7.4 事件模型

建议至少保留：

- `statechange`
- `frame`
- `level`
- `encoded-chunk`
- `warning`
- `error`

## 8. TypeScript 与工程规范

### 8.1 工程要求

- `strict: true`
- 禁止默认 `any`
- 公开 API 显式声明类型
- 关键逻辑有注释
- Worker 协议单独封装
- 浏览器 API 不得散落业务层

### 8.2 工具链

- `vite`
- `typescript`
- `vitest`
- `playwright`
- `eslint`

### 8.3 构建要求

- 输出 ESM
- 输出类型声明
- 输出子路径入口
- 校验 `exports` 与 `dist` 一致

---

# 第二部分：计划

## 9. 阶段划分

项目按六个阶段推进。

## Phase 0：基线与工程初始化

目标：

- 固定行为基线
- 初始化单仓库工程

产出：

- Vite 工程
- 测试框架
- 基线记录
- 根入口和子路径导出结构

验收：

- `dev/build/typecheck/test` 可跑
- 有第一批自动化测试

## Phase 1：录制核心主链路

目标：

- 完成不依赖全局对象的录制主链路

范围：

- `open/start/pause/resume/close/destroy`
- 外部流接入
- 事件系统
- 声道协商
- PCM 实时帧输出

验收：

- 单声道录音稳定
- 请求双声道时可正确返回实际声道信息

## Phase 2：缓冲、重采样、PCM/WAV 导出

目标：

- 形成第一批可用于业务的输出能力

范围：

- `PcmBufferStore`
- `resample`
- PCM 导出
- WAV 导出
- 双声道 WAV

验收：

- PCM/WAV 导出正确
- 双声道 WAV 头部正确

## Phase 3：注册体系与插件体系

目标：

- 完成编码器与插件的正式扩展机制

范围：

- `EncoderRegistry`
- `PluginHost`
- `level-meter`
- `waveform`
- 多声道预览降混

验收：

- 插件完全不依赖全局
- 编码器可通过注册接入

## Phase 4：MP3 与实时编码

目标：

- 补齐主流业务导出格式

范围：

- MP3 编码
- WorkerBridge
- `encoded-chunk`
- 主线程 fallback

验收：

- 录音时可实时产出 MP3 分片
- `stop()` 可导出 MP3

## Phase 5：解码与流播放

目标：

- 形成录制 + 解码 + 播放闭环

范围：

- `decodeAudio`
- WAV/PCM 解码
- 浏览器原生解码
- `stream-player`

验收：

- 支持 wav/mp3 解码成 PCM
- 支持解码后回放

## Phase 6：DSP 与语音增强

目标：

- 让语音业务具备可插拔增强能力

范围：

- 高通
- 低通
- 噪声门
- G711
- 视情况评估 AMR

验收：

- DSP 插件可独立启停
- 不污染核心控制器

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
      waveform/
      stream-player/
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
- 重采样
- PCM 导出
- WAV 导出
- 双声道 WAV

#### Phase 3

- 编码器注册
- 插件宿主
- 音量插件
- 波形插件
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
5. `AudioWorklet` 不可用时允许走 `ScriptProcessor`
6. `MediaRecorder` 可用时优先评估原生后端

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

这是长期任务，实施部分必须支持中断恢复。每次开发结束都要更新以下记录。

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
- `IMPLEMENTATION-LOG.md` 维护阶段状态，`logs/YYYY-MM-DD.md` 维护当日执行明细，两者都必须同步更新。
