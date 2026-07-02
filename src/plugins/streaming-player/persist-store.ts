import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"

/**
 * PersistStore 接口：历史 packet 存储，用于重播。
 * - push：写入 packet（超出时间上限自动 drop-old）
 * - recent：取最近 durationMs 内的 packet（旧→新顺序）
 * - storedMs：当前已存储的音频时长（毫秒）
 * - clear：清空
 */
export interface PersistStore {
  readonly storedMs: number
  push(packet: StreamingPacketPayload): void
  recent(durationMs: number): StreamingPacketPayload[]
  clear(): void
}

/**
 * 内存实现：时间环形缓冲，drop-old 策略。
 * maxMs 控制最大存储时长，超出后从头部丢弃最旧包。
 */
export class MemoryPersistStore implements PersistStore {
  private queue: StreamingPacketPayload[] = []

  constructor(private readonly maxMs: number = 10_000) {}

  private _storedMs = 0

  get storedMs(): number {
    return this._storedMs
  }

  push(packet: StreamingPacketPayload): void {
    this.queue.push(packet)
    this._storedMs += packet.durationMs ?? 0

    // drop-old：从头部丢弃超出的旧包
    while (this._storedMs > this.maxMs && this.queue.length > 0) {
      const old = this.queue.shift()!
      this._storedMs = Math.max(0, this._storedMs - (old.durationMs ?? 0))
    }
  }

  recent(durationMs: number): StreamingPacketPayload[] {
    const result: StreamingPacketPayload[] = []
    let total = 0
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const p = this.queue[i]!
      total += p.durationMs ?? 0
      result.unshift(p)
      if (total >= durationMs) break
    }
    return result
  }

  clear(): void {
    this.queue = []
    this._storedMs = 0
  }
}

/**
 * IndexedDB 实现：将 packet 持久化到 IndexedDB。
 * 注意：recent() 从内存镜像（_queue）查询，不读 IndexedDB；实例重建后内存镜像清空，
 * 因此本实现不支持跨页面刷新的重播。IndexedDB 写入仅作为旁路持久化，当前未被读回。
 * push/drop-old 合并到单个事务异步写入（不阻塞调用方）。
 */
export class IndexedDbPersistStore implements PersistStore {
  private _queue: StreamingPacketPayload[] = []
  private db: IDBDatabase | null = null
  private readonly dbName: string
  private readonly storeName = "packets"
  private nextId = 0
  private minId = 0

  constructor(
    private readonly maxMs: number = 10_000,
    dbName = "streaming-player-persist"
  ) {
    this.dbName = dbName
    void this._open()
  }

  private _storedMs = 0

  get storedMs(): number {
    return this._storedMs
  }

  push(packet: StreamingPacketPayload): void {
    const id = this.nextId++
    this._queue.push(packet)
    this._storedMs += packet.durationMs ?? 0

    // drop-old：先收集需要删除的 id，再与 put 合并到一个事务，避免每个 packet 产生多个事务
    const toDelete: number[] = []
    while (this._storedMs > this.maxMs && this._queue.length > 0) {
      const old = this._queue.shift()!
      this._storedMs = Math.max(0, this._storedMs - (old.durationMs ?? 0))
      toDelete.push(this.minId++)
    }

    if (this.db) {
      // put + 所有 delete 合并到一个事务，只触发一次 flush
      const tx = this.db.transaction(this.storeName, "readwrite")
      const store = tx.objectStore(this.storeName)
      store.put({ id, packet })
      for (const delId of toDelete) {
        store.delete(delId)
      }
    }
  }

  recent(durationMs: number): StreamingPacketPayload[] {
    const result: StreamingPacketPayload[] = []
    let total = 0
    for (let i = this._queue.length - 1; i >= 0; i--) {
      const p = this._queue[i]!
      total += p.durationMs ?? 0
      result.unshift(p)
      if (total >= durationMs) break
    }
    return result
  }

  clear(): void {
    this._queue = []
    this._storedMs = 0
    this.nextId = 0
    this.minId = 0
    if (this.db) {
      const tx = this.db.transaction(this.storeName, "readwrite")
      tx.objectStore(this.storeName).clear()
    }
  }

  private async _open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" })
        }
      }
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  }
}
