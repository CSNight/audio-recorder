<template>
  <div class="sp-wrap">
    <!-- ── stats strip ── -->
    <div class="sp-stats-strip">
      <span class="sp-stat">
        <b>{{ translate("状态", "State") }}</b>
        <i :class="`sp-state-${state}`">{{ getPlayerStateLabel(state) }}</i>
      </span>
      <span class="sp-stat">
        <b>{{ translate("缓冲", "Buffered") }}</b>
        <i>{{ Number(bufferedMs).toFixed(2) }} ms</i>
      </span>
      <span class="sp-stat">
        <b>{{ translate("已存储", "Stored") }}</b>
        <i>{{ storedMs }} ms</i>
      </span>
      <span class="sp-stat">
        <b>{{ translate("丢包", "Dropped") }}</b>
        <i :class="{ 'sp-danger': droppedPackets > 0 }">{{ droppedPackets }}</i>
      </span>
      <span class="sp-stat">
        <b>{{ translate("包数", "Packets") }}</b>
        <i class="sp-accent">{{ rxCount }}</i>
      </span>
      <span class="sp-stat">
        <b>{{ translate("来源", "Source") }}</b>
        <i :class="recorder ? 'sp-accent-2' : ''">
          {{
            recorder
              ? sourceName || translate("已连接", "Attached")
              : translate("未连接", "Detached")
          }}
        </i>
      </span>
    </div>

    <!-- ── Config + Playback 两栏并排 ── -->
    <div class="sp-two-col">
      <!-- Config -->
      <fieldset class="sp-fieldset">
        <legend>
          {{ translate("配置", "Config") }}
          <span :class="['sp-badge', player ? 'sp-badge-active' : '']">
            {{
              player
                ? translate("已启用", "Active")
                : translate("未创建", "Not Created")
            }}
          </span>
        </legend>

        <!-- 2列网格：label在上、input在下 -->
        <div class="sp-cfg-grid">
          <label class="sp-cfg-cell">
            <span>targetLatencyMs</span>
            <input
              v-model.number="cfg.targetLatencyMs"
              :disabled="!!player"
              max="2000"
              min="50"
              step="50"
              type="number"
            />
          </label>
          <label class="sp-cfg-cell">
            <span>maxBufferMs</span>
            <input
              v-model.number="cfg.maxBufferMs"
              :disabled="!!player"
              max="10000"
              min="500"
              step="500"
              type="number"
            />
          </label>
          <label class="sp-cfg-cell">
            <span>persistBufferMs</span>
            <input
              v-model.number="cfg.persistBufferMs"
              :disabled="!!player"
              max="60000"
              min="1000"
              step="1000"
              type="number"
            />
          </label>
          <label class="sp-cfg-cell">
            <span>persistMode</span>
            <select v-model="cfg.persistMode" :disabled="!!player">
              <option value="memory">memory</option>
              <option value="indexeddb">indexeddb</option>
            </select>
          </label>
          <!-- 音量范围独占一行 -->
          <label class="sp-cfg-cell sp-cfg-full">
            <span
              >{{ translate("初始音量", "Initial Volume") }}
              {{ (cfg.volume * 100).toFixed(0) }}%</span
            >
            <input
              v-model.number="cfg.volume"
              :disabled="!!player"
              max="1"
              min="0"
              step="0.05"
              type="range"
            />
          </label>
        </div>

        <div class="sp-action-row">
          <button
            :disabled="!!player"
            data-testid="player-create"
            @click="createPlayer"
          >
            {{ translate("创建播放器", "Create Player") }}
          </button>
          <button
            :disabled="!player"
            data-testid="player-destroy"
            @click="doDestroy"
          >
            {{ translate("销毁播放器", "Destroy Player") }}
          </button>
        </div>
      </fieldset>

      <!-- Playback + Replay + Events 竖排 -->
      <div class="sp-right-col">
        <fieldset class="sp-fieldset">
          <legend>{{ translate("播放控制", "Playback") }}</legend>
          <div class="sp-action-row">
            <button
              :disabled="!player || state !== 'idle'"
              data-testid="player-start"
              @click="doStart"
            >
              {{ translate("开始播放", "Start") }}
            </button>
            <button
              :disabled="!player || state !== 'playing'"
              data-testid="player-pause"
              @click="doPause"
            >
              {{ translate("暂停播放", "Pause") }}
            </button>
            <button
              :disabled="!player || state !== 'paused'"
              data-testid="player-resume"
              @click="doResume"
            >
              {{ translate("继续播放", "Resume") }}
            </button>
          </div>
          <label class="sp-cfg-cell sp-cfg-full sp-mt">
            <span
              >{{ translate("实时音量", "Live Volume") }}
              {{ (liveVolume * 100).toFixed(0) }}%</span
            >
            <input
              v-model.number="liveVolume"
              :disabled="!player"
              max="1"
              min="0"
              step="0.05"
              type="range"
              @input="doSetVolume"
            />
          </label>
        </fieldset>

        <fieldset class="sp-fieldset">
          <legend>
            {{ translate("回放", "Replay") }}
            <small>{{
              translate("仅暂停状态可用", "Available only while paused")
            }}</small>
          </legend>
          <div class="sp-inline-row">
            <label class="sp-cfg-cell" style="flex: 1">
              <span>{{ translate("时长（秒）", "Duration (s)") }}</span>
              <input
                v-model.number="replaySec"
                :disabled="state !== 'paused'"
                max="60"
                min="1"
                step="1"
                type="number"
              />
            </label>
            <button
              :disabled="state !== 'paused'"
              data-testid="player-replay"
              @click="doReplay"
            >
              {{ translate(`回放 ${replaySec}s`, `Replay ${replaySec}s`) }}
            </button>
          </div>
        </fieldset>

        <fieldset class="sp-fieldset">
          <legend>{{ translate("事件", "Events") }}</legend>
          <p class="sp-note">
            {{
              translate(
                "动态赋值 onStateChange",
                "Dynamically assign onStateChange"
              )
            }}
          </p>
          <div class="sp-action-row">
            <button
              :disabled="!player"
              data-testid="player-bind-state"
              @click="bindStateChange"
            >
              {{ translate("绑定回调", "Bind Callback") }}
            </button>
            <button
              :disabled="!player"
              data-testid="player-unbind-state"
              @click="unbindStateChange"
            >
              {{ translate("清空回调", "Unbind Callback") }}
            </button>
          </div>
        </fieldset>
      </div>
    </div>

    <!-- ── Log ── -->
    <div class="sp-log-wrap">
      <div class="sp-log-head">
        <span class="section-kicker">{{ translate("日志", "Log") }}</span>
        <button class="ghost-button" @click="logs = []">
          {{ translate("清空", "Clear") }}
        </button>
      </div>
      <ul class="sp-log-list">
        <li
          v-for="(entry, index) in logs"
          :key="index"
          :class="['sp-log-item', index === 0 ? 'sp-log-latest' : '']"
        >
          {{ entry }}
        </li>
        <li v-if="logs.length === 0" class="sp-log-empty">
          {{ translate("暂无日志", "No logs yet") }}
        </li>
      </ul>
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

const PLAYGROUND_LOCALE = {
  zh: "zh-CN",
  en: "en-US",
} as const

type SupportedLocale =
  (typeof PLAYGROUND_LOCALE)[keyof typeof PLAYGROUND_LOCALE]
type StreamingPacket = Parameters<StreamingPlayerHandle["push"]>[0]

interface RecorderStreamEvent {
  payload?: StreamingPacket
}

interface RecorderLike {
  on(
    event: "plugin:stream",
    handler: (event: RecorderStreamEvent) => void
  ): () => void
}

const props = withDefaults(
  defineProps<{
    recorder?: RecorderLike | null
    locale?: SupportedLocale
    sourceName?: string
  }>(),
  {
    recorder: null,
    locale: "zh-CN",
    sourceName: "",
  }
)

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

function translate(zhText: string, enText: string) {
  return props.locale === PLAYGROUND_LOCALE.en ? enText : zhText
}

function getPlayerStateLabel(value: StreamingPlayerState) {
  switch (value) {
    case "idle":
      return translate("空闲", "Idle")
    case "playing":
      return translate("播放中", "Playing")
    case "paused":
      return translate("已暂停", "Paused")
    case "stopped":
      return translate("已停止", "Stopped")
    default:
      return value
  }
}

function getPersistModeLabel(value: "memory" | "indexeddb") {
  return value === "memory" ? translate("内存", "Memory") : "IndexedDB"
}

function log(message: string) {
  logs.value.unshift(
    `[${new Date().toLocaleTimeString(props.locale, { hour12: false })}] ${message}`
  )
  if (logs.value.length > 200) logs.value.length = 200
}

function syncPlayerSnapshot() {
  if (!player.value) return
  state.value = player.value.state
  bufferedMs.value = player.value.bufferedMs
  droppedPackets.value = player.value.droppedPackets
  storedMs.value = player.value.storedMs
}

function subscribeRecorder(recorderInstance: any) {
  if (streamUnsub) {
    streamUnsub()
    streamUnsub = null
  }
  if (!recorderInstance) return
  streamUnsub = recorderInstance.on("plugin:stream", (event) => {
    const packet = event?.payload
    if (!packet || !player.value) return
    rxCount.value += 1
    player.value.push(packet)
  })
  log(
    translate(
      `已订阅 ${props.sourceName || "plugin:stream"}。`,
      `Subscribed to ${props.sourceName || "plugin:stream"}.`
    )
  )
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
        log(
          translate(
            `状态回调 -> ${getPlayerStateLabel(nextState)}`,
            `onStateChange -> ${getPlayerStateLabel(nextState)}`
          )
        )
      },
      onUnderrun: (detail) =>
        log(
          translate(
            `欠载 bufferedMs=${detail.bufferedMs}`,
            `Underrun bufferedMs=${detail.bufferedMs}`
          )
        ),
      onPacketDrop: (detail) =>
        log(
          translate(
            `丢包 ${detail.count} ${detail.reason}`,
            `Packet drop ${detail.count} ${detail.reason}`
          )
        ),
    })
    player.value = instance
    liveVolume.value = cfg.value.volume
    state.value = instance.state
    statusTimer = setInterval(() => {
      if (!player.value) return
      syncPlayerSnapshot()
    }, 200)
    log(
      translate(
        `播放器已创建，模式=${getPersistModeLabel(cfg.value.persistMode)}。`,
        `Player created with mode=${getPersistModeLabel(cfg.value.persistMode)}.`
      )
    )
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(
      translate(
        `createStreamingPlayer 失败：${errorMessage}`,
        `createStreamingPlayer failed: ${errorMessage}`
      )
    )
  }
}

async function doStart() {
  if (!player.value) return
  try {
    await player.value.start()
    syncPlayerSnapshot()
    log(translate("已开始播放。", "Playback started."))
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(
      translate(
        `开始播放失败：${errorMessage}`,
        `Start failed: ${errorMessage}`
      )
    )
  }
}

function doPause() {
  player.value?.pause()
  syncPlayerSnapshot()
  log(translate("已暂停播放。", "Playback paused."))
}

function doResume() {
  player.value?.resume()
  syncPlayerSnapshot()
  log(translate("已恢复播放。", "Playback resumed."))
}

function doSetVolume() {
  player.value?.setVolume(liveVolume.value)
}

function doReplay() {
  if (!player.value) return
  player.value.replay(replaySec.value)
  log(
    translate(`执行回放 ${replaySec.value}s。`, `Replay ${replaySec.value}s.`)
  )
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
  log(translate("播放器已销毁。", "Player destroyed."))
}

function bindStateChange() {
  if (!player.value) return
  player.value.onStateChange = (nextState) => {
    state.value = nextState
    log(
      translate(
        `动态状态回调 -> ${getPlayerStateLabel(nextState)}`,
        `Dynamic onStateChange -> ${getPlayerStateLabel(nextState)}`
      )
    )
  }
  log(translate("onStateChange 已重新绑定。", "onStateChange rebound."))
}

function unbindStateChange() {
  if (!player.value) return
  player.value.onStateChange = null
  log(translate("onStateChange 已清空。", "onStateChange cleared."))
}

onUnmounted(() => {
  if (streamUnsub) streamUnsub()
  if (statusTimer) clearInterval(statusTimer)
  player.value?.destroy()
})
</script>

<style scoped>
.sp-wrap {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.015);
  overflow: hidden;
}

.sp-stats-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
  background: rgba(8, 17, 22, 0.72);
}

.sp-stat {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 14px;
  border-right: 1px solid var(--line);
  min-width: 0;
}

.sp-stat:last-child {
  border-right: none;
}

.sp-stat b {
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.sp-stat i {
  font-style: normal;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.2;
}

.sp-accent {
  color: var(--accent) !important;
}
.sp-accent-2 {
  color: var(--accent-2) !important;
}
.sp-danger {
  color: var(--danger) !important;
}

.sp-fieldset {
  border: 0;
  border-top: 1px solid rgba(73, 103, 119, 0.2);
  margin: 0;
  padding: 16px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sp-fieldset legend {
  width: 100%;
  padding: 0 0 8px;
  float: none;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #d1e7f2;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sp-fieldset legend small {
  font-size: 0.6rem;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
  opacity: 0.7;
}

.sp-badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sp-two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 0;
  border-bottom: 1px solid var(--line);
}

.sp-two-col > .sp-fieldset {
  border-top: 0;
  border-right: 1px solid var(--line);
}

.sp-right-col {
  display: flex;
  flex-direction: column;
}

.sp-right-col .sp-fieldset {
  border-right: none;
}

.sp-cfg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.sp-cfg-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.74rem;
}

.sp-cfg-cell span {
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-cfg-cell input[type="number"],
.sp-cfg-cell select {
  width: 100%;
}

.sp-cfg-cell input[type="range"] {
  width: 100%;
}

.sp-cfg-full {
  grid-column: 1 / -1;
}

.sp-mt {
  margin-top: 4px;
}

/* ── action row ───────────────────────────────────────── */
.sp-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sp-action-row button {
  flex: 1;
  min-width: 0;
}

.sp-inline-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.sp-note {
  font-size: 0.72rem;
  color: var(--muted);
  margin: 0;
  line-height: 1.55;
}

.sp-log-wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.sp-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
}

.sp-log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  max-height: 200px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.72rem;
  line-height: 1.6;
}

.sp-log-item {
  padding: 10px 16px;
  border-top: 1px solid rgba(73, 103, 119, 0.18);
  color: var(--ink);
  word-break: break-all;
}

.sp-log-item:first-child {
  border-top: 0;
}

.sp-log-empty {
  padding: 12px 16px;
  color: var(--muted);
  font-style: italic;
}

@media (max-width: 900px) {
  .sp-stats-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .sp-two-col {
    grid-template-columns: 1fr;
  }

  .sp-two-col > .sp-fieldset {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}

@media (max-width: 640px) {
  .sp-stats-strip,
  .sp-cfg-grid {
    grid-template-columns: 1fr;
  }

  .sp-inline-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
