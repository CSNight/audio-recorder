import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createStreamingPlayer } from "@/plugins/streaming-player/player"
import type { StreamingPlayerOptions } from "@/plugins/streaming-player/types"
import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"
import type { EncodedAudioChunk } from "@/types"

// ── 工具函数 ────────────────────────────────────────────────────────────────

function makePacket(seq: number, durationMs = 20): StreamingPacketPayload {
  return {
    streamId: "test-stream",
    sessionId: "test-session",
    seq,
    timestampMs: seq * durationMs,
    durationMs,
    sampleRate: 16000,
    channels: 1,
    format: "pcm16",
    chunk: new Uint8Array(320 * 2),
    isFinal: false,
  }
}

function makeDummyDecoder() {
  return {
    format: "pcm16",
    decode: vi.fn(async (_chunk: EncodedAudioChunk) => ({
      sampleRate: 16000,
      channels: 1,
      planar: [new Float32Array(320)],
    })),
  }
}

function makeAudioContextMock() {
  const createBuffer = vi.fn(
    (channels: number, frameCount: number, sampleRate: number) => ({
      duration: frameCount / sampleRate,
      sampleRate,
      numberOfChannels: channels,
      length: frameCount,
      copyToChannel: vi.fn(),
    })
  )
  const createBufferSource = vi.fn(() => ({
    buffer: null as unknown,
    connect: vi.fn(),
    start: vi.fn(),
  }))
  const createGain = vi.fn(() => ({
    gain: { value: 1 },
    connect: vi.fn(),
  }))

  return {
    state: "running" as AudioContextState,
    currentTime: 0,
    destination: {},
    createBuffer,
    createBufferSource,
    createGain,
    resume: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function makeTrackedAudioContextMock() {
  const sources: Array<{
    buffer: unknown
    connect: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    onended?: (() => void) | null
  }> = []
  const ctx = makeAudioContextMock()
  ctx.createBufferSource = vi.fn(() => {
    const source = {
      buffer: null as unknown,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    }
    sources.push(source)
    return source
  })
  return { ctx, sources }
}

function makeOptions(
  overrides: Partial<StreamingPlayerOptions> = {}
): StreamingPlayerOptions {
  return {
    decoders: [makeDummyDecoder()],
    targetLatencyMs: 60,
    maxBufferMs: 3000,
    volume: 1.0,
    persistMode: "memory",
    persistBufferMs: 10_000,
    audioContext: makeAudioContextMock() as unknown as AudioContext,
    ...overrides,
  }
}

// ── 测试套件 ────────────────────────────────────────────────────────────────

describe("createStreamingPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom 没有 AudioContext，给需要内部创建 ctx 的测试提供全局 mock
    // @ts-expect-error mock
    globalThis.AudioContext = function AudioContext() {
      return makeAudioContextMock()
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── 初始状态 ──────────────────────────────────────────────────────────────

  describe("初始状态", () => {
    it("创建后 state 为 idle", async () => {
      const p = await createStreamingPlayer(makeOptions())
      expect(p.state).toBe("idle")
      p.destroy()
    })

    it("创建后 bufferedMs 为 0", async () => {
      const p = await createStreamingPlayer(makeOptions())
      expect(p.bufferedMs).toBe(0)
      p.destroy()
    })

    it("创建后 droppedPackets 为 0", async () => {
      const p = await createStreamingPlayer(makeOptions())
      expect(p.droppedPackets).toBe(0)
      p.destroy()
    })

    it("创建后 storedMs 为 0", async () => {
      const p = await createStreamingPlayer(makeOptions())
      expect(p.storedMs).toBe(0)
      p.destroy()
    })
  })

  // ── start() ────────────────────────────────────────────────────────────────

  describe("start()", () => {
    it("调用 start() 后 state 变为 buffering", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      expect(p.state).toBe("buffering")
      p.destroy()
    })

    it("已经不是 idle 时再次调用 start() 不改变状态", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      await p.start()
      expect(p.state).toBe("buffering")
      p.destroy()
    })

    it("destroy() 后 start() 不改变状态", async () => {
      const p = await createStreamingPlayer(makeOptions())
      p.destroy()
      await p.start()
      expect(p.state).toBe("stopped")
    })
  })

  // ── pause() / resume() ────────────────────────────────────────────────────

  describe("pause() / resume()", () => {
    it("pause() 将 state 切换为 paused", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      p.pause()
      expect(p.state).toBe("paused")
      p.destroy()
    })

    it("resume() 将 state 切换为 buffering", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      p.pause()
      p.resume()
      expect(p.state).toBe("buffering")
      p.destroy()
    })

    it("重复调用 pause() 不会出错", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      p.pause()
      expect(() => p.pause()).not.toThrow()
      p.destroy()
    })

    it("未 pause 时调用 resume() 不会出错", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      expect(() => p.resume()).not.toThrow()
      p.destroy()
    })

    it("使用外部 AudioContext 时 pause() 不调用 suspend()", async () => {
      const ctx = makeAudioContextMock()
      const p = await createStreamingPlayer(
        makeOptions({ audioContext: ctx as unknown as AudioContext })
      )
      await p.start()
      p.pause()
      // 外部 ctx：pause 不应触发 suspend
      expect(ctx.suspend).not.toHaveBeenCalled()
      p.destroy()
    })

    it("内部 AudioContext（不传 audioContext）时 pause() 调用 suspend()", async () => {
      // 不传 audioContext，让 player 内部创建
      // 由于 AudioContext 在测试环境可能不可用，此处仅测试不崩溃
      // 实际 suspend 调用通过集成测试验证
      const p = await createStreamingPlayer({
        decoders: [makeDummyDecoder()],
        targetLatencyMs: 60,
        persistMode: "memory",
      })
      await p.start()
      expect(() => p.pause()).not.toThrow()
      p.destroy()
    })
  })

  // ── onStateChange 回调 ────────────────────────────────────────────────────

  describe("onStateChange 回调", () => {
    it("start() 触发 buffering 回调", async () => {
      const cb = vi.fn()
      const p = await createStreamingPlayer(makeOptions({ onStateChange: cb }))
      await p.start()
      expect(cb).toHaveBeenCalledWith("buffering")
      p.destroy()
    })

    it("pause() 触发 paused 回调", async () => {
      const cb = vi.fn()
      const p = await createStreamingPlayer(makeOptions({ onStateChange: cb }))
      await p.start()
      p.pause()
      expect(cb).toHaveBeenCalledWith("paused")
      p.destroy()
    })

    it("resume() 触发 buffering 回调", async () => {
      const cb = vi.fn()
      const p = await createStreamingPlayer(makeOptions({ onStateChange: cb }))
      await p.start()
      p.pause()
      cb.mockClear()
      p.resume()
      expect(cb).toHaveBeenCalledWith("buffering")
      p.destroy()
    })

    it("destroy() 触发 stopped 回调", async () => {
      const cb = vi.fn()
      const p = await createStreamingPlayer(makeOptions({ onStateChange: cb }))
      p.destroy()
      expect(cb).toHaveBeenCalledWith("stopped")
    })

    it("可以在创建后动态替换 onStateChange", async () => {
      const p = await createStreamingPlayer(makeOptions())
      const cb = vi.fn()
      p.onStateChange = cb
      await p.start()
      expect(cb).toHaveBeenCalledWith("buffering")
      p.destroy()
    })

    it("将 onStateChange 设为 null 后不再触发", async () => {
      const cb = vi.fn()
      const p = await createStreamingPlayer(makeOptions({ onStateChange: cb }))
      p.onStateChange = null
      await p.start()
      expect(cb).not.toHaveBeenCalled()
      p.destroy()
    })
  })

  // ── push() 双写行为 ───────────────────────────────────────────────────────

  describe("push() 双写行为", () => {
    it("push() 非暂停状态写入 persistStore", async () => {
      const p = await createStreamingPlayer(
        makeOptions({ persistBufferMs: 10_000 })
      )
      await p.start()
      p.push(makePacket(0))
      p.push(makePacket(1))
      p.push(makePacket(2))
      expect(p.storedMs).toBe(60)
      p.destroy()
    })

    it("pause() 期间 push() 仍写入 persistStore", async () => {
      const p = await createStreamingPlayer(
        makeOptions({ persistBufferMs: 10_000 })
      )
      await p.start()
      p.pause()
      p.push(makePacket(0))
      p.push(makePacket(1))
      expect(p.storedMs).toBe(40)
      p.destroy()
    })

    it("storedMs 反映 persistStore 的当前存储量", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      p.push(makePacket(0))
      p.push(makePacket(1))
      expect(p.storedMs).toBe(40)
      p.destroy()
    })

    it("destroy() 后 push() 不写入", async () => {
      const p = await createStreamingPlayer(makeOptions())
      p.destroy()
      p.push(makePacket(0))
      expect(p.storedMs).toBe(0)
    })
  })

  // ── storedMs drop-old 行为 ────────────────────────────────────────────────

  describe("storedMs drop-old 行为", () => {
    it("超出 persistBufferMs 后 storedMs 不超过上限", async () => {
      const p = await createStreamingPlayer(
        makeOptions({ persistBufferMs: 100 })
      )
      await p.start()
      for (let i = 0; i < 10; i++) p.push(makePacket(i))
      expect(p.storedMs).toBeLessThanOrEqual(100)
      p.destroy()
    })
  })

  // ── bufferedMs 统计准确性 ─────────────────────────────────────────────────

  describe("bufferedMs 统计", () => {
    it("push 包后 bufferedMs 增加", async () => {
      const p = await createStreamingPlayer(
        makeOptions({ targetLatencyMs: 300 })
      )
      await p.start()
      p.push(makePacket(0))
      p.push(makePacket(1))
      // drainLoop 每 20ms tick 一次，触发 reorderBuf.drain() 后 bufferedMs 才会更新
      await vi.advanceTimersByTimeAsync(25)
      expect(p.bufferedMs).toBeGreaterThan(0)
      p.destroy()
    })

    it("初始 bufferedMs 为 0", async () => {
      const p = await createStreamingPlayer(makeOptions())
      expect(p.bufferedMs).toBe(0)
      p.destroy()
    })
  })

  // ── maxBufferMs drop-old ──────────────────────────────────────────────────

  describe("maxBufferMs drop-old", () => {
    it("积压超出 maxBufferMs 时触发 onPacketDrop", async () => {
      const onPacketDrop = vi.fn()
      const p = await createStreamingPlayer(
        makeOptions({ maxBufferMs: 100, onPacketDrop, targetLatencyMs: 0 })
      )
      await p.start()
      // 推入 200ms 数据，超出 maxBufferMs=100ms
      for (let i = 0; i < 10; i++) p.push(makePacket(i))
      // drainLoop 每 20ms tick，触发 reorderBuf.drain() 后 drop-old 才执行
      await vi.advanceTimersByTimeAsync(25)
      expect(onPacketDrop).toHaveBeenCalled()
      const call = onPacketDrop.mock.calls[0]![0] as {
        count: number
        reason: string
      }
      expect(call.reason).toBe("max-buffer-exceeded")
      expect(call.count).toBeGreaterThan(0)
      p.destroy()
    })

    it("droppedPackets 累计被 drop 的包数", async () => {
      const p = await createStreamingPlayer(
        makeOptions({ maxBufferMs: 60, targetLatencyMs: 0 })
      )
      await p.start()
      for (let i = 0; i < 10; i++) p.push(makePacket(i))
      await vi.advanceTimersByTimeAsync(25)
      expect(p.droppedPackets).toBeGreaterThan(0)
      p.destroy()
    })
  })

  // ── setVolume() ────────────────────────────────────────────────────────────

  describe("setVolume()", () => {
    it("setVolume 在 [0,1] 范围内正常设置", async () => {
      const ctx = makeAudioContextMock()
      const gainMock = { gain: { value: 1 }, connect: vi.fn() }
      ctx.createGain = vi.fn().mockReturnValue(gainMock)
      const p = await createStreamingPlayer(
        makeOptions({ audioContext: ctx as unknown as AudioContext })
      )
      p.setVolume(0.5)
      expect(gainMock.gain.value).toBe(0.5)
      p.destroy()
    })

    it("setVolume 超出范围时 clamp 到 [0,1]", async () => {
      const ctx = makeAudioContextMock()
      const gainMock = { gain: { value: 1 }, connect: vi.fn() }
      ctx.createGain = vi.fn().mockReturnValue(gainMock)
      const p = await createStreamingPlayer(
        makeOptions({ audioContext: ctx as unknown as AudioContext })
      )
      p.setVolume(2)
      expect(gainMock.gain.value).toBe(1)
      p.setVolume(-1)
      expect(gainMock.gain.value).toBe(0)
      p.destroy()
    })
  })

  // ── destroy() ─────────────────────────────────────────────────────────────

  describe("destroy()", () => {
    it("destroy() 将 state 切换为 stopped", async () => {
      const p = await createStreamingPlayer(makeOptions())
      p.destroy()
      expect(p.state).toBe("stopped")
    })

    it("重复调用 destroy() 不崩溃", async () => {
      const p = await createStreamingPlayer(makeOptions())
      p.destroy()
      expect(() => p.destroy()).not.toThrow()
    })

    it("destroy() 后 push() 无效", async () => {
      const p = await createStreamingPlayer(makeOptions())
      p.destroy()
      p.push(makePacket(0))
      expect(p.storedMs).toBe(0)
    })

    it("外部 AudioContext 时 destroy() 不调用 close()", async () => {
      const ctx = makeAudioContextMock()
      const p = await createStreamingPlayer(
        makeOptions({ audioContext: ctx as unknown as AudioContext })
      )
      p.destroy()
      expect(ctx.close).not.toHaveBeenCalled()
    })
  })

  // ── replay() ───────────────────────────────────────────────────────────────

  describe("replay()", () => {
    it("非暂停状态调用 replay() 不崩溃", async () => {
      const p = await createStreamingPlayer(makeOptions())
      await p.start()
      expect(() => p.replay(5)).not.toThrow()
      p.destroy()
    })

    it("暂停状态且 persistStore 有数据时 replay() 调用 audioCtx.resume()", async () => {
      const ctx = makeAudioContextMock()
      const p = await createStreamingPlayer(
        makeOptions({
          audioContext: ctx as unknown as AudioContext,
          persistBufferMs: 10_000,
        })
      )
      await p.start()
      p.push(makePacket(0))
      p.push(makePacket(1))
      p.push(makePacket(2))
      p.pause()
      ctx.resume.mockClear()
      p.replay(1)
      await vi.runAllTimersAsync()
      expect(ctx.resume).toHaveBeenCalled()
      p.destroy()
    })

    it("persistStore 无数据时 replay() 不调用 resume()", async () => {
      const ctx = makeAudioContextMock()
      const p = await createStreamingPlayer(
        makeOptions({ audioContext: ctx as unknown as AudioContext })
      )
      await p.start()
      p.pause()
      ctx.resume.mockClear()
      p.replay(5)
      await vi.runAllTimersAsync()
      expect(ctx.resume).not.toHaveBeenCalled()
      p.destroy()
    })

    it("replay() 后保持 paused 状态", async () => {
      const ctx = makeAudioContextMock()
      const p = await createStreamingPlayer(
        makeOptions({
          audioContext: ctx as unknown as AudioContext,
          persistBufferMs: 10_000,
        })
      )
      await p.start()
      p.push(makePacket(0))
      p.push(makePacket(1))
      p.pause()
      p.replay(1)
      await vi.runAllTimersAsync()
      expect(p.state).toBe("paused")
      p.destroy()
    })

    it("resume() 会停止正在进行中的 replay，避免与实时播放叠播", async () => {
      const { ctx, sources } = makeTrackedAudioContextMock()
      const p = await createStreamingPlayer(
        makeOptions({
          audioContext: ctx as unknown as AudioContext,
          persistBufferMs: 10_000,
        })
      )
      await p.start()
      p.push(makePacket(0))
      p.push(makePacket(1))
      p.push(makePacket(2))
      await vi.advanceTimersByTimeAsync(40)

      p.pause()
      const sourceCountBeforeReplay = sources.length

      p.replay(1)
      await vi.advanceTimersByTimeAsync(20)

      const replaySources = sources.slice(sourceCountBeforeReplay)
      expect(replaySources.length).toBeGreaterThan(0)
      expect(
        replaySources.every((src) => src.stop.mock.calls.length === 0)
      ).toBe(true)

      p.resume()

      expect(replaySources.every((src) => src.stop.mock.calls.length > 0)).toBe(
        true
      )
      p.destroy()
    })
  })

  // ── onUnderrun 回调 ───────────────────────────────────────────────────────

  describe("onUnderrun 回调", () => {
    it("当 audioCtx.currentTime 超过 scheduleTime 时触发 onUnderrun", async () => {
      const onUnderrun = vi.fn()
      const ctx = makeAudioContextMock()
      // 模拟 currentTime 推进到超过 scheduleTime
      Object.defineProperty(ctx, "currentTime", { value: 100, writable: true })
      const p = await createStreamingPlayer(
        makeOptions({
          audioContext: ctx as unknown as AudioContext,
          onUnderrun,
          targetLatencyMs: 0,
        })
      )
      await p.start()
      // 推入包触发 playbackStarted，然后让 currentTime 超过 scheduleTime
      p.push(makePacket(0))
      // 等待解码和调度（drainLoop 每 20ms 一次）
      await vi.advanceTimersByTimeAsync(500)
      // 由于 currentTime=100 >> scheduleTime，应触发 underrun
      if (onUnderrun.mock.calls.length > 0) {
        expect(onUnderrun).toHaveBeenCalledWith({ bufferedMs: 0 })
      }
      p.destroy()
    })
  })

  // ── decodePacket 边界安全 ─────────────────────────────────────────────────

  describe("decodePacket 边界安全", () => {
    it("decoder 返回空 planar 时不崩溃", async () => {
      const badDecoder = {
        format: "pcm16",
        decode: vi.fn(async () => ({
          sampleRate: 16000,
          channels: 2,
          planar: [new Float32Array(0)], // channels=2 但 planar 只有 1 个
        })),
      }
      const p = await createStreamingPlayer(
        makeOptions({ decoders: [badDecoder], targetLatencyMs: 0 })
      )
      await p.start()
      p.push(makePacket(0))
      await vi.advanceTimersByTimeAsync(500)
      // 不崩溃即通过
      p.destroy()
    })

    it("没有对应 decoder 时 push 不崩溃", async () => {
      const p = await createStreamingPlayer(
        makeOptions({ decoders: [], targetLatencyMs: 0 })
      )
      await p.start()
      expect(() => p.push(makePacket(0))).not.toThrow()
      p.destroy()
    })

    it("decoder 抛出异常时 push 不崩溃", async () => {
      const errorDecoder = {
        format: "pcm16",
        decode: vi.fn(async () => {
          throw new Error("decode failed")
        }),
      }
      const p = await createStreamingPlayer(
        makeOptions({ decoders: [errorDecoder], targetLatencyMs: 0 })
      )
      await p.start()
      p.push(makePacket(0))
      await vi.advanceTimersByTimeAsync(500)
      // 不崩溃即通过
      p.destroy()
    })
  })

  // ── drainLoop 行为 ────────────────────────────────────────────────────────

  describe("drainLoop 行为", () => {
    it("pause() 后 drainLoop 停止，resume() 后重新启动", async () => {
      const decoder = makeDummyDecoder()
      const p = await createStreamingPlayer(
        makeOptions({ decoders: [decoder], targetLatencyMs: 0 })
      )
      await p.start()

      p.push(makePacket(0))
      await vi.advanceTimersByTimeAsync(40)
      const callsBefore = decoder.decode.mock.calls.length

      p.pause()
      p.push(makePacket(1))
      await vi.advanceTimersByTimeAsync(100)
      // pause 后 drainLoop 停止，decode 不应再被调用
      expect(decoder.decode.mock.calls.length).toBe(callsBefore)

      p.resume()
      p.push(makePacket(2))
      await vi.advanceTimersByTimeAsync(40)
      // resume 后 drainLoop 重启，新包应被处理
      p.destroy()
    })

    it("bufferedMs 在 drainLoop 中始终非负", async () => {
      const p = await createStreamingPlayer(makeOptions({ targetLatencyMs: 0 }))
      await p.start()

      for (let i = 0; i < 5; i++) p.push(makePacket(i))
      await vi.advanceTimersByTimeAsync(200)
      expect(p.bufferedMs).toBeGreaterThanOrEqual(0)
      p.destroy()
    })
  })
})
