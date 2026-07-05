<template>
  <section class="center-block">
    <div class="center-block-head">
      <div>
        <p class="section-kicker">
          {{ translate("导出阶段", "Output Stage") }}
        </p>
        <h2>{{ translate("导出与下载", "Export & Download") }}</h2>
      </div>
      <span class="badge">
        {{
          hasExportResult
            ? formatBytes(exportedBytes ?? 0)
            : translate("等待导出", "Waiting")
        }}
      </span>
    </div>

    <div class="export-options-row">
      <label class="field field-inline">
        <span>sampleRate</span>
        <select v-model="exportSampleRateInputModel">
          <option value="">{{ translate("不指定", "Unset") }}</option>
          <option
            v-for="sampleRate in standardExportSampleRates"
            :key="sampleRate"
            :value="String(sampleRate)"
          >
            {{ sampleRate }} Hz
          </option>
        </select>
      </label>
    </div>
    <p class="field-note">{{ exportHint }}</p>

    <div class="export-btn-row">
      <button
        v-for="action in exportActions"
        :key="action.type"
        :disabled="action.disabled"
        @click="$emit('export-audio', action.type)"
      >
        {{ action.label }}
      </button>
    </div>

    <div class="subsection-divider">
      <span>{{
        translate(
          "Sonic Snapshot — 变速变调离线导出",
          "Sonic Snapshot — Offline speed and pitch export"
        )
      }}</span>
      <span class="badge">{{ streamPluginModeLabel }}</span>
    </div>
    <p class="field-note">
      {{
        translate(
          "始终基于 stopped 后的 PCM snapshot 做 Sonic 处理，再导出为 PCM/WAV，与实时流插件是否为 Sonic 无关。",
          "Sonic export always starts from the stopped PCM snapshot and then exports PCM/WAV, independent of the live stream plugin mode."
        )
      }}
    </p>
    <div class="export-btn-row export-btn-row-sm">
      <button
        :disabled="!canExportAudio"
        @click="$emit('export-sonic-snapshot', 'pcm')"
      >
        Sonic PCM
      </button>
      <button
        :disabled="!canExportAudio"
        @click="$emit('export-sonic-snapshot', 'wav')"
      >
        Sonic WAV
      </button>
    </div>

    <template v-if="resultRows.length">
      <div class="result-list">
        <div v-for="item in resultRows" :key="item.label" class="result-row">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
    </template>
    <p v-else class="field-note muted-block">
      {{
        translate(
          "停止录音后点击任一编码按钮，触发对应格式导出并下载。",
          "Stop the recorder, then click any encoder button to export and download that format."
        )
      }}
    </p>
  </section>
</template>

<script lang="ts" setup>
import { computed } from "vue"
import { formatBytes } from "../playground-utils"
import type {
  PlaygroundExportActionButton,
  PlaygroundResultRow,
} from "./playground-panel-types"

interface PlaygroundExportPanelProps {
  localize: (zhText: string, enText: string) => string
  exportSampleRateInput: string
  standardExportSampleRates: number[]
  exportHint: string
  exportActions: PlaygroundExportActionButton[]
  streamPluginModeLabel: string
  canExportAudio: boolean
  hasExportResult: boolean
  exportedBytes: number | null
  resultRows: PlaygroundResultRow[]
}

const props = defineProps<PlaygroundExportPanelProps>()

const emit = defineEmits<{
  "update:export-sample-rate-input": [value: string]
  "export-audio": [format: string]
  "export-sonic-snapshot": [format: "pcm" | "wav"]
}>()

const exportSampleRateInputModel = computed({
  get: () => props.exportSampleRateInput,
  set: (value: string) => emit("update:export-sample-rate-input", value),
})

function translate(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}
</script>
