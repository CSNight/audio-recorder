<template>
  <aside class="rail rail-config">
    <div class="rail-head">
      <span class="rail-title">setup.conf</span>
      <span class="rail-meta">{{
        translate("采集 / 管线 / DSP", "capture / pipeline / DSP")
      }}</span>
    </div>

    <section class="config-section">
      <div class="config-section-head">
        <span class="section-kicker">{{
          translate("采集设置", "Capture Setup")
        }}</span>
        <span class="badge">{{ translate("步骤 1", "Step 1") }}</span>
      </div>

      <fieldset class="config-fieldset">
        <legend>{{ translate("输入源", "Input Source") }}</legend>
        <label class="field">
          <span>{{ translate("来源", "Source") }}</span>
          <select
            v-model="sourceModeModel"
            @change="$emit('source-mode-change')"
          >
            <option :value="sourceModeOptions.microphone">
              {{ translate("麦克风", "Microphone") }}
            </option>
            <option :value="sourceModeOptions.externalTone">
              {{ translate("外部音调流", "External tone stream") }}
            </option>
          </select>
        </label>
        <label v-if="sourceMode === sourceModeOptions.microphone" class="field">
          <span>{{ translate("设备", "Device") }}</span>
          <div class="inline-field">
            <select v-model="selectedDeviceIdModel">
              <option value="">
                {{ translate("默认麦克风", "Default microphone") }}
              </option>
              <option
                v-for="device in microphoneDevices"
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{
                  device.label ||
                  translate(
                    `麦克风 ${device.deviceId.slice(0, 8)}…`,
                    `Microphone ${device.deviceId.slice(0, 8)}…`
                  )
                }}
              </option>
            </select>
            <button
              class="ghost-button"
              @click="$emit('refresh-microphone-devices')"
            >
              {{ translate("刷新", "Refresh") }}
            </button>
          </div>
        </label>
      </fieldset>

      <fieldset class="config-fieldset">
        <legend>{{ translate("采集参数", "Capture Settings") }}</legend>
        <label class="field">
          <span>{{ translate("声道", "Channels") }}</span>
          <select v-model.number="requestedChannelCountModel">
            <option :value="1">{{ translate("单声道", "Mono") }}</option>
            <option :value="2">{{ translate("双声道", "Stereo") }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ translate("策略", "Strategy") }}</span>
          <select v-model="inputStrategyModel">
            <option value="auto">{{ translate("自动", "Auto") }}</option>
            <option value="media-recorder">MediaRecorder</option>
            <option value="audio-worklet">AudioWorklet</option>
            <option value="script-processor">ScriptProcessor</option>
          </select>
        </label>
      </fieldset>
    </section>

    <section class="config-section">
      <div class="config-section-head">
        <span class="section-kicker">{{
          translate("管线设置", "Pipeline Setup")
        }}</span>
        <span class="badge">{{ translate("步骤 2", "Step 2") }}</span>
      </div>

      <fieldset class="config-fieldset">
        <legend>{{ translate("缓存与持久化", "Buffer & Persistence") }}</legend>
        <label class="field">
          <span>{{ translate("存储模式", "Storage Mode") }}</span>
          <select
            v-model="storageModeModel"
            :disabled="!canChangeStorageMode"
            @change="$emit('storage-mode-change')"
          >
            <option :value="storageModeOptions.memory">
              {{ translate("纯内存", "Memory only") }}
            </option>
            <option :value="storageModeOptions.persistent">
              {{ translate("持久化", "Persistent") }}
            </option>
            <option :value="storageModeOptions.auto">
              {{ translate("自动切换", "Auto switch") }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>{{ translate("后端", "Backend") }}</span>
          <select
            v-model="persistenceBackendModel"
            :disabled="
              !canChangeStorageMode || storageMode === storageModeOptions.memory
            "
            @change="$emit('storage-mode-change')"
          >
            <option :value="persistenceBackendOptions.indexeddb">
              IndexedDB
            </option>
            <option :value="persistenceBackendOptions.opfs">OPFS</option>
          </select>
        </label>
        <label class="field">
          <span>{{ translate("溢写阈值", "Spill Threshold") }}</span>
          <input
            v-model.number="memoryThresholdBytesModel"
            :disabled="
              !canChangeStorageMode || storageMode !== storageModeOptions.auto
            "
            min="1"
            step="1"
            type="number"
          />
        </label>
        <p class="field-note">{{ storageHint }}</p>
      </fieldset>

      <PlaygroundPluginPanel
        v-model:plugin-config="pluginConfigModel"
        :analysis-hint="analysisHint"
        :apply-disabled="!canApplyPluginConfig"
        :dsp-hint="dspHint"
        :dsp-plugin-options="dspPluginOptions"
        :is-dirty="pluginConfigDirty"
        :localize="translate"
        :stream-plugin-modes="streamPluginModes"
        @apply-plugin-config="$emit('apply-plugin-config')"
      />
    </section>
  </aside>
</template>

<script lang="ts" setup>
import { computed } from "vue"
import PlaygroundPluginPanel from "./PlaygroundPluginPanel.vue"
import type { PlaygroundMicrophoneDevice } from "./playground-panel-types"

interface PlaygroundSetupRailProps {
  localize: (zhText: string, enText: string) => string
  sourceMode: string
  sourceModeOptions: Record<string, string>
  microphoneDevices: PlaygroundMicrophoneDevice[]
  selectedDeviceId: string
  requestedChannelCount: number
  inputStrategy: string
  storageMode: string
  storageModeOptions: Record<string, string>
  persistenceBackend: string
  persistenceBackendOptions: Record<string, string>
  memoryThresholdBytes: number
  canChangeStorageMode: boolean
  storageHint: string
  pluginConfig: Record<string, unknown>
  analysisHint: string
  dspHint: string
  pluginConfigDirty: boolean
  canApplyPluginConfig: boolean
  dspPluginOptions: Array<Record<string, unknown>>
  streamPluginModes: Record<string, string>
}

const props = defineProps<PlaygroundSetupRailProps>()

const emit = defineEmits<{
  "update:source-mode": [value: string]
  "source-mode-change": []
  "refresh-microphone-devices": []
  "update:selected-device-id": [value: string]
  "update:requested-channel-count": [value: number]
  "update:input-strategy": [value: string]
  "update:storage-mode": [value: string]
  "storage-mode-change": []
  "update:persistence-backend": [value: string]
  "update:memory-threshold-bytes": [value: number]
  "update:plugin-config": [value: Record<string, unknown>]
  "apply-plugin-config": []
}>()

const sourceModeModel = computed({
  get: () => props.sourceMode,
  set: (value: string) => emit("update:source-mode", value),
})

const selectedDeviceIdModel = computed({
  get: () => props.selectedDeviceId,
  set: (value: string) => emit("update:selected-device-id", value),
})

const requestedChannelCountModel = computed({
  get: () => props.requestedChannelCount,
  set: (value: number) => emit("update:requested-channel-count", value),
})

const inputStrategyModel = computed({
  get: () => props.inputStrategy,
  set: (value: string) => emit("update:input-strategy", value),
})

const storageModeModel = computed({
  get: () => props.storageMode,
  set: (value: string) => emit("update:storage-mode", value),
})

const persistenceBackendModel = computed({
  get: () => props.persistenceBackend,
  set: (value: string) => emit("update:persistence-backend", value),
})

const memoryThresholdBytesModel = computed({
  get: () => props.memoryThresholdBytes,
  set: (value: number) => emit("update:memory-threshold-bytes", value),
})

const pluginConfigModel = computed({
  get: () => props.pluginConfig,
  set: (value: Record<string, unknown>) => emit("update:plugin-config", value),
})

function translate(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}
</script>
