import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PcmBufferSnapshot } from "../../src"
import { serializePcmSnapshot } from "../../src"
import { createOpfsPersistencePlugin, isSupport } from "../../src/storage/opfs"

const ROOT_DIRECTORY = "audio-recorder"

class MockWritableFileStream {
  constructor(private readonly fileHandle: MockFileHandle) {}

  async write(data: ArrayBuffer): Promise<void> {
    this.fileHandle.buffer = data.slice(0)
  }

  async close(): Promise<void> {
    return
  }
}

class MockFileHandle {
  kind = "file" as const
  buffer = new ArrayBuffer(0)

  constructor(public readonly name: string) {}

  async createWritable(): Promise<MockWritableFileStream> {
    return new MockWritableFileStream(this)
  }

  async getFile(): Promise<{
    size: number
    arrayBuffer: () => Promise<ArrayBuffer>
  }> {
    return {
      size: this.buffer.byteLength,
      arrayBuffer: async () => this.buffer.slice(0),
    }
  }
}

class MockDirectoryHandle {
  kind = "directory" as const
  private readonly directories = new Map<string, MockDirectoryHandle>()
  private readonly files = new Map<string, MockFileHandle>()

  constructor(public readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MockDirectoryHandle> {
    const existing = this.directories.get(name)
    if (existing) {
      return existing
    }

    if (!options?.create) {
      throw new Error(`Directory "${name}" does not exist.`)
    }

    const directory = new MockDirectoryHandle(name)
    this.directories.set(name, directory)
    return directory
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MockFileHandle> {
    const existing = this.files.get(name)
    if (existing) {
      return existing
    }

    if (!options?.create) {
      throw new Error(`File "${name}" does not exist.`)
    }

    const file = new MockFileHandle(name)
    this.files.set(name, file)
    return file
  }

  async removeEntry(
    name: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    if (this.files.delete(name)) {
      return
    }

    const directory = this.directories.get(name)
    if (!directory) {
      throw new Error(`Entry "${name}" does not exist.`)
    }

    if (
      !options?.recursive &&
      (directory.files.size > 0 || directory.directories.size > 0)
    ) {
      throw new Error(`Directory "${name}" is not empty.`)
    }

    this.directories.delete(name)
  }

  async *entries(): AsyncIterable<
    [string, MockDirectoryHandle | MockFileHandle]
  > {
    for (const entry of this.directories) {
      yield entry
    }
    for (const entry of this.files) {
      yield entry
    }
  }
}

function createSnapshot(samples: readonly number[]): PcmBufferSnapshot {
  return {
    sampleRate: 16_000,
    channels: 1,
    frameCount: 1,
    durationMs: 10,
    planar: [new Int16Array(samples)],
  }
}

async function getRootStorageDirectory(
  rootDirectory: MockDirectoryHandle
): Promise<MockDirectoryHandle> {
  return rootDirectory.getDirectoryHandle(ROOT_DIRECTORY)
}

describe("createOpfsPersistencePlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("exports a static OPFS support probe and keeps instance checks compatible", () => {
    const plugin = createOpfsPersistencePlugin()

    expect(isSupport()).toBe(
      typeof navigator !== "undefined" &&
        "storage" in navigator &&
        typeof navigator.storage?.getDirectory === "function"
    )
    expect(plugin.isSupported()).toBe(isSupport())
  })

  it("appends, reads, clears, and closes chunked session files", async () => {
    const rootDirectory = new MockDirectoryHandle("root")
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: async () => rootDirectory,
      },
    })

    const plugin = createOpfsPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "session-opfs-1",
      startedAt: 1,
    })

    await session.appendSnapshot(createSnapshot([100, 200]))
    await session.appendSnapshot(createSnapshot([300, 400]))

    const snapshots = await session.readSnapshots()

    expect(snapshots).toHaveLength(2)
    expect(Array.from(snapshots[0]?.planar[0] ?? [])).toEqual([100, 200])
    expect(Array.from(snapshots[1]?.planar[0] ?? [])).toEqual([300, 400])

    await session.clear()
    await expect(session.readSnapshots()).resolves.toEqual([])

    const baseDirectory = await getRootStorageDirectory(rootDirectory)
    await baseDirectory.getDirectoryHandle("session-opfs-1")

    await session.close()

    await expect(
      baseDirectory.getDirectoryHandle("session-opfs-1")
    ).rejects.toThrow('Directory "session-opfs-1" does not exist.')
  })

  it("cleans up stale session directories before creating a new session", async () => {
    const rootDirectory = new MockDirectoryHandle("root")
    const baseDirectory = await rootDirectory.getDirectoryHandle(
      ROOT_DIRECTORY,
      {
        create: true,
      }
    )
    const staleDirectory = await baseDirectory.getDirectoryHandle(
      "stale-session",
      {
        create: true,
      }
    )
    const staleFile = await staleDirectory.getFileHandle("chunk-00000000.bin", {
      create: true,
    })
    staleFile.buffer = new Uint8Array([1, 2, 3]).buffer

    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: async () => rootDirectory,
      },
    })

    const plugin = createOpfsPersistencePlugin()
    await plugin.createSession({
      sessionId: "active-session",
      startedAt: 2,
    })

    await expect(
      baseDirectory.getDirectoryHandle("stale-session")
    ).rejects.toThrow('Directory "stale-session" does not exist.')
    await expect(
      baseDirectory.getDirectoryHandle("active-session")
    ).resolves.toBeDefined()
  })

  it("resumes chunk indexing for an existing session and ignores empty or non-bin entries", async () => {
    const rootDirectory = new MockDirectoryHandle("root")
    const baseDirectory = await rootDirectory.getDirectoryHandle(
      ROOT_DIRECTORY,
      {
        create: true,
      }
    )
    const sessionDirectory = await baseDirectory.getDirectoryHandle(
      "active-session",
      {
        create: true,
      }
    )
    const existingChunk = await sessionDirectory.getFileHandle(
      "chunk-00000000.bin",
      {
        create: true,
      }
    )
    existingChunk.buffer = serializePcmSnapshot(createSnapshot([11, 22]))

    await sessionDirectory.getFileHandle("chunk-00000001.bin", {
      create: true,
    })
    await sessionDirectory.getFileHandle("notes.txt", {
      create: true,
    })
    await sessionDirectory.getDirectoryHandle("nested", {
      create: true,
    })

    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: async () => rootDirectory,
      },
    })

    const plugin = createOpfsPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "active-session",
      startedAt: 3,
    })

    await session.appendSnapshot(createSnapshot([33, 44]))

    const snapshots = await session.readSnapshots()

    expect(snapshots).toHaveLength(2)
    expect(Array.from(snapshots[0]?.planar[0] ?? [])).toEqual([11, 22])
    expect(Array.from(snapshots[1]?.planar[0] ?? [])).toEqual([33, 44])
  })

  it("swallows chunk removal failures during clear and resets chunk numbering", async () => {
    const rootDirectory = new MockDirectoryHandle("root")
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: async () => rootDirectory,
      },
    })

    const plugin = createOpfsPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "session-clear-errors",
      startedAt: 4,
    })

    await session.appendSnapshot(createSnapshot([100, 200]))

    const baseDirectory = await getRootStorageDirectory(rootDirectory)
    const sessionDirectory = await baseDirectory.getDirectoryHandle(
      "session-clear-errors"
    )
    const originalRemoveEntry =
      sessionDirectory.removeEntry.bind(sessionDirectory)

    vi.spyOn(sessionDirectory, "removeEntry").mockImplementation(
      async (name, options) => {
        if (name === "chunk-00000000.bin") {
          throw new Error("Simulated OPFS remove failure.")
        }

        return originalRemoveEntry(name, options)
      }
    )

    await expect(session.clear()).resolves.toBeUndefined()

    await session.appendSnapshot(createSnapshot([300, 400]))

    const snapshots = await session.readSnapshots()
    expect(snapshots).toHaveLength(1)
    expect(Array.from(snapshots[0]?.planar[0] ?? [])).toEqual([300, 400])
  })

  it("swallows session directory removal failures during close", async () => {
    const rootDirectory = new MockDirectoryHandle("root")
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: async () => rootDirectory,
      },
    })

    const plugin = createOpfsPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "session-close-errors",
      startedAt: 5,
    })

    const baseDirectory = await getRootStorageDirectory(rootDirectory)
    vi.spyOn(baseDirectory, "removeEntry").mockRejectedValue(
      new Error("Simulated OPFS close failure.")
    )

    await expect(session.close()).resolves.toBeUndefined()
  })
})
