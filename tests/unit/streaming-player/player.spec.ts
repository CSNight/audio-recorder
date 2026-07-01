import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"
import type { AudioDecoderDefinition } from "@/plugins/streaming-player/types"

// ─── AudioContext Mock ────────────────────────────────────────────────────────

function makeAudioContextMock() {
  let _state: AudioContextState = "running"
  let _currentTime = 0

  const sources: ReturnType<typeof makeSourceNode>[] = []

  function makeSourceNode() {
    return {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }

  function makeGainNode() {
    return {
      gain: { value: 1.0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }

  function makeAudioBuffer(
    channels: number,
    frames: number,
    sampleRate: number
  ): AudioBuffer {
    const channelData = Array.from(
      { length: channels },
      () => new Float32Array(frames)
    )
    return {
      numberOfChannels: channels,
      length: frames,
      sampleRate,
      duration: frames / sampleRate,
      getChannelData: (c: number) => channelData[c]!,
      copyToChannel: vi.fn(),
      copyFromChannel: vi.fn(),
    } as unknown as AudioBuffer
  }

  const ctx = {
    get state() {
      return _state
    },
    get currentTime() {
      return _currentTime
    },
    set currentTime(v: number) {
      _currentTime = v
    },
    destination: {},
    createGain: vi.fn(() => makeGainNode()),
    createBuffer: vi.fn(
      (channels: number, frames: number, sampleRate: number) =>
        makeAudioBuffer(channels, frames, sampleRate)
    ),
    createBufferSource: vi.fn(() => {
      const src = makeSourceNode()
      sources.push(src)
      return src
    }),
    resume: vi.fn(async () => {
      _state = "running"
    }),
    suspend: vi.fn(async () => {
      _state = "suspended"
    }),
    close: vi.fn(async () => {
      _state = "closed"
    }),
    setState(s: AudioContextState) {
      _state = s
    },
    sources,
  }

  return ctx
}

type AudioContextMock = ReturnType<typeof makeAudioContextMock>

// ─── Packet / Decoder helpers ─────────────────────────────────────────────────

function makePacket(
  seq: number,
  durationMs = 20,
  extra?: Partial<StreamingPacketPayload>
): StreamingPacketPayload {
  return {
    seq,
    streamId: "test",
    sessionId: "session",
    timestampMs: seq * durationMs,
    durationMs,
    sampleRate: 16000,
    channels: 1,
    format: "pcm",
    chunk: new Uint8Array(320),
    isFinal: false,
    ...extra,
  }
}

function makePcmDecoder(): AudioDecoderDefinition {
  return {
    format: "pcm",
    decode: vi.fn(async ({ sampleRate, channels, chunk }) => ({
      planar: [new Float32Array(chunk.length / 2)],
      sampleRate,
      channels,
    })),
  }
}

// ─── createStreamingPlayer import (dynamic to allow mock injection) ───────────

async function buildPlayer(
  ctx: AudioContextMock,
  overrides: Record<string, unknown> = {}
) {
  const { createStreamingPlayer } =
    await import("@/plugins/streaming-player/player")
  return createStreamingPlayer({
    decoders: [makePcmDecoder()],
    targetLatencyMs: 60, // small so tests don't need many packets
    maxBufferMs: 3000,
    autoPlay: false, // manual start unless overridden
    audioContext: ctx as unknown as AudioContext,
    ...overrides,
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createStreamingPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── initial state ──────────────────────────────────────────────────────────

  it("autoPlay=false 时初始状态为 idle", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, { autoPlay: false })
    expect(handle.state).toBe("idle")
  })

  it("autoPlay=true 时初始状态为 buffering", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, { autoPlay: true })
    expect(handle.state).toBe("buffering")
    await handle.destroy()
  })

  // ── start ──────────────────────────────────────────────────────────────────

  it("start() 后状态变为 buffering", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)
    await handle.start()
    expect(handle.state).toBe("buffering")
    await handle.destroy()
  })

  it("start() 若 AudioContext 已 suspended 则 resume", async () => {
    const ctx = makeAudioContextMock()
    ctx.setState("suspended")
    const handle = await buildPlayer(ctx)
    await handle.start()
    expect(ctx.resume).toHaveBeenCalled()
    await handle.destroy()
  })

  // ── push + bufferedMs ──────────────────────────────────────────────────────

  it("push 后 bufferedMs 增加", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)
    handle.push(makePacket(0, 20))
    handle.push(makePacket(1, 20))
    expect(handle.bufferedMs).toBe(40)
    await handle.destroy()
  })

  it("destroy 后 push 无效", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)
    await handle.destroy()
    handle.push(makePacket(0, 20))
    expect(handle.bufferedMs).toBe(0)
  })

  // ── drain → playing state ──────────────────────────────────────────────────

  it("积累足够数据后 drain 触发 playing 状态", async () => {
    const ctx = makeAudioContextMock()
    const states: string[] = []
    const handle = await buildPlayer(ctx, {
      targetLatencyMs: 60,
      onStateChange: (s: string) => states.push(s),
      autoPlay: true,
    })

    // push 3×20ms = 60ms → meets targetLatencyMs
    handle.push(makePacket(0, 20))
    handle.push(makePacket(1, 20))
    handle.push(makePacket(2, 20))

    // advance drain interval (20ms tick × 4)
    await vi.advanceTimersByTimeAsync(80)

    expect(states).toContain("playing")
    await handle.destroy()
  })

  // ── onStateChange ──────────────────────────────────────────────────────────

  it("onStateChange 可以在创建后通过属性赋值替换", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)

    const states: string[] = []
    handle.onStateChange = (s) => states.push(s)

    await handle.start()
    expect(states).toContain("buffering")
    await handle.destroy()
  })

  it("onStateChange 赋 null 后不崩溃", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)
    handle.onStateChange = null
    expect(() => handle.start()).not.toThrow()
    await handle.destroy()
  })

  // ── pause / resume ─────────────────────────────────────────────────────────

  it("pause() 状态变 paused，drain 停止", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, { autoPlay: true })
    await handle.start()
    handle.pause()
    expect(handle.state).toBe("paused")
    expect(ctx.suspend).toHaveBeenCalled()
    await handle.destroy()
  })

  it("resume() 后状态变回 buffering", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, { autoPlay: true })
    await handle.start()
    handle.pause()
    handle.resume()
    expect(handle.state).toBe("buffering")
    expect(ctx.resume).toHaveBeenCalled()
    await handle.destroy()
  })

  it("重复 pause() 不影响状态", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, { autoPlay: true })
    await handle.start()
    handle.pause()
    handle.pause()
    expect(handle.state).toBe("paused")
    await handle.destroy()
  })

  it("未 pause 时调用 resume() 无效", async () => {
    const ctx = makeAudioContextMock()
    const states: string[] = []
    const handle = await buildPlayer(ctx, {
      onStateChange: (s: string) => states.push(s),
    })
    await handle.start()
    const lenBefore = states.length
    handle.resume()
    expect(states.length).toBe(lenBefore) // no extra state change
    await handle.destroy()
  })

  // ── setVolume ──────────────────────────────────────────────────────────────

  it("setVolume 夹在 [0, 1] 内", async () => {
    const ctx = makeAudioContextMock()
    const gainNode = ctx.createGain()
    ctx.createGain.mockReturnValue(gainNode)

    const handle = await buildPlayer(ctx)
    handle.setVolume(2.0)
    expect(gainNode.gain.value).toBe(1.0)
    handle.setVolume(-0.5)
    expect(gainNode.gain.value).toBe(0.0)
    handle.setVolume(0.5)
    expect(gainNode.gain.value).toBe(0.5)
    await handle.destroy()
  })

  // ── replay ─────────────────────────────────────────────────────────────────

  it("replay 在无数据时无效不崩溃", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)
    expect(() => handle.replay(5)).not.toThrow()
    await handle.destroy()
  })

  it("replay 重新入队 recent 的包并重置 bufferedMs", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, { autoPlay: true })
    await handle.start()

    for (let i = 0; i < 5; i++) handle.push(makePacket(i, 20))
    const before = handle.bufferedMs

    handle.replay(0.1) // 100ms → 5 packets × 20ms
    // replay resets pipeline then re-pushes packets
    expect(handle.bufferedMs).toBeGreaterThan(0)
    expect(handle.bufferedMs).toBeLessThanOrEqual(before)
    await handle.destroy()
  })

  // ── backlog policy ─────────────────────────────────────────────────────────

  it("drop-old 策略：超过 maxBufferMs 时调用 onPacketDrop", async () => {
    const ctx = makeAudioContextMock()
    const drops: { count: number; reason: string }[] = []
    const handle = await buildPlayer(ctx, {
      maxBufferMs: 60,
      backlogPolicy: "drop-old",
      onPacketDrop: (d: { count: number; reason: string }) => drops.push(d),
    })

    // push 10x20ms=200ms, after 3 packets bufferedMs=60 (>=maxBufferMs), 4th triggers drop-old
    for (let i = 0; i < 10; i++) handle.push(makePacket(i, 20))

    expect(drops.length).toBeGreaterThan(0)
    expect(drops[0]!.reason).toBe("backlog-drop-old")
    await handle.destroy()
  })

  it("wait-drop 策略：超过 maxBufferMs 时直接丢新包", async () => {
    const ctx = makeAudioContextMock()
    const drops: { count: number; reason: string }[] = []
    const handle = await buildPlayer(ctx, {
      maxBufferMs: 60,
      backlogPolicy: "wait-drop",
      onPacketDrop: (d: { count: number; reason: string }) => drops.push(d),
    })

    for (let i = 0; i < 10; i++) handle.push(makePacket(i, 20))

    expect(drops.some((d) => d.reason === "backlog-wait-drop")).toBe(true)
    await handle.destroy()
  })

  // ── discontinuity ──────────────────────────────────────────────────────────

  it("discontinuity=true 时 pipeline 重置，bufferedMs 归零", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)

    handle.push(makePacket(0, 20))
    handle.push(makePacket(1, 20))
    expect(handle.bufferedMs).toBe(40)

    handle.push(makePacket(2, 20, { discontinuity: true }))
    // After discontinuity reset, only the new packet's durationMs is counted
    expect(handle.bufferedMs).toBe(20)
    await handle.destroy()
  })

  // ── destroy ────────────────────────────────────────────────────────────────

  it("destroy() 关闭 AudioContext 并设状态为 stopped", async () => {
    const ctx = makeAudioContextMock()
    const states: string[] = []
    const handle = await buildPlayer(ctx, {
      onStateChange: (s: string) => states.push(s),
    })
    await handle.destroy()
    expect(ctx.close).toHaveBeenCalled()
    expect(states).toContain("stopped")
  })

  it("重复 destroy() 无副作用", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx)
    await handle.destroy()
    await expect(handle.destroy()).resolves.toBeUndefined()
    expect(ctx.close).toHaveBeenCalledTimes(1)
  })

  // ── droppedPackets counter ─────────────────────────────────────────────────

  it("droppedPackets 计数在 drop-old 时增加", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, {
      maxBufferMs: 60,
      backlogPolicy: "drop-old",
    })

    for (let i = 0; i < 10; i++) handle.push(makePacket(i, 20))
    expect(handle.droppedPackets).toBeGreaterThan(0)
    await handle.destroy()
  })

  it("droppedPackets 计数在 wait-drop 时增加", async () => {
    const ctx = makeAudioContextMock()
    const handle = await buildPlayer(ctx, {
      maxBufferMs: 60,
      backlogPolicy: "wait-drop",
    })

    for (let i = 0; i < 10; i++) handle.push(makePacket(i, 20))
    expect(handle.droppedPackets).toBeGreaterThan(0)
    await handle.destroy()
  })

  // ── underrun callback ──────────────────────────────────────────────────────

  it("AudioContext currentTime 追上 scheduleTime 时触发 onUnderrun 并切换 buffering", async () => {
    const ctx = makeAudioContextMock()
    const underruns: { bufferedMs: number }[] = []
    const states: string[] = []

    const handle = await buildPlayer(ctx, {
      targetLatencyMs: 0,
      autoPlay: true,
      onUnderrun: (u: { bufferedMs: number }) => underruns.push(u),
      onStateChange: (s: string) => states.push(s),
    })

    // Push one packet so it gets decoded and scheduleTime is set
    handle.push(makePacket(0, 20))

    // Advance drain loop so packet is processed
    await vi.advanceTimersByTimeAsync(40)

    // Now simulate time advancing past scheduleTime so next decode sees underrun
    ctx.currentTime = 999

    handle.push(makePacket(1, 20))
    await vi.advanceTimersByTimeAsync(40)

    expect(underruns.length).toBeGreaterThanOrEqual(1)
    await handle.destroy()
  })
})
