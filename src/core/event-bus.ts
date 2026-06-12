type EventMap = object
type Listener<T> = (payload: T) => void

export class EventBus<TEvents extends EventMap> {
  private readonly listeners = new Map<
    keyof TEvents,
    Set<(payload: TEvents[keyof TEvents]) => void>
  >()

  on<TKey extends keyof TEvents>(
    event: TKey,
    listener: Listener<TEvents[TKey]>
  ): () => void {
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
      this.listeners.delete(event)
    }
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    const eventListeners = this.listeners.get(event)
    if (!eventListeners) {
      return
    }

    for (const listener of eventListeners) {
      ;(listener as Listener<TEvents[TKey]>)(payload)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
