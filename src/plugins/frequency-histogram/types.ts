export interface FrequencyHistogramOptions {
  /** FFT 窗口大小，必须是 2 的幂，默认 2048。 */
  fftSize?: 512 | 1024 | 2048 | 4096
  /** 输出柱数，默认 64。 */
  barCount?: number
  /** 每隔 N 帧分析一次，默认 1。 */
  frameInterval?: number
}

export interface FrequencyFftEvent {
  /** 归一化频谱柱数据，范围 [0, 1]。 */
  bars: Float32Array
  /** 当前分析窗口结束时刻。 */
  timestampMs: number
  fftSize: number
  sampleRate: number
}
