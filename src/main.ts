import type {
  CaptureAdapter,
  CaptureHandlers,
  CaptureOpenRequest,
  CaptureSession,
  CaptureSessionSummary,
} from "./capture/types"
import { CaptureSessionState, type RecorderState } from "./types"
import { createRecorder } from "./index"
import { createAudioFrame } from "./utils/audio-frame"

const app = document.querySelector<HTMLDivElement>("#app")

if (app) {
  app.innerHTML = `
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Phase 1</p>
        <h1>Recorder core chain is online</h1>
        <p class="lede">
          The library now ships a typed recorder controller, browser capture adapter,
          state machine, warning events, and real-time PCM frame dispatch.
        </p>
        <div class="hero-actions">
          <a class="action-link" href="/playground/">打开中文示例工作台</a>
          <a class="action-link muted" href="/?diagnostic=e2e">Run E2E diagnostic</a>
        </div>
      </section>
      <section class="panel">
        <h2>Browser diagnostic</h2>
        <p id="diagnostic-status">Running external stream lifecycle check...</p>
        <pre id="diagnostic-output" aria-live="polite"></pre>
      </section>
      <section class="panel">
        <h2>Upstream reference</h2>
        <p class="supporting">
          Upstream Recorder source and demos are vendored under
          <code>vendor/Recorder-master</code> and are now the baseline reference for
          behavior comparisons.
        </p>
      </section>
    </main>
  `
}

async function runDiagnostic(): Promise<void> {
  const statusNode =
    document.querySelector<HTMLParagraphElement>("#diagnostic-status")
  const outputNode =
    document.querySelector<HTMLPreElement>("#diagnostic-output")

  if (!statusNode || !outputNode) {
    return
  }

  const diagnosticMode = new URL(window.location.href).searchParams.get(
    "diagnostic"
  )
  let audioContext: AudioContext | undefined
  let oscillator: OscillatorNode | undefined

  try {
    const AudioContextCtor = globalThis.AudioContext
    if (!AudioContextCtor) {
      throw new Error("AudioContext is unavailable.")
    }

    audioContext = new AudioContextCtor()
    oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const destination = audioContext.createMediaStreamDestination()

    gainNode.gain.value = 0.05
    oscillator.type = "sine"
    oscillator.frequency.value = 220
    oscillator.connect(gainNode)
    gainNode.connect(destination)
    oscillator.start()

    if (diagnosticMode !== "e2e") {
      await audioContext.resume()
    }

    const recorderOptions =
      diagnosticMode === "e2e"
        ? {
            captureAdapter: new DeterministicCaptureAdapter(
              audioContext.sampleRate
            ),
          }
        : {}
    const recorder = createRecorder(recorderOptions)
    const states: RecorderState[] = []
    let observedFrame = false

    recorder.on("statechange", ({ state }) => {
      states.push(state)
    })
    recorder.on("frame", () => {
      observedFrame = true
    })

    const summary = await withTimeout(
      (async () => {
        await recorder.open({
          sourceStream: destination.stream,
          capture: {
            channelCount: 2,
            sampleRate: audioContext.sampleRate,
          },
        })
        await recorder.start()

        await waitFor(() => observedFrame, 2_000)

        recorder.pause()
        await recorder.resume()
        const result = await recorder.stop()
        await recorder.close()

        return result
      })(),
      4_000,
      "Timed out while running the phase 1 external stream diagnostic."
    )

    statusNode.textContent = "External stream diagnostic passed."
    outputNode.textContent = JSON.stringify(
      {
        states,
        runtime: recorder.getRuntimeInfo(),
        summary,
      },
      null,
      2
    )
  } catch (error) {
    statusNode.textContent = "External stream diagnostic failed."
    outputNode.textContent =
      error instanceof Error ? error.message : String(error)
  } finally {
    oscillator?.stop()
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close()
    }
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const startedAt = performance.now()

  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(
        "Timed out waiting for a PCM frame from the external stream."
      )
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 16)
    })
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeoutHandle = 0

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    window.clearTimeout(timeoutHandle)
  }
}

class DeterministicCaptureAdapter implements CaptureAdapter {
  constructor(private readonly sampleRate: number) {}

  async open(
    request: CaptureOpenRequest,
    handlers: CaptureHandlers
  ): Promise<CaptureSession> {
    if (!request.sourceStream) {
      throw new Error(
        "Deterministic diagnostic requires an external MediaStream."
      )
    }

    return new DeterministicCaptureSession(
      handlers,
      this.sampleRate,
      request.capture?.channelCount ?? 1
    )
  }
}

class DeterministicCaptureSession implements CaptureSession {
  private frameTimer: number | undefined
  private frames = 0
  private durationMs = 0
  private sessionState = CaptureSessionState.Ready

  constructor(
    private readonly handlers: CaptureHandlers,
    public readonly actualSampleRate: number,
    public readonly actualChannelCount: 1 | 2
  ) {}

  async start(): Promise<void> {
    this.assertState([
      CaptureSessionState.Ready,
      CaptureSessionState.Stopped,
      CaptureSessionState.Paused,
    ])
    this.sessionState = CaptureSessionState.Recording
    this.startEmittingFrames()
  }

  pause(): void {
    this.assertState([CaptureSessionState.Recording])
    this.sessionState = CaptureSessionState.Paused
    this.stopEmittingFrames()
  }

  async resume(): Promise<void> {
    this.assertState([CaptureSessionState.Paused])
    this.sessionState = CaptureSessionState.Recording
    this.startEmittingFrames()
  }

  async stop(): Promise<CaptureSessionSummary> {
    this.assertState([
      CaptureSessionState.Recording,
      CaptureSessionState.Paused,
      CaptureSessionState.Ready,
      CaptureSessionState.Stopped,
    ])
    this.sessionState = CaptureSessionState.Stopped
    this.stopEmittingFrames()

    return {
      frames: this.frames,
      durationMs: this.durationMs,
    }
  }

  async close(): Promise<void> {
    if (this.sessionState === CaptureSessionState.Closed) {
      return
    }

    this.sessionState = CaptureSessionState.Closed
    this.stopEmittingFrames()
  }

  private startEmittingFrames(): void {
    if (this.frameTimer !== undefined) {
      return
    }

    this.frameTimer = window.setInterval(() => {
      if (this.sessionState !== CaptureSessionState.Recording) {
        return
      }

      const sampleSize = 128
      const left = new Float32Array(sampleSize).fill(0.25)
      const planarFloat =
        this.actualChannelCount === 2
          ? [left, new Float32Array(sampleSize).fill(-0.25)]
          : [left]
      const frame = createAudioFrame(
        planarFloat,
        this.actualSampleRate,
        performance.now()
      )

      this.frames += 1
      this.durationMs += frame.durationMs
      this.handlers.onFrame(frame)
    }, 24)
  }

  private stopEmittingFrames(): void {
    if (this.frameTimer === undefined) {
      return
    }

    window.clearInterval(this.frameTimer)
    this.frameTimer = undefined
  }

  private assertState(allowedStates: CaptureSessionState[]): void {
    if (allowedStates.includes(this.sessionState)) {
      return
    }

    throw new Error(
      `Deterministic capture session state "${this.sessionState}" does not allow this operation.`
    )
  }
}

if (app) {
  void runDiagnostic()
}
