/**
 * lamejs 类型接口定义。
 *
 * 不直接 import lamejs，而是由消费方通过 registerMp3Encoder() 传入构造函数。
 * 这样可以避免：
 *  1. 库与消费方项目各自打包一份 lamejs（重复问题）
 *  2. Worker inline blob 无法访问外部 peer dep 的问题
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
