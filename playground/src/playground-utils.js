import { RecorderState } from "@media-studio/audio-recorder"
import {
  EXPORT_FORMAT_ACTIONS,
  PLAYGROUND_PERSISTENCE_BACKEND,
  PLAYGROUND_SOURCE_MODE,
  PLAYGROUND_STORAGE_MODE,
} from "./playground-constants.js"

export function toKvRows(value, prefix = "") {
  if (value === null || value === undefined) return []
  if (typeof value !== "object") {
    return [{ label: prefix || "value", value: String(value) }]
  }

  return Object.entries(value).flatMap(([key, currentValue]) => {
    const label = prefix ? `${prefix}.${key}` : key

    if (
      currentValue !== null &&
      typeof currentValue === "object" &&
      !Array.isArray(currentValue)
    ) {
      return toKvRows(currentValue, label)
    }

    return [
      {
        label,
        value: Array.isArray(currentValue)
          ? JSON.stringify(currentValue)
          : String(currentValue),
      },
    ]
  })
}

export function getInputStrategyLabel(localize, strategy) {
  switch (strategy) {
    case "auto":
      return localize("自动", "Auto")
    case "media-recorder":
      return "MediaRecorder"
    case "audio-worklet":
      return "AudioWorklet"
    case "script-processor":
      return "ScriptProcessor"
    default:
      return String(strategy ?? "-")
  }
}

export function getSourceModeLabel(localize, mode) {
  return mode === PLAYGROUND_SOURCE_MODE.externalTone
    ? localize("外部音调流", "External tone stream")
    : localize("麦克风", "Microphone")
}

export function getStorageModeLabel(localize, mode) {
  switch (mode) {
    case PLAYGROUND_STORAGE_MODE.persistent:
      return localize("持久化模式", "Persistent")
    case PLAYGROUND_STORAGE_MODE.auto:
      return localize("自动模式", "Auto")
    default:
      return localize("纯内存", "Memory only")
  }
}

export function getPersistenceBackendLabel(backend) {
  return backend === PLAYGROUND_PERSISTENCE_BACKEND.opfs ? "OPFS" : "IndexedDB"
}

export function getRecorderStateLabel(localize, value) {
  switch (value) {
    case RecorderState.Idle:
      return localize("空闲", "Idle")
    case RecorderState.Ready:
      return localize("就绪", "Ready")
    case RecorderState.Recording:
      return localize("录音中", "Recording")
    case RecorderState.Paused:
      return localize("已暂停", "Paused")
    case RecorderState.Stopped:
      return localize("已停止", "Stopped")
    case RecorderState.Closed:
      return localize("已关闭", "Closed")
    default:
      return String(value)
  }
}

export function getLogTypeLabel(localize, type) {
  switch (type) {
    case "info":
      return localize("信息", "Info")
    case "warning":
      return localize("警告", "Warning")
    case "error":
      return localize("错误", "Error")
    default:
      return type
  }
}

export function getExportAction(format) {
  return EXPORT_FORMAT_ACTIONS.find((action) => action.type === format) ?? null
}

export function getExportFormatLabel(format) {
  return getExportAction(format)?.label ?? format
}

export function getExportResultByteLength(result) {
  if (result?.data instanceof Uint8Array) return result.data.byteLength
  return 0
}

export function getFftBarHeight(bar) {
  if (!Number.isFinite(bar) || bar <= 0) {
    return "0%"
  }

  return `${Math.max(2, Math.round(bar * 100))}%`
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "-"
  if (bytes < 1024) return `${bytes} B`

  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function toStateClassName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
}

export function getRecorderBadgeClass(value) {
  return `badge-state-${toStateClassName(value)}`
}
