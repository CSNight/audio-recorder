<template>
  <section class="center-block">
    <div class="center-block-head">
      <div>
        <p class="section-kicker">NMN2PCM</p>
        <h2>{{ translate("简谱生成器", "Numbered Music Notation") }}</h2>
      </div>
      <span class="badge">{{ exportFormat.toUpperCase() }}</span>
    </div>

    <div class="nmn-grid">
      <label class="field nmn-score-field">
        <span>{{ translate("简谱文本", "Score Text") }}</span>
        <textarea
          v-model.trim="scoreModel"
          rows="7"
          spellcheck="false"
        ></textarea>
      </label>

      <div class="nmn-controls">
        <label class="field">
          <span>sampleRate</span>
          <select v-model.number="sampleRateModel">
            <option
              v-for="sampleRateValue in standardExportSampleRates"
              :key="`nmn-${sampleRateValue}`"
              :value="sampleRateValue"
            >
              {{ sampleRateValue }} Hz
            </option>
          </select>
        </label>
        <label class="field">
          <span>bpm</span>
          <input
            v-model.number="bpmModel"
            max="220"
            min="30"
            step="1"
            type="number"
          />
        </label>
        <label class="field">
          <span>volume</span>
          <input
            v-model.number="volumeModel"
            max="1"
            min="0.1"
            step="0.05"
            type="number"
          />
        </label>
        <label class="field">
          <span>key</span>
          <select v-model="keyModel">
            <option
              v-for="keyOption in keyOptions"
              :key="`nmn-key-${keyOption}`"
              :value="keyOption"
            >
              {{ keyOption }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>transpose</span>
          <input
            v-model.number="transposeModel"
            max="24"
            min="-24"
            step="1"
            type="number"
          />
        </label>
        <label class="field">
          <span>{{ translate("导出格式", "Export Format") }}</span>
          <select v-model="exportFormatModel">
            <option
              v-for="action in exportFormatActions"
              :key="`nmn-format-${action.type}`"
              :disabled="!isExportFormatSupported(action.type)"
              :value="action.type"
            >
              {{ action.label }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <p class="field-note muted-block">{{ exportHint }}</p>

    <div class="export-btn-row export-btn-row-sm">
      <button @click="$emit('generate-preview')">
        {{ translate("生成预览", "Generate Preview") }}
      </button>
      <button
        :disabled="!isExportFormatSupported(exportFormat)"
        @click="$emit('export-audio')"
      >
        {{ translate("生成并下载", "Generate & Download") }}
      </button>
    </div>

    <div class="nmn-grid">
      <article class="analysis-card nmn-preview-card">
        <div class="analysis-card-head">
          <span>{{ translate("本地预览", "Local Preview") }}</span>
          <strong>{{
            hasPreview
              ? `${Math.round(previewDurationMs)} ms`
              : translate("未生成", "Idle")
          }}</strong>
        </div>
        <audio
          v-if="hasPreview"
          :src="previewUrl"
          class="nmn-preview-audio"
          controls
          preload="metadata"
        ></audio>
        <p v-else class="field-note">
          {{
            translate(
              "点击“生成预览”后，这里会提供可直接试听的 WAV 预览。",
              'Click "Generate Preview" to render a WAV preview for direct playback here.'
            )
          }}
        </p>
        <p v-if="isPreviewStale" class="field-note">
          {{
            translate(
              "当前参数已变化，试听内容还是上一次生成结果；重新生成后才会刷新。",
              "The score or parameters changed. This preview still reflects the previous render until you generate again."
            )
          }}
        </p>
      </article>

      <article class="analysis-card nmn-preview-card">
        <div class="analysis-card-head">
          <span>{{ translate("预览信息", "Preview Info") }}</span>
          <strong>{{
            hasPreview
              ? translate("已就绪", "Ready")
              : translate("待生成", "Pending")
          }}</strong>
        </div>
        <p class="field-note">
          {{
            translate(
              "NMN 预览只用于本地试听，不接入录音输入，也不会推送到实时播放器链路。",
              "The NMN preview is only for local playback. It never enters recorder input or the realtime streaming-player chain."
            )
          }}
        </p>
        <div v-if="previewRows.length" class="result-list nmn-preview-rows">
          <div v-for="item in previewRows" :key="item.label" class="result-row">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </article>
    </div>

    <div v-if="resultRows.length" class="result-list">
      <div v-for="item in resultRows" :key="item.label" class="result-row">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed } from "vue"
import {
  NMN_KEY_OFFSETS,
  type NmnConvertOptions,
} from "@media-studio/audio-recorder/plugins/nmn2pcm"
import type {
  PlaygroundExportAction,
  PlaygroundResultRow,
} from "./playground-panel-types"

type PlaygroundNmnOptions = Required<
  Pick<NmnConvertOptions, "sampleRate" | "bpm" | "volume" | "key" | "transpose">
>

interface PlaygroundNmnPanelProps {
  localize: (zhText: string, enText: string) => string
  standardExportSampleRates: number[]
  exportFormatActions: PlaygroundExportAction[]
  score: string
  options: PlaygroundNmnOptions
  exportFormat: string
  exportHint: string
  hasPreview: boolean
  previewDurationMs: number
  previewUrl: string
  isPreviewStale: boolean
  previewRows: PlaygroundResultRow[]
  resultRows: PlaygroundResultRow[]
  isExportFormatSupported: (format: string) => boolean
}

const props = defineProps<PlaygroundNmnPanelProps>()

const emit = defineEmits<{
  "update:score": [value: string]
  "update:options": [value: PlaygroundNmnOptions]
  "update:exportFormat": [value: string]
  "generate-preview": []
  "export-audio": []
}>()

const scoreModel = computed({
  get: () => props.score,
  set: (value: string) => emit("update:score", value),
})

function updateOptions(patch: Partial<PlaygroundNmnOptions>): void {
  emit("update:options", { ...props.options, ...patch })
}

const sampleRateModel = computed({
  get: () => props.options.sampleRate,
  set: (value: number) => updateOptions({ sampleRate: value }),
})

const bpmModel = computed({
  get: () => props.options.bpm,
  set: (value: number) => updateOptions({ bpm: value }),
})

const volumeModel = computed({
  get: () => props.options.volume,
  set: (value: number) => updateOptions({ volume: value }),
})

const keyOptions = Object.keys(NMN_KEY_OFFSETS).flatMap((key) => [
  key,
  `${key}m`,
])

const keyModel = computed({
  get: () => props.options.key,
  set: (value: string) => updateOptions({ key: value }),
})

const transposeModel = computed({
  get: () => props.options.transpose,
  set: (value: number) => updateOptions({ transpose: value }),
})

const exportFormatModel = computed({
  get: () => props.exportFormat,
  set: (value: string) => emit("update:exportFormat", value),
})

function translate(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}

function isExportFormatSupported(format: string): boolean {
  return props.isExportFormatSupported(format)
}
</script>
