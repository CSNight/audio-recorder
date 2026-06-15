type EventMap = object
type Listener<T> = (payload: T) => void

export class EventBus<TEvents extends EventMap> {
  private readonly listeners = new Map<
    keyof TEvents,
    Set<(payload: TEvents[keyof TEvents]) => void>
  >()

  once<TKey extends keyof TEvents>(
    event: TKey,
    listener: Listener<TEvents[TKey]>
  ): () => void {
    // 包装成自移除监听器：触发一次后立即从 Set 中删除自身。
    const wrapper = (payload: TEvents[TKey]) => {
      this.off(event, wrapper as unknown as Listener<TEvents[TKey]>)
      listener(payload)
    }
    return this.on(event, wrapper as unknown as Listener<TEvents[TKey]>)
  }

  on<TKey extends keyof TEvents>(
    event: TKey,
    listener: Listener<TEvents[TKey]>
  ): () => void {
    // 同一个事件统一复用一个监听集合，避免重复创建容器。
    const eventListeners =
      this.listeners.get(event) ??
      new Set<(payload: TEvents[keyof TEvents]) => void>()
    const typedListener = listener as (payload: TEvents[keyof TEvents]) => void

    eventListeners.add(typedListener)
    this.listeners.set(event, eventListeners)

    return () => {
      this.off(event, listener)
    }
  }

  off<TKey extends keyof TEvents>(
    event: TKey,
    listener: Listener<TEvents[TKey]>
  ): void {
    const eventListeners = this.listeners.get(event)
    if (!eventListeners) {
      return
    }

    eventListeners.delete(listener as (payload: TEvents[keyof TEvents]) => void)
    if (eventListeners.size === 0) {
      // 最后一个监听器移除后直接清理键，避免事件表长期残留空集合。
      this.listeners.delete(event)
    }
  }

  hasListeners<TKey extends keyof TEvents>(event: TKey): boolean {
    const eventListeners = this.listeners.get(event)
    return eventListeners !== undefined && eventListeners.size > 0
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    const eventListeners = this.listeners.get(event)
    if (!eventListeners) {
      return
    }

    // Fix #13: snapshot listeners before iteration so that a listener added
    // inside a callback (e.g. via once()) does not fire in the current emit.
    for (const listener of [...eventListeners]) {
      ;(listener as Listener<TEvents[TKey]>)(payload)
    }
  }

  clear(): void {
    // destroy 时一次性释放所有订阅，避免控制器被外部监听器意外持有。
    this.listeners.clear()
  }
}
