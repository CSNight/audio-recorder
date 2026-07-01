<script setup>
import { computed, onBeforeUnmount, ref } from "vue"
import { createStreamingPlayer } from "@csnight/audio-recorder/plugins/streaming-player"
import {
  pcmDecoderDefinition,
  wavDecoderDefinition,
} from "@csnight/audio-recorder/codecs/base"

const props = defineProps({
  recorder: {
    type: Object,
    default: null,
  },
})

const playerState = ref("idle")
const bufferedMs = ref(0)
const droppedPackets = ref(0)
const underrunCount = ref(0)
const volume = ref(1.0)
const targetLatencyMs = ref(300)
const logs = ref([])

let playerHandle = null
let streamUnsubscribe = null
let statsTimer = null

function appendLog(type, message) {
  logs.value = [
    {
      type,
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      message,
    },
    ...logs.value,
  ].slice(0, 40)
}

const replaySeconds = ref(5)

const canStart = computed(
  () => playerState.value === "idle" && props.recorder !== null
)
const canStop = computed(() =>
  ["buffering", "playing", "paused"].includes(playerState.value)
)
const canPause = computed(() => playerState.value === "playing")
const canResume = computed(() => playerState.value === "paused")
const canReplay = computed(() =>
  ["buffering", "playing", "paused"].includes(playerState.value)
)

async function startPlayer() {
  const recorder = props.recorder?.value ?? props.recorder
  if (!recorder) {
    appendLog("error", "Recorder 未就绪，请先打开录音器。")
    return
  }

  try {
    playerHandle = await createStreamingPlayer({
      decoders: [wavDecoderDefinition, pcmDecoderDefinition],
      targetLatencyMs: targetLatencyMs.value,
      maxBufferMs: 3000,
      backlogPolicy: "drop-old",
      volume: volume.value,
      onStateChange(state) {
        playerState.value = state
        appendLog("info", `播放状态: ${state}`)
      },
      onUnderrun({ bufferedMs: ms }) {
        underrunCount.value++
        appendLog("warn", `欠载 (buffered=${ms}ms)`)
      },
      onPacketDrop({ count, reason }) {
        droppedPackets.value += count
        appendLog("warn", `丢包 count=${count} reason=${reason}`)
      },
    })

    await playerHandle.start()

    // 订阅 recorder 的流式 packet 事件，推送给 player
    // recorder.on("plugin:stream") 回调收到的是 RecorderPluginEventContext，
    // 真实的 StreamingPacketPayload 在 event.payload 中
    streamUnsubscribe = recorder.on("plugin:stream", (event) => {
      playerHandle?.push(event.payload)
    })

    appendLog("info", "播放器已启动，等待数据...")

    statsTimer = setInterval(() => {
      if (playerHandle) {
        bufferedMs.value = playerHandle.bufferedMs
        droppedPackets.value = playerHandle.droppedPackets
      }
    }, 200)
  } catch (err) {
    appendLog("error", `启动播放器失败: ${err?.message ?? err}`)
  }
}

function pausePlayer() {
  playerHandle?.pause()
}

function resumePlayer() {
  playerHandle?.resume()
}

function stopPlayer() {
  if (streamUnsubscribe) {
    streamUnsubscribe()
    streamUnsubscribe = null
  }
  if (statsTimer) {
    clearInterval(statsTimer)
    statsTimer = null
  }
  if (playerHandle) {
    playerHandle.destroy()
    playerHandle = null
  }
  playerState.value = "idle"
  bufferedMs.value = 0
  droppedPackets.value = 0
  underrunCount.value = 0
  appendLog("info", "播放器已停止")
}

function setVolume() {
  playerHandle?.setVolume(volume.value)
}

onBeforeUnmount(() => {
  stopPlayer()
})
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <p class="panel-kicker">Streaming Player</p>
        <h2>实时流式播放演示</h2>
      </div>
    </div>
    <div class="panel-body">
      <!-- 状态 -->
      <div class="sp-status">
        状态：<strong>{{ playerState }}</strong> &nbsp;|&nbsp; 缓冲：<strong
          >{{ bufferedMs }} ms</strong
        >
        &nbsp;|&nbsp; 丢包：<strong>{{ droppedPackets }}</strong> &nbsp;|&nbsp;
        欠载：<strong>{{ underrunCount }}</strong>
      </div>

      <!-- 控制 -->
      <div class="sp-controls">
        <button :disabled="!canStart" @click="startPlayer">启动播放器</button>
        <button :disabled="!canPause" @click="pausePlayer">暂停</button>
        <button :disabled="!canResume" @click="resumePlayer">恢复</button>
        <button :disabled="!canStop" @click="stopPlayer">停止</button>
      </div>

      <!-- 参数 -->
      <div class="sp-params">
        <label>
          目标延迟 (ms)：
          <input
            v-model.number="targetLatencyMs"
            :disabled="!canStart"
            max="2000"
            min="50"
            step="50"
            type="number"
          />
        </label>
        <label>
          音量：
          <input
            v-model.number="volume"
            max="1"
            min="0"
            step="0.05"
            type="range"
            @input="setVolume"
          />
          {{ Math.round(volume * 100) }}%
        </label>
      </div>

      <!-- 用法提示 -->
      <p class="sp-hint">
        先开启录音（选择含 streaming-export
        插件的配置），再点击"启动播放器"。<br />
        播放器订阅 <code>plugin:stream</code> 事件，收到 packet
        后解码并实时播放。
      </p>

      <!-- 日志 -->
      <ul class="sp-log">
        <li
          v-for="(item, i) in logs"
          :key="i"
          :class="`sp-log-item sp-log-${item.type}`"
        >
          <span class="sp-log-time">{{ item.time }}</span>
          <span class="sp-log-msg">{{ item.message }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.sp-status {
  margin-bottom: 12px;
  font-size: 14px;
}
.sp-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.sp-controls button {
  padding: 6px 14px;
  cursor: pointer;
}
.sp-controls button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sp-params {
  display: flex;
  gap: 24px;
  margin-bottom: 12px;
  font-size: 14px;
  align-items: center;
  flex-wrap: wrap;
}
.sp-params label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sp-params input[type="number"] {
  width: 80px;
}
.sp-hint {
  font-size: 13px;
  color: #666;
  margin-bottom: 12px;
  line-height: 1.6;
}
.sp-log {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 180px;
  overflow-y: auto;
  font-size: 12px;
  font-family: monospace;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #fafafa;
}
.sp-log-item {
  display: flex;
  gap: 8px;
  padding: 2px 8px;
  border-bottom: 1px solid #f0f0f0;
}
.sp-log-time {
  color: #999;
  flex-shrink: 0;
}
.sp-log-info .sp-log-msg {
  color: #333;
}
.sp-log-warn .sp-log-msg {
  color: #b45309;
}
.sp-log-error .sp-log-msg {
  color: #dc2626;
}
</style>
