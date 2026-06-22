import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { serializePcmSnapshot } from "@/utils/snapshot-codec"
import { createIndexedDbPersistencePlugin } from "@/storage/indexeddb/plugin"

const DATABASE_NAME = "audio-recorder"
const STORE_NAME = "sessions"

class MockIdbRequest<Result> {
  result!: Result
  error: Error | null = null
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  succeed(result: Result): void {
    this.result = result
    queueMicrotask(() => {
      this.onsuccess?.({} as Event)
    })
  }

  fail(error: Error): void {
    this.error = error
    queueMicrotask(() => {
      this.onerror?.({} as Event)
    })
  }
}

class MockOpenDbRequest extends MockIdbRequest<MockIdbDatabase> {
  onupgradeneeded: ((event: Event) => void) | null = null
}

class MockIdbTransaction {
  error: Error | null = null
  oncomplete: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private completed = false

  constructor(
    private readonly database: MockIdbDatabase,
    private readonly storeName: string
  ) {}

  objectStore(name: string): IDBObjectStore {
    if (name !== this.storeName) {
      throw new Error(`Unknown object store "${name}".`)
    }

    return new MockIdbObjectStore(
      this.database,
      this.database.getStore(name),
      this
    ) as unknown as IDBObjectStore
  }

  complete(): void {
    if (this.completed) {
      return
    }

    this.completed = true
    queueMicrotask(() => {
      this.oncomplete?.({} as Event)
    })
  }

  fail(error: Error): void {
    if (this.completed) {
      return
    }

    this.completed = true
    this.error = error
    queueMicrotask(() => {
      this.onerror?.({} as Event)
    })
  }
}

class MockIdbObjectStore {
  constructor(
    private readonly database: MockIdbDatabase,
    private readonly store: Map<IDBValidKey, unknown>,
    private readonly transaction: MockIdbTransaction
  ) {}

  put(value: unknown, key: IDBValidKey): IDBRequest {
    const request = new MockIdbRequest<IDBValidKey>()

    queueMicrotask(() => {
      try {
        if (this.database.failNextPutRequestWith) {
          const error = this.database.failNextPutRequestWith
          this.database.failNextPutRequestWith = null
          request.fail(error)
          return
        }

        this.store.set(key, value)
        request.succeed(key)
        this.transaction.complete()
      } catch (error) {
        const failure = toError(error, "Failed to put IndexedDB value.")
        request.fail(failure)
        this.transaction.fail(failure)
      }
    })

    return request as unknown as IDBRequest
  }

  get(key: IDBValidKey): IDBRequest {
    const request = new MockIdbRequest<unknown>()

    queueMicrotask(() => {
      try {
        if (this.database.failNextGetWith) {
          const error = this.database.failNextGetWith
          this.database.failNextGetWith = null
          request.fail(error)
          return
        }

        request.succeed(this.store.get(key))
      } catch (error) {
        request.fail(toError(error, "Failed to get IndexedDB value."))
      }
    })

    return request as unknown as IDBRequest
  }

  getAllKeys(): IDBRequest {
    const request = new MockIdbRequest<readonly IDBValidKey[]>()

    queueMicrotask(() => {
      try {
        if (this.database.failNextGetAllKeysWith) {
          const error = this.database.failNextGetAllKeysWith
          this.database.failNextGetAllKeysWith = null
          request.fail(error)
          this.transaction.fail(error)
          return
        }

        request.succeed(Array.from(this.store.keys()))
      } catch (error) {
        const failure = toError(error, "Failed to list IndexedDB keys.")
        request.fail(failure)
        this.transaction.fail(failure)
      }
    })

    return request as unknown as IDBRequest
  }

  getAll(): IDBRequest {
    const request = new MockIdbRequest<readonly unknown[]>()

    queueMicrotask(() => {
      try {
        if (this.database.failNextGetWith) {
          const error = this.database.failNextGetWith
          this.database.failNextGetWith = null
          request.fail(error)
          this.transaction.fail(error)
          return
        }

        request.succeed(Array.from(this.store.values()))
        this.transaction.complete()
      } catch (error) {
        const failure = toError(error, "Failed to get all IndexedDB values.")
        request.fail(failure)
        this.transaction.fail(failure)
      }
    })

    return request as unknown as IDBRequest
  }

  delete(key: IDBValidKey): IDBRequest {
    const request = new MockIdbRequest<undefined>()

    queueMicrotask(() => {
      try {
        if (this.database.failNextDeleteTransactionWith) {
          const error = this.database.failNextDeleteTransactionWith
          this.database.failNextDeleteTransactionWith = null
          request.succeed(undefined)
          this.transaction.fail(error)
          return
        }

        this.store.delete(key)
        request.succeed(undefined)
        this.transaction.complete()
      } catch (error) {
        const failure = toError(error, "Failed to delete IndexedDB value.")
        request.fail(failure)
        this.transaction.fail(failure)
      }
    })

    return request as unknown as IDBRequest
  }
}

class MockIdbDatabase {
  closed = false
  failNextGetAllKeysWith: Error | null = null
  failNextGetWith: Error | null = null
  failNextPutRequestWith: Error | null = null
  failNextDeleteTransactionWith: Error | null = null
  private readonly stores = new Map<string, Map<IDBValidKey, unknown>>()

  get objectStoreNames(): Pick<DOMStringList, "contains"> {
    return {
      contains: (name: string) => this.stores.has(name),
    }
  }

  createObjectStore(name: string): IDBObjectStore {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map())
    }

    return {} as IDBObjectStore
  }

  transaction(name: string): IDBTransaction {
    if (!this.stores.has(name)) {
      throw new Error(`Unknown object store "${name}".`)
    }

    return new MockIdbTransaction(this, name) as unknown as IDBTransaction
  }

  close(): void {
    this.closed = true
  }

  getStore(name: string): Map<IDBValidKey, unknown> {
    const store = this.stores.get(name)
    if (!store) {
      throw new Error(`Unknown object store "${name}".`)
    }

    return store
  }
}

class MockIndexedDbFactory {
  failNextOpenWith: Error | null = null
  private readonly databases = new Map<string, MockIdbDatabase>()

  open(name: string): IDBOpenDBRequest {
    const request = new MockOpenDbRequest()

    queueMicrotask(() => {
      if (this.failNextOpenWith) {
        const error = this.failNextOpenWith
        this.failNextOpenWith = null
        request.fail(error)
        return
      }

      const existingDatabase = this.databases.get(name)
      const database = existingDatabase ?? new MockIdbDatabase()
      request.result = database

      if (!existingDatabase) {
        this.databases.set(name, database)
        request.onupgradeneeded?.({} as Event)
      }

      request.onsuccess?.({} as Event)
    })

    return request as unknown as IDBOpenDBRequest
  }

  getDatabase(name: string): MockIdbDatabase {
    const database = this.databases.get(name)
    if (!database) {
      throw new Error(`Database "${name}" does not exist.`)
    }

    return database
  }

  seedStore(
    databaseName: string,
    storeName: string,
    entries: ReadonlyArray<readonly [IDBValidKey, unknown]>
  ): void {
    const database =
      this.databases.get(databaseName) ??
      (() => {
        const created = new MockIdbDatabase()
        this.databases.set(databaseName, created)
        return created
      })()

    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName)
    }

    const store = database.getStore(storeName)
    for (const [key, value] of entries) {
      store.set(key, value)
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

function getStoreKeys(factory: MockIndexedDbFactory): readonly IDBValidKey[] {
  return Array.from(
    factory.getDatabase(DATABASE_NAME).getStore(STORE_NAME).keys()
  )
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage)
}

describe("createIndexedDbPersistencePlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("requires indexedDB to report support", async () => {
    const plugin = createIndexedDbPersistencePlugin()

    expect(await plugin.isSupported()).toBe(typeof indexedDB !== "undefined")
  })

  it("appends, reads, clears, and closes session snapshots", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "session-indexeddb-1",
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

    await session.appendSnapshot(createSnapshot([500, 600]))
    expect(getStoreKeys(indexedDbFactory)).toEqual([
      "session-indexeddb-1::chunk::00000000",
    ])

    await session.close()

    expect(getStoreKeys(indexedDbFactory)).toEqual([])
    expect(indexedDbFactory.getDatabase(DATABASE_NAME).closed).toBe(true)
  })

  it("cleans stale sessions, keeps active session chunks, and resumes chunk numbering", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.seedStore(DATABASE_NAME, STORE_NAME, [
      [
        "stale-session::chunk::00000000",
        serializePcmSnapshot(createSnapshot([1, 2])),
      ],
      [
        "active-session::chunk::00000001",
        serializePcmSnapshot(createSnapshot([11, 22])),
      ],
      [
        "active-session::chunk::00000000",
        serializePcmSnapshot(createSnapshot([33, 44])),
      ],
      ["active-session::chunk::00000002", "not-a-buffer"],
      [123, serializePcmSnapshot(createSnapshot([55, 66]))],
    ])

    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "active-session",
      startedAt: 2,
    })

    await session.appendSnapshot(createSnapshot([77, 88]))

    const snapshots = await session.readSnapshots()

    expect(snapshots).toHaveLength(3)
    expect(Array.from(snapshots[0]?.planar[0] ?? [])).toEqual([33, 44])
    expect(Array.from(snapshots[1]?.planar[0] ?? [])).toEqual([11, 22])
    expect(Array.from(snapshots[2]?.planar[0] ?? [])).toEqual([77, 88])
    expect(getStoreKeys(indexedDbFactory)).toEqual([
      "active-session::chunk::00000001",
      "active-session::chunk::00000000",
      "active-session::chunk::00000002",
      123,
      "active-session::chunk::00000003",
    ])
  })

  it("rejects createSession when IndexedDB cannot be opened", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.failNextOpenWith = new Error("open failed")
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()

    await expect(
      plugin.createSession({
        sessionId: "session-open-failure",
        startedAt: 3,
      })
    ).rejects.toThrow("open failed")
  })

  it("rejects readSnapshots when listing keys or reading buffers fails", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.seedStore(DATABASE_NAME, STORE_NAME, [
      ["active-session", serializePcmSnapshot(createSnapshot([1, 2]))],
      [
        "active-session::chunk::00000000",
        serializePcmSnapshot(createSnapshot([3, 4])),
      ],
    ])

    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "active-session",
      startedAt: 4,
    })

    indexedDbFactory.getDatabase(DATABASE_NAME).failNextGetAllKeysWith =
      new Error("list failed")
    await expect(session.readSnapshots()).rejects.toThrow("list failed")

    indexedDbFactory.getDatabase(DATABASE_NAME).failNextGetWith = new Error(
      "get failed"
    )
    await expect(session.readSnapshots()).rejects.toThrow("get failed")
  })

  it("rejects write and delete operations when IndexedDB requests or transactions fail", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.seedStore(DATABASE_NAME, STORE_NAME, [
      [
        "active-session::chunk::00000000",
        serializePcmSnapshot(createSnapshot([1, 2])),
      ],
    ])

    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "active-session",
      startedAt: 5,
    })

    indexedDbFactory.getDatabase(DATABASE_NAME).failNextPutRequestWith =
      new Error("put failed")
    await expect(
      session.appendSnapshot(createSnapshot([5, 6]))
    ).rejects.toThrow("put failed")

    indexedDbFactory.getDatabase(DATABASE_NAME).failNextDeleteTransactionWith =
      new Error("delete failed")
    await expect(session.clear()).rejects.toThrow("delete failed")
  })
})
