<template>
  <section class="center-block">
    <div class="center-block-head">
      <div>
        <p class="section-kicker">
          {{ translate("分析插件", "Analysis Plugins") }}
        </p>
        <h2>{{ translate("频谱与按键识别", "FFT & DTMF") }}</h2>
      </div>
      <span class="badge">{{ badgeText }}</span>
    </div>

    <div class="analysis-grid">
      <article class="analysis-card">
        <div class="analysis-card-head">
          <span>plugin:fft</span>
          <div class="fft-controls">
            <div class="viz-mode-tabs">
              <button
                v-for="mode in vizModes"
                :key="mode.key"
                :class="['viz-tab', { active: currentVizMode === mode.key }]"
                @click="currentVizMode = mode.key"
              >
                {{ mode.label }}
              </button>
            </div>
            <strong>{{ fftPeakPercent }}%</strong>
          </div>
        </div>

        <!-- Histogram1: classic vertical bars -->
        <div
          v-if="currentVizMode === 'histogram1'"
          aria-label="FFT bars histogram1"
          class="fft-strip fft-histogram1"
        >
          <span
            v-for="(bar, index) in fftBars"
            :key="index"
            :style="{ height: getFftBarHeight(bar) }"
            class="fft-bar"
          ></span>
        </div>

        <!-- Histogram2: mirrored / symmetrical bars (center baseline) -->
        <div
          v-else-if="currentVizMode === 'histogram2'"
          aria-label="FFT bars histogram2"
          class="fft-strip fft-histogram2"
        >
          <span
            v-for="(bar, index) in fftBars"
            :key="index"
            class="fft-bar-mirror-wrap"
          >
            <span
              class="fft-bar-mirror top"
              :style="{ height: getMirrorBarHeight(bar) }"
            ></span>
            <span
              class="fft-bar-mirror bottom"
              :style="{ height: getMirrorBarHeight(bar) }"
            ></span>
          </span>
        </div>

        <!-- Histogram3: dot/pill style -->
        <div
          v-else-if="currentVizMode === 'histogram3'"
          aria-label="FFT bars histogram3"
          class="fft-strip fft-histogram3"
        >
          <span
            v-for="(bar, index) in fftBars"
            :key="index"
            class="fft-dot-col"
          >
            <span
              v-for="dotIndex in getDotCount(bar)"
              :key="dotIndex"
              :style="getDotStyle(bar, dotIndex)"
              class="fft-dot"
            ></span>
          </span>
        </div>

        <!-- WaveView: sine-wave style using SVG polyline -->
        <div
          v-else-if="currentVizMode === 'waveview'"
          aria-label="FFT waveview"
          class="fft-strip fft-waveview"
        >
          <svg
            :viewBox="`0 0 ${waveViewWidth} ${waveViewHeight}`"
            preserveAspectRatio="none"
            class="fft-wave-svg"
          >
            <defs>
              <linearGradient id="waveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stop-color="var(--accent-2)"
                  stop-opacity="0.9"
                />
                <stop
                  offset="100%"
                  stop-color="var(--accent)"
                  stop-opacity="0.5"
                />
              </linearGradient>
              <linearGradient id="waveFillGrad" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stop-color="var(--accent-2)"
                  stop-opacity="0.18"
                />
                <stop
                  offset="100%"
                  stop-color="var(--accent)"
                  stop-opacity="0.04"
                />
              </linearGradient>
            </defs>
            <!-- fill area -->
            <polygon
              v-if="fftBars.length"
              :points="wavePolygonPoints"
              fill="url(#waveFillGrad)"
            />
            <!-- stroke line -->
            <polyline
              v-if="fftBars.length"
              :points="wavePolylinePoints"
              fill="none"
              stroke="url(#waveGrad)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        <p class="field-note">
          {{
            translate(
              "显示最近一次频谱分析结果；关闭 FFT 插件后这里会回到空态。",
              "Shows the latest FFT spectrum slice. It returns to idle when the FFT plugin is disabled."
            )
          }}
        </p>
      </article>

      <article class="analysis-card">
        <div class="analysis-card-head">
          <span>plugin:dtmf:detect</span>
          <strong>{{ dtmfLastKey }}</strong>
        </div>
        <div v-if="dtmfDetections.length" class="token-pile">
          <span
            v-for="item in dtmfDetections"
            :key="`${item.key}-${item.startedAtMs}`"
            class="token-chip"
          >
            {{ item.key }} · {{ Math.round(item.durationMs) }}ms
          </span>
        </div>
        <p v-else class="field-note">
          {{
            translate(
              "暂无识别结果；启用 DTMF 插件后向录音链路输入按键音即可在这里看到最近序列。",
              "No detections yet. Enable the DTMF plugin and feed keypad tones into the recorder to see recent events here."
            )
          }}
        </p>
      </article>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue"
import { getFftBarHeight } from "../playground-utils.js"
import type { PlaygroundDtmfDetection } from "./playground-panel-types"

interface PlaygroundAnalysisPanelProps {
  localize: (zhText: string, enText: string) => string
  badgeText: string
  fftPeakPercent: number
  fftBars: number[]
  dtmfLastKey: string
  dtmfDetections: PlaygroundDtmfDetection[]
}

const props = defineProps<PlaygroundAnalysisPanelProps>()

function translate(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}

type VizMode = "histogram1" | "histogram2" | "histogram3" | "waveview"

const vizModes: { key: VizMode; label: string }[] = [
  { key: "histogram1", label: "H1" },
  { key: "histogram2", label: "H2" },
  { key: "histogram3", label: "H3" },
  { key: "waveview", label: "Wave" },
]

const currentVizMode = ref<VizMode>("histogram1")

// --- Histogram2: mirrored bars (px height, max 45px half) ---
const MIRROR_MAX_PX = 45

function getMirrorBarHeight(bar: number): string {
  if (!Number.isFinite(bar) || bar <= 0) return "2px"
  return `${Math.max(2, Math.round(bar * MIRROR_MAX_PX))}px`
}

// --- Histogram3: dot columns ---
const DOT_TOTAL = 12

function getDotCount(bar: number): number {
  if (!Number.isFinite(bar) || bar <= 0) return 0
  return Math.max(1, Math.round(bar * DOT_TOTAL))
}

function getDotStyle(bar: number, dotIndex: number): Record<string, string> {
  const ratio = dotIndex / DOT_TOTAL
  // top dots use accent-2 (blue), bottom ones use accent (green)
  const opacity = 0.4 + ratio * 0.6
  return { opacity: String(opacity) }
}

// --- WaveView: SVG polyline ---
const waveViewWidth = 320
const waveViewHeight = 110

const wavePolylinePoints = computed(() => {
  if (!props.fftBars.length) return ""
  const bars = props.fftBars
  const step = waveViewWidth / Math.max(1, bars.length - 1)
  return bars
    .map((bar, i) => {
      const x = i * step
      const y =
        waveViewHeight -
        Math.max(0, Math.min(1, bar ?? 0)) * (waveViewHeight - 4) -
        2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
})

const wavePolygonPoints = computed(() => {
  if (!props.fftBars.length) return ""
  const bars = props.fftBars
  const step = waveViewWidth / Math.max(1, bars.length - 1)
  const top = bars.map((bar, i) => {
    const x = i * step
    const y =
      waveViewHeight -
      Math.max(0, Math.min(1, bar ?? 0)) * (waveViewHeight - 4) -
      2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return [
    ...top,
    `${waveViewWidth},${waveViewHeight}`,
    `0,${waveViewHeight}`,
  ].join(" ")
})
</script>
