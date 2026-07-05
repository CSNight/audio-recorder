export interface PlaygroundResultRow {
  label: string
  value: string
}

export interface PlaygroundDiagnosticGroup {
  label: string
  rows: PlaygroundResultRow[]
}

export interface PlaygroundLogItem {
  type: string
  time: string
  message: string
}

export interface PlaygroundExportAction {
  type: string
  label: string
}
