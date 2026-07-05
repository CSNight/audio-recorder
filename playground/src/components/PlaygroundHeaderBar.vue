<template>
  <header class="site-header topbar">
    <div class="site-header-left">
      <p class="eyebrow">Audio Recorder Lab</p>
      <h1>{{ translate("浏览器录音工作台", "Browser Recorder Workspace") }}</h1>
      <p class="lede">
        {{
          translate(
            "通过 dist 产物快速校验输入源、持久化、实时编码、播放器与导出链路。",
            "Use the dist build to validate input sources, persistence, realtime encoding, playback, and export flows."
          )
        }}
      </p>
    </div>

    <div class="site-header-right">
      <div
        :aria-label="translate('界面语言', 'Interface language')"
        class="locale-switch"
        role="group"
      >
        <span class="locale-switch-label">{{
          translate("界面语言", "Language")
        }}</span>
        <div class="locale-switch-buttons">
          <button
            v-for="option in localeOptions"
            :key="option.value"
            :class="[
              'locale-button',
              { 'locale-button-active': locale === option.value },
            ]"
            :data-testid="`locale-${option.value}`"
            type="button"
            @click="$emit('update:locale', option.value)"
          >
            <span>{{ option.shortLabel }}</span>
            <small>{{ option.label }}</small>
          </button>
        </div>
      </div>

      <span
        :class="[
          'state-badge',
          badgeClass,
          isPendingAction ? 'badge-accent' : '',
        ]"
        >{{ badgeText }}</span
      >

      <dl class="metrics-strip">
        <template v-for="item in metrics" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>
            <strong>{{ item.value }}</strong>
            <small>{{ item.detail }}</small>
          </dd>
        </template>
      </dl>

      <div class="context-chips">
        <span v-for="item in contextChips" :key="item" class="mini-chip">
          {{ item }}
        </span>
      </div>
    </div>
  </header>
</template>

<script lang="ts" setup>
import type {
  PlaygroundLocaleOption,
  PlaygroundMetricItem,
} from "./playground-panel-types"

interface PlaygroundHeaderBarProps {
  localize: (zhText: string, enText: string) => string
  locale: string
  localeOptions: PlaygroundLocaleOption[]
  badgeText: string
  badgeClass: string
  isPendingAction: boolean
  metrics: PlaygroundMetricItem[]
  contextChips: string[]
}

const props = defineProps<PlaygroundHeaderBarProps>()

defineEmits<{
  "update:locale": [value: string]
}>()

function translate(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}
</script>
