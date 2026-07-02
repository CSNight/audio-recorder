# Streaming Player 落地方案

更新时间：2026-07-02

---

## 一、功能点清单

| #  | 功能               | 实现方式                                                                       |
|----|------------------|----------------------------------------------------------------------------|
| 1  | **接收音频包**        | 调用 `player.push(packet)` 推入 `StreamingPacketPayload`                       |
| 2  | **双写持久化**        | 每次 `push()` 同时写入 persistStore（无论是否暂停）                                      |
| 3  | **乱序重排**         | `ReorderBuffer`：按 `seq` 排序，超时后强制放行，通过 `onRelease` 回调输出                     |
| 4  | **抖动缓冲**         | `JitterBuffer`：累积至 `targetLatencyMs` 后开始出队，通过 `onRelease` 回调输出             |
| 5  | **解码**           | 主线程异步解码，`AudioDecoderDefinition.decode(EncodedAudioChunk) → DecodedAudioChunk` |
| 6  | **连续播放**         | `AudioBufferSourceNode` 链式调度（`scheduleAudioBuffer`），`GainNode` 控制音量         |
| 7  | **欠载保护**         | 定时检测 `audioCtx.currentTime > _scheduleTime`，超出则触发 `onUnderrun` 并回到 buffering |
| 8  | **积压处理**         | 缓冲超 `maxBufferMs` 时丢旧包（`jitterBuf.dropOld`），触发 `onPacketDrop`              |
| 9  | **暂停（无延时恢复）**    | 暂停：停止推入管线并停止已调度 source，内部创建的 `audioCtx` 会 suspend；恢复：清空积压并 `audioCtx.resume()` |
| 10 | **重播最近 N 秒**     | `replay(seconds)`：只能在暂停状态调用，从 persistStore 取历史包解码并调度，播完保持暂停             |
| 11 | **持久化存储选择**      | `persistMode: "memory"` 或 `"indexeddb"`；当前 `indexeddb` 为旁路写入，不支持跨刷新读回      |
| 12 | **storedMs 指标**  | `player.storedMs` 实时读取 persistStore 的已存储时长                                 |
| 13 | **音量控制**         | `setVolume(v)` 动态修改 `GainNode.gain.value`                                  |
| 14 | **停止 / 销毁**      | 停止 drain 循环，关闭 AudioContext，清空缓冲                                           |
| 15 | **状态上报**         | `state`：`idle / buffering / playing / paused / stopped`；`onStateChange` 回调 |
| 16 | **动态 onStateChange** | 可在创建后直接赋值 `player.onStateChange = fn`，设为 null 停止监听                    |

---

## 二、核心链路

```
push(packet)
  ├─→ persistStore.push(packet)        // 双写：始终写入，用于重播
  │
  └─→ （未暂停时）
       │
       ▼
  ReorderBuffer                        // 按 seq 排序，onRelease 回调
       │
       ▼
  JitterBuffer                         // 累积 targetLatencyMs，onRelease 回调
       │
       ▼
  decodePacket()                       // EncodedAudioChunk → DecodedAudioChunk → AudioBuffer
       │
       ▼
  scheduleAudioBuffer()                // AudioBufferSourceNode 链式调度
       │
       ▼
  AudioContext.destination             // 浏览器音频输出
```

**暂停时**：`push()` 只写 persistStore，不进入管线。

**重播时**：`persistStore.recent(ms)` → 逐包解码 → 链式调度 → 播完后 `audioCtx.suspend()`。

---

## 三、输入 / 输出

### 输入

```ts
player.push(packet)  // StreamingPacketPayload（直接复用现有类型）
```

业务层可从 WebSocket、录音事件等来源推包，与播放器完全解耦。

### 输出

```ts
const player = await createStreamingPlayer({
  // 必填：解码器列表
  decoders: [pcm16Decoder],

  // 可选
  targetLatencyMs: 300,         // 默认 300ms
  maxBufferMs: 3000,            // 默认 3000ms，超出丢旧包
  volume: 1.0,                  // 默认 1.0

  // 持久化存储
  persistMode: "memory",        // 或 "indexeddb"
  persistBufferMs: 10_000,      // 默认 10000ms

  // 可选：复用已有 AudioContext
  audioContext: existingCtx,

  // 回调
  onUnderrun: ({ bufferedMs }) => {},
  onPacketDrop: ({ count, reason }) => {},
  onStateChange: (state) => {},
})

// 控制
await player.start()            // idle → buffering（等缓冲充足后自动切 playing）
player.pause()                  // 暂停（推包只写 persistStore）
player.resume()                 // 恢复（清空积压，重新缓冲）
player.replay(5)                // 重播最近 5 秒（仅限暂停状态）
player.setVolume(0.8)           // 动态音量
player.destroy()                // 销毁

// 动态回调赋值
player.onStateChange = (s) => console.log(s)
player.onStateChange = null     // 停止监听

// 只读 getter
player.state           // StreamingPlayerState
player.bufferedMs      // 管线中已缓冲时长（ms）
player.droppedPackets  // 已丢弃包总数
player.storedMs        // persistStore 已存储时长（ms），即最大可重播时长
```

---

## 四、目录结构

```
src/plugins/streaming-player/
  index.ts                  // 公开导出入口
  types.ts                  // StreamingPlayerOptions / Handle / State
  player.ts                 // createStreamingPlayer 主实现
  reorder-buffer.ts         // 按 seq 排序（onRelease 回调，reset()）
  jitter-buffer.ts          // 抖动缓冲（onRelease 回调，reset()，dropOld()）
  persist-store.ts          // 内置 persist store：memory / indexeddb
```

---

## 五、关键设计决策

### 5.1 为什么去掉 autoPlay / backlogPolicy wait

- `autoPlay: false` 无效：`start()` 会立即启动 drain 循环，不存在"延迟自动播放"语义。
- `backlogPolicy: 'wait'` 无法实现无感恢复：暂停后积压的旧包进入队列，恢复时会先播旧包，产生与暂停等长的延时。
- **现方案**：`resume()` 调用 `resetPipeline()` 清空 reorder/jitter 缓冲，从当前时刻重新缓冲，延时仅为 `targetLatencyMs`。

### 5.2 双写持久化 vs 单写管线

- 管线（ReorderBuffer + JitterBuffer）只服务于当前播放，暂停时完全旁路。
- persistStore 始终接收每个 packet，保证历史可重播，与播放状态解耦。
- `indexeddb` 模式当前只做旁路写入，`recent()` 仍基于当前实例的内存镜像。

### 5.3 replay() 只在暂停时可用

- 重播期间 AudioContext 需要先 resume，播完后再 suspend，期间不接受新的调度包。
- 在 playing 状态下调用会与正在播放的包产生调度冲突。
- replay 播完后保持 paused 状态，业务层可选择继续 resume 或再次 replay。

### 5.4 persist-store 的当前边界

- `memory` 模式是默认路径，重播历史完全来自当前实例内存。
- `indexeddb` 模式会将包异步写入 IndexedDB，但当前不会在新实例中读回。
- 因此“跨页面刷新后继续 replay”不属于当前能力边界。

---

## 六、解码器接口

```ts
// 传入 createStreamingPlayer({ decoders })
interface AudioDecoderDefinition {
  format: string
  decode(chunk: EncodedAudioChunk): Promise<DecodedAudioChunk>
}

interface EncodedAudioChunk {
  format: string
  sampleRate: number
  channels: number
  chunk: Uint8Array   // 原始编码字节
}

interface DecodedAudioChunk {
  sampleRate: number
  channels: number
  planar: Float32Array[]  // planar[ch][frame]，非 interleaved
}
```

PCM-16 解码示例：

```ts
const pcm16Decoder: AudioDecoderDefinition = {
  format: 'pcm16',
  async decode({ sampleRate, channels, chunk }) {
    const i16 = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2)
    const samplesPerChannel = i16.length / channels
    const planar = Array.from({ length: channels }, (_, ch) => {
      const plane = new Float32Array(samplesPerChannel)
      for (let i = 0; i < samplesPerChannel; i++) {
        plane[i] = (i16[i * channels + ch] ?? 0) / 32768
      }
      return plane
    })
    return { sampleRate, channels, planar }
  },
}
```

---

## 七、与现有代码衔接

- `StreamingPacketPayload` 不改字段，直接复用。
- `createStreamingExportPlugin()` 不动；播放层通过订阅 `plugin:stream` 事件获取 packet，手动调用 `player.push(payload)`。
- ReorderBuffer / JitterBuffer 使用 `onRelease` 回调模式（非 2-参数 push，非数组返回的 drain）。
- 子路径导出：`@csnight/audio-recorder/plugins/streaming-player`。

---

## 八、v1 已交付 / v2+ 待做

**v1 已交付：**

- PCM-16 等自定义解码器接口
- MemoryPersistStore + IndexedDbPersistStore
- reorder + jitter buffer（onRelease 回调，reset()）
- AudioBufferSourceNode 链式调度
- pause/resume 无延时（resetPipeline on resume）
- replay() 暂停时重播
- storedMs / bufferedMs / droppedPackets 指标
- 动态 onStateChange 赋值
- Vue 3 playground 完整演示

**v2+ 待做：**

- WASM 解码器（Opus、AAC、MP3）
- AudioWorklet + SharedArrayBuffer ring buffer 替代 AudioBufferSourceNode
- 速度拉伸（追赶积压时 1.05× playback rate）
- MediaStream 导出
