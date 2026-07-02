import { describe, expect, it, vi } from "vitest"
import { PcmFramePipeline } from "@/pipeline/pcm-frame-pipeline"
import { createAudioFrame } from "@/utils/audio-frame"
import type { PcmBufferStore } from "@/buffer/types"

function makeFrame(samples: number[] = [0.5, -0.5], sampleRate = 16000) {
  return createAudioFrame([new Float32Array(samples)], sampleRate, 10)
}

describe("PcmFramePipeline", () => {
  it("使用默认 InMemoryPcmBufferStore，acceptFrame 后 getSnapshot 可取到数据", () => {
    const pipeline = new PcmFramePipeline()
    pipeline.acceptFrame(makeFrame([0.5, -0.5]))
    const snap = pipeline.getSnapshot()
    expect(snap).toBeDefined()
    expect(snap?.channels).toBe(1)
    expect(snap?.frameCount).toBe(1)
  })

  it("多帧 acceptFrame 后 snapshot 包含所有帧", () => {
    const pipeline = new PcmFramePipeline()
    pipeline.acceptFrame(makeFrame([0.25]))
    pipeline.acceptFrame(makeFrame([0.5]))
    pipeline.acceptFrame(makeFrame([-0.25]))
    const snap = pipeline.getSnapshot()
    expect(snap?.frameCount).toBe(3)
  })

  it("reset 后 getSnapshot 返回 undefined/null", () => {
    const pipeline = new PcmFramePipeline()
    pipeline.acceptFrame(makeFrame())
    pipeline.reset()
    const snap = pipeline.getSnapshot()
    expect(snap == null).toBe(true)
  })

  it("reset 后可以重新写入数据", () => {
    const pipeline = new PcmFramePipeline()
    pipeline.acceptFrame(makeFrame([0.9]))
    pipeline.reset()
    pipeline.acceptFrame(makeFrame([0.1]))
    const snap = pipeline.getSnapshot()
    expect(snap?.frameCount).toBe(1)
  })

  it("initialize 透传给底层 store 的 initialize 方法", async () => {
    const mockStore: PcmBufferStore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      appendFrame: vi.fn(),
      snapshot: vi.fn().mockReturnValue(undefined),
      clear: vi.fn(),
    }
    const pipeline = new PcmFramePipeline(mockStore)
    await pipeline.initialize()
    expect(mockStore.initialize).toHaveBeenCalledOnce()
  })

  it("acceptFrame 透传给底层 store 的 appendFrame 方法", () => {
    const mockStore: PcmBufferStore = {
      appendFrame: vi.fn(),
      snapshot: vi.fn().mockReturnValue(undefined),
      clear: vi.fn(),
    }
    const pipeline = new PcmFramePipeline(mockStore)
    const frame = makeFrame()
    pipeline.acceptFrame(frame)
    expect(mockStore.appendFrame).toHaveBeenCalledWith(frame)
  })

  it("getSnapshot 透传给底层 store 的 snapshot 方法", () => {
    const fakeSnap = {
      sampleRate: 16000,
      channels: 1,
      frameCount: 1,
      durationMs: 10,
      planar: [],
    } as any
    const mockStore: PcmBufferStore = {
      appendFrame: vi.fn(),
      snapshot: vi.fn().mockReturnValue(fakeSnap),
      clear: vi.fn(),
    }
    const pipeline = new PcmFramePipeline(mockStore)
    const result = pipeline.getSnapshot()
    expect(result).toBe(fakeSnap)
    expect(mockStore.snapshot).toHaveBeenCalledOnce()
  })

  it("reset 透传给底层 store 的 clear 方法", async () => {
    const mockStore: PcmBufferStore = {
      appendFrame: vi.fn(),
      snapshot: vi.fn().mockReturnValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }
    const pipeline = new PcmFramePipeline(mockStore)
    await pipeline.reset()
    expect(mockStore.clear).toHaveBeenCalledOnce()
  })

  it("store 没有 initialize 方法时 initialize 不抛错", async () => {
    const mockStore: PcmBufferStore = {
      appendFrame: vi.fn(),
      snapshot: vi.fn().mockReturnValue(undefined),
      clear: vi.fn(),
    }
    const pipeline = new PcmFramePipeline(mockStore)
    expect(() => pipeline.initialize()).not.toThrow()
  })

  it("自定义 store 注入后 getSnapshot 返回自定义数据", () => {
    const fakeSnap = {
      sampleRate: 48000,
      channels: 2,
      frameCount: 5,
      durationMs: 50,
      planar: [],
    } as any
    const mockStore: PcmBufferStore = {
      appendFrame: vi.fn(),
      snapshot: vi.fn().mockReturnValue(fakeSnap),
      clear: vi.fn(),
    }
    const pipeline = new PcmFramePipeline(mockStore)
    expect(pipeline.getSnapshot()).toBe(fakeSnap)
  })
})
