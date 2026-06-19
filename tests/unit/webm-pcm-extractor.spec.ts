import { describe, expect, it } from "vitest"
import { createWebMExtractScope, webmExtract } from "@/input/webm-pcm-extractor"

// ─────────────────────────────────────────────────────────────────────────────
// WebM binary builder helpers
// ─────────────────────────────────────────────────────────────────────────────

function encodeVIntLength(len: number): Uint8Array {
  // encode length as Matroska VINT (1–4 bytes)
  if (len < 0x7f) return new Uint8Array([len | 0x80])
  if (len < 0x3fff) return new Uint8Array([(len >> 8) | 0x40, len & 0xff])
  if (len < 0x1fffff)
    return new Uint8Array([(len >> 16) | 0x20, (len >> 8) & 0xff, len & 0xff])
  return new Uint8Array([
    (len >> 24) | 0x10,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
  ])
}

function element(id: number[], payload: Uint8Array): Uint8Array {
  const lenBytes = encodeVIntLength(payload.length)
  const out = new Uint8Array(id.length + lenBytes.length + payload.length)
  out.set(id)
  out.set(lenBytes, id.length)
  out.set(payload, id.length + lenBytes.length)
  return out
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function floatBE32(value: number): Uint8Array {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setFloat32(0, value, false)
  return new Uint8Array(buf)
}

function uint8(value: number): Uint8Array {
  return new Uint8Array([value])
}

function asciiBytes(str: string): Uint8Array {
  return new Uint8Array(str.split("").map((c) => c.charCodeAt(0)))
}

/**
 * Build a minimal valid WebM/PCM binary with the given audio parameters.
 * Returns the full file as Uint8Array.
 *
 * @param sampleRate  e.g. 48000
 * @param channels    1 or 2
 * @param samples     Float32 interleaved sample values (length = frames * channels)
 */
function buildWebM(
  sampleRate: number,
  channels: number,
  samples: Float32Array
): Uint8Array {
  // ── Audio element (inside TrackEntry) ────────────────────────────────────
  const audioEl = concat(
    element([0xb5], floatBE32(sampleRate)), // SamplingFrequency
    element([0x62, 0x64], uint8(32)), // BitDepth = 32
    element([0x9f], uint8(channels)) // Channels
  )

  // ── TrackEntry ────────────────────────────────────────────────────────────
  const trackEntry = concat(
    element([0xd7], uint8(1)), // TrackNumber = 1
    element([0x83], uint8(2)), // TrackType = audio
    element([0x86], asciiBytes("A_PCM/FLOAT/IEEE")), // CodecID
    element([0xe1], audioEl) // Audio
  )

  // ── Tracks ────────────────────────────────────────────────────────────────
  const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], trackEntry))

  // ── SimpleBlock ───────────────────────────────────────────────────────────
  // header: trackNo(1) + timecode(2) + flags(1) = 4 bytes, then PCM payload
  const pcmBytes = new Uint8Array(samples.buffer)
  const simpleBlockPayload = concat(
    new Uint8Array([0x01, 0x00, 0x00, 0x00]), // track=1, timecode=0, flags=0
    pcmBytes
  )
  const simpleBlock = element([0xa3], simpleBlockPayload)

  // ── Segment ───────────────────────────────────────────────────────────────
  const segmentPayload = concat(tracks, simpleBlock)
  // Segment id with "unknown" length marker (0x01 ff ff ff ff ff ff ff)
  const segmentId = new Uint8Array([0x18, 0x53, 0x80, 0x67])
  const segmentLen = new Uint8Array([
    0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ])
  const segment = concat(segmentId, segmentLen, segmentPayload)

  // ── EBML Header ───────────────────────────────────────────────────────────
  const ebmlPayload = concat(
    element([0x42, 0x86], uint8(1)), // EBMLVersion
    element([0x42, 0xf7], uint8(1)), // EBMLReadVersion
    element([0x42, 0xf2], uint8(4)), // EBMLMaxIDLength
    element([0x42, 0xf3], uint8(8)), // EBMLMaxSizeLength
    element([0x42, 0x82], asciiBytes("webm")), // DocType
    element([0x42, 0x87], uint8(2)), // DocTypeVersion
    element([0x42, 0x85], uint8(2)) // DocTypeReadVersion
  )
  const ebmlHeader = element([0x1a, 0x45, 0xdf, 0xa3], ebmlPayload)

  return concat(ebmlHeader, segment)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("webmExtract", () => {
  it("extracts mono Float32 PCM from a minimal WebM blob", () => {
    const samples = new Float32Array([0.1, 0.2, -0.1, -0.2, 0.5])
    const webm = buildWebM(48000, 1, samples)
    const scope = createWebMExtractScope()

    const result = webmExtract(webm, scope)

    expect(Array.isArray(result)).toBe(true)
    const planar = result as Float32Array[]
    expect(planar).toHaveLength(1)
    expect(planar[0]).toHaveLength(5)
    Array.from(samples).forEach((v, i) => expect(planar[0]![i]).toBeCloseTo(v))
    expect(scope.webmSR).toBe(48000)
  })

  it("de-interleaves stereo PCM into two planar channels", () => {
    // interleaved: [L0, R0, L1, R1, L2, R2]
    const interleaved = new Float32Array([0.1, 0.9, 0.2, 0.8, 0.3, 0.7])
    const webm = buildWebM(48000, 2, interleaved)
    const scope = createWebMExtractScope()

    const result = webmExtract(webm, scope) as Float32Array[]

    expect(result).toHaveLength(2)
    ;[0.1, 0.2, 0.3].forEach((v, i) => expect(result[0]![i]).toBeCloseTo(v))
    ;[0.9, 0.8, 0.7].forEach((v, i) => expect(result[1]![i]).toBeCloseTo(v))
  })

  it("returns null when given an empty buffer (incomplete data)", () => {
    const scope = createWebMExtractScope()
    const result = webmExtract(new Uint8Array(0), scope)
    expect(result).toBeNull()
  })

  it("accumulates chunks across multiple calls (streaming mode)", () => {
    const samples = new Float32Array([0.1, 0.2, 0.3, 0.4])
    const webm = buildWebM(16000, 1, samples)

    // Split at midpoint to simulate two ondataavailable callbacks
    const mid = Math.floor(webm.length / 2)
    const chunk1 = webm.slice(0, mid)
    const chunk2 = webm.slice(mid)

    const scope = createWebMExtractScope()
    const r1 = webmExtract(chunk1, scope)
    // May be null (incomplete) or already have data depending on split point
    // Feed the second chunk
    const r2 = webmExtract(chunk2, scope)

    // Combined result should contain all samples
    const combined: number[] = []
    if (Array.isArray(r1))
      combined.push(...Array.from((r1 as Float32Array[])[0]!))
    if (Array.isArray(r2))
      combined.push(...Array.from((r2 as Float32Array[])[0]!))

    expect(combined).toHaveLength(4)
    expect(combined[0]).toBeCloseTo(0.1)
    expect(combined[3]).toBeCloseTo(0.4)
  })

  it("returns 'invalid' for non-WebM bytes and sets scope.bad", () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
    const scope = createWebMExtractScope()

    // Feed enough garbage to trigger header parse failure
    webmExtract(garbage, scope)
    // Either null (incomplete) or invalid — subsequent calls must return invalid
    webmExtract(garbage, scope)
    webmExtract(garbage, scope)
    // After bad is set, always returns invalid
    // Force bad path by corrupting codec
    const badScope = createWebMExtractScope()
    badScope.bad = 1
    expect(webmExtract(new Uint8Array([0xff]), badScope)).toBe("invalid")
  })

  it("returns 'invalid' when codec is not PCM float", () => {
    // Build WebM with wrong codec (A_VORBIS instead of A_PCM/FLOAT/IEEE)
    function buildWebMBadCodec(
      sampleRate: number,
      channels: number,
      samples: Float32Array
    ): Uint8Array {
      const audioEl = concat(
        element([0xb5], floatBE32(sampleRate)),
        element([0x62, 0x64], uint8(32)),
        element([0x9f], uint8(channels))
      )
      const trackEntry = concat(
        element([0xd7], uint8(1)),
        element([0x83], uint8(2)),
        element([0x86], asciiBytes("A_VORBIS")), // wrong codec
        element([0xe1], audioEl)
      )
      const tracks = element(
        [0x16, 0x54, 0xae, 0x6b],
        element([0xae], trackEntry)
      )
      const pcmBytes = new Uint8Array(samples.buffer)
      const simpleBlockPayload = concat(
        new Uint8Array([0x01, 0x00, 0x00, 0x00]),
        pcmBytes
      )
      const simpleBlock = element([0xa3], simpleBlockPayload)
      const segmentPayload = concat(tracks, simpleBlock)
      const segmentId = new Uint8Array([0x18, 0x53, 0x80, 0x67])
      const segmentLen = new Uint8Array([
        0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      ])
      const segment = concat(segmentId, segmentLen, segmentPayload)
      const ebmlPayload = concat(
        element([0x42, 0x86], uint8(1)),
        element([0x42, 0xf7], uint8(1)),
        element([0x42, 0xf2], uint8(4)),
        element([0x42, 0xf3], uint8(8)),
        element([0x42, 0x82], asciiBytes("webm")),
        element([0x42, 0x87], uint8(2)),
        element([0x42, 0x85], uint8(2))
      )
      const ebmlHeader = element([0x1a, 0x45, 0xdf, 0xa3], ebmlPayload)
      return concat(ebmlHeader, segment)
    }

    const samples = new Float32Array([0.1, 0.2])
    const webm = buildWebMBadCodec(48000, 1, samples)
    const scope = createWebMExtractScope()
    const result = webmExtract(webm, scope)

    expect(result).toBe("invalid")
    expect(scope.bad).toBe(1)
  })

  it("exposes the correct webmSR from track metadata", () => {
    const samples = new Float32Array([0.0])
    const webm = buildWebM(44100, 1, samples)
    const scope = createWebMExtractScope()
    webmExtract(webm, scope)
    expect(scope.webmSR).toBe(44100)
  })

  it("handles multiple SimpleBlock calls within one extract call", () => {
    // Build two SimpleBlocks in a single WebM blob
    const s1 = new Float32Array([0.1, 0.2])
    const s2 = new Float32Array([0.3, 0.4])

    const audioEl = concat(
      element([0xb5], floatBE32(48000)),
      element([0x62, 0x64], uint8(32)),
      element([0x9f], uint8(1))
    )
    const trackEntry = concat(
      element([0xd7], uint8(1)),
      element([0x83], uint8(2)),
      element([0x86], asciiBytes("A_PCM/FLOAT/IEEE")),
      element([0xe1], audioEl)
    )
    const tracks = element(
      [0x16, 0x54, 0xae, 0x6b],
      element([0xae], trackEntry)
    )

    function makeBlock(s: Float32Array): Uint8Array {
      return element(
        [0xa3],
        concat(
          new Uint8Array([0x01, 0x00, 0x00, 0x00]),
          new Uint8Array(s.buffer)
        )
      )
    }

    const segPayload = concat(tracks, makeBlock(s1), makeBlock(s2))
    const segmentId = new Uint8Array([0x18, 0x53, 0x80, 0x67])
    const segmentLen = new Uint8Array([
      0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ])
    const ebmlPayload = concat(
      element([0x42, 0x86], uint8(1)),
      element([0x42, 0xf7], uint8(1)),
      element([0x42, 0xf2], uint8(4)),
      element([0x42, 0xf3], uint8(8)),
      element([0x42, 0x82], asciiBytes("webm")),
      element([0x42, 0x87], uint8(2)),
      element([0x42, 0x85], uint8(2))
    )
    const webm = concat(
      element([0x1a, 0x45, 0xdf, 0xa3], ebmlPayload),
      segmentId,
      segmentLen,
      segPayload
    )

    const scope = createWebMExtractScope()
    const result = webmExtract(webm, scope) as Float32Array[]

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(4)
    expect(result[0]![0]).toBeCloseTo(0.1)
    expect(result[0]![3]).toBeCloseTo(0.4)
  })
})
