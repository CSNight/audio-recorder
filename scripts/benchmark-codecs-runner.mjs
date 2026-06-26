#!/usr/bin/env node
import { performance } from "perf_hooks"
import { parseArgs } from "util"

const supportedCodecs = ["pcm", "wav", "mp3", "flac", "opus", "aac", "amr"]
const supportedMaterials = ["tone", "chirp", "noise"]
const streamingFrameMs = 20

const { values } = parseArgs({
  options: {
    codec: {
      type: "string",
      multiple: true,
      default: ["all"],
    },
    rounds: {
      type: "string",
      default: "5",
    },
    warmup: {
      type: "string",
      default: "1",
    },
    "audio-ms": {
      type: "string",
      default: "15000",
    },
  },
})

function parseCodecSelection(codecValues) {
  const rawValues = Array.isArray(codecValues) ? codecValues : [codecValues]
  const selections = rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (selections.length === 0 || selections.includes("all")) {
    return [...supportedCodecs]
  }

  const invalid = selections.filter((value) => !supportedCodecs.includes(value))
  if (invalid.length > 0) {
    throw new Error(`Unknown codec selection: ${invalid.join(", ")}`)
  }

  return [...new Set(selections)]
}

function sum(valuesToSum) {
  return valuesToSum.reduce((total, value) => total + value, 0)
}

function clampUnit(value) {
  return Math.max(-1, Math.min(1, value))
}

function createNoiseGenerator(seed) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 0xffffffff) * 2 - 1
  }
}

function createMaterialSnapshot(sampleRate, durationMs, material) {
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000))
  const planar = [new Int16Array(sampleCount)]
  const channel = planar[0]
  const durationSeconds = sampleCount / sampleRate

  if (material === "tone") {
    const frequency = 997
    for (let index = 0; index < sampleCount; index++) {
      const sample =
        Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.7
      channel[index] = Math.round(sample * 32767)
    }
  } else if (material === "chirp") {
    const startFrequency = 120
    const endFrequency = Math.min(sampleRate * 0.42, 7200)
    const sweepRate = (endFrequency - startFrequency) / durationSeconds
    for (let index = 0; index < sampleCount; index++) {
      const timeSeconds = index / sampleRate
      const phase =
        2 *
        Math.PI *
        (startFrequency * timeSeconds +
          0.5 * sweepRate * timeSeconds * timeSeconds)
      const envelope =
        0.35 +
        0.35 * Math.sin(2 * Math.PI * 1.3 * timeSeconds) ** 2 +
        0.15 * Math.sin(2 * Math.PI * 0.37 * timeSeconds + 0.4) ** 2
      channel[index] = Math.round(clampUnit(Math.sin(phase) * envelope) * 32767)
    }
  } else if (material === "noise") {
    const random = createNoiseGenerator(0x9e3779b9 ^ sampleRate)
    let low = 0
    let band = 0
    for (let index = 0; index < sampleCount; index++) {
      const timeSeconds = index / sampleRate
      const white = random()
      low = low * 0.985 + white * 0.12
      band = band * 0.94 + (white - low) * 0.18
      const envelope =
        0.22 +
        0.48 * Math.sin(2 * Math.PI * 1.9 * timeSeconds) ** 2 +
        0.2 * Math.sin(2 * Math.PI * 3.7 * timeSeconds + 0.6) ** 2
      const mixed = clampUnit((low * 0.65 + band * 0.35) * envelope)
      channel[index] = Math.round(mixed * 32767)
    }
  } else {
    throw new Error(`Unknown material: ${material}`)
  }

  return {
    sampleRate,
    channels: 1,
    frameCount: 1,
    durationMs: (sampleCount / sampleRate) * 1000,
    planar,
  }
}

function getStreamingFrameSamples(sampleRate) {
  return Math.max(1, Math.round((sampleRate * streamingFrameMs) / 1000))
}

function runChunkedEncoder(definition, snapshot, options) {
  const frameSamples = getStreamingFrameSamples(snapshot.sampleRate)
  const encoder = definition.create(options)
  let outputBytes = 0
  let frameCount = 0

  try {
    const totalSamples = snapshot.planar[0]?.length ?? 0

    for (let offset = 0; offset < totalSamples; offset += frameSamples) {
      const nextOffset = Math.min(offset + frameSamples, totalSamples)
      const framePlanar = snapshot.planar.map((channel) =>
        channel.subarray(offset, nextOffset)
      )
      const chunk = encoder.feedFrame(
        snapshot.channels,
        snapshot.sampleRate,
        framePlanar
      )
      if (chunk) {
        outputBytes += chunk.byteLength
      }
      frameCount += 1
    }

    const finalChunk = encoder.flush()
    if (finalChunk) {
      outputBytes += finalChunk.byteLength
    }

    return {
      outputBytes,
      inputFrameSamples: frameSamples,
      inputFrameCount: frameCount,
    }
  } finally {
    encoder.dispose()
  }
}

async function benchmarkCase({
  name,
  codec,
  variant,
  scenario,
  material,
  sampleRate,
  channels,
  inputDescriptor,
  encoderConfig,
  audioMsTotal,
  rounds,
  warmupRounds,
  runRound,
}) {
  let lastRoundMeta = {}

  for (let warmupIndex = 0; warmupIndex < warmupRounds; warmupIndex++) {
    lastRoundMeta = await runRound()
  }

  const roundResults = []
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    const start = performance.now()
    const result = await runRound()
    const elapsedMs = performance.now() - start
    lastRoundMeta = result
    roundResults.push({
      elapsedMs,
      outputBytes: result.outputBytes,
    })
  }

  const elapsedValues = roundResults.map((result) => result.elapsedMs)
  const byteValues = roundResults.map((result) => result.outputBytes)
  const averageElapsedMs = sum(elapsedValues) / elapsedValues.length
  const averageOutputBytes = sum(byteValues) / byteValues.length

  return {
    name,
    codec,
    variant,
    scenario,
    material,
    sampleRate,
    channels,
    rounds,
    warmupRounds,
    audioMsTotal,
    inputDescriptor,
    encoderConfig,
    averageElapsedMs,
    minElapsedMs: Math.min(...elapsedValues),
    maxElapsedMs: Math.max(...elapsedValues),
    averageOutputBytes,
    realtimeFactor: audioMsTotal / averageElapsedMs,
    roundResults,
    ...lastRoundMeta,
  }
}

async function benchmarkMaterialSet({
  cases,
  codec,
  variant = "default",
  scenario,
  sampleRate,
  targetAudioMs,
  rounds,
  warmupRounds,
  inputDescriptor,
  encoderConfig,
  runRoundFactory,
}) {
  for (const material of supportedMaterials) {
    const snapshot = createMaterialSnapshot(sampleRate, targetAudioMs, material)
    cases.push(
      await benchmarkCase({
        name: `${codec}${variant === "default" ? "" : `-${variant}`}/${scenario}/${material}`,
        codec,
        variant,
        scenario,
        material,
        sampleRate: snapshot.sampleRate,
        channels: snapshot.channels,
        inputDescriptor,
        encoderConfig,
        audioMsTotal: snapshot.durationMs,
        rounds,
        warmupRounds,
        runRound: () => runRoundFactory(snapshot),
      })
    )
  }
}

async function run() {
  const codecs = parseCodecSelection(values.codec)
  const rounds = parseInt(values.rounds, 10)
  const warmupRounds = parseInt(values.warmup, 10)
  const targetAudioMs = parseInt(values["audio-ms"], 10)

  if (Number.isNaN(rounds) || rounds <= 0) {
    throw new Error(`Invalid rounds value: ${values.rounds}`)
  }
  if (Number.isNaN(warmupRounds) || warmupRounds < 0) {
    throw new Error(`Invalid warmup value: ${values.warmup}`)
  }
  if (Number.isNaN(targetAudioMs) || targetAudioMs <= 0) {
    throw new Error(`Invalid audio-ms value: ${values["audio-ms"]}`)
  }

  const cases = []

  if (codecs.includes("pcm") || codecs.includes("wav")) {
    const base = await import("../dist/codecs/base/index.js")

    if (codecs.includes("pcm")) {
      await benchmarkMaterialSet({
        cases,
        codec: "pcm",
        scenario: "snapshot",
        sampleRate: 48000,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: "full snapshot",
        encoderConfig: { bitRate: 16 },
        runRoundFactory(snapshot) {
          return {
            outputBytes: base.pcmSnapshotEncoderDefinition.export(snapshot, {
              bitRate: 16,
            }).data.byteLength,
          }
        },
      })

      await benchmarkMaterialSet({
        cases,
        codec: "pcm",
        scenario: "streaming",
        sampleRate: 48000,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: `${streamingFrameMs} ms PCM frames`,
        encoderConfig: { bitsPerSample: 16 },
        runRoundFactory(snapshot) {
          return runChunkedEncoder(base.pcmChunkedEncoderDefinition, snapshot, {
            bitsPerSample: 16,
          })
        },
      })
    }

    if (codecs.includes("wav")) {
      await benchmarkMaterialSet({
        cases,
        codec: "wav",
        scenario: "snapshot",
        sampleRate: 48000,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: "full snapshot",
        encoderConfig: { bitRate: 16 },
        runRoundFactory(snapshot) {
          return {
            outputBytes: base.wavSnapshotEncoderDefinition.export(snapshot, {
              bitRate: 16,
            }).arrayBuffer.byteLength,
          }
        },
      })

      await benchmarkMaterialSet({
        cases,
        codec: "wav",
        scenario: "streaming",
        sampleRate: 48000,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: `${streamingFrameMs} ms PCM frames`,
        encoderConfig: { bitsPerSample: 16, framesPerChunk: 100 },
        runRoundFactory(snapshot) {
          return runChunkedEncoder(base.wavChunkedEncoderDefinition, snapshot, {
            bitsPerSample: 16,
            framesPerChunk: 100,
          })
        },
      })
    }
  }

  if (codecs.includes("mp3")) {
    const mp3 = await import("../dist/codecs/mp3/index.js")

    await benchmarkMaterialSet({
      cases,
      codec: "mp3",
      scenario: "snapshot",
      sampleRate: 48000,
      targetAudioMs,
      rounds,
      warmupRounds,
      inputDescriptor: "full snapshot",
      encoderConfig: { bitrateKbps: 128 },
      runRoundFactory(snapshot) {
        return {
          outputBytes: mp3.mp3SnapshotEncoderDefinition.export(snapshot, {
            bitrateKbps: 128,
          }).data.byteLength,
        }
      },
    })

    await benchmarkMaterialSet({
      cases,
      codec: "mp3",
      scenario: "streaming",
      sampleRate: 48000,
      targetAudioMs,
      rounds,
      warmupRounds,
      inputDescriptor: `${streamingFrameMs} ms PCM frames`,
      encoderConfig: { bitrateKbps: 128 },
      runRoundFactory(snapshot) {
        return runChunkedEncoder(mp3.mp3ChunkedEncoderDefinition, snapshot, {
          bitrateKbps: 128,
        })
      },
    })
  }

  if (codecs.includes("flac")) {
    const flac = await import("../dist/codecs/flac/index.js")
    await flac.flacSnapshotEncoderDefinition.preload?.()
    await flac.flacChunkedEncoderDefinition.preload?.()

    await benchmarkMaterialSet({
      cases,
      codec: "flac",
      scenario: "snapshot",
      sampleRate: 48000,
      targetAudioMs,
      rounds,
      warmupRounds,
      inputDescriptor: "full snapshot",
      encoderConfig: { compressionLevel: 5, bitsPerSample: 16 },
      runRoundFactory(snapshot) {
        return {
          outputBytes: flac.flacSnapshotEncoderDefinition.export(snapshot, {
            compressionLevel: 5,
            bitsPerSample: 16,
          }).data.byteLength,
        }
      },
    })

    await benchmarkMaterialSet({
      cases,
      codec: "flac",
      scenario: "streaming",
      sampleRate: 48000,
      targetAudioMs,
      rounds,
      warmupRounds,
      inputDescriptor: `${streamingFrameMs} ms PCM frames`,
      encoderConfig: {
        sampleRate: 48000,
        channels: 1,
        compressionLevel: 5,
        bitsPerSample: 16,
      },
      runRoundFactory(snapshot) {
        return runChunkedEncoder(flac.flacChunkedEncoderDefinition, snapshot, {
          sampleRate: snapshot.sampleRate,
          channels: snapshot.channels,
          compressionLevel: 5,
          bitsPerSample: 16,
        })
      },
    })
  }

  if (codecs.includes("opus")) {
    const opus = await import("../dist/codecs/opus/index.js")
    await opus.oggSnapshotEncoderDefinition.preload?.()
    await opus.webmSnapshotEncoderDefinition.preload?.()
    await opus.oggChunkedEncoderDefinition.preload?.()
    await opus.webmChunkedEncoderDefinition.preload?.()

    const opusVariants = [
      {
        variant: "ogg",
        snapshotDefinition: opus.oggSnapshotEncoderDefinition,
        chunkedDefinition: opus.oggChunkedEncoderDefinition,
      },
      {
        variant: "webm",
        snapshotDefinition: opus.webmSnapshotEncoderDefinition,
        chunkedDefinition: opus.webmChunkedEncoderDefinition,
      },
    ]

    for (const variantConfig of opusVariants) {
      const encoderConfig = {
        sampleRate: 48000,
        channels: 1,
        bitrate: 128000,
        application: "audio",
        complexity: 10,
        vbr: true,
      }

      await benchmarkMaterialSet({
        cases,
        codec: "opus",
        variant: variantConfig.variant,
        scenario: "snapshot",
        sampleRate: 48000,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: "full snapshot",
        encoderConfig,
        runRoundFactory(snapshot) {
          return {
            outputBytes: variantConfig.snapshotDefinition.export(snapshot, {
              bitrate: 128000,
              application: "audio",
              complexity: 10,
              vbr: true,
            }).data.byteLength,
          }
        },
      })

      await benchmarkMaterialSet({
        cases,
        codec: "opus",
        variant: variantConfig.variant,
        scenario: "streaming",
        sampleRate: 48000,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: `${streamingFrameMs} ms PCM frames`,
        encoderConfig,
        runRoundFactory(snapshot) {
          return runChunkedEncoder(variantConfig.chunkedDefinition, snapshot, {
            sampleRate: snapshot.sampleRate,
            channels: snapshot.channels,
            bitrate: 128000,
            application: "audio",
            complexity: 10,
            vbr: true,
          })
        },
      })
    }
  }

  if (codecs.includes("aac")) {
    const aac = await import("../dist/codecs/aac/index.js")
    await aac.aacSnapshotEncoderDefinition.preload?.()
    await aac.aacChunkedEncoderDefinition.preload?.()

    await benchmarkMaterialSet({
      cases,
      codec: "aac",
      scenario: "snapshot",
      sampleRate: 48000,
      targetAudioMs,
      rounds,
      warmupRounds,
      inputDescriptor: "full snapshot",
      encoderConfig: { bitrate: 128000 },
      runRoundFactory(snapshot) {
        return {
          outputBytes: aac.aacSnapshotEncoderDefinition.export(snapshot, {
            bitrate: 128000,
          }).data.byteLength,
        }
      },
    })

    await benchmarkMaterialSet({
      cases,
      codec: "aac",
      scenario: "streaming",
      sampleRate: 48000,
      targetAudioMs,
      rounds,
      warmupRounds,
      inputDescriptor: `${streamingFrameMs} ms PCM frames`,
      encoderConfig: { bitrate: 128000 },
      runRoundFactory(snapshot) {
        return runChunkedEncoder(aac.aacChunkedEncoderDefinition, snapshot, {
          bitrate: 128000,
        })
      },
    })
  }

  if (codecs.includes("amr")) {
    const amr = await import("../dist/codecs/amr/index.js")
    await amr.amrSnapshotEncoderDefinition.preload?.()
    await amr.amrChunkedEncoderDefinition.preload?.()

    for (const bandMode of ["nb", "wb"]) {
      const sampleRate = bandMode === "nb" ? 8000 : 16000

      await benchmarkMaterialSet({
        cases,
        codec: "amr",
        variant: bandMode,
        scenario: "snapshot",
        sampleRate,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: "full snapshot",
        encoderConfig: { bandMode },
        runRoundFactory(snapshot) {
          return {
            outputBytes: amr.amrSnapshotEncoderDefinition.export(snapshot, {
              bandMode,
            }).data.byteLength,
          }
        },
      })

      await benchmarkMaterialSet({
        cases,
        codec: "amr",
        variant: bandMode,
        scenario: "streaming",
        sampleRate,
        targetAudioMs,
        rounds,
        warmupRounds,
        inputDescriptor: `${streamingFrameMs} ms PCM frames`,
        encoderConfig: { bandMode },
        runRoundFactory(snapshot) {
          return runChunkedEncoder(amr.amrChunkedEncoderDefinition, snapshot, {
            bandMode,
          })
        },
      })
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    audioMs: targetAudioMs,
    rounds,
    warmupRounds,
    codecs,
    materials: supportedMaterials,
    streamingFrameMs,
    channels: 1,
    cases,
  }

  process.stdout.write(`${JSON.stringify(result)}\n`)
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`
  )
  process.exit(1)
})
