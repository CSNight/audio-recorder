/**
 * lamejs ESM 适配层。
 *
 * lamejs 是无官方类型声明的 CJS 模块，这里封装为 ESM 导出：
 * - 不向 globalThis 挂载任何变量
 * - Worker 和主线程均使用同一份适配器
 *
 * 注意：lamejs 精简版（vendor/Recorder-master/src/engine/mp3-engine.js）
 * 仅支持单声道，且包含 xiangyuecn 的 out_samplerate fix（低码率无声问题）。
 * 当前使用 npm lamejs（支持双声道）；如需体积更小的单声道版本可切换为 vendor 版。
 */
import { Mp3Encoder } from "lamejs"

/** lamejs Mp3Encoder 实例接口 */
export interface LameMp3Encoder {
  /**
   * 编码一帧音频，left/right 为 Int16 PCM 数据。
   * 单声道时 right 与 left 相同（lamejs 内部忽略 right）。
   * 返回 Int8Array，长度为 0 时表示本帧内部缓冲未满，无产出。
   */
  encodeBuffer(left: Int16Array, right: Int16Array): Int8Array
  /** 冲刷内部缓冲，返回最后一批 MP3 帧数据。 */
  flush(): Int8Array
}

/** lamejs Mp3Encoder 构造函数类型 */
export interface LameMp3EncoderConstructor {
  new (channels: number, sampleRate: number, kbps: number): LameMp3Encoder
}

/**
 * lamejs 的 Mp3Encoder 构造函数，直接从模块导入，不走全局挂载。
 */
export const Mp3EncoderClass: LameMp3EncoderConstructor =
  Mp3Encoder as unknown as LameMp3EncoderConstructor
