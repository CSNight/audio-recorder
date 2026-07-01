# Streaming Player 落地方案

更新时间：2026-07-01

---

## 一、功能点清单

| #  | 功能           | 实现方式                                                          |
|----|--------------|---------------------------------------------------------------|
| 1  | **接收音频包**    | 注册 source，每次 `plugin:stream` 事件推入一个 `StreamingPacketPayload`  |
| 2  | **乱序重排**     | 按 `seq` 维护优先队列，超时后强制放行                                        |
| 3  | **抖动缓冲**     | 维护目标缓冲量 `targetLatencyMs`（默认 300ms），缓冲足够才开始出队                 |
| 4  | **解码**       | Worker 内解码（PCM/WAV 同步即可，后续 WASM codec 异步），返回 `Float32Array[]` |
| 5  | **连续播放**     | AudioWorklet + SharedArrayBuffer ring buffer，与主线程完全解耦         |
| 6  | **欠载保护**     | ring buffer 空时 AudioWorklet 输出静音，主线程收到 `onUnderrun` 回调        |
| 7  | **积压处理**     | 缓冲超 `maxBufferMs` 时按策略丢旧包或等待                                  |
| 8  | **回放最近 N 秒** | 内存环形存储最近 packet，调用 `replay(seconds)` 重新入队                     |
| 9  | **音量控制**     | AudioWorklet 内对 PCM 乘以增益系数                                    |
| 10 | **暂停 / 恢复**  | 暂停：停止出队；恢复：继续出队                                               |
| 11 | **停止 / 销毁**  | 关闭 AudioContext，释放 Worker，清空缓冲                                |
| 12 | **状态上报**     | 暴露响应式 `state`：`idle / buffering / playing / paused / stopped` |
| 13 | **指标回调**     | `onUnderrun`、`onPacketDrop`、`bufferedMs` getter               |

---

## 二、核心链路

```
StreamingPacketSource
  └─ push(packet)
       │
       ▼
  reorder-buffer          // 按 seq 排序，超时放行
       │
       ▼
  jitter-buffer           // 攒够 targetLatencyMs 再开始出队
       │
       ▼
  decoder (Worker)        // EncodedAudioChunk → Float32Array[]
       │
       ▼
  ring-buffer             // SharedArrayBuffer，主线程写 / Worklet 读
       │
       ▼
  AudioWorklet            // 持续渲染，输出到 AudioContext.destination
```

`isFinal=true` 的包出队后，标记本 session 完成；不关闭 player，可继续接收下一 session。

---

## 三、输入 / 输出

### 输入

```ts
// source 接口：任何能推包的东西都能接
interface StreamingPacketSource {
  subscribe(handler: (packet: StreamingPacketPayload) => void): () => void
}

// v1 内置三种 source
createMemorySource()           // 手动 push(packet)
createWebSocketSource(url)     // 自动连接，收到消息后反序列化推入
createRecorderEventSource(recorder)  // 订阅 recorder 的 plugin:stream 事件
```

`StreamingPacketPayload` 直接复用现有类型，不改字段。

### 输出

```ts
// 创建 player
const player = await createStreamingPlayer({
  source,                        // 必填
  decoders: [pcmStreamDecoder, wavStreamDecoder],  // 必填
  targetLatencyMs: 300,          // 可选，默认 300
  maxBufferMs: 3000,             // 可选，默认 3000
  backlogPolicy: "drop-old",     // 可选，默认 drop-old
  autoPlay: true,                // 可选，默认 true
  volume: 1.0,                   // 可选
  onUnderrun: ({ bufferedMs }) => {
  },
  onPacketDrop: ({ count, reason }) => {
  },
})

// 控制
player.pause()
player.resume()
player.replay(5)       // 重播最近 5 秒
player.setVolume(0.8)
player.destroy()

// 状态（响应式 getter，可直接绑 Vue 模板）
player.state            // "idle" | "buffering" | "playing" | "paused" | "stopped"
player.bufferedMs       // 当前缓冲量（毫秒）
player.droppedPackets   // 已丢弃包数
```

---

## 四、目录结构

```
src/streaming-player/
  types.ts               // 所有公共接口定义
  player.ts              // createStreamingPlayer 入口
  reorder-buffer.ts      // 按 seq 排序
  jitter-buffer.ts       // 抖动缓冲
  ring-buffer.ts         // SharedArrayBuffer 环形缓冲工具
  worklet/
    player-processor.ts  // AudioWorkletProcessor 实现
  source/
    memory-source.ts
    websocket-source.ts
    recorder-event-source.ts
  codec/
    types.ts             // StreamingDecoderDefinition
    pcm-decoder.ts       // PCM 解码（直接转 Float32）
    wav-decoder.ts       // WAV header 剥离 + PCM 转换
  store/
    memory-ring-store.ts // 最近 N 秒 packet 环形存储（用于 replay）
```

> `codec/` 只有这一个目录，decoder 运行在 Worker 内，通过 `WorkerDecoder` 包装。

---

## 五、界面交互适配

### Vue 响应式绑定

`player.state` 和 `player.bufferedMs` 是普通 getter，用 `ref` + 定时轮询（或 event 驱动）包一层即可：

```ts
// composable: useStreamingPlayer.ts
import { ref, onUnmounted } from "vue"

export function useStreamingPlayer(options) {
  const state = ref("idle")
  const bufferedMs = ref(0)
  const droppedPackets = ref(0)

  let player

  async function init() {
    player = await createStreamingPlayer({
      ...options,
      onUnderrun: (d) => {
        bufferedMs.value = d.bufferedMs
      },
      onPacketDrop: (d) => {
        droppedPackets.value += d.count
      },
    })
    // player 内部在状态变化时调用 onStateChange
    player.onStateChange = (s) => {
      state.value = s
    }
  }

  onUnmounted(() => player?.destroy())

  return {
    state, bufferedMs, droppedPackets, init,
    pause: () => player?.pause(),
    resume: () => player?.resume(),
    replay: (s) => player?.replay(s),
    setVolume: (v) => player?.setVolume(v)
  }
}
```

### 模板示例

```html

<button @click="pause" :disabled="state !== 'playing'">暂停</button>
<button @click="resume" :disabled="state !== 'paused'">继续</button>
<button @click="replay(5)">回放最近 5 秒</button>
<input type="range" min="0" max="1" step="0.01" @input="setVolume($event.target.value)" />
<span>状态：{{ state }} | 缓冲：{{ bufferedMs }}ms | 丢包：{{ droppedPackets }}</span>
```

---

## 六、v1 范围

**做：**

- PCM / WAV 解码
- memory-source、websocket-source、recorder-event-source
- AudioWorklet 播放 + ring buffer
- reorder + jitter buffer
- replay 最近 N 秒
- pause / resume / volume / destroy
- Vue composable 示例

**不做（v2+）：**

- MP3 / Opus / FLAC 等 WASM 解码
- IndexedDB / OPFS 持久化存储
- MediaStream 导出
- speed-up 时间拉伸

---

## 七、与现有代码衔接

- `StreamingPacketPayload` 不改字段，直接用
- `createStreamingExportPlugin()` 不动，通过 `createRecorderEventSource(recorder)` 桥接到 player
- `pcmStreamEncoder` / `wavStreamEncoder` 已有，decoder 是其逆操作，直接参考现有类型实现
- 子路径导出：新增 `@csnight/audio-recorder/streaming-player` 入口
