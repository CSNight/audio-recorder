import { describe, expect, it } from "vitest"
import { JitterBuffer } from "@/plugins/streaming-player/jitter-buffer"
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

describe("JitterBuffer", () => {
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

  it("drain 每次最多释放 releaseWindowMs 毫秒", () => {
    const buf = new JitterBuffer(0) // targetLatencyMs=0 立即开始
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    // 推入 200ms 的数据
    for (let i = 0; i < 10; i++) buf.push(makePacket(i, 20))

    // 默认 releaseWindowMs=60ms，最多释放 3 个 20ms 包
    buf.drain(60)

    expect(released.length).toBeLessThanOrEqual(3)
  })

  it("多次 drain 逐步释放所有包", () => {
    const buf = new JitterBuffer(0)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    for (let i = 0; i < 10; i++) buf.push(makePacket(i, 20))

    // 每次 drain 最多 60ms，需要多次才能全部释放
    for (let i = 0; i < 5; i++) buf.drain(60)

    expect(released).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("getBufferedMs 返回正确的缓冲毫秒数", () => {
    const buf = new JitterBuffer(300)

    buf.push(makePacket(0, 20))
    buf.push(makePacket(1, 30))
    expect(buf.getBufferedMs()).toBe(50)

    buf.onRelease = () => {}
    // 使 started=true 以便 drain 释放
    buf.push(makePacket(2, 250)) // 总共 300ms，触发开始
    buf.drain(60)

    expect(buf.getBufferedMs()).toBeLessThan(300)
  })

  it("reset 后重新从零开始", () => {
    const buf = new JitterBuffer(60)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    for (let i = 0; i < 5; i++) buf.push(makePacket(i, 20))
    buf.drain()

    buf.reset()
    expect(buf.getBufferedMs()).toBe(0)

    released.length = 0
    buf.push(makePacket(10, 20))
    buf.drain()
    expect(released).toEqual([]) // reset 后未达到 targetLatencyMs
  })

  it("dropOld 丢弃最旧的包", () => {
    const buf = new JitterBuffer(300)

    for (let i = 0; i < 5; i++) buf.push(makePacket(i, 20)) // 100ms
    const dropped = buf.dropOld(40)

    expect(dropped).toBe(2)
    expect(buf.getBufferedMs()).toBe(60)
  })

  it("dropOld 不超过实际缓冲量", () => {
    const buf = new JitterBuffer(300)

    buf.push(makePacket(0, 20))
    const dropped = buf.dropOld(1000)

    expect(dropped).toBe(1)
    expect(buf.getBufferedMs()).toBe(0)
  })

  it("队列清空后 started 重置，需要重新积累延迟", () => {
    const buf = new JitterBuffer(60)
    const released: number[] = []
    buf.onRelease = (p) => released.push(p.seq)

    // 先积累并释放所有包
    for (let i = 0; i < 3; i++) buf.push(makePacket(i, 20))
    buf.drain()
    buf.drain()
    buf.drain()
    expect(released).toEqual([0, 1, 2])

    released.length = 0

    // 再推新包，需要重新积累
    buf.push(makePacket(10, 20))
    buf.drain()
    expect(released).toEqual([]) // 未达到 targetLatencyMs
  })

  it("没有 onRelease 时不崩溃", () => {
    const buf = new JitterBuffer(0)
    buf.push(makePacket(0, 20))
    expect(() => buf.drain()).not.toThrow()
  })
})
