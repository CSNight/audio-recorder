/**
 * MP3 编码器相关类型定义（原 lamejs-adapter.ts 重命名而来）。
 *
 * lamejs 是无官方类型声明的 CJS 模块，环境类型声明见同目录 lamejs.d.ts
 * （declare module "lamejs"）。该文件不再持有 `Mp3EncoderClass` 适配常量——
 * codecs/mp3 下各实现（mp3-chunked-encoder.ts / mp3-snapshot-exporter.ts）
 * 均直接 `import { Mp3Encoder } from "lamejs"` 使用，类型由 lamejs.d.ts 提供。
 *
 * 本文件仅保留编码器接口形状的类型定义，供需要显式标注变量类型
 * （例如惰性初始化的 `let encoder: LameMp3Encoder | null = null`）的场景复用，
 * 避免散落多处重复声明同样的接口形状。
 */

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
