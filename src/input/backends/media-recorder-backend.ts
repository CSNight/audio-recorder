import {
  type InputBackend,
  type InputBackendContext,
  InputBackendUnavailableError,
} from "@/input/backends/types"
import {
  createWebMExtractScope,
  webmExtract,
  type WebMExtractScope,
} from "@/input/webm-pcm-extractor"
import { RecorderWarningCode } from "@/types"

const MEDIA_RECORDER_MIME = "audio/webm; codecs=pcm"
const MEDIA_RECORDER_TIMESLICE_MS = 10 // ondataavailable 回调间隔
const MEDIA_RECORDER_TIMEOUT_MS = 500 // onstart 超时：超过仍未进入 recording 即判定不可用

type MediaRecorderScope = typeof globalThis & {
  MediaRecorder?: {
    new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorder
    isTypeSupported?: (type: string) => boolean
  }
}

/**
 * MediaRecorder 采集 backend —— 默认首选链路。
 *
 * 直接 `new MediaRecorder(stream)` 录制 getUserMedia 原始流，**不绕 Web Audio 图**：
 * 声道数由 getUserMedia 的 channelCount 约束负责，原生 APM（AEC/NS/AGC）完整保留。
 * （历史实现曾用 source→Gain→MediaStreamDestination 绕图强制声道数，实测会产出
 * 假立体声、破坏原生 APM 且码流不可解，已彻底移除。）
 *
 * 以 onstart 事件验证可用性，500ms 超时兜底；不可用时抛 InputBackendUnavailableError。
 * WebM/PCM 数据经 webmExtract 解析为 Float32Array[] planar 后推给 sink。
 */
export function createMediaRecorderBackend(
  context: InputBackendContext
): Promise<InputBackend> {
  const { stream, audioContext, sink, emitIssue } = context

  const scope = globalThis as MediaRecorderScope
  if (
    !scope.MediaRecorder ||
    !scope.MediaRecorder.isTypeSupported?.(MEDIA_RECORDER_MIME)
  ) {
    return Promise.reject(
      new InputBackendUnavailableError(
        "media-recorder",
        `MediaRecorder (${MEDIA_RECORDER_MIME}) is not supported in this browser.`
      )
    )
  }
  const MediaRecorderCtor = scope.MediaRecorder

  return new Promise<InputBackend>((resolve, reject) => {
    const extractScope: WebMExtractScope = createWebMExtractScope()
    const timer: { id?: ReturnType<typeof setTimeout> } = {}
    let settled = false
    let hasSampleRateWarned = false

    let mr: MediaRecorder
    try {
      mr = new MediaRecorderCtor(stream, { mimeType: MEDIA_RECORDER_MIME })
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "MediaRecorder construction failed"
      reject(new InputBackendUnavailableError("media-recorder", reason))
      return
    }

    function unavailable(message: string): void {
      if (settled) return
      settled = true
      clearTimeout(timer.id)
      detach(mr)
      try {
        mr.stop()
      } catch {
        /* ignore */
      }
      reject(new InputBackendUnavailableError("media-recorder", message))
    }

    // onstart 触发即表示成功进入 recording 状态，链路可用
    ;(mr as MediaRecorder & { onstart: (() => void) | null }).onstart = () => {
      if (settled) return
      settled = true
      clearTimeout(timer.id)
      resolve({
        strategy: "media-recorder",
        suspend: () => {
          try {
            mr.pause()
          } catch {
            /* ignore */
          }
        },
        resume: () => {
          try {
            mr.resume()
          } catch {
            /* ignore */
          }
        },
        dispose: () => {
          detach(mr)
          try {
            mr.stop()
          } catch {
            /* ignore */
          }
        },
      })
    }

    mr.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return
      event.data
        .arrayBuffer()
        .then((buf) => {
          const result = webmExtract(new Uint8Array(buf), extractScope)
          if (result === "invalid") {
            emitIssue({
              kind: "warning",
              warning: {
                code: RecorderWarningCode.MediaRecorderFallback,
                message:
                  "MediaRecorder produced unrecognised WebM/PCM data; falling back.",
              },
            })
            return
          }
          if (result === null) return

          if (
            !hasSampleRateWarned &&
            extractScope.webmSR !== undefined &&
            extractScope.webmSR !== audioContext.sampleRate
          ) {
            hasSampleRateWarned = true
            emitIssue({
              kind: "warning",
              warning: {
                code: RecorderWarningCode.MediaRecorderFallback,
                message: `MediaRecorder sample rate (${extractScope.webmSR}) differs from AudioContext (${audioContext.sampleRate}).`,
              },
            })
          }

          sink.acceptFrame(result, performance.now())
        })
        .catch(() => {
          /* ignore read errors */
        })
    }

    mr.onerror = () => {
      unavailable("MediaRecorder emitted an error before becoming available.")
    }

    timer.id = setTimeout(() => {
      unavailable(
        `MediaRecorder did not start within ${MEDIA_RECORDER_TIMEOUT_MS}ms.`
      )
    }, MEDIA_RECORDER_TIMEOUT_MS)

    try {
      mr.start(MEDIA_RECORDER_TIMESLICE_MS)
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "MediaRecorder.start() failed"
      unavailable(reason)
    }
  })
}

function detach(mr: MediaRecorder): void {
  mr.ondataavailable = null
  mr.onerror = null
  ;(mr as MediaRecorder & { onstart: null }).onstart = null
}
