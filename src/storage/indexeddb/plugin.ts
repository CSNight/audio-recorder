import {
  deserializePcmSnapshot,
  serializePcmSnapshot,
} from "@/storage/snapshot-codec"
import type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
  RecorderPersistenceSessionOptions,
} from "@/storage/types"

const DATABASE_NAME = "audio-recorder"
const STORE_NAME = "sessions"
const CHUNK_KEY_SEPARATOR = "::chunk::"

export function createIndexedDbPersistencePlugin(): RecorderPersistencePlugin {
  return {
    backend: "indexeddb",
    isSupported() {
      return typeof indexedDB !== "undefined"
    },
    async createSession(
      options: RecorderPersistenceSessionOptions
    ): Promise<RecorderPersistenceSession> {
      const database = await openDatabase()
      await cleanupStaleSessions(database, options.sessionId)
      let chunkIndex = await resolveNextChunkIndex(database, options.sessionId)

      return {
        async appendSnapshot(snapshot) {
          await putSnapshot(
            database,
            createChunkKey(options.sessionId, chunkIndex),
            serializePcmSnapshot(snapshot)
          )
          chunkIndex += 1
        },
        async readSnapshots() {
          const buffers = await getSnapshots(database, options.sessionId)
          return buffers.map((buffer) => deserializePcmSnapshot(buffer))
        },
        async clear() {
          await deleteSnapshots(database, options.sessionId)
          chunkIndex = 0
        },
        async close() {
          await deleteSnapshots(database, options.sessionId)
          database.close()
        },
      }
    },
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB."))
  })
}

async function resolveNextChunkIndex(
  database: IDBDatabase,
  sessionId: string
): Promise<number> {
  const keys = await getSessionKeys(database, sessionId)
  const lastKey = keys.at(-1)
  if (!lastKey) {
    return 0
  }

  return parseChunkIndexFromKey(lastKey) + 1
}

function putSnapshot(
  database: IDBDatabase,
  key: string,
  buffer: ArrayBuffer
): Promise<void> {
  return runTransaction(database, "readwrite", (store) =>
    store.put(buffer, key)
  )
}

async function getSnapshots(
  database: IDBDatabase,
  sessionId: string
): Promise<readonly ArrayBuffer[]> {
  const entries = await getSessionEntries(database, sessionId)
  return entries.map((entry) => entry.buffer)
}

async function deleteSnapshots(
  database: IDBDatabase,
  sessionId: string
): Promise<void> {
  const keys = await getSessionKeys(database, sessionId)
  await deleteKeys(database, keys)
}

async function cleanupStaleSessions(
  database: IDBDatabase,
  activeSessionId: string
): Promise<void> {
  const { keys } = await getAllEntries(database)
  const staleKeys = keys.filter(
    (key) => parseSessionIdFromKey(key) !== activeSessionId
  )
  await deleteKeys(database, staleKeys)
}

async function getSessionEntries(
  database: IDBDatabase,
  sessionId: string
): Promise<readonly { key: string; buffer: ArrayBuffer }[]> {
  const { keys, values } = await getAllEntries(database)

  return keys
    .map((key, index) => ({ key, buffer: values[index] }))
    .filter(
      (entry): entry is { key: string; buffer: ArrayBuffer } =>
        parseSessionIdFromKey(entry.key) === sessionId &&
        entry.buffer instanceof ArrayBuffer
    )
    .sort((left, right) => compareChunkKeys(left.key, right.key))
}

async function getSessionKeys(
  database: IDBDatabase,
  sessionId: string
): Promise<readonly string[]> {
  const { keys } = await getAllEntries(database)
  return keys
    .filter((key) => parseSessionIdFromKey(key) === sessionId)
    .sort(compareChunkKeys)
}

// 单个只读事务一次取回全部 key/value（getAllKeys 与 getAll 同序），避免每个 chunk 各开一个事务。
function getAllEntries(database: IDBDatabase): Promise<{
  keys: readonly string[]
  values: readonly (ArrayBuffer | undefined)[]
}> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly")
    const store = transaction.objectStore(STORE_NAME)
    const keysRequest = store.getAllKeys()
    const valuesRequest = store.getAll()

    transaction.oncomplete = () => {
      const rawKeys =
        (keysRequest.result as readonly IDBValidKey[] | null) ?? []
      const rawValues =
        (valuesRequest.result as readonly (ArrayBuffer | undefined)[] | null) ??
        []
      // Filter to string keys only, keeping values aligned by index
      const keys: string[] = []
      const values: (ArrayBuffer | undefined)[] = []
      for (let i = 0; i < rawKeys.length; i++) {
        const key = rawKeys[i]
        if (typeof key === "string") {
          keys.push(key)
          values.push(rawValues[i])
        }
      }
      resolve({ keys, values })
    }
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed to read IndexedDB store."))
  })
}

// 在单个读写事务内批量删除，N 个 chunk 仅一次事务提交。
function deleteKeys(
  database: IDBDatabase,
  keys: readonly string[]
): Promise<void> {
  if (keys.length === 0) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    const store = transaction.objectStore(STORE_NAME)

    for (const key of keys) {
      store.delete(key)
    }

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Failed to delete IndexedDB snapshots.")
      )
  })
}

function createChunkKey(sessionId: string, chunkIndex: number): string {
  return `${sessionId}${CHUNK_KEY_SEPARATOR}${chunkIndex.toString().padStart(8, "0")}`
}

function parseSessionIdFromKey(key: string): string {
  const separatorIndex = key.indexOf(CHUNK_KEY_SEPARATOR)
  if (separatorIndex === -1) {
    return key
  }

  return key.slice(0, separatorIndex)
}

function parseChunkIndexFromKey(key: string): number {
  const separatorIndex = key.indexOf(CHUNK_KEY_SEPARATOR)
  if (separatorIndex === -1) {
    return -1
  }

  return Number.parseInt(
    key.slice(separatorIndex + CHUNK_KEY_SEPARATOR.length),
    10
  )
}

function compareChunkKeys(left: string, right: string): number {
  return parseChunkIndexFromKey(left) - parseChunkIndexFromKey(right)
}

function runTransaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const request = action(store)

    request.onerror = () =>
      reject(
        request.error ?? new Error("IndexedDB transaction request failed.")
      )
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."))
  })
}
