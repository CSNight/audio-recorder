export interface PlaygroundResultRow {
  label: string
  value: string
}

export interface PlaygroundMetricItem {
  label: string
  value: string | number
  detail: string
}

export interface PlaygroundDiagnosticGroup {
  label: string
  rows: PlaygroundResultRow[]
}

export interface PlaygroundLocaleOption {
  value: string
  shortLabel: string
  label: string
}

export interface PlaygroundLogItem {
  type: string
  time: string
  message: string
}

export interface PlaygroundMicrophoneDevice {
  deviceId: string
  label?: string
}

export interface PlaygroundDtmfDetection {
  key: string
  startedAtMs: number
  durationMs: number
}

export interface PlaygroundExportAction {
  type: string
  label: string
}

export interface PlaygroundExportActionButton extends PlaygroundExportAction {
  disabled: boolean
}
