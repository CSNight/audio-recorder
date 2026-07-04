import { afterEach, describe, expect, it, vi } from "vitest"
import {
  IndexedDbPersistStore,
  MemoryPersistStore,
} from "../../../src/plugins/streaming-player/persist-store"
import type { StreamingPacketPayload } from "../../../src"

function makePacket(seq: number, durationMs = 20): StreamingPacketPayload {
  return {
    streamId: "test-stream",
    sessionId: "test-session",
    seq,
    timestampMs: seq * durationMs,
    durationMs,
    sampleRate: 16000,
    channels: 1,
    format: "pcm16",
    chunk: new Uint8Array(320 * 2),
    isFinal: false,
  }
}

function makePacketWithoutDuration(seq: number): StreamingPacketPayload {
  return {
    ...makePacket(seq, 20),
    durationMs: undefined,
  } as unknown as StreamingPacketPayload
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

class MockOpenDbRequest {
  result!: MockIdbDatabase
  error: Error | null = null
  onupgradeneeded: ((event: Event) => void) | null = null
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  succeed(result: MockIdbDatabase): void {
    this.result = result
    queueMicrotask(() => {
      this.onupgradeneeded?.({ target: this } as unknown as Event)
      this.onsuccess?.({ target: this } as unknown as Event)
    })
  }

  fail(error: Error): void {
    this.error = error
    queueMicrotask(() => {
      this.onerror?.({ target: this } as unknown as Event)
    })
  }
}

class MockIdbObjectStore {
  constructor(
    private readonly database: MockIdbDatabase,
    private readonly storeName: string
  ) {}

  put(value: unknown): IDBRequest {
    this.database.putCalls.push({ storeName: this.storeName, value })
    const id = (value as { id?: IDBValidKey }).id
    this.database
      .getStore(this.storeName)
      .set(id ?? this.database.putCalls.length, value)
    return {} as IDBRequest
  }

  delete(key: IDBValidKey): void {
    this.database.deleteCalls.push({ storeName: this.storeName, key })
    this.database.getStore(this.storeName).delete(key)
  }

  clear(): void {
    this.database.clearCalls.push(this.storeName)
    this.database.getStore(this.storeName).clear()
  }
}

class MockIdbTransaction {
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
      name
    ) as unknown as IDBObjectStore
  }
}

class MockIdbDatabase {
  readonly stores = new Map<string, Map<IDBValidKey, unknown>>()
  readonly createObjectStoreCalls: string[] = []
  readonly transactionCalls: Array<{
    storeName: string
    mode?: IDBTransactionMode
  }> = []
  readonly putCalls: Array<{ storeName: string; value: unknown }> = []
  readonly deleteCalls: Array<{ storeName: string; key: IDBValidKey }> = []
  readonly clearCalls: string[] = []

  get objectStoreNames(): Pick<DOMStringList, "contains"> {
    return {
      contains: (name: string) => this.stores.has(name),
    }
  }

  seedStore(name: string): void {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map())
    }
  }

  createObjectStore(name: string): IDBObjectStore {
    this.createObjectStoreCalls.push(name)
    this.seedStore(name)
    return {} as IDBObjectStore
  }

  transaction(name: string, mode?: IDBTransactionMode): IDBTransaction {
    this.transactionCalls.push(
      mode === undefined ? { storeName: name } : { storeName: name, mode }
    )
    this.seedStore(name)
    return new MockIdbTransaction(this, name) as unknown as IDBTransaction
  }

  getStore(name: string): Map<IDBValidKey, unknown> {
    this.seedStore(name)
    return this.stores.get(name)!
  }
}

function createIndexedDbMock(options?: {
  autoOpen?: boolean
  existingPacketsStore?: boolean
}) {
  const database = new MockIdbDatabase()
  if (options?.existingPacketsStore) {
    database.seedStore("packets")
  }
  const requests: MockOpenDbRequest[] = []

  const indexedDb = {
    open: vi.fn((_name: string, _version?: number) => {
      const request = new MockOpenDbRequest()
      requests.push(request)
      if (options?.autoOpen !== false) {
        request.succeed(database)
      }
      return request as unknown as IDBOpenDBRequest
    }),
  }

  return {
    indexedDb,
    database,
    requests,
    succeedLatest() {
      requests.at(-1)?.succeed(database)
    },
  }
}

describe("streaming-player persist-store", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe("MemoryPersistStore", () => {
    it("按 maxMs 保留最近窗口，并按旧→新顺序返回 recent()", () => {
      const store = new MemoryPersistStore(100)

      store.push(makePacket(0, 20))
      store.push(makePacket(1, 30))
      store.push(makePacket(2, 40))

      expect(store.storedMs).toBe(90)
      expect(store.recent(50).map((packet) => packet.seq)).toEqual([1, 2])

      store.push(makePacket(3, 50))

      expect(store.storedMs).toBe(90)
      expect(store.recent(200).map((packet) => packet.seq)).toEqual([2, 3])
    })

    it("clear() 会清空 storedMs 和 recent()", () => {
      const store = new MemoryPersistStore(100)

      store.push(makePacket(0, 20))
      store.push(makePacket(1, 20))
      store.clear()

      expect(store.storedMs).toBe(0)
      expect(store.recent(100)).toEqual([])
    })

    it("异常 packet 缺少 durationMs 时按 0 处理，不会污染 storedMs", () => {
      const store = new MemoryPersistStore(100)

      store.push(makePacketWithoutDuration(0))
      store.push(makePacket(1, 20))

      expect(store.storedMs).toBe(20)
      expect(store.recent(100).map((packet) => packet.seq)).toEqual([0, 1])
    })
  })

  describe("IndexedDbPersistStore", () => {
    it("打开数据库时会创建 packets store，并把 push() 镜像写入 IndexedDB", async () => {
      const mock = createIndexedDbMock()
      vi.stubGlobal("indexedDB", mock.indexedDb)

      const store = new IndexedDbPersistStore(60, "streaming-player-test")
      await flushMicrotasks()

      expect(mock.database.createObjectStoreCalls).toEqual(["packets"])

      store.push(makePacket(0, 20))
      store.push(makePacket(1, 20))
      store.push(makePacket(2, 30))

      expect(store.storedMs).toBe(50)
      expect(store.recent(100).map((packet) => packet.seq)).toEqual([1, 2])
      expect(mock.database.putCalls).toHaveLength(3)
      expect(mock.database.deleteCalls.map((entry) => entry.key)).toEqual([0])
      expect(
        mock.database.transactionCalls.every(
          (entry) => entry.storeName === "packets" && entry.mode === "readwrite"
        )
      ).toBe(true)
    })

    it("若 packets store 已存在，则不会重复 createObjectStore()", async () => {
      const mock = createIndexedDbMock({ existingPacketsStore: true })
      vi.stubGlobal("indexedDB", mock.indexedDb)

      new IndexedDbPersistStore(60, "streaming-player-test")
      await flushMicrotasks()

      expect(mock.database.createObjectStoreCalls).toEqual([])
    })

    it("数据库尚未 ready 时 recent()/storedMs 仍走内存镜像，ready 后只持久化后续 push()", async () => {
      const mock = createIndexedDbMock({ autoOpen: false })
      vi.stubGlobal("indexedDB", mock.indexedDb)

      const store = new IndexedDbPersistStore(100, "streaming-player-test")
      store.push(makePacket(0, 20))
      store.push(makePacket(1, 20))

      expect(store.storedMs).toBe(40)
      expect(store.recent(100).map((packet) => packet.seq)).toEqual([0, 1])
      expect(mock.database.putCalls).toHaveLength(0)

      mock.succeedLatest()
      await flushMicrotasks()

      store.push(makePacket(2, 20))

      expect(mock.database.putCalls).toHaveLength(1)
      expect(
        mock.database.putCalls[0]!.value as {
          id: number
          packet: StreamingPacketPayload
        }
      ).toMatchObject({
        id: 2,
        packet: expect.objectContaining({ seq: 2 }),
      })
    })

    it("clear() 会清空内存镜像、触发 IndexedDB clear，并重置后续 id 计数", async () => {
      const mock = createIndexedDbMock()
      vi.stubGlobal("indexedDB", mock.indexedDb)

      const store = new IndexedDbPersistStore(100, "streaming-player-test")
      await flushMicrotasks()

      store.push(makePacket(0, 20))
      store.push(makePacket(1, 20))
      store.clear()

      expect(store.storedMs).toBe(0)
      expect(store.recent(100)).toEqual([])
      expect(mock.database.clearCalls).toEqual(["packets"])

      store.push(makePacket(2, 20))

      expect(
        mock.database.putCalls.at(-1)!.value as {
          id: number
          packet: StreamingPacketPayload
        }
      ).toMatchObject({
        id: 0,
        packet: expect.objectContaining({ seq: 2 }),
      })
    })

    it("数据库未 ready 时 clear() 仅清空内存镜像；ready 后异常 packet 缺少 durationMs 时按 0 处理", async () => {
      const mock = createIndexedDbMock({ autoOpen: false })
      vi.stubGlobal("indexedDB", mock.indexedDb)

      const store = new IndexedDbPersistStore(100, "streaming-player-test")
      store.push(makePacket(0, 20))
      store.clear()

      expect(store.storedMs).toBe(0)
      expect(store.recent(100)).toEqual([])
      expect(mock.database.clearCalls).toEqual([])

      mock.succeedLatest()
      await flushMicrotasks()

      store.push(makePacketWithoutDuration(1))
      store.push(makePacket(2, 20))

      expect(store.storedMs).toBe(20)
      expect(
        mock.database.putCalls.at(-1)!.value as {
          id: number
          packet: StreamingPacketPayload
        }
      ).toMatchObject({
        id: 1,
        packet: expect.objectContaining({ seq: 2 }),
      })
    })
  })
})
