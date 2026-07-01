/**
 * streaming-player 公开入口
 *
 * 用法：
 *   import { createStreamingPlayer } from "@csnight/audio-recorder/streaming-player"
 *
 *   // 业务层自行订阅 recorder / websocket，拿到 packet 后调用 handle.push(packet)
 *   const handle = await createStreamingPlayer({ decoders: [...], ... })
 *   recorderEventBus.on('plugin:stream', (pkt) => handle.push(pkt))
 *   await handle.start()
 */

export { createStreamingPlayer } from "./player"

export type {
  StreamingPlayerOptions,
  StreamingPlayerHandle,
  StreamingPlayerState,
} from "./types"
