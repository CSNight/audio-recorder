/**
 * WebM/PCM 容器解析器，移植自 vendor/Recorder-master/src/recorder-core.js
 * WebM_Extract 及其辅助函数（bytesEq / bytesInt / readVInt / readBlock）。
 *
 * 与 vendor 的主要差异：
 * - 提取全部音频声道，返回 Float32Array[] planar（vendor 只取第一声道）
 * - 纯 TypeScript，无全局副作用，所有状态通过 WebMExtractScope 显式传递
 *
 * 使用方式：
 *   const scope = createWebMExtractScope()
 *   mr.ondataavailable = e => {
 *     const result = webmExtract(new Uint8Array(await e.data.arrayBuffer()), scope)
 *     if (result === "invalid") { fallback() }
 *     else if (Array.isArray(result)) { session.acceptFrame(result, performance.now()) }
 *     // result === null：数据不完整，等待下次回调
 *   }
 */

interface WebMTrack {
  number?: number
  type?: string
  codec?: string
  sampleRate?: number
  bitDepth?: number
  channels?: number
  idx?: number
}

export interface WebMExtractScope {
  /** 当前解析位置（单元素数组，便于按引用传递给递归辅助函数） */
  pos: [number]
  /** trackNumber → TrackEntry 元数据映射，Tracks 块解析完成后填入 */
  tracks: Record<number, WebMTrack>
  /** 跨调用累积的未解析字节缓冲 */
  bytes: Uint8Array
  /** 第一条音频轨道（idx=0），决定采样率/位深/声道数 */
  track0?: WebMTrack
  /** EBML header + Tracks 是否已解析完成（1=已完成） */
  _ht?: number
  /** 从 Track 元数据读取到的实际采样率，供调用方与 AudioContext.sampleRate 比较 */
  webmSR?: number
  /** 遇到无法处理的格式后置 1，后续所有调用立即返回 "invalid" */
  bad?: number
}

/** 返回值：
 *  - `Float32Array[]` planar — 本次成功解析出的帧（各声道）
 *  - `null`            — 数据不完整，等待下次追加
 *  - `"invalid"`       — 格式无法处理，调用方应立即降级
 */
export type WebMExtractResult = Float32Array[] | null | "invalid"

function bytesEq(a: Uint8Array | number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function bytesInt(bytes: number[] | Uint8Array): number {
  let s = ""
  for (let i = 0; i < bytes.length; i++) {
    const n = bytes[i]!
    s += (n < 16 ? "0" : "") + n.toString(16)
  }
  return parseInt(s, 16) || 0
}

function readVInt(
  arr: Uint8Array,
  pos: [number],
  trim?: boolean
): number[] | undefined {
  const i0 = pos[0]
  if (i0 >= arr.length) return undefined
  const b0 = arr[i0]!
  const b2 = ("0000000" + b0.toString(2)).slice(-8)
  const m = /^(0*1)(\d*)$/.exec(b2)
  if (!m) return undefined
  const len = m[1]!.length
  if (i0 + len > arr.length) return undefined
  const val: number[] = []
  let i = i0
  for (let i2 = 0; i2 < len; i2++) {
    val[i2] = arr[i]!
    i++
  }
  if (trim) val[0] = parseInt(m[2] || "0", 2)
  pos[0] = i
  return val
}

function readBlock(arr: Uint8Array, pos: [number]): number[] | undefined {
  const lenVal = readVInt(arr, pos, true)
  if (!lenVal) return undefined
  const len = bytesInt(lenVal)
  const i = pos[0]
  const val: number[] = []
  if (len < 0x7fffffff) {
    if (i + len > arr.length) return undefined
    for (let i2 = 0; i2 < len; i2++) val[i2] = arr[i + i2]!
    pos[0] = i + len
  }
  return val
}

export function webmExtract(
  inBytes: Uint8Array,
  scope: WebMExtractScope
): WebMExtractResult {
  if (scope.bad) return "invalid"

  // 追加新数据到缓冲
  const prev = scope.bytes
  const merged = new Uint8Array(prev.length + inBytes.length)
  merged.set(prev)
  merged.set(inBytes, prev.length)
  scope.bytes = merged

  const bytes = scope.bytes
  const tracks = scope.tracks
  const position: [number] = [scope.pos[0]]
  const savePos = (): void => {
    scope.pos[0] = position[0]
  }

  // ── Phase 1: 解析 EBML header + Tracks ──────────────────────────────────
  if (!scope._ht) {
    readVInt(bytes, position) // EBML element id
    readBlock(bytes, position) // EBML header content (skip)

    // Segment element id = 0x18 0x53 0x80 0x67
    const segId = readVInt(bytes, position)
    if (!bytesEq(segId, [0x18, 0x53, 0x80, 0x67])) return null
    readVInt(bytes, position, true) // Segment length (skip)

    let audioIdx = 0
    while (position[0] < bytes.length) {
      const eid0 = readVInt(bytes, position)
      const bytes0Raw = readBlock(bytes, position)
      if (!bytes0Raw) return null // incomplete, wait

      // Tracks element id = 0x16 0x54 0xAE 0x6B
      if (!bytesEq(eid0, [0x16, 0x54, 0xae, 0x6b])) continue

      const bytes0 = new Uint8Array(bytes0Raw)
      const pos0: [number] = [0]

      while (pos0[0] < bytes0.length) {
        const eid1 = readVInt(bytes0, pos0)
        const bytes1Raw = readBlock(bytes0, pos0)
        if (!bytes1Raw) break
        const bytes1 = new Uint8Array(bytes1Raw)
        const pos1: [number] = [0]
        const track: WebMTrack = { channels: 0, sampleRate: 0 }

        // TrackEntry = 0xAE
        if (!bytesEq(eid1, [0xae])) continue

        while (pos1[0] < bytes1.length) {
          const eid2 = readVInt(bytes1, pos1)
          const bytes2Raw = readBlock(bytes1, pos1)
          if (!bytes2Raw) break
          const bytes2 = new Uint8Array(bytes2Raw)
          const pos2: [number] = [0]

          if (bytesEq(eid2, [0xd7])) {
            // Track Number
            track.number = bytesInt(bytes2)
            tracks[track.number] = track
          } else if (bytesEq(eid2, [0x83])) {
            // Track Type: 1=video 2=audio
            const val = bytesInt(bytes2)
            if (val === 2) {
              track.type = "audio"
              if (audioIdx === 0) scope.track0 = track
              track.idx = audioIdx++
            } else {
              track.type = val === 1 ? "video" : `type-${val}`
            }
          } else if (bytesEq(eid2, [0x86])) {
            // Codec ID
            let str = ""
            for (let i = 0; i < bytes2.length; i++)
              str += String.fromCharCode(bytes2[i]!)
            track.codec = str
          } else if (bytesEq(eid2, [0xe1])) {
            // Audio settings
            while (pos2[0] < bytes2.length) {
              const eid3 = readVInt(bytes2, pos2)
              const bytes3Raw = readBlock(bytes2, pos2)
              if (!bytes3Raw) break
              const bytes3 = new Uint8Array(bytes3Raw)

              if (bytesEq(eid3, [0xb5])) {
                // SamplingFrequency (float BE)
                const reversed = new Uint8Array(bytes3).reverse().buffer
                let val = 0
                if (bytes3.length === 4) val = new Float32Array(reversed)[0]!
                else if (bytes3.length === 8)
                  val = new Float64Array(reversed)[0]!
                track.sampleRate = Math.round(val)
              } else if (bytesEq(eid3, [0x62, 0x64])) {
                // BitDepth
                track.bitDepth = bytesInt(bytes3)
              } else if (bytesEq(eid3, [0x9f])) {
                // Channels
                track.channels = bytesInt(bytes3)
              }
            }
          }
        }
      }

      scope._ht = 1
      savePos()
      break
    }

    if (!scope._ht) return null // Tracks not yet fully received
  }

  // ── Phase 2: 校验音频格式 ────────────────────────────────────────────────
  const track0 = scope.track0
  if (!track0) return null

  // Chrome v66 quirk: reports bitDepth=16 but actually uses float32
  if (track0.bitDepth === 16 && /FLOAT/i.test(track0.codec ?? "")) {
    track0.bitDepth = 32
  }

  const trackSR = track0.sampleRate ?? 0
  scope.webmSR = trackSR

  if (
    trackSR < 8000 ||
    track0.bitDepth !== 32 ||
    (track0.channels ?? 0) < 1 ||
    !/(\b|_)PCM\b/i.test(track0.codec ?? "")
  ) {
    scope.bytes = new Uint8Array(0)
    scope.bad = 1
    return "invalid"
  }

  // ── Phase 3: 循环读取 Cluster → SimpleBlock ──────────────────────────────
  const channelCount = track0.channels ?? 1
  const rawChunks: Uint8Array[] = []
  let rawLen = 0

  while (position[0] < bytes.length) {
    const eid1 = readVInt(bytes, position)
    const bytes1Raw = readBlock(bytes, position)
    if (!bytes1Raw) break // incomplete, wait

    // SimpleBlock = 0xA3
    if (!bytesEq(eid1, [0xa3])) {
      savePos()
      continue
    }

    const trackNo = bytes1Raw[0]! & 0xf
    const track = tracks[trackNo]
    if (!track) {
      scope.bad = 1
      return "invalid"
    }

    if (track.idx === 0) {
      // skip 4-byte SimpleBlock header (track no + timecode + flags)
      const payload = new Uint8Array(bytes1Raw.length - 4)
      for (let i = 4; i < bytes1Raw.length; i++) payload[i - 4] = bytes1Raw[i]!
      rawChunks.push(payload)
      rawLen += payload.length
    }
    savePos()
  }

  if (rawLen === 0) return null

  // 剩余未处理字节保留给下次调用
  const remaining = new Uint8Array(bytes.length - scope.pos[0])
  remaining.set(bytes.subarray(scope.pos[0]))
  scope.bytes = remaining
  scope.pos[0] = 0

  // 合并原始字节 → Float32 interleaved
  const combined = new Uint8Array(rawLen)
  let offset = 0
  for (const chunk of rawChunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  const interleaved = new Float32Array(combined.buffer)
  const frameCount = Math.floor(interleaved.length / channelCount)

  // de-interleave → planar Float32Array[]
  const planar: Float32Array[] = Array.from(
    { length: channelCount },
    () => new Float32Array(frameCount)
  )
  for (let s = 0; s < frameCount; s++) {
    for (let ch = 0; ch < channelCount; ch++) {
      planar[ch]![s] = interleaved[s * channelCount + ch]!
    }
  }

  return planar
}

export function createWebMExtractScope(): WebMExtractScope {
  return {
    pos: [0],
    tracks: {},
    bytes: new Uint8Array(0),
  }
}
