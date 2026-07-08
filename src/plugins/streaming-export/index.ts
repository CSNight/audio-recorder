/**
 * streaming-export 子路径导出入口。
 *
 * 用户须显式传入 encoders 到 createStreamingExportPlugin({ format, encoders: [...] })。
 * 当前仅支持 PCM/WAV，对应定义从 @media-studio/audio-recorder/codecs/base 导入。
 */
export { createStreamingExportPlugin } from "./plugin"
export type { StreamingExportPluginOptions } from "./types"
