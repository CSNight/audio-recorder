<template>
  <div class="sp-wrap">
    <div class="sp-statusbar">
      <div class="sp-stat">
        <span>State</span>
        <strong :class="`sp-state-${state}`">{{ state }}</strong>
      </div>
      <div class="sp-stat">
        <span>Buffered</span>
        <strong>{{ bufferedMs }} ms</strong>
      </div>
      <div class="sp-stat">
        <span>Stored</span>
        <strong>{{ storedMs }} ms</strong>
      </div>
      <div class="sp-stat">
        <span>Dropped</span>
        <strong :class="{ 'sp-danger': droppedPackets > 0 }">
          {{ droppedPackets }}
        </strong>
      </div>
      <div class="sp-stat">
        <span>Packets</span>
        <strong class="sp-accent">{{ rxCount }}</strong>
      </div>
      <div class="sp-stat">
        <span>Source</span>
        <strong :class="recorder ? 'sp-accent-2' : ''">
          {{ recorder ? "recorder attached" : "not bound" }}
        </strong>
      </div>
    </div>

    <div class="sp-layout">
      <div class="sp-main-grid">
        <section class="panel sp-panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">Config</p>
              <h3 class="sp-section-title">创建配置</h3>
            </div>
            <span :class="player ? 'badge-accent' : ''" class="badge">
              {{ player ? "Active" : "Not Created" }}
            </span>
          </div>

          <div class="form-grid">
            <div class="field">
              <span>targetLatencyMs</span>
              <input
                v-model.number="cfg.targetLatencyMs"
                :disabled="!!player"
                max="2000"
                min="50"
                step="50"
                type="number"
              />
            </div>
            <div class="field">
              <span>maxBufferMs</span>
              <input
                v-model.number="cfg.maxBufferMs"
                :disabled="!!player"
                max="10000"
                min="500"
                step="500"
                type="number"
              />
            </div>
            <div class="field">
              <span>persistBufferMs</span>
              <input
                v-model.number="cfg.persistBufferMs"
                :disabled="!!player"
                max="60000"
                min="1000"
                step="1000"
                type="number"
              />
            </div>
            <div class="field">
              <span>persistMode</span>
              <select v-model="cfg.persistMode" :disabled="!!player">
                <option value="memory">memory</option>
                <option value="indexeddb">indexeddb</option>
              </select>
            </div>
            <div class="field field-span">
              <span>初始音量 {{ (cfg.volume * 100).toFixed(0) }}%</span>
              <input
                v-model.number="cfg.volume"
                :disabled="!!player"
                max="1"
                min="0"
                step="0.05"
                type="range"
              />
            </div>
          </div>

          <div class="sp-btn-row sp-actions">
            <button
              :disabled="!!player"
              class="sp-btn-primary"
              @click="createPlayer"
            >
              createPlayer()
            </button>
            <button
              :disabled="!player"
              class="secondary-button"
              @click="doDestroy"
            >
              destroy()
            </button>
          </div>
        </section>

        <section class="panel sp-panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">Playback</p>
              <h3 class="sp-section-title">播放控制</h3>
            </div>
          </div>

          <div class="sp-btn-row">
            <button
              :disabled="!player || state !== 'idle'"
              class="sp-btn-primary"
              @click="doStart"
            >
              start()
            </button>
            <button
              :disabled="!player || state !== 'playing'"
              class="secondary-button"
              @click="doPause"
            >
              pause()
            </button>
            <button
              :disabled="!player || state !== 'paused'"
              class="secondary-button"
              @click="doResume"
            >
              resume()
            </button>
          </div>

          <div class="field sp-volume-field">
            <span>实时音量 {{ (liveVolume * 100).toFixed(0) }}%</span>
            <input
              v-model.number="liveVolume"
              :disabled="!player"
              max="1"
              min="0"
              step="0.05"
              type="range"
              @input="doSetVolume"
            />
          </div>
        </section>

        <section class="panel sp-panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">Replay</p>
              <h3 class="sp-section-title">重播历史音频</h3>
            </div>
            <span class="badge">Paused Only</span>
          </div>

          <div class="inline-field sp-inline-actions">
            <div class="field">
              <span>重播时长（秒）</span>
              <input
                v-model.number="replaySec"
                :disabled="state !== 'paused'"
                max="60"
                min="1"
                step="1"
                type="number"
              />
            </div>
            <button
              :disabled="state !== 'paused'"
              class="sp-btn-primary"
              @click="doReplay"
            >
              replay({{ replaySec }}s)
            </button>
          </div>
        </section>

        <section class="panel sp-panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">Events</p>
              <h3 class="sp-section-title">动态事件绑定</h3>
            </div>
          </div>

          <p class="panel-note sp-panel-note">
            测试创建后动态赋值 <code>onStateChange</code>
          </p>

          <div class="sp-btn-row">
            <button
              :disabled="!player"
              class="secondary-button"
              @click="bindStateChange"
            >
              bind callback
            </button>
            <button
              :disabled="!player"
              class="secondary-button"
              @click="unbindStateChange"
            >
              unbind null
            </button>
          </div>
        </section>
      </div>

      <section class="panel sp-log-panel">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">Log</p>
            <h3 class="sp-section-title">事件日志</h3>
          </div>
          <button class="secondary-button sp-clear-button" @click="logs = []">
            清空
          </button>
        </div>

        <ul class="log-list sp-log-list">
          <li v-for="(entry, index) in logs" :key="index" class="sp-log-item">
            {{ entry }}
          </li>
          <li v-if="logs.length === 0" class="sp-log-empty">暂无日志</li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onUnmounted, ref, watch } from "vue"
import type {
  StreamingPlayerHandle,
  StreamingPlayerState,
} from "@csnight/audio-recorder/plugins/streaming-player"
import { createStreamingPlayer } from "@csnight/audio-recorder/plugins/streaming-player"
import {
  pcmDecoderDefinition,
  wavDecoderDefinition,
} from "@csnight/audio-recorder/codecs/base"

const props = defineProps<{
  recorder?: any | null
}>()

const cfg = ref({
  targetLatencyMs: 300,
  maxBufferMs: 3000,
  volume: 1.0,
  persistMode: "memory" as "memory" | "indexeddb",
  persistBufferMs: 10000,
})

const player = ref<StreamingPlayerHandle | null>(null)
const state = ref<StreamingPlayerState>("idle")
const bufferedMs = ref(0)
const droppedPackets = ref(0)
const storedMs = ref(0)
const rxCount = ref(0)
const replaySec = ref(5)
const liveVolume = ref(1.0)
const logs = ref<string[]>([])

let statusTimer: ReturnType<typeof setInterval> | null = null
let streamUnsub: (() => void) | null = null

function log(message: string) {
  logs.value.unshift(`[${new Date().toLocaleTimeString()}] ${message}`)
  if (logs.value.length > 200) logs.value.length = 200
}

function subscribeRecorder(recorderInstance: any) {
  if (streamUnsub) {
    streamUnsub()
    streamUnsub = null
  }

  if (!recorderInstance) return

  streamUnsub = recorderInstance.on("plugin:stream", (event: any) => {
    const packet = event?.payload
    if (!packet || !player.value) return
    rxCount.value += 1
    player.value.push(packet)
  })
  log("subscribed recorder plugin:stream")
}

watch(
  () => props.recorder,
  (recorderInstance) => {
    subscribeRecorder(recorderInstance)
  },
  { immediate: true }
)

async function createPlayer() {
  if (player.value) return

  try {
    const instance = await createStreamingPlayer({
      decoders: [pcmDecoderDefinition, wavDecoderDefinition],
      targetLatencyMs: cfg.value.targetLatencyMs,
      maxBufferMs: cfg.value.maxBufferMs,
      volume: cfg.value.volume,
      persistMode: cfg.value.persistMode,
      persistBufferMs: cfg.value.persistBufferMs,
      onStateChange: (nextState) => {
        state.value = nextState
        log(`onStateChange -> ${nextState}`)
      },
      onUnderrun: (detail) => log(`underrun bufferedMs=${detail.bufferedMs}`),
      onPacketDrop: (detail) =>
        log(`packetDrop ${detail.count} ${detail.reason}`),
    })

    player.value = instance
    liveVolume.value = cfg.value.volume
    state.value = instance.state

    statusTimer = setInterval(() => {
      if (!player.value) return
      bufferedMs.value = player.value.bufferedMs
      droppedPackets.value = player.value.droppedPackets
      storedMs.value = player.value.storedMs
    }, 200)

    log(`player created mode=${cfg.value.persistMode}`)
  } catch (error: any) {
    log(`createStreamingPlayer failed: ${error?.message ?? error}`)
  }
}

async function doStart() {
  if (!player.value) return

  try {
    await player.value.start()
    log("start()")
  } catch (error: any) {
    log(`start() failed: ${error?.message ?? error}`)
  }
}

function doPause() {
  player.value?.pause()
  log("pause()")
}

function doResume() {
  player.value?.resume()
  log("resume()")
}

function doSetVolume() {
  player.value?.setVolume(liveVolume.value)
}

function doReplay() {
  if (!player.value) return
  player.value.replay(replaySec.value)
  log(`replay(${replaySec.value}s)`)
}

function doDestroy() {
  if (!player.value) return

  player.value.destroy()
  player.value = null
  state.value = "idle"
  bufferedMs.value = 0
  droppedPackets.value = 0
  storedMs.value = 0
  rxCount.value = 0

  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }

  log("destroy()")
}

function bindStateChange() {
  if (!player.value) return

  player.value.onStateChange = (nextState) => {
    state.value = nextState
    log(`dynamic onStateChange -> ${nextState}`)
  }

  log("onStateChange rebound")
}

function unbindStateChange() {
  if (!player.value) return

  player.value.onStateChange = null
  log("onStateChange cleared")
}

onUnmounted(() => {
  if (streamUnsub) streamUnsub()
  if (statusTimer) clearInterval(statusTimer)
  player.value?.destroy()
})
</script>

<style scoped>
.sp-wrap {
  display: grid;
  gap: 12px;
  min-height: 0;
}

.sp-statusbar {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.028);
  overflow: hidden;
}

.sp-stat {
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
}

.sp-stat:last-child {
  border-right: 0;
}

.sp-stat span {
  display: block;
  color: var(--muted);
  font-family: "Fira Code", "Cascadia Code", Consolas, monospace;
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.sp-stat strong {
  overflow-wrap: anywhere;
  font-family: "Fira Code", "Cascadia Code", Consolas, monospace;
  font-size: 0.94rem;
}

.sp-accent {
  color: var(--accent);
}

.sp-accent-2 {
  color: var(--accent-2);
}

.sp-danger {
  color: var(--danger);
}

.sp-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 12px;
  align-items: start;
  min-height: 0;
}

.sp-main-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-height: 0;
}

.sp-panel,
.sp-log-panel {
  min-width: 0;
  min-height: 0;
}

.sp-section-title {
  margin: 4px 0 0;
  font-size: 0.98rem;
  letter-spacing: -0.02em;
}

.sp-panel-note {
  margin-bottom: 10px;
  font-size: 0.82rem;
}

.sp-btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sp-actions,
.sp-volume-field {
  margin-top: 12px;
}

.sp-inline-actions {
  align-items: end;
  gap: 10px;
}

.sp-inline-actions .field {
  flex: 1;
}

.sp-btn-primary {
  border-color: rgba(53, 240, 159, 0.38) !important;
  background: #163328 !important;
  color: #dff8ee !important;
}

.sp-btn-primary:hover:not(:disabled) {
  border-color: rgba(53, 240, 159, 0.6) !important;
  background: #1d3e31 !important;
}

.sp-btn-primary:disabled {
  border-color: rgba(222, 232, 244, 0.08) !important;
  background: #202633 !important;
  color: #718094 !important;
}

.sp-log-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: stretch;
  block-size: clamp(320px, 44vh, 520px);
  overflow: hidden;
}

.sp-clear-button {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 0.75rem;
}

.sp-log-list {
  block-size: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  margin: 0;
  padding: 10px;
  list-style: none;
  border: 1px solid rgba(73, 182, 255, 0.14);
  border-radius: 12px;
  background: #080c12;
  font-family: "Fira Code", "Cascadia Code", Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.7;
}

.sp-log-item {
  padding: 3px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.07);
  color: var(--ink);
  word-break: break-all;
}

.sp-log-item:first-child {
  color: var(--accent);
}

.sp-log-item:last-child {
  border-bottom: 0;
}

.sp-log-empty {
  color: var(--muted);
  font-size: 0.82rem;
  font-style: italic;
}

@media (max-width: 1180px) {
  .sp-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .sp-statusbar,
  .sp-main-grid {
    grid-template-columns: 1fr;
  }

  .sp-stat {
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }

  .sp-stat:last-child {
    border-bottom: 0;
  }

  .sp-inline-actions {
    display: grid;
  }

  .sp-log-panel {
    block-size: 320px;
  }
}
</style>
