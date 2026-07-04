import { describe, expect, it, vi } from "vitest"
import type {
  InputSessionSummary,
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputRequest,
  RecorderInputSession,
} from "../../src/input/types"
import type { RecorderPersistencePlugin } from "../../src"
import {
  RecorderController,
  type RecorderInputStrategy,
  RecorderState,
  RecorderWarningCode,
} from "../../src"
import type { RecorderPlugin } from "../../src/plugins/types"
import { createAudioFrame } from "../../src/utils/audio-frame"
import { pcmExportEncoder, wavExportEncoder } from "../../src/codecs/base"

class FakeInputSession implements RecorderInputSession {
  closeCalls = 0
  public actualInputStrategy: RecorderInputStrategy = "media-recorder"
  private readonly summary: InputSessionSummary = {
    frames: 0,
    durationMs: 0,
  }

  constructor(
    private readonly handlers: RecorderInputHandlers,
    public readonly actualSampleRate: number,
    public readonly actualChannelCount: 1 | 2
  ) {}

  async start(): Promise<void> {}

  pause(): void {}

  async resume(): Promise<void> {}

  async stop(): Promise<InputSessionSummary> {
    return { ...this.summary }
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }

  emitFrame(
    frame = createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
  ): void {
    this.summary.frames += 1
    this.summary.durationMs += frame.durationMs
    this.handlers.onFrame(frame)
  }
}

class FakeInputAdapter implements RecorderInputAdapter {
  public lastRequest?: RecorderInputRequest
  public session?: FakeInputSession

  async open(
    request: RecorderInputRequest,
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    this.lastRequest = request
    this.session = new FakeInputSession(
      handlers,
      request.input?.sampleRate ?? 48_000,
      request.input?.channelCount === 2 ? 1 : 1
    )

    if (request.input?.channelCount === 2) {
      handlers.onIssue({
        kind: "warning",
        warning: {
          code: RecorderWarningCode.ChannelCountAdjusted,
          message: "Requested 2 channel(s) but the active stream reported 1.",
        },
      })
    }

    if (request.input?.sampleRate === 9_999) {
      handlers.onIssue({
        kind: "error",
        error: new Error("Synthetic capture failure."),
      })
    }

    return this.session
  }
}

class ThrowingInputAdapter implements RecorderInputAdapter {
  constructor(private readonly error: unknown) {}

  async open(): Promise<RecorderInputSession> {
    throw this.error
  }
}

describe("RecorderController", () => {
  it("runs the phase 1 lifecycle and emits frames, issues, and summaries", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const states: string[] = []
    const frames: number[] = []
    const issues: string[] = []

    recorder.on("statechange", ({ state }) => {
      states.push(state)
    })
    recorder.on("issue", ({ issue, runtimeInfo, summary, controller }) => {
      issues.push(
        issue.kind === "warning" ? issue.warning.code : issue.error.message
      )
      expect(runtimeInfo.requestedChannelCount).toBe(2)
      expect(summary.channels).toBe(2)
      expect(controller).toBe(recorder)
    })
    recorder.on(
      "frame:async",
      ({ frame, controller, summary, sessionId, emittedAt }) => {
        frames.push(frame.planar[0]?.[1] ?? 0)
        expect(controller).toBe(recorder)
        expect(summary.frames).toBeGreaterThan(0)
        expect(sessionId).toMatch(/^session-/)
        expect(emittedAt).toBeGreaterThan(0)
      }
    )

    const runtime = await recorder.open({
      sampleRate: 16_000,
      channelCount: 2,
    })

    expect(runtime.requestedChannelCount).toBe(2)
    expect(runtime.actualChannelCount).toBe(1)
    expect(adapter.lastRequest?.input?.sampleRate).toBe(16_000)
    expect(recorder.getState()).toBe(RecorderState.Ready)

    await recorder.start()
    adapter.session?.emitFrame()
    await Promise.resolve() // flush queueMicrotask for frame:async
    recorder.pause()
    await recorder.resume()
    const summary = await recorder.stop()
    await recorder.close()

    expect(states).toEqual([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Paused,
      RecorderState.Recording,
      RecorderState.Stopped,
      RecorderState.Closed,
    ])
    expect(issues).toEqual([RecorderWarningCode.ChannelCountAdjusted])
    expect(frames).toEqual([16384])
    expect(summary.frames).toBe(1)
    expect(summary.sampleRate).toBe(16_000)
    expect(summary.channels).toBe(1)
    expect(recorder.getLatestSummary().durationMs).toBeGreaterThan(0)
  })

  it("writes inputStrategy to runtimeInfo after open", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })

    const runtime = await recorder.open({ sampleRate: 16_000 })

    expect(runtime.inputStrategy).toBe("media-recorder")
    expect(recorder.getRuntimeInfo().inputStrategy).toBe("media-recorder")
  })

  it("emits a ScriptProcessorFallback warning during open when expectedInputStrategy is script-processor", async () => {
    // Stub globals so capability check returns script-processor
    vi.stubGlobal("AudioContext", class {})
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => Promise.resolve() },
    })

    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
        issues.push(issue.warning.code)
      }
    })

    await recorder.open()

    vi.unstubAllGlobals()

    expect(issues).toContain(RecorderWarningCode.ScriptProcessorFallback)
  })

  it("rejects invalid lifecycle transitions", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })

    await expect(recorder.start()).rejects.toThrow(
      'Recorder state "idle" does not allow this operation.'
    )

    await recorder.open()

    expect(() => recorder.pause()).toThrow(
      'Recorder state "ready" does not allow this operation.'
    )
  })

  it("routes input issues of kind error into the issue event", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "error") {
        issues.push(issue.error.message)
      }
    })

    await recorder.open({ sampleRate: 9_999 })

    expect(issues).toEqual(["Synthetic capture failure."])
  })

  it("supports explicit off for event listeners", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })
    const receivedStates: RecorderState[] = []
    const listener = ({ state }: { state: RecorderState }): void => {
      receivedStates.push(state)
    }

    recorder.on("statechange", listener)
    recorder.off("statechange", listener)

    await recorder.open()

    expect(receivedStates).toEqual([])
  })

  it("resets internal frame buffering when a session is reopened", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })

    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()
    await recorder.stop()
    await recorder.close()

    await recorder.open()

    expect(recorder.getLatestSummary().frames).toBe(0)
    expect(recorder.getLatestSummary().durationMs).toBe(0)
  })

  it("exports buffered PCM and WAV data from the controller", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
      encoders: [pcmExportEncoder, wavExportEncoder],
    })

    await recorder.open({ sampleRate: 16_000 })
    await recorder.start()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5, 0.25])], 16_000, 10)
    )

    const pcm = await recorder.exportEncoded("pcm")
    const wav = await recorder.exportEncoded("wav", { bitRate: 8 })

    expect(Array.from(pcm.data)).toEqual([0, 16384, -16384, 8192])
    expect(wav.mimeType).toBe("audio/wav")
    expect(wav.bitRate).toBe(8)
    expect(wav.arrayBuffer.byteLength).toBe(48)
  })

  it("rejects exporting when no buffered PCM data exists", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })

    await expect(recorder.exportEncoded("pcm")).rejects.toThrow(
      "Recorder has no PCM data to export."
    )
    await expect(recorder.exportEncoded("wav")).rejects.toThrow(
      "Recorder has no PCM data to export."
    )
  })

  it("emits a warning when persistent mode opens without any persistence plugin", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: { mode: "persistent" },
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
        issues.push(issue.warning.code)
      }
    })

    await expect(recorder.open()).rejects.toThrow(
      "Persistent storage mode requires an available persistence plugin before recording starts."
    )

    expect(issues).toEqual([RecorderWarningCode.PersistencePluginMissing])
  })

  it("emits activation warning when persistent storage session creation fails during open", async () => {
    const failingPlugin: RecorderPersistencePlugin = {
      backend: "indexeddb",
      isSupported: () => true,
      createSession: async () => {
        throw new Error("persistent activation failed")
      },
    }
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: {
        mode: "persistent",
        persistencePlugin: failingPlugin,
      },
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
        issues.push(issue.warning.code)
      }
    })

    await expect(recorder.open()).rejects.toThrow(
      "persistent activation failed"
    )

    expect(issues).toEqual([RecorderWarningCode.PersistenceActivationFailed])
  })

  it("falls back to memory export when auto-mode persistence activation fails mid-recording", async () => {
    const failingPlugin: RecorderPersistencePlugin = {
      backend: "indexeddb",
      isSupported: () => true,
      createSession: async () => {
        throw new Error("auto promotion failed")
      },
    }
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: {
        mode: "auto",
        memoryThresholdBytes: 1,
        persistencePlugin: failingPlugin,
      },
      encoders: [pcmExportEncoder],
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
        issues.push(issue.warning.code)
      }
    })

    await recorder.open({ sampleRate: 16_000 })
    await recorder.start()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5, 0.25])], 16_000, 10)
    )

    const pcm = await recorder.exportEncoded("pcm")

    expect(Array.from(pcm.data)).toEqual([0, 16384, -16384, 8192])
    expect(issues).toContain(RecorderWarningCode.PersistenceActivationFailed)
  })

  it("wraps non-Error open failures into both the issue event and thrown rejection", async () => {
    const recorder = new RecorderController({
      inputAdapter: new ThrowingInputAdapter("open failed"),
      storageOptions: undefined,
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "error") {
        issues.push(issue.error.message)
      }
    })

    await expect(recorder.open()).rejects.toThrow("Failed to open recorder.")
    expect(issues).toEqual(["Failed to open recorder."])
    expect(recorder.getState()).toBe(RecorderState.Idle)
  })

  it("reports external-stream runtime info when opened with a source stream", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })

    const runtime = await recorder.open({
      sourceStream: {} as MediaStream,
      sampleRate: 16_000,
    } as Parameters<typeof recorder.open>[0] & { sourceStream: MediaStream })

    expect(runtime.source).toBe("external-stream")
    expect(recorder.getRuntimeInfo().source).toBe("external-stream")
  })

  it("destroys the active session, emits destroyed once, and clears listeners afterwards", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const states: RecorderState[] = []
    const listener = ({ state }: { state: RecorderState }): void => {
      states.push(state)
    }

    recorder.on("statechange", listener)
    await recorder.open()
    await recorder.start()
    await recorder.destroy()

    expect(adapter.session?.closeCalls).toBe(1)
    expect(recorder.getState()).toBe(RecorderState.Destroyed)
    expect(states).toEqual([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Destroyed,
    ])

    recorder.off("statechange", listener)
    await expect(recorder.open()).rejects.toThrow(
      'Recorder state "destroyed" does not allow this operation.'
    )
    expect(states).toEqual([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Destroyed,
    ])
  })

  it("returns stable snapshots from runtime and summary accessors", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })

    await recorder.open({ sampleRate: 16_000 })

    const runtime = recorder.getRuntimeInfo()
    const summary = recorder.getLatestSummary()
    runtime.requestedChannelCount = 2
    summary.frames = 999

    expect(recorder.getRuntimeInfo().requestedChannelCount).toBe(1)
    expect(recorder.getLatestSummary().frames).toBe(0)
  })

  it("runs plugin hooks across the recorder lifecycle", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const calls: string[] = []
    const plugin: RecorderPlugin = {
      name: "test-plugin",
      setup() {
        calls.push("setup")
      },
      onStart() {
        calls.push("start")
      },
      onFrame() {
        calls.push("frame")
      },
      onPause() {
        calls.push("pause")
      },
      onResume() {
        calls.push("resume")
      },
      onStop() {
        calls.push("stop")
      },
      dispose() {
        calls.push("dispose")
      },
    }

    await recorder.use(plugin)
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()
    recorder.pause()
    await recorder.resume()
    await recorder.stop()
    await recorder.destroy()

    expect(calls).toEqual([
      "setup",
      "start",
      "frame",
      "pause",
      "resume",
      "stop",
      "dispose",
    ])
  })

  it("requires plugin events to be registered before emit", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })
    const plugin: RecorderPlugin = {
      name: "unregistered-event-plugin",
      setup(context) {
        context.eventBus.emit("custom-event", { value: 1 })
      },
    }

    await expect(recorder.use(plugin)).rejects.toThrow(
      'Recorder plugin "unregistered-event-plugin" failed during setup.'
    )
  })

  it("rejects duplicate plugin registration", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })
    const plugin: RecorderPlugin = {
      name: "duplicate-plugin",
      setup() {
        return
      },
    }

    await recorder.use(plugin)

    await expect(recorder.use(plugin)).rejects.toThrow(
      'Recorder plugin "duplicate-plugin" is already registered.'
    )
  })

  it("supports prefix unuse only while idle", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })
    const disposed: string[] = []

    await recorder.use({
      name: "streaming-export:pcm",
      setup() {
        return
      },
      dispose() {
        disposed.push("pcm")
      },
    })
    await recorder.use({
      name: "streaming-export:wav",
      setup() {
        return
      },
      dispose() {
        disposed.push("wav")
      },
    })

    await recorder.unuse("streaming-export")

    expect(disposed).toEqual(["wav", "pcm"])

    await recorder.open()

    await expect(recorder.unuse("streaming-export")).rejects.toThrow(
      'Recorder state "ready" does not allow this operation. Expected: idle.'
    )
  })

  it("registers custom encoders through the controller and exports through the shared registry", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })

    recorder.registerEncoder({
      type: "mock-text",
      export: (snapshot, options?: { prefix?: string }) => {
        const samples = Array.from(snapshot.planar[0] ?? [])
        return Promise.resolve(
          `${options?.prefix ?? "samples"}:${samples.join(",")}`
        )
      },
    })

    await recorder.open({ sampleRate: 16_000 })
    await recorder.start()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5, 0.25])], 16_000, 10)
    )

    const exported = await recorder.exportEncoded<{ prefix?: string }, string>(
      "mock-text",
      { prefix: "pcm" }
    )

    expect(exported).toBe("pcm:0,16384,-16384,8192")
  })

  it("rejects encoder registration after destroy", async () => {
    const recorder = new RecorderController({
      inputAdapter: new FakeInputAdapter(),
      storageOptions: undefined,
    })

    await recorder.destroy()

    expect(() =>
      recorder.registerEncoder({
        type: "mock",
        export: () => Promise.resolve("ok"),
      })
    ).toThrow('Recorder state "destroyed" does not allow this operation.')
  })

  it("emits frame:async asynchronously after synchronous frame processing", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const syncOrder: string[] = []
    const asyncFrames: number[] = []

    recorder.on("frame:async", ({ frame }) => {
      asyncFrames.push(frame.planar[0]?.[1] ?? 0)
      syncOrder.push("async")
    })

    await recorder.open({ sampleRate: 16_000 })
    await recorder.start()

    syncOrder.push("before-emit")
    adapter.session?.emitFrame()
    syncOrder.push("after-emit")

    // frame:async fires in microtask, not synchronously
    expect(asyncFrames).toHaveLength(0)

    await Promise.resolve()

    expect(asyncFrames).toEqual([16384])
    expect(syncOrder).toEqual(["before-emit", "after-emit", "async"])
  })

  it("does not dispatch frame:async when no listeners are registered before start", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })

    await recorder.open({ sampleRate: 16_000 })
    await recorder.start()

    // Add listener AFTER start — hasAsyncFrameListeners was already cached as false
    const lateFrames: number[] = []
    recorder.on("frame:async", ({ frame }) => {
      lateFrames.push(frame.planar[0]?.[1] ?? 0)
    })

    adapter.session?.emitFrame()
    await Promise.resolve()

    // No frames dispatched because flag was cached before the listener was added
    expect(lateFrames).toHaveLength(0)
  })

  it("dispatches frame:async when listener is registered before start on next session", async () => {
    const adapter = new FakeInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const frames: number[] = []

    recorder.on("frame:async", ({ frame }) => {
      frames.push(frame.planar[0]?.[1] ?? 0)
    })

    await recorder.open({ sampleRate: 16_000 })
    await recorder.start() // flag cached here — listener already registered

    adapter.session?.emitFrame()
    await Promise.resolve()

    expect(frames).toEqual([16384])
  })
})
