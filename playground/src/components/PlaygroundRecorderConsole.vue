<template>
  <section class="center-block">
    <div class="center-block-head">
      <div>
        <p class="section-kicker">
          {{ translate("操作台", "Action Console") }}
        </p>
        <h2>{{ translate("录音流程", "Recording Flow") }}</h2>
      </div>
      <span
        :class="[
          'state-badge',
          badgeClass,
          isPendingAction ? 'badge-accent' : '',
        ]"
        >{{ badgeText }}</span
      >
    </div>

    <div class="live-stats-row">
      <span class="live-stat">
        <b>{{ translate("帧数", "Frames") }}</b
        ><i>{{ frameCount }}</i>
      </span>
      <span class="live-stat">
        <b>{{ translate("实时流", "Realtime") }}</b
        ><i>{{ formatBytes(realtimeChunkBytes) }}</i>
      </span>
      <span class="live-stat">
        <b>ASR</b><i>{{ formatBytes(asrChunkBytes) }}</i>
      </span>
      <span class="live-stat">
        <b>FFT</b><i>{{ fftPeakPercent }}%</i>
      </span>
      <span class="live-stat">
        <b>DTMF</b><i>{{ dtmfLastKey }}</i>
      </span>
      <span class="live-stat">
        <b>{{ translate("导出", "Export") }}</b>
        <i>{{
          hasExportResult
            ? formatBytes(exportedBytes ?? 0)
            : translate("等待中", "Pending")
        }}</i>
      </span>
    </div>

    <div class="meter-row">
      <span
        >{{ translate("输入电平", "Input Level") }} {{ levelPercent }}%</span
      >
      <div class="meter-shell">
        <div :style="{ width: `${levelPercent}%` }" class="meter-fill"></div>
      </div>
    </div>

    <div class="action-bar">
      <button :disabled="!canOpen" @click="$emit('open')">
        {{ translate("打开", "Open") }}
      </button>
      <button :disabled="!canStart" @click="$emit('start')">
        {{ translate("开始", "Start") }}
      </button>
      <button :disabled="!canPause" @click="$emit('pause')">
        {{ translate("暂停", "Pause") }}
      </button>
      <button :disabled="!canResume" @click="$emit('resume')">
        {{ translate("恢复", "Resume") }}
      </button>
      <button :disabled="!canStop" @click="$emit('stop')">
        {{ translate("停止", "Stop") }}
      </button>
      <button :disabled="!canClose" @click="$emit('close')">
        {{ translate("关闭", "Close") }}
      </button>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { formatBytes } from "../playground-utils"

interface PlaygroundRecorderConsoleProps {
  localize: (zhText: string, enText: string) => string
  badgeText: string
  badgeClass: string
  isPendingAction: boolean
  frameCount: number
  realtimeChunkBytes: number
  asrChunkBytes: number
  fftPeakPercent: number
  dtmfLastKey: string
  hasExportResult: boolean
  exportedBytes: number | null
  levelPercent: number
  canOpen: boolean
  canStart: boolean
  canPause: boolean
  canResume: boolean
  canStop: boolean
  canClose: boolean
}

const props = defineProps<PlaygroundRecorderConsoleProps>()

defineEmits<{
  open: []
  start: []
  pause: []
  resume: []
  stop: []
  close: []
}>()

function translate(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}
</script>
