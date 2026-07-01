import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReorderBuffer } from "@/plugins/streaming-player/reorder-buffer"
import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"

function makePacket(seq: number, durationMs = 20): StreamingPacketPayload {
  return {
    seq,
    streamId: "test",
    sessionId: "session",
    timestampMs: seq * durationMs,
    durationMs,
    sampleRate: 16000,
    channels: 1,
    format: "pcm",
    chunk: new Uint8Array(0),
    isFinal: false,
  }
}

describe("ReorderBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("顺序到达时按序释放", () => {
    const buf = new ReorderBuffer()
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0))
    buf.push(makePacket(1))
    buf.push(makePacket(2))
    buf.drain()

    expect(released).toEqual([0, 1, 2])
  })

  it("乱序到达时等待补齐后按序释放", () => {
    const buf = new ReorderBuffer()
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    // 先推 seq=0 让 nextSeq 初始化为 0，再推乱序包
    buf.push(makePacket(0))
    buf.push(makePacket(2))
    buf.push(makePacket(1))
    buf.drain()

    expect(released).toEqual([0, 1, 2])
  })

  it("缺包时 drain 阻塞，等超时后强制释放", () => {
    const buf = new ReorderBuffer(200)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0))
    buf.push(makePacket(2)) // seq=1 缺失
    buf.drain()

    expect(released).toEqual([0]) // 只释放 seq=0，seq=2 等待

    vi.advanceTimersByTime(200)

    expect(released).toEqual([0, 2]) // 超时强制释放 seq=2
  })

  it("timer 不因持续 push 而重置（避免永久阻塞）", () => {
    const buf = new ReorderBuffer(200)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0))
    buf.push(makePacket(2))
    buf.drain()
    expect(released).toEqual([0])

    // 100ms 后再推一个包，timer 不应该重置
    vi.advanceTimersByTime(100)
    buf.push(makePacket(4))
    buf.drain()

    // 再过 100ms（总共 200ms），应该触发超时
    vi.advanceTimersByTime(100)
    expect(released).toEqual([0, 2, 4])
  })

  it("reset 后重新从新 seq 开始", () => {
    const buf = new ReorderBuffer()
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0))
    buf.push(makePacket(1))
    buf.drain()
    expect(released).toEqual([0, 1])

    buf.reset()
    released.length = 0

    buf.push(makePacket(100))
    buf.push(makePacket(101))
    buf.drain()
    expect(released).toEqual([100, 101])
  })

  it("reset 清除 pending timer", () => {
    const buf = new ReorderBuffer(200)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0))
    buf.push(makePacket(2))
    buf.drain()

    buf.reset()
    vi.advanceTimersByTime(300)

    // reset 后 timer 已清，不应该触发任何 release
    expect(released).toEqual([0])
  })

  it("多次 drain 调用不重复释放", () => {
    const buf = new ReorderBuffer()
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0))
    buf.push(makePacket(1))
    buf.drain()
    buf.drain()
    buf.drain()

    expect(released).toEqual([0, 1])
  })

  it("没有 onRelease 时不崩溃", () => {
    const buf = new ReorderBuffer()
    buf.push(makePacket(0))
    buf.push(makePacket(1))
    expect(() => buf.drain()).not.toThrow()
  })

  it("单包直接释放", () => {
    const buf = new ReorderBuffer()
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(5))
    buf.drain()

    expect(released).toEqual([5])
  })

  it("大量乱序包正确重排", () => {
    const buf = new ReorderBuffer()
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    // 先推 seq=0 以初始化 nextSeq=0，再推乱序其余包
    const seqs = [0, 4, 1, 3, 2, 7, 5, 6, 9, 8]
    for (const s of seqs) buf.push(makePacket(s))
    buf.drain()

    expect(released).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
