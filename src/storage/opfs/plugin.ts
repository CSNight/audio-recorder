import { deserializePcmSnapshot, serializePcmSnapshot } from "audio-recorder"
import type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
  RecorderPersistenceSessionOptions,
} from "@/storage/types"

// OPFS 根目录名，所有会话子目录都挂在这一目录下
const ROOT_DIRECTORY = "audio-recorder"

/**
 * 基于 Origin Private File System (OPFS) 的持久化插件。
 * 每个录音 session 对应一个子目录，快照按 chunk 分文件存储，
 * 避免单文件无限增长，也便于增量写入和清理。
 */
export function createOpfsPersistencePlugin(): RecorderPersistencePlugin {
  return {
    backend: "opfs",
    isSupported() {
      return (
        typeof navigator !== "undefined" &&
        "storage" in navigator &&
        typeof navigator.storage?.getDirectory === "function"
      )
    },
    async createSession(
      options: RecorderPersistenceSessionOptions
    ): Promise<RecorderPersistenceSession> {
      const root = await navigator.storage.getDirectory()
      const baseDirectory = await root.getDirectoryHandle(ROOT_DIRECTORY, {
        create: true,
      })
      // 清理上一次未正常关闭遗留的过期会话目录，避免 OPFS 空间无限增长
      await cleanupExpiredSessionDirectories(baseDirectory, options.sessionId)
      const sessionDirectory = await baseDirectory.getDirectoryHandle(
        options.sessionId,
        { create: true }
      )
      let chunkIndex = await resolveNextChunkIndex(sessionDirectory)

      return {
        async appendSnapshot(snapshot) {
          const snapshotFile = await sessionDirectory.getFileHandle(
            createChunkFilename(chunkIndex),
            {
              create: true,
            }
          )
          const writable = await snapshotFile.createWritable()
          await writable.write(serializePcmSnapshot(snapshot))
          await writable.close()
          chunkIndex += 1
        },
        async readSnapshots() {
          const chunkNames = await listChunkFilenames(sessionDirectory)
          const snapshots = []

          for (const chunkName of chunkNames) {
            const snapshotFile = await sessionDirectory.getFileHandle(chunkName)
            const file = await snapshotFile.getFile()
            if (file.size === 0) {
              continue
            }

            snapshots.push(deserializePcmSnapshot(await file.arrayBuffer()))
          }

          return snapshots
        },
        async clear() {
          const chunkNames = await listChunkFilenames(sessionDirectory)
          await Promise.all(
            chunkNames.map(async (chunkName) => {
              try {
                await sessionDirectory.removeEntry(chunkName)
              } catch {
                return
              }
            })
          )
          chunkIndex = 0
        },
        async close() {
          try {
            await baseDirectory.removeEntry(options.sessionId, {
              recursive: true,
            })
          } catch {
            return
          }
        },
      }
    },
  }
}

async function resolveNextChunkIndex(
  sessionDirectory: FileSystemDirectoryHandle
): Promise<number> {
  const chunkNames = await listChunkFilenames(sessionDirectory)
  const lastChunkName = chunkNames[chunkNames.length - 1]
  if (!lastChunkName) {
    return 0
  }

  return parseChunkIndexFromFilename(lastChunkName) + 1
}

async function listChunkFilenames(
  sessionDirectory: FileSystemDirectoryHandle
): Promise<readonly string[]> {
  const chunkNames = []

  for await (const [name, handle] of sessionDirectory.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".bin")) {
      continue
    }

    chunkNames.push(name)
  }

  return chunkNames.sort(compareChunkFilenames)
}

function createChunkFilename(chunkIndex: number): string {
  return `chunk-${chunkIndex.toString().padStart(8, "0")}.bin`
}

function parseChunkIndexFromFilename(filename: string): number {
  return Number.parseInt(filename.slice(6, -4), 10)
}

function compareChunkFilenames(left: string, right: string): number {
  return parseChunkIndexFromFilename(left) - parseChunkIndexFromFilename(right)
}

async function cleanupExpiredSessionDirectories(
  baseDirectory: FileSystemDirectoryHandle,
  activeSessionId: string
): Promise<void> {
  for await (const [name] of baseDirectory.entries()) {
    if (name === activeSessionId) {
      continue
    }

    try {
      await baseDirectory.removeEntry(name, { recursive: true })
    } catch {
      return
    }
  }
}
