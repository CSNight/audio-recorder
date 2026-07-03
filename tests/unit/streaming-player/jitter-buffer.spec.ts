import { describe, expect, it } from "vitest"
import { JitterBuffer } from "../../../src/plugins/streaming-player/jitter-buffer"
import type { StreamingPacketPayload } from "../../../src/plugins/streaming-export"

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

describe("JitterBuffer", () => {
  // ── 基础积累行为 ─────────────────────────────────────────────────────────

  it("未达到 targetLatencyMs 时 drain 不释放", () => {
    const buf = new JitterBuffer(300)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0, 20))
    buf.push(makePacket(1, 20))
    buf.drain()

    expect(released).toEqual([])
  })

  it("达到 targetLatencyMs 后 drain 开始释放", () => {
    const buf = new JitterBuffer(60)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0, 20))
    buf.push(makePacket(1, 20))
    buf.push(makePacket(2, 20))
    buf.drain()

    expect(released.length).toBeGreaterThan(0)
  })

  it("targetLatencyMs=0 时第一个包入队即开始释放", () => {
    const buf = new JitterBuffer(0)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0, 20))
    buf.drain()

    expect(released).toEqual([0])
  })

  // ── releaseWindowMs 限速 ──────────────────────────────────────────────────

  it("drain 每次最多释放 releaseWindowMs 毫秒", () => {
    const buf = new JitterBuffer(0)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    for (let i = 0; i < 10; i++) buf.push(makePacket(i, 20))
    buf.drain(60) // 最多 60ms = 3 个 20ms 包

    expect(released.length).toBeLessThanOrEqual(3)
  })

  it("多次 drain 逐步释放所有包", () => {
    const buf = new JitterBuffer(0)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    for (let i = 0; i < 10; i++) buf.push(makePacket(i, 20))
    for (let i = 0; i < 5; i++) buf.drain(60)

    expect(released).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  // ── getBufferedMs ─────────────────────────────────────────────────────────

  it("getBufferedMs 返回正确的缓冲毫秒数", () => {
    const buf = new JitterBuffer(300)

    buf.push(makePacket(0, 20))
    buf.push(makePacket(1, 30))
    expect(buf.getBufferedMs()).toBe(50)
  })

  it("drain 释放包后 getBufferedMs 减少", () => {
    const buf = new JitterBuffer(60)
    buf.onRelease = () => {}

    buf.push(makePacket(0, 20))
    buf.push(makePacket(1, 20))
    buf.push(makePacket(2, 20))
    const before = buf.getBufferedMs() // 60ms

    buf.drain(40) // 最多 40ms = 2 个包
    expect(buf.getBufferedMs()).toBeLessThan(before)
  })

  it("getBufferedMs 不低于 0", () => {
    const buf = new JitterBuffer(0)
    buf.onRelease = () => {}

    buf.push(makePacket(0, 20))
    buf.drain(1000) // 远超实际缓冲量
    expect(buf.getBufferedMs()).toBeGreaterThanOrEqual(0)
  })

  // ── dropOld ───────────────────────────────────────────────────────────────

  it("dropOld 丢弃最旧的包并返回丢弃数", () => {
    const buf = new JitterBuffer(300)

    for (let i = 0; i < 5; i++) buf.push(makePacket(i, 20)) // 100ms
    const dropped = buf.dropOld(40) // 丢弃 40ms = 2 个包

    expect(dropped).toBe(2)
    expect(buf.getBufferedMs()).toBe(60)
  })

  it("dropOld 不超过实际缓冲量（队列耗尽即停）", () => {
    const buf = new JitterBuffer(300)

    buf.push(makePacket(0, 20))
    const dropped = buf.dropOld(1000)

    expect(dropped).toBe(1)
    expect(buf.getBufferedMs()).toBe(0)
  })

  it("dropOld 后 getBufferedMs 同步更新", () => {
    const buf = new JitterBuffer(300)

    for (let i = 0; i < 5; i++) buf.push(makePacket(i, 20))
    buf.dropOld(60) // 丢 3 个
    expect(buf.getBufferedMs()).toBe(40)
  })

  // ── started 状态流转 ──────────────────────────────────────────────────────

  it("队列清空后 started 重置，再推包需重新积累延迟", () => {
    const buf = new JitterBuffer(60)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    for (let i = 0; i < 3; i++) buf.push(makePacket(i, 20))
    buf.drain()
    buf.drain()
    buf.drain()
    expect(released).toEqual([0, 1, 2])

    released.length = 0

    buf.push(makePacket(10, 20))
    buf.drain()
    expect(released).toEqual([]) // 未达到 targetLatencyMs，不释放
  })

  // ── 启动行为 ───────────────────────────────────────────────────────────────

  it("积压超出 targetLatencyMs 时，首次 drain 保留积压并按 releaseWindowMs 释放", () => {
    const buf = new JitterBuffer(60) // 目标 60ms
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    // 推入 200ms，首次启动后不应把安全余量直接丢掉。
    for (let i = 0; i < 10; i++) buf.push(makePacket(i, 20))

    buf.drain(60)
    expect(released).toEqual([0, 1, 2])
    expect(buf.getBufferedMs()).toBe(140)
  })

  it("积压等于 targetLatencyMs 时，首次 drain 不 drop-old", () => {
    const buf = new JitterBuffer(60)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    buf.push(makePacket(0, 20))
    buf.push(makePacket(1, 20))
    buf.push(makePacket(2, 20)) // 恰好 60ms

    buf.drain(60)
    expect(released).toEqual([0, 1, 2])
  })

  // ── reset ─────────────────────────────────────────────────────────────────

  it("reset 后 getBufferedMs 为 0", () => {
    const buf = new JitterBuffer(60)

    for (let i = 0; i < 5; i++) buf.push(makePacket(i, 20))
    buf.reset()
    expect(buf.getBufferedMs()).toBe(0)
  })

  it("reset 后重新积累才能释放", () => {
    const buf = new JitterBuffer(60)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    for (let i = 0; i < 5; i++) buf.push(makePacket(i, 20))
    buf.drain()
    buf.reset()
    released.length = 0

    buf.push(makePacket(10, 20))
    buf.drain()
    expect(released).toEqual([]) // reset 后 started=false，需重新积累
  })

  // ── 无 onRelease 不崩溃 ───────────────────────────────────────────────────

  it("没有 onRelease 时 drain 不崩溃", () => {
    const buf = new JitterBuffer(0)
    buf.push(makePacket(0, 20))
    expect(() => buf.drain()).not.toThrow()
  })

  it("没有 onRelease 时 dropOld 不崩溃", () => {
    const buf = new JitterBuffer(300)
    buf.push(makePacket(0, 20))
    expect(() => buf.dropOld(20)).not.toThrow()
  })
})
