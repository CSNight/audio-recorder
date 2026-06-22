import { describe, expect, it, vi } from "vitest"
import { PluginHost } from "@/plugins/plugin-host"
import type { RecorderPlugin } from "@/plugins/types"
import { RecorderInputSource } from "@/types"
import { createAudioFrame } from "@/utils/audio-frame"

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
