import type { PcmBufferSnapshot, PcmBufferStore } from "@/buffer/types"
import { mergeChannelChunks } from "@/buffer/pcm-buffer-utils"
import type { AudioFrame } from "@/types"

type PcmLayout = {
  sampleRate: number
  channels: number
}

type PlanarSource = {
  channels: number
  frameCount: number
  durationMs: number
  planar: readonly (Int16Array | undefined)[]
}

/**
 * 纯内存 PCM 缓冲存储。
 *
 * 以平面（planar）格式分声道存储 Int16Array 块列表；
 * 调用 `snapshot()` 时懒合并为单条连续缓冲，并对结果做浅拷贝防止外部篡改。
 * `drainSnapshot()` 可原子地取出快照并立即清空自身，供 promotion 流程使用。
 */
export class InMemoryPcmBufferStore implements PcmBufferStore {
  private layout: PcmLayout | undefined
  private frameCount = 0
  private durationMs = 0
  private planarChunks: Int16Array[][] = []
  private mergedSnapshot: PcmBufferSnapshot | undefined
  private hasSnapshotChanges = false

  appendFrame(frame: AudioFrame): void {
    this.ensureLayout(frame.sampleRate, frame.channels)
    this.appendPlanarSource({
      channels: frame.channels,
      frameCount: 1,
      durationMs: frame.durationMs,
      planar: frame.planar,
    })
  }

  appendSnapshot(snapshot: PcmBufferSnapshot): void {
    this.ensureLayout(snapshot.sampleRate, snapshot.channels)
    this.appendPlanarSource({
      channels: snapshot.channels,
      frameCount: snapshot.frameCount,
      durationMs: snapshot.durationMs,
      planar: snapshot.planar,
    })
  }

  snapshot(): PcmBufferSnapshot | undefined {
    if (!this.layout) {
      return undefined
    }

    if (!this.mergedSnapshot || this.hasSnapshotChanges) {
      this.mergedSnapshot = {
        sampleRate: this.layout.sampleRate,
        channels: this.layout.channels,
        frameCount: this.frameCount,
        durationMs: this.durationMs,
        planar: Array.from(
          { length: this.layout.channels },
          (_, channelIndex) =>
            mergeChannelChunks(this.planarChunks[channelIndex] ?? [])
        ),
      }
      this.hasSnapshotChanges = false
    }

    return cloneSnapshot(this.mergedSnapshot)
  }

  drainSnapshot(): PcmBufferSnapshot | undefined {
    const snapshot = this.snapshot()
    if (!snapshot) {
      return undefined
    }

    this.clear()
    return snapshot
  }

  clear(): void {
    this.layout = undefined
    this.frameCount = 0
    this.durationMs = 0
    this.mergedSnapshot = undefined
    this.hasSnapshotChanges = false
    this.planarChunks = []
  }

  private ensureLayout(sampleRate: number, channels: number): void {
    if (!this.layout) {
      this.layout = { sampleRate, channels }
      // 声道分桶按实际声道数构造，不再写死双声道。
      this.planarChunks = Array.from({ length: channels }, () => [])
      return
    }

    if (sampleRate !== this.layout.sampleRate) {
      throw new Error(
        `PCM buffer store received sampleRate ${sampleRate}, expected ${this.layout.sampleRate}.`
      )
    }
    if (channels !== this.layout.channels) {
      throw new Error(
        `PCM buffer store received ${channels} channel(s), expected ${this.layout.channels}.`
      )
    }
  }

  private appendPlanarSource(source: PlanarSource): void {
    this.frameCount += source.frameCount
    this.durationMs += source.durationMs
    this.hasSnapshotChanges = true

    for (
      let channelIndex = 0;
      channelIndex < source.channels;
      channelIndex += 1
    ) {
      const channelSamples = source.planar[channelIndex]
      if (!channelSamples) {
        throw new Error(
          `PCM data is missing channel data at index ${channelIndex}.`
        )
      }

      this.planarChunks[channelIndex]?.push(channelSamples)
    }
  }
}

function cloneSnapshot(snapshot: PcmBufferSnapshot): PcmBufferSnapshot {
  return {
    sampleRate: snapshot.sampleRate,
    channels: snapshot.channels,
    frameCount: snapshot.frameCount,
    durationMs: snapshot.durationMs,
    planar: snapshot.planar.map((channel) => new Int16Array(channel)),
  }
}
