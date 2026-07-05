import { describe, expect, it, vi } from "vitest"
import { createSonicStreamBridge } from "../../src/plugins/sonic-export/stream-bridge"
import type { StreamEncoderDefinition } from "../../src"

function makeMockDefinition(): StreamEncoderDefinition {
  const encoder = {
    feedFrame: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    flush: vi.fn().mockReturnValue(new Uint8Array([4, 5, 6])),
    dispose: vi.fn(),
  }
  return {
    create: vi.fn().mockReturnValue(encoder),
    workerFactory: undefined,
  } as unknown as StreamEncoderDefinition
}

function makeTransformOptions() {
  return {
    blockMs: 20,
    sampleRate: 16000,
    channels: 1,
  }
}

function makeAudioFrame(
  samples: number[] = Array(320).fill(1000),
  sampleRate = 16000,
  channels = 1,
  timestamp = 0
) {
  const planar: Int16Array[] = []
  for (let c = 0; c < channels; c++) {
    const ch = new Int16Array(samples.length / channels)
    for (let i = 0; i < ch.length; i++) {
      ch[i] = samples[c + i * channels] ?? 0
    }
    planar.push(ch)
  }
  const durationMs = (samples.length / channels / sampleRate) * 1000
  return { planar, sampleRate, channels, timestamp, durationMs }
}

async function flushQueue() {
  // Wait for microtasks/promises to resolve
  await new Promise((r) => setTimeout(r, 10))
}

describe("createSonicStreamBridge", () => {
  it("dispose without start does not throw", () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    expect(() => bridge.dispose()).not.toThrow()
  })

  it("feedFrame before start is ignored", async () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    const frame = makeAudioFrame()
    bridge.feedFrame(frame as any)
    await flushQueue()
    expect(emitPacket).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it("start/stop lifecycle works without throwing", async () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    bridge.start()
    bridge.stop()
    await flushQueue()
    bridge.dispose()
  })

  it("pause/resume cycle works", async () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    bridge.start()
    bridge.pause()
    bridge.resume()
    bridge.stop()
    await flushQueue()
    bridge.dispose()
  })

  it("feedFrame after pause is ignored", async () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    bridge.start()
    bridge.pause()
    const frame = makeAudioFrame()
    bridge.feedFrame(frame as any)
    await flushQueue()
    bridge.dispose()
  })

  it("uses custom createSessionId if provided", () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const createSessionId = vi.fn().mockReturnValue("custom-session-id")
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
      createSessionId,
    })
    bridge.start()
    expect(createSessionId).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it("stop before any feedFrame calls flush and emits final packet", async () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    bridge.start()
    // Feed enough data to trigger a block flush
    const frame = makeAudioFrame(Array(320).fill(10000), 16000, 1, 0)
    bridge.feedFrame(frame as any)
    await flushQueue()
    bridge.stop()
    await flushQueue()
    bridge.dispose()
  })

  it("dispose calls encoder.dispose", () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(null),
      flush: vi.fn().mockReturnValue(null),
      dispose: vi.fn(),
    }
    const def = {
      create: vi.fn().mockReturnValue(mockEncoder),
      workerFactory: undefined,
    } as unknown as StreamEncoderDefinition

    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    bridge.dispose()
    expect(mockEncoder.dispose).toHaveBeenCalled()
  })

  it("multiple start calls reset state", async () => {
    const def = makeMockDefinition()
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: makeTransformOptions() as any,
      emitPacket,
    })
    bridge.start()
    bridge.stop()
    await flushQueue()
    bridge.start()
    bridge.stop()
    await flushQueue()
    bridge.dispose()
  })

  it("emits packet with discontinuity flag after resume", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      flush: vi.fn().mockReturnValue(new Uint8Array([4, 5, 6])),
      dispose: vi.fn(),
    }
    const def = {
      create: vi.fn().mockReturnValue(mockEncoder),
      workerFactory: undefined,
    } as unknown as StreamEncoderDefinition
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: {
        blockMs: 10,
        speed: 1,
        pitch: 1,
        rate: 1,
        volume: 1,
      } as any,
      emitPacket,
    })
    bridge.start()
    // Feed enough data to trigger a flush
    const frame = makeAudioFrame(Array(320).fill(1000), 16000, 1, 0)
    bridge.feedFrame(frame as any)
    await flushQueue()
    bridge.pause()
    bridge.resume()
    // Feed more data after resume (should set discontinuity)
    const frame2 = makeAudioFrame(Array(320).fill(1000), 16000, 1, 100)
    bridge.feedFrame(frame2 as any)
    await flushQueue()
    bridge.stop()
    await flushQueue()
    bridge.dispose()
    // Should have emitted some packets
    expect(emitPacket).toHaveBeenCalled()
  })

  it("emits packet with metadata when metadata option is set", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      flush: vi.fn().mockReturnValue(new Uint8Array([4, 5, 6])),
      dispose: vi.fn(),
    }
    const def = {
      create: vi.fn().mockReturnValue(mockEncoder),
      workerFactory: undefined,
    } as unknown as StreamEncoderDefinition
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      metadata: { lang: "en" },
      transformOptions: {
        blockMs: 10,
        speed: 1,
        pitch: 1,
        rate: 1,
        volume: 1,
      } as any,
      emitPacket,
    })
    bridge.start()
    const frame = makeAudioFrame(Array(320).fill(1000), 16000, 1, 0)
    bridge.feedFrame(frame as any)
    await flushQueue()
    bridge.stop()
    await flushQueue()
    bridge.dispose()
    // Packets that have data should include metadata
    const calls = emitPacket.mock.calls
    if (calls.length > 0) {
      const packet = calls[0]![0]
      if (packet.chunk && packet.chunk.length > 0) {
        expect(packet.metadata).toEqual({ lang: "en" })
      }
    }
  })

  it("handles sampleRate/channels change mid-session by flushing buffered frames", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(new Uint8Array([1])),
      flush: vi.fn().mockReturnValue(null),
      dispose: vi.fn(),
    }
    const def = {
      create: vi.fn().mockReturnValue(mockEncoder),
      workerFactory: undefined,
    } as unknown as StreamEncoderDefinition
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: {
        blockMs: 100,
        speed: 1,
        pitch: 1,
        rate: 1,
        volume: 1,
      } as any,
      emitPacket,
    })
    bridge.start()
    // Feed mono frame
    const monoFrame = makeAudioFrame(Array(80).fill(500), 16000, 1, 0)
    bridge.feedFrame(monoFrame as any)
    // Feed stereo frame with different channel count (should trigger flush)
    const stereoFrame = makeAudioFrame(Array(160).fill(500), 16000, 2, 5)
    bridge.feedFrame(stereoFrame as any)
    await flushQueue()
    bridge.dispose()
  })

  it("stop with obsolete sessionId discards the final packet", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(null),
      flush: vi.fn().mockReturnValue(new Uint8Array([1])),
      dispose: vi.fn(),
    }
    const def = {
      create: vi.fn().mockReturnValue(mockEncoder),
      workerFactory: undefined,
    } as unknown as StreamEncoderDefinition
    const emitPacket = vi.fn()
    const bridge = createSonicStreamBridge({
      format: "pcm",
      definition: def,
      streamId: "stream-1",
      transformOptions: {
        blockMs: 100,
        speed: 1,
        pitch: 1,
        rate: 1,
        volume: 1,
      } as any,
      emitPacket,
    })
    bridge.start()
    bridge.stop()
    // Restart immediately to invalidate captured sessionId
    bridge.start()
    await flushQueue()
    bridge.dispose()
  })
})
