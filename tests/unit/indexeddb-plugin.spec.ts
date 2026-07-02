import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { serializePcmSnapshot } from "@/utils/snapshot-codec"
import { createIndexedDbPersistencePlugin } from "@/storage/indexeddb/plugin"

const DATABASE_NAME = "csnight-audio-recorder"
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

        if (this.database.failNextPutWithBothErrors) {
          const error = this.database.failNextPutWithBothErrors
          this.database.failNextPutWithBothErrors = null
          // Fire request.fail() which schedules request.onerror via queueMicrotask,
          // then also schedule transaction.onerror in a subsequent microtask.
          // Both fire after the source code attaches handlers synchronously.
          // First call: rejectOnce → rejected=true, reject(error) [lines 262-264]
          // Second call: rejectOnce → if (rejected) return [line 262 guard]
          request.fail(error)
          queueMicrotask(() => {
            this.transaction.error = error
            this.transaction.onerror?.({} as Event)
          })
          return
        }

        if (this.database.failNextPutWithNullError) {
          this.database.failNextPutWithNullError = false
          // Fire transaction.onerror with transaction.error=null to hit the
          // ?? fallback: reject(null ?? new Error("IndexedDB transaction failed."))
          // This covers the right-hand side of the ?? on line 264.
          this.transaction.error = null
          queueMicrotask(() => {
            this.transaction.onerror?.({} as Event)
          })
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

        if (this.database.failNextGetAllWithNullResults) {
          // Return null result to cover the `?? []` fallback on lines 173-175
          // Don't call succeed/fail — let getAll() drive oncomplete
          ;(request as unknown as { result: null }).result = null
          queueMicrotask(() => {
            request.onsuccess?.({} as Event)
          })
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

        if (this.database.failNextGetAllWithNullResults) {
          this.database.failNextGetAllWithNullResults = false
          // Return null result to cover the `?? []` fallback on lines 174-175
          ;(request as unknown as { result: null }).result = null
          queueMicrotask(() => {
            request.onsuccess?.({} as Event)
            // Complete the transaction so oncomplete fires
            this.transaction.complete()
          })
          return
        }

        if (this.database.failNextGetAllTransactionWithNullError) {
          this.database.failNextGetAllTransactionWithNullError = false
          // Fire transaction.onerror with null error to cover line 190
          this.transaction.error = null
          queueMicrotask(() => {
            this.transaction.onerror?.({} as Event)
          })
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

        if (this.database.failNextDeleteTransactionWithNullError) {
          this.database.failNextDeleteTransactionWithNullError = false
          request.succeed(undefined)
          // fire onerror with transaction.error=null to test the ?? fallback
          this.transaction.error = null
          queueMicrotask(() => {
            this.transaction.onerror?.({} as Event)
          })
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
  failNextPutWithBothErrors: Error | null = null
  failNextPutWithNullError = false
  failNextDeleteTransactionWith: Error | null = null
  failNextDeleteTransactionWithNullError = false
  failNextGetAllWithNullResults = false
  failNextGetAllTransactionWithNullError = false
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
  failNextOpenWithNullError = false
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

      if (this.failNextOpenWithNullError) {
        this.failNextOpenWithNullError = false
        // Fire onerror with request.error=null to cover the ?? fallback on line 71
        request.error = null
        queueMicrotask(() => {
          request.onerror?.({} as Event)
        })
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

  it("rejects createSession with fallback message when open request.error is null", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.failNextOpenWithNullError = true
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()

    await expect(
      plugin.createSession({
        sessionId: "session-open-null-error",
        startedAt: 3,
      })
    ).rejects.toThrow("Failed to open IndexedDB.")
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

  it("resolveNextChunkIndex returns 0 when session has no existing chunks", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    // 全新 session，无任何 chunk → resolveNextChunkIndex 走 !lastKey → return 0
    const session = await plugin.createSession({
      sessionId: "brand-new-session",
      startedAt: 10,
    })
    // 第一次写入的 key 应以 00000000 结尾
    await session.appendSnapshot(createSnapshot([1, 2]))
    expect(getStoreKeys(indexedDbFactory)).toEqual([
      "brand-new-session::chunk::00000000",
    ])
  })

  it("cleanupStaleSessions skips keys without CHUNK_KEY_SEPARATOR", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    // 预置一个不含分隔符的 key（纯数字 key 等），不应被删除
    indexedDbFactory.seedStore(DATABASE_NAME, STORE_NAME, [
      ["no-separator-key", new ArrayBuffer(0)],
      ["stale::chunk::00000000", serializePcmSnapshot(createSnapshot([1, 2]))],
    ])
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    await plugin.createSession({ sessionId: "current", startedAt: 11 })

    // stale::chunk::00000000 应被删除，no-separator-key 不含分隔符应保留
    const remainingKeys = Array.from(
      indexedDbFactory.getDatabase(DATABASE_NAME).getStore(STORE_NAME).keys()
    )
    expect(remainingKeys).not.toContain("stale::chunk::00000000")
    expect(remainingKeys).toContain("no-separator-key")
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

  it("deleteKeys: rejects with fallback message when transaction.error is null", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.seedStore(DATABASE_NAME, STORE_NAME, [
      [
        "del-session::chunk::00000000",
        serializePcmSnapshot(createSnapshot([1, 2])),
      ],
    ])
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "del-session",
      startedAt: 1,
    })

    // 触发 transaction.error=null 路径，期望使用 fallback 消息
    indexedDbFactory.getDatabase(
      DATABASE_NAME
    ).failNextDeleteTransactionWithNullError = true
    await expect(session.clear()).rejects.toThrow(
      "Failed to delete IndexedDB snapshots."
    )
  })

  it("runTransaction: rejectOnce prevents double-rejection when both request.onerror and transaction.onerror fire", async () => {
    // 使 put request 失败（request.onerror 触发），同时 mock 触发 transaction.onerror
    // 验证 rejectOnce 防重入不会导致未捕获的 rejection
    const indexedDbFactory = new MockIndexedDbFactory()
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "rejectonce-session",
      startedAt: 1,
    })

    // failNextPutWithBothErrors 同时触发 request.onerror 和 transaction.onerror
    // 第一次调用 rejectOnce → rejected=true，reject(error)
    // 第二次调用 rejectOnce → if (rejected) return  ← 覆盖 lines 262-264
    indexedDbFactory.getDatabase(DATABASE_NAME).failNextPutWithBothErrors =
      new Error("put-and-txn-fail")
    await expect(
      session.appendSnapshot(createSnapshot([9, 8]))
    ).rejects.toThrow("put-and-txn-fail")
  })

  it("runTransaction: rejectOnce uses fallback message when transaction.error is null", async () => {
    // 触发 transaction.onerror 且 transaction.error=null，覆盖 line 264 的 ?? 右侧分支
    const indexedDbFactory = new MockIndexedDbFactory()
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "rejectonce-null-session",
      startedAt: 1,
    })

    indexedDbFactory.getDatabase(DATABASE_NAME).failNextPutWithNullError = true
    await expect(
      session.appendSnapshot(createSnapshot([7, 8]))
    ).rejects.toThrow("IndexedDB transaction failed.")
  })

  it("getAllEntries: handles null getAllKeys/getAll results (covers ?? [] fallback on lines 173-175)", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.seedStore(DATABASE_NAME, STORE_NAME, [
      [
        "null-results-session::chunk::00000000",
        serializePcmSnapshot(createSnapshot([1, 2])),
      ],
    ])
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "null-results-session",
      startedAt: 1,
    })

    // Mock returns null for both getAllKeys and getAll results — fallback to []
    indexedDbFactory.getDatabase(DATABASE_NAME).failNextGetAllWithNullResults =
      true
    // readSnapshots calls getAllEntries which uses ?? [] on null results
    const snapshots = await session.readSnapshots()
    expect(snapshots).toEqual([])
  })

  it("getAllEntries: rejects with fallback message when transaction.error is null (covers line 190)", async () => {
    const indexedDbFactory = new MockIndexedDbFactory()
    indexedDbFactory.seedStore(DATABASE_NAME, STORE_NAME, [
      [
        "txn-null-error-session::chunk::00000000",
        serializePcmSnapshot(createSnapshot([1, 2])),
      ],
    ])
    vi.stubGlobal("indexedDB", {
      open: indexedDbFactory.open.bind(indexedDbFactory),
    })

    const plugin = createIndexedDbPersistencePlugin()
    const session = await plugin.createSession({
      sessionId: "txn-null-error-session",
      startedAt: 1,
    })

    // Mock fires transaction.onerror with transaction.error=null → ?? fallback
    indexedDbFactory.getDatabase(
      DATABASE_NAME
    ).failNextGetAllTransactionWithNullError = true
    await expect(session.readSnapshots()).rejects.toThrow(
      "Failed to read IndexedDB store."
    )
  })
})
