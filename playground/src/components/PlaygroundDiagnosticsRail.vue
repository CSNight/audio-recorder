<template>
  <aside class="rail rail-info side-column">
    <div class="rail-head">
      <span class="rail-title">diag.log</span>
      <span class="rail-meta">{{
        localize("运行时 / 存储 / 事件", "runtime / storage / events")
      }}</span>
    </div>

    <section class="info-section">
      <div class="info-section-head">
        <span class="section-kicker">{{
          localize("诊断", "Diagnostics")
        }}</span>
        <button class="ghost-button" @click="$emit('toggle-raw-view')">
          {{ diagnosticsRawView ? localize("结构化", "Structured") : "JSON" }}
        </button>
      </div>

      <template v-if="diagnosticsRawView">
        <pre class="json">{{ runtimeJson }}</pre>
        <pre class="json">{{ summaryJson }}</pre>
        <pre class="json">{{ storageJson }}</pre>
      </template>

      <template v-else>
        <div
          v-for="group in diagnosticGroups"
          :key="group.label"
          class="diag-group"
        >
          <p class="diag-group-label">
            {{ group.label }} <small>{{ group.rows.length }}</small>
          </p>
          <dl v-if="group.rows.length" class="kv-grid">
            <template v-for="row in group.rows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
          <p v-else class="field-note">
            {{ localize("暂无数据。", "No data yet.") }}
          </p>
        </div>
      </template>
    </section>

    <section class="info-section info-section-logs">
      <div class="info-section-head">
        <span class="section-kicker">{{ localize("日志", "Logs") }}</span>
        <button class="ghost-button" @click="$emit('clear-logs')">
          {{ localize("清空", "Clear") }}
        </button>
      </div>
      <ul class="log-list log-panel-body">
        <li
          v-for="item in logs"
          :key="`${item.time}-${item.message}`"
          class="log-item"
        >
          <div class="log-head">
            <span class="log-time">{{ item.time }}</span>
            <span :class="['log-type', item.type]">{{
              getLogTypeLabel(item.type)
            }}</span>
          </div>
          <p class="log-message">{{ item.message }}</p>
        </li>
        <li v-if="logs.length === 0" class="log-item log-item-empty">
          <p class="log-message">
            {{
              localize(
                "暂无日志，操作录音器后会在这里展示事件流。",
                "No logs yet. Recorder events will appear here after you interact with it."
              )
            }}
          </p>
        </li>
      </ul>
    </section>
  </aside>
</template>

<script lang="ts" setup>
import type {
  PlaygroundDiagnosticGroup,
  PlaygroundLogItem,
} from "./playground-panel-types"

interface PlaygroundDiagnosticsRailProps {
  localize: (zhText: string, enText: string) => string
  diagnosticsRawView: boolean
  runtimeJson: string
  summaryJson: string
  storageJson: string
  diagnosticGroups: PlaygroundDiagnosticGroup[]
  logs: PlaygroundLogItem[]
  getLogTypeLabel: (type: string) => string
}

const props = defineProps<PlaygroundDiagnosticsRailProps>()

defineEmits<{
  "toggle-raw-view": []
  "clear-logs": []
}>()

function localize(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}

function getLogTypeLabel(type: string): string {
  return props.getLogTypeLabel(type)
}
</script>
