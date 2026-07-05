<template>
  <section class="config-section">
    <div class="config-section-head">
      <div>
        <span class="section-kicker">{{
          translate("插件装配", "Plugin Assembly")
        }}</span>
        <h2>{{ translate("统一配置与挂载", "Unified Config & Mounting") }}</h2>
      </div>
      <button
        :disabled="applyDisabled || !isDirty"
        class="ghost-button"
        @click="$emit('apply-plugin-config')"
      >
        {{ translate("统一应用插件", "Apply All Plugins") }}
      </button>
    </div>
    <p class="field-note">{{ pluginApplyHint }}</p>

    <fieldset class="config-fieldset">
      <legend>{{ translate("实时流插件", "Realtime Stream Plugin") }}</legend>
      <label class="field">
        <span>{{ translate("流模式", "Stream Mode") }}</span>
        <select v-model="pluginConfig.streamPluginMode">
          <option :value="streamPluginModes.streaming">Streaming Export</option>
          <option :value="streamPluginModes.sonic">Sonic Export</option>
        </select>
      </label>
      <label class="field">
        <span>{{ translate("流格式", "Stream Format") }}</span>
        <select v-model="pluginConfig.streamPluginFormat">
          <option value="wav">WAV</option>
          <option value="pcm">PCM</option>
        </select>
      </label>
      <template
        v-if="pluginConfig.streamPluginMode === streamPluginModes.sonic"
      >
        <label class="field">
          <span>speed</span>
          <input
            v-model.number="pluginConfig.sonicSpeed"
            min="0.1"
            step="0.1"
            type="number"
          />
        </label>
        <label class="field">
          <span>pitch</span>
          <input
            v-model.number="pluginConfig.sonicPitch"
            min="0.1"
            step="0.1"
            type="number"
          />
        </label>
        <label class="field">
          <span>rate</span>
          <input
            v-model.number="pluginConfig.sonicRate"
            min="0.1"
            step="0.1"
            type="number"
          />
        </label>
        <label class="field">
          <span>volume</span>
          <input
            v-model.number="pluginConfig.sonicVolume"
            min="0.1"
            step="0.1"
            type="number"
          />
        </label>
        <label class="field">
          <span>blockMs</span>
          <input
            v-model.number="pluginConfig.sonicBlockMs"
            min="100"
            step="10"
            type="number"
          />
        </label>
      </template>
      <p class="field-note">
        {{
          translate(
            "当前实时流通过 plugin:stream 对接 Streaming Player。这里的变更会和分析、DSP 一起统一重挂。",
            "The live stream is wired into Streaming Player via plugin:stream. Changes here are remounted together with analysis and DSP plugins."
          )
        }}
      </p>
    </fieldset>

    <fieldset class="config-fieldset">
      <legend>{{ translate("分析插件", "Analysis Plugins") }}</legend>
      <label class="dsp-row">
        <input v-model="pluginConfig.enableFftPlugin" type="checkbox" />
        <span class="dsp-row-body">
          <strong>Frequency Histogram / FFT</strong>
          <small>{{
            translate(
              "通过 plugin:fft 输出实时频谱柱数据，不影响主录音链路。",
              "Streams realtime spectrum bars through plugin:fft without touching the main recorder path."
            )
          }}</small>
        </span>
      </label>
      <template v-if="pluginConfig.enableFftPlugin">
        <label class="field">
          <span>fftSize</span>
          <select v-model.number="pluginConfig.fftSize">
            <option :value="512">512</option>
            <option :value="1024">1024</option>
            <option :value="2048">2048</option>
            <option :value="4096">4096</option>
          </select>
        </label>
        <label class="field">
          <span>barCount</span>
          <input
            v-model.number="pluginConfig.fftBarCount"
            max="96"
            min="12"
            step="4"
            type="number"
          />
        </label>
        <label class="field">
          <span>frameInterval</span>
          <input
            v-model.number="pluginConfig.fftFrameInterval"
            max="12"
            min="1"
            step="1"
            type="number"
          />
        </label>
      </template>

      <label class="dsp-row">
        <input v-model="pluginConfig.enableDtmfPlugin" type="checkbox" />
        <span class="dsp-row-body">
          <strong>DTMF Detector</strong>
          <small>{{
            translate(
              "通过 plugin:dtmf:detect 识别电话按键音，适合调试 IVR / 双音频场景。",
              "Detects telephone keypad tones through plugin:dtmf:detect for IVR and dual-tone debugging."
            )
          }}</small>
        </span>
      </label>
      <template v-if="pluginConfig.enableDtmfPlugin">
        <label class="field">
          <span>frameWindowMs</span>
          <input
            v-model.number="pluginConfig.dtmfFrameWindowMs"
            max="120"
            min="20"
            step="5"
            type="number"
          />
        </label>
        <label class="field">
          <span>minToneMs</span>
          <input
            v-model.number="pluginConfig.dtmfMinToneMs"
            max="200"
            min="20"
            step="10"
            type="number"
          />
        </label>
        <label class="field">
          <span>minGapMs</span>
          <input
            v-model.number="pluginConfig.dtmfMinGapMs"
            max="120"
            min="10"
            step="5"
            type="number"
          />
        </label>
        <label class="field">
          <span>energyThreshold</span>
          <input
            v-model.number="pluginConfig.dtmfEnergyThreshold"
            max="0.2"
            min="0.005"
            step="0.005"
            type="number"
          />
        </label>
      </template>
      <p class="field-note">{{ analysisHint }}</p>
    </fieldset>

    <div class="dsp-list">
      <label
        v-for="option in dspPluginOptions"
        :key="option.pluginName"
        class="dsp-row"
      >
        <input v-model="pluginConfig[option.key]" type="checkbox" />
        <span class="dsp-row-body">
          <strong>{{ getLocalizedCopy(option.label) }}</strong>
          <small>{{ getLocalizedCopy(option.note) }}</small>
        </span>
      </label>
    </div>
    <p class="field-note">{{ dspHint }}</p>
  </section>
</template>

<script setup>
import { computed } from "vue"

const pluginConfig = defineModel("pluginConfig", {
  required: true,
})

const props = defineProps({
  localize: {
    type: Function,
    required: true,
  },
  streamPluginModes: {
    type: Object,
    required: true,
  },
  dspPluginOptions: {
    type: Array,
    required: true,
  },
  analysisHint: {
    type: String,
    required: true,
  },
  dspHint: {
    type: String,
    required: true,
  },
  applyDisabled: {
    type: Boolean,
    required: true,
  },
  isDirty: {
    type: Boolean,
    required: true,
  },
})

defineEmits(["apply-plugin-config"])

function translate(zhText, enText) {
  return props.localize(zhText, enText)
}

function getLocalizedCopy(copy) {
  return translate(copy.zh, copy.en)
}

const pluginApplyHint = computed(() => {
  if (props.applyDisabled) {
    return translate(
      "当前录音器未处于可应用状态；插件修改会先保留在面板里。",
      "The recorder is not ready for plugin apply right now. Changes stay staged in the panel."
    )
  }

  if (!props.isDirty) {
    return translate(
      "当前面板配置已经同步到录音器。",
      "The current panel configuration is already synced to the recorder."
    )
  }

  return translate(
    "当前有未应用的插件修改。点击“统一应用插件”后，会一次性重挂实时流、分析和 DSP 插件。",
    "There are unapplied plugin changes. Apply All Plugins remounts live stream, analysis, and DSP plugins in one pass."
  )
})
</script>
