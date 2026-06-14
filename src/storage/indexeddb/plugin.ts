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
  await Promise.all(
    keys.map((key) =>
      runTransaction(database, "readwrite", (store) => store.delete(key))
    )
  )
}

async function cleanupStaleSessions(
  database: IDBDatabase,
  activeSessionId: string
): Promise<void> {
  const keys = await listAllKeys(database)
  await Promise.all(
    keys
      .filter((key): key is string => {
        if (typeof key !== "string") {
          return false
        }

        return parseSessionIdFromKey(key) !== activeSessionId
      })
      .map((key) =>
        runTransaction(database, "readwrite", (store) => store.delete(key))
      )
  )
}

async function getSessionEntries(
  database: IDBDatabase,
  sessionId: string
): Promise<readonly { key: string; buffer: ArrayBuffer }[]> {
  const keys = await getSessionKeys(database, sessionId)
  const buffers = await Promise.all(
    keys.map((key) => getBufferByKey(database, key))
  )

  return keys
    .map((key, index) => ({
      key,
      buffer: buffers[index],
    }))
    .filter(
      (entry): entry is { key: string; buffer: ArrayBuffer } =>
        entry.buffer instanceof ArrayBuffer
    )
}

async function getSessionKeys(
  database: IDBDatabase,
  sessionId: string
): Promise<readonly string[]> {
  const keys = await listAllKeys(database)
  return keys
    .filter(
      (key): key is string =>
        typeof key === "string" && parseSessionIdFromKey(key) === sessionId
    )
    .sort(compareChunkKeys)
}

function getBufferByKey(
  database: IDBDatabase,
  key: string
): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(key)

    request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined)
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to read IndexedDB snapshot."))
  })
}

function listAllKeys(database: IDBDatabase): Promise<readonly IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .getAllKeys()

    request.onsuccess = () =>
      resolve((request.result as readonly IDBValidKey[]) ?? [])
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to list IndexedDB sessions."))
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
