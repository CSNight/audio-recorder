import { describe, expect, it } from "vitest"
import { ChunkedEncoderBridge } from "@/workers/chunked-encoder-bridge"
import { ChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
import { pcmChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/pcm"
import { wavChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/wav"

/**
 * vitest 在 Node.js 下 typeof Worker === 'undefined'，
 * 所以 ChunkedEncoderBridge 自动回退到主线程同步模式。
 * 这些测试覆盖主线程 fallback 路径。
 */

function buildRegistry() {
  const registry = new ChunkedEncoderRegistry()
  registry.register(pcmChunkedEncoderDefinition)
  registry.register(wavChunkedEncoderDefinition)
  return registry
}

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

describe("ChunkedEncoderBridge (main-thread fallback)", () => {
  it("feedFrame returns PCM chunk synchronously via Promise", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      registry: buildRegistry(),
    })

    const result = await bridge.feedFrame(1, 16000, mono([100, 200]))
    expect(result).not.toBeNull()
    expect(result!.byteLength).toBe(4) // 2 samples × 2 bytes

    bridge.dispose()
  })

  it("flush returns null for PCM encoder (no buffer)", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      registry: buildRegistry(),
    })
    await bridge.feedFrame(1, 16000, mono([1, 2]))
    const result = await bridge.flush()
    expect(result).toBeNull()
    bridge.dispose()
  })

  it("WAV bridge accumulates frames and emits on flush", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "wav",
      encoderOptions: { framesPerChunk: 10 },
      registry: buildRegistry(),
    })

    // 不够 10 帧，feedFrame 应返回 null
    const mid = await bridge.feedFrame(1, 16000, mono([1, 2, 3]))
    expect(mid).toBeNull()

    // flush 返回剩余数据
    const final = await bridge.flush()
    expect(final).not.toBeNull()
    expect(final!.byteLength).toBeGreaterThan(44) // header + data

    bridge.dispose()
  })

  it("rejects feedFrame and flush after dispose", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      registry: buildRegistry(),
    })
    bridge.dispose()

    await expect(bridge.feedFrame(1, 16000, mono([1]))).rejects.toThrow(
      "disposed"
    )
    await expect(bridge.flush()).rejects.toThrow("disposed")
  })

  it("throws on unknown format", () => {
    expect(
      () =>
        new ChunkedEncoderBridge({ format: "ogg", registry: buildRegistry() })
    ).toThrow()
  })

  it("throws when allowMainThreadFallback is false and Worker is unavailable", () => {
    // vitest 运行在 Node 下，typeof Worker === 'undefined'，模拟 Worker 不可用
    expect(
      () =>
        new ChunkedEncoderBridge({
          format: "pcm",
          registry: buildRegistry(),
          allowMainThreadFallback: false,
        })
    ).toThrow("allowMainThreadFallback")
  })
})
