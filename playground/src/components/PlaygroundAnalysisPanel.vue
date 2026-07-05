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
          <strong>{{ fftPeakPercent }}%</strong>
        </div>
        <div aria-label="FFT bars" class="fft-strip">
          <span
            v-for="(bar, index) in fftBars"
            :key="index"
            :style="{ height: getFftBarHeight(bar) }"
            class="fft-bar"
          ></span>
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
</script>
