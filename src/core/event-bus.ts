type Listener<T> = (payload: T) => void
type WildcardListener<TEvents extends object> = <TKey extends keyof TEvents>(
  event: TKey,
  payload: TEvents[TKey]
) => void

const WILDCARD = "*" as const

/**
 * 轻量级类型安全事件总线。
 * 泛型参数 `TEvents` 为事件名到载荷类型的映射对象。
 * 支持 on / once / off / emit / clear 操作，内部用统一的 Map<key, Set<listener>> 管理订阅。
 * 支持通配符 '*' 监听所有事件，以及无 payload 事件（emit 第二参数可选）。
 */
export class EventBus<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents | "*", Set<unknown>>()

  once<TKey extends keyof TEvents>(
    event: TKey,
    listener: Listener<TEvents[TKey]>
  ): () => void {
    const wrapper = (payload: TEvents[TKey]) => {
      this.off(event, wrapper as Listener<TEvents[TKey]>)
      listener(payload)
    }
    return this.on(event, wrapper as Listener<TEvents[TKey]>)
  }

  on<TKey extends keyof TEvents>(
    event: TKey,
    listener: Listener<TEvents[TKey]>
  ): () => void
  on(event: "*", listener: WildcardListener<TEvents>): () => void
  on<TKey extends keyof TEvents>(
    event: TKey | "*",
    listener: Listener<TEvents[TKey]> | WildcardListener<TEvents>
  ): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener)
    return () => {
      if (event === WILDCARD) {
        this.off(WILDCARD, listener as WildcardListener<TEvents>)
      } else {
        this.off(event as TKey, listener as Listener<TEvents[TKey]>)
      }
    }
  }

  off<TKey extends keyof TEvents>(
    event: TKey,
    listener?: Listener<TEvents[TKey]>
  ): void
  off(event: "*", listener?: WildcardListener<TEvents>): void
  off<TKey extends keyof TEvents>(
    event: TKey | "*",
    listener?: Listener<TEvents[TKey]> | WildcardListener<TEvents>
  ): void {
    if (!listener) {
      this.listeners.delete(event)
      return
    }
    const set = this.listeners.get(event)
    if (!set) return
    set.delete(listener)
    if (set.size === 0) this.listeners.delete(event)
  }

  hasListeners<TKey extends keyof TEvents>(event: TKey): boolean {
    return this.listenerCount(event) > 0
  }

  listenerCount<TKey extends keyof TEvents>(event: TKey): number {
    return this.listeners.get(event)?.size ?? 0
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload?: TEvents[TKey]): void {
    const set = this.listeners.get(event)
    if (set) {
      for (const listener of Array.from(set)) {
        ;(listener as Listener<TEvents[TKey]>)(payload as TEvents[TKey])
      }
    }

    const wildcardSet = this.listeners.get(WILDCARD)
    if (wildcardSet) {
      for (const listener of Array.from(wildcardSet)) {
        ;(listener as WildcardListener<TEvents>)(
          event,
          payload as TEvents[TKey]
        )
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
