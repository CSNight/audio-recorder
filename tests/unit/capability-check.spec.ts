import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkRecorderCapability } from "@/input/capability-check"

describe("checkRecorderCapability", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reports audio-worklet strategy when AudioContext, getUserMedia, and AudioWorkletNode are available", () => {
    vi.stubGlobal("AudioContext", class {})
    vi.stubGlobal("AudioWorkletNode", class {})
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => {} },
    })
    vi.stubGlobal("MediaRecorder", undefined)

    const report = checkRecorderCapability()

    expect(report.hasAudioContext).toBe(true)
    expect(report.hasGetUserMedia).toBe(true)
    expect(report.hasAudioWorklet).toBe(true)
    expect(report.hasMediaRecorderWebMPcm).toBe(false)
    expect(report.expectedInputStrategy).toBe("audio-worklet")
  })

  it("reports script-processor strategy when AudioWorkletNode is absent", () => {
    vi.stubGlobal("AudioContext", class {})
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => {} },
    })

    const report = checkRecorderCapability()

    expect(report.hasAudioContext).toBe(true)
    expect(report.hasAudioWorklet).toBe(false)
    expect(report.expectedInputStrategy).toBe("script-processor")
  })

  it("reports unsupported when AudioContext is absent", () => {
    vi.stubGlobal("AudioContext", undefined)
    vi.stubGlobal("webkitAudioContext", undefined)
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => {} },
    })

    const report = checkRecorderCapability()

    expect(report.hasAudioContext).toBe(false)
    expect(report.expectedInputStrategy).toBe("unsupported")
  })

  it("reports unsupported when getUserMedia is absent", () => {
    vi.stubGlobal("AudioContext", class {})
    vi.stubGlobal("AudioWorkletNode", class {})
    vi.stubGlobal("navigator", { mediaDevices: {} })

    const report = checkRecorderCapability()

    expect(report.hasGetUserMedia).toBe(false)
    expect(report.expectedInputStrategy).toBe("unsupported")
  })

  it("detects webkitAudioContext as a valid AudioContext", () => {
    vi.stubGlobal("AudioContext", undefined)
    vi.stubGlobal("webkitAudioContext", class {})
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => {} },
    })

    const report = checkRecorderCapability()

    expect(report.hasAudioContext).toBe(true)
    expect(report.expectedInputStrategy).toBe("script-processor")
  })

  it("detects MediaRecorder webm/pcm support when isTypeSupported returns true", () => {
    vi.stubGlobal("AudioContext", class {})
    vi.stubGlobal("AudioWorkletNode", class {})
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => {} },
    })
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type: string) => type === "audio/webm; codecs=pcm",
    })

    const report = checkRecorderCapability()

    expect(report.hasMediaRecorderWebMPcm).toBe(true)
  })

  it("returns false for hasMediaRecorderWebMPcm when isTypeSupported returns false", () => {
    vi.stubGlobal("AudioContext", class {})
    vi.stubGlobal("AudioWorkletNode", class {})
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => {} },
    })
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: () => false,
    })

    const report = checkRecorderCapability()

    expect(report.hasMediaRecorderWebMPcm).toBe(false)
  })
})
