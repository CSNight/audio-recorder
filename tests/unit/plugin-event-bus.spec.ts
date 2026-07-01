import { describe, expect, it, vi } from "vitest"
import { EventBus } from "@/core/event-bus"
import { PluginEventBus } from "@/plugins/plugin-event-bus"
import type { RecorderPluginEventMap } from "@/plugins/types"
import { RecorderInputSource } from "@/types"

function createPluginEventBus() {
  const controller = {} as never
  const eventBus = new EventBus<RecorderPluginEventMap>()
  const pluginEventBus = new PluginEventBus("test-plugin", eventBus, () => ({
    controller,
    sessionId: "session-test",
    emittedAt: 123,
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
  }))

  return { controller, eventBus, pluginEventBus }
}

describe("PluginEventBus", () => {
  it("registers plugin:* events before emit", () => {
    const { controller, eventBus, pluginEventBus } = createPluginEventBus()
    const listener = vi.fn()

    eventBus.on("plugin:level", listener)
    pluginEventBus.register("plugin:level")
    pluginEventBus.emit("plugin:level", {
      level: {
        peak: 0.5,
        rms: 0.25,
        channels: [{ peak: 0.5, rms: 0.25 }],
      },
    })

    expect(listener).toHaveBeenCalledWith({
      controller,
      sessionId: "session-test",
      emittedAt: 123,
      pluginName: "test-plugin",
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

  it("rejects emit before register", () => {
    const { pluginEventBus } = createPluginEventBus()

    expect(() =>
      pluginEventBus.emit("plugin:level", {
        level: {
          peak: 0.5,
          rms: 0.25,
          channels: [{ peak: 0.5, rms: 0.25 }],
        },
      })
    ).toThrow(
      'Recorder plugin event "plugin:level" must be registered before emit.'
    )
  })

  it("rejects reserved core event names", () => {
    const { pluginEventBus } = createPluginEventBus()

    expect(() => pluginEventBus.register("frame")).toThrow(
      'Recorder plugin event "frame" is reserved for the core event bus.'
    )
  })

  it("allows plugin: prefix to pass through without error", () => {
    const { pluginEventBus } = createPluginEventBus()

    expect(() => pluginEventBus.register("plugin:custom")).not.toThrow()
  })
})
