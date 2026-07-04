import { describe, expect, it, vi } from "vitest"
import { PluginHost } from "../../src/plugins/plugin-host"
import type { RecorderPlugin } from "../../src/plugins/types"
import { RecorderInputSource } from "../../src"
import { createAudioFrame } from "../../src/utils/audio-frame"

function createHost() {
  const emitIssue = vi.fn()
  const host = new PluginHost({
    recorder: {} as never,
    emitIssue,
    getRuntimeInfo: () => ({
      requestedChannelCount: 1,
      source: RecorderInputSource.Microphone,
    }),
    getLatestSummary: () => ({
      frames: 0,
      durationMs: 0,
      sampleRate: 0,
      channels: 1,
    }),
    createEventContext: () => ({
      controller: {} as never,
      sessionId: "session-test",
      emittedAt: 1,
      runtimeInfo: {
        requestedChannelCount: 1,
        source: RecorderInputSource.Microphone,
      },
      summary: {
        frames: 0,
        durationMs: 0,
        sampleRate: 0,
        channels: 1,
      },
    }),
  })

  return { host, emitIssue }
}

describe("PluginHost", () => {
  it("rethrows setup failures and emits a wrapped issue", async () => {
    const { host, emitIssue } = createHost()
    const cause = new Error("setup failed")
    const plugin: RecorderPlugin = {
      name: "broken-setup",
      setup() {
        throw cause
      },
    }

    await expect(host.use(plugin)).rejects.toThrow(
      'Recorder plugin "broken-setup" failed during setup.'
    )
    expect(emitIssue).toHaveBeenCalledTimes(1)
    const issue = emitIssue.mock.calls[0]?.[0]

    expect(issue?.kind).toBe("error")
    expect(issue?.error.message).toBe(
      'Recorder plugin "broken-setup" failed during setup.'
    )
    expect(issue?.error.cause).toBe(cause)
  })

  it("does not retain a plugin whose setup failed", async () => {
    const { host } = createHost()
    const healthyStart = vi.fn()

    await expect(
      host.use({
        name: "broken-setup",
        setup() {
          throw new Error("setup failed")
        },
        onStart() {
          throw new Error("should never run")
        },
      })
    ).rejects.toThrow('Recorder plugin "broken-setup" failed during setup.')

    await host.use({
      name: "healthy",
      setup() {
        return
      },
      onStart() {
        healthyStart()
      },
    })

    host.onStart()

    expect(healthyStart).toHaveBeenCalledTimes(1)
  })

  it("rejects plugins that conflict with an already registered prefix family", async () => {
    const { host } = createHost()

    await host.use({
      name: "streaming-export:pcm",
      setup() {
        return
      },
    })

    await expect(
      host.use({
        name: "sonic-export:wav",
        exclusiveWith: ["streaming-export"],
        setup() {
          return
        },
      })
    ).rejects.toThrow(
      'Recorder plugin "sonic-export:wav" conflicts with "streaming-export:pcm".'
    )
  })

  it("rejects plugins when an already registered plugin declares the conflict", async () => {
    const { host } = createHost()

    await host.use({
      name: "sonic-export:mp3",
      exclusiveWith: ["streaming-export"],
      setup() {
        return
      },
    })

    await expect(
      host.use({
        name: "streaming-export:wav",
        setup() {
          return
        },
      })
    ).rejects.toThrow(
      'Recorder plugin "streaming-export:wav" conflicts with "sonic-export:mp3".'
    )
  })

  it("injects a plugin eventBus instance into plugin context for plugin-prefixed events", async () => {
    const { host } = createHost()
    const listener = vi.fn()

    host.on("plugin:level", listener)

    await host.use({
      name: "level-plugin",
      setup(context) {
        context.eventBus.register("plugin:level")
        context.eventBus.emit("plugin:level", {
          level: {
            peak: 0.5,
            rms: 0.25,
            channels: [{ peak: 0.5, rms: 0.25 }],
          },
        })
      },
    })

    expect(listener).toHaveBeenCalledWith({
      controller: {} as never,
      sessionId: "session-test",
      emittedAt: 1,
      pluginName: "level-plugin",
      runtimeInfo: {
        requestedChannelCount: 1,
        source: RecorderInputSource.Microphone,
      },
      summary: {
        frames: 0,
        durationMs: 0,
        sampleRate: 0,
        channels: 1,
      },
      payload: {
        level: {
          peak: 0.5,
          rms: 0.25,
          channels: [{ peak: 0.5, rms: 0.25 }],
        },
      },
    })
  })

  it("rejects reserved core event names during registration", async () => {
    const { host } = createHost()

    await expect(
      host.use({
        name: "reserved-event-plugin",
        setup(context) {
          context.eventBus.register("frame")
        },
      })
    ).rejects.toThrow(
      'Recorder plugin "reserved-event-plugin" failed during setup.'
    )
  })

  it("emits wrapped issues when runtime hooks throw and continues other plugins", async () => {
    const { host, emitIssue } = createHost()
    const calls: string[] = []
    const frame = createAudioFrame(
      [new Float32Array([0, 0.25, -0.25])],
      16_000,
      10
    )

    await host.use({
      name: "broken-frame",
      setup() {
        return
      },
      onFrame() {
        calls.push("broken")
        throw new Error("frame failed")
      },
    })
    await host.use({
      name: "healthy-frame",
      setup() {
        return
      },
      onFrame() {
        calls.push("healthy")
      },
    })

    host.onFrame(frame)

    expect(calls).toEqual(["broken", "healthy"])
    expect(emitIssue).toHaveBeenCalledTimes(1)
    const issue = emitIssue.mock.calls[0]?.[0]

    expect(issue?.error.message).toBe(
      'Recorder plugin "broken-frame" failed during onFrame.'
    )
  })

  it("processes onBeforeFrame in registration order and falls back to the pre-plugin frame on failure", async () => {
    const { host, emitIssue } = createHost()
    const frame = createAudioFrame(
      [new Float32Array([0.25, -0.25])],
      16_000,
      10
    )

    await host.use({
      name: "double",
      setup() {
        return
      },
      onBeforeFrame(input) {
        const channel = input.planar[0]
        if (!channel) {
          return
        }
        channel[0] = (channel[0] ?? 0) * 2
      },
    })
    await host.use({
      name: "broken-transform",
      setup() {
        return
      },
      onBeforeFrame(input) {
        const channel = input.planar[0]
        if (!channel) {
          throw new Error("missing channel")
        }
        channel[1] = 777
        throw new Error("transform failed")
      },
    })
    await host.use({
      name: "offset",
      setup() {
        return
      },
      onBeforeFrame(input) {
        const channel = input.planar[0]
        if (!channel) {
          return
        }
        channel[1] = (channel[1] ?? 0) + 100
      },
    })

    const processed = host.processBeforeFrame(frame)

    expect(Array.from(processed.planar[0] ?? [])).toEqual([16384, -8092])
    expect(Array.from(frame.planar[0] ?? [])).toEqual([8192, -8192])
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "error",
      error: expect.objectContaining({
        message:
          'Recorder plugin "broken-transform" failed during onBeforeFrame.',
      }),
    })
  })

  it("pipes earlier onFlush tail frames through later onBeforeFrame hooks", async () => {
    const { host } = createHost()
    let emitted = false

    await host.use({
      name: "tail-producer",
      setup() {
        return
      },
      onFlush() {
        if (emitted) {
          return
        }
        emitted = true
        return [createAudioFrame([new Float32Array([0.25, -0.25])], 16_000, 20)]
      },
    })
    await host.use({
      name: "tail-transformer",
      setup() {
        return
      },
      onBeforeFrame(input) {
        const channel = input.planar[0]
        if (!channel) {
          return
        }
        channel[0] = (channel[0] ?? 0) * -1
        channel[1] = (channel[1] ?? 0) * -1
      },
    })

    const flushed = host.flushDspFrames()

    expect(flushed).toHaveLength(1)
    expect(Array.from(flushed[0]?.planar[0] ?? [])).toEqual([-8192, 8192])
  })

  it("drains onFlush across multiple rounds until all plugins stop producing tail frames", async () => {
    const { host } = createHost()
    let pendingTailFrames = 2
    let absorbedFrames = 0

    await host.use({
      name: "multi-round-producer",
      setup() {
        return
      },
      onFlush() {
        if (pendingTailFrames <= 0) {
          return
        }

        pendingTailFrames -= 1
        return [
          createAudioFrame(
            [new Float32Array([pendingTailFrames === 1 ? 0.25 : 0.125])],
            16_000,
            pendingTailFrames === 1 ? 20 : 30
          ),
        ]
      },
    })
    await host.use({
      name: "tail-absorber",
      setup() {
        return
      },
      onBeforeFrame() {
        absorbedFrames += 1
      },
    })

    const flushed = host.flushDspFrames()

    expect(flushed).toHaveLength(2)
    expect(absorbedFrames).toBe(2)
    expect(Array.from(flushed[0]?.planar[0] ?? [])).toEqual([8192])
    expect(Array.from(flushed[1]?.planar[0] ?? [])).toEqual([4096])
  })

  it("rejects flush frames that change the recorder format", async () => {
    const { host, emitIssue } = createHost()

    await host.use({
      name: "invalid-flush-format",
      setup() {
        return
      },
      onFlush() {
        return [createAudioFrame([new Float32Array([0.25])], 8_000, 20)]
      },
    })

    const flushed = host.flushDspFrames({
      sampleRate: 16_000,
      channels: 1,
    })

    expect(flushed).toEqual([])
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "error",
      error: expect.objectContaining({
        message:
          'Recorder plugin "invalid-flush-format" failed during onFlush.',
      }),
    })
  })

  it("wraps non-Error runtime hook failures and keeps later hooks running", async () => {
    const { host, emitIssue } = createHost()
    const calls: string[] = []

    await host.use({
      name: "broken-start",
      setup() {
        return
      },
      onStart() {
        calls.push("broken")
        throw "boom"
      },
    })
    await host.use({
      name: "healthy-start",
      setup() {
        return
      },
      onStart() {
        calls.push("healthy")
      },
    })

    host.onStart()

    expect(calls).toEqual(["broken", "healthy"])
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "error",
      error: expect.objectContaining({
        message: 'Recorder plugin "broken-start" failed during onStart.',
      }),
    })
  })

  it("supports explicit off for plugin event listeners", async () => {
    const { host } = createHost()
    const listener = vi.fn()
    const off = host.on("plugin:level", listener)

    off()

    await host.use({
      name: "level-plugin",
      setup(context) {
        context.eventBus.register("plugin:level")
        context.eventBus.emit("plugin:level", {
          level: {
            peak: 0.5,
            rms: 0.25,
            channels: [{ peak: 0.5, rms: 0.25 }],
          },
        })
      },
    })

    expect(listener).not.toHaveBeenCalled()
  })

  it("emits wrapped issues when dispose throws and keeps destroying remaining plugins", async () => {
    const { host, emitIssue } = createHost()
    const calls: string[] = []

    await host.use({
      name: "first",
      setup() {
        return
      },
      async dispose() {
        calls.push("first")
      },
    })
    await host.use({
      name: "second",
      setup() {
        return
      },
      async dispose() {
        calls.push("second")
        throw new Error("dispose failed")
      },
    })

    await host.destroy()

    expect(calls).toEqual(["second", "first"])
    expect(emitIssue).toHaveBeenCalledTimes(1)
    const issue = emitIssue.mock.calls[0]?.[0]

    expect(issue?.error.message).toBe(
      'Recorder plugin "second" failed during dispose.'
    )
  })

  it("wraps non-Error dispose failures and continues teardown", async () => {
    const { host, emitIssue } = createHost()
    const disposed: string[] = []

    await host.use({
      name: "broken-dispose",
      setup() {
        return
      },
      dispose() {
        disposed.push("broken")
        throw "dispose exploded"
      },
    })
    await host.use({
      name: "healthy-dispose",
      setup() {
        return
      },
      dispose() {
        disposed.push("healthy")
      },
    })

    await host.destroy()

    expect(disposed).toEqual(["healthy", "broken"])
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "error",
      error: expect.objectContaining({
        message: 'Recorder plugin "broken-dispose" failed during dispose.',
      }),
    })
  })

  it("clears plugin event listeners before dispose runs", async () => {
    const { host } = createHost()
    const listener = vi.fn()
    host.on("plugin:level", listener)

    await host.use({
      name: "dispose-emitter",
      setup(context) {
        context.eventBus.register("plugin:level")
      },
      dispose() {
        host.on("plugin:level", () => {
          throw new Error("should not be called")
        })
      },
    })

    await host.destroy()

    expect(listener).not.toHaveBeenCalled()
  })

  it("supports prefix unuse and disposes matched plugins in reverse registration order", async () => {
    const { host } = createHost()
    const disposed: string[] = []

    await host.use({
      name: "streaming-export:pcm",
      setup() {
        return
      },
      dispose() {
        disposed.push("pcm")
      },
    })
    await host.use({
      name: "streaming-export:wav",
      setup() {
        return
      },
      dispose() {
        disposed.push("wav")
      },
    })
    await host.use({
      name: "sonic-export:wav",
      setup() {
        return
      },
      dispose() {
        disposed.push("sonic")
      },
    })

    await host.unuse("streaming-export")

    expect(disposed).toEqual(["wav", "pcm"])
  })

  it("does not invoke hooks after destroy clears the plugin list", async () => {
    const { host } = createHost()
    const onStart = vi.fn()

    await host.use({
      name: "start-plugin",
      setup() {
        return
      },
      onStart,
    })

    await host.destroy()
    host.onStart()

    expect(onStart).not.toHaveBeenCalled()
  })
})
