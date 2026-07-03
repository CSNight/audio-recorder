import { describe, expect, it, vi } from "vitest"
import { EventBus } from "../../src/core/event-bus"

interface TestEvents {
  value: { count: number }
  other: string
}

describe("EventBus", () => {
  it("tracks listeners and removes the event key when the last listener unsubscribes", () => {
    const bus = new EventBus<TestEvents>()
    const first = vi.fn()
    const second = vi.fn()

    const offFirst = bus.on("value", first)
    const offSecond = bus.on("value", second)

    expect(bus.hasListeners("value")).toBe(true)
    expect(bus.listenerCount("value")).toBe(2)

    offFirst()
    expect(bus.hasListeners("value")).toBe(true)
    expect(bus.listenerCount("value")).toBe(1)

    offSecond()
    expect(bus.hasListeners("value")).toBe(false)
    expect(bus.listenerCount("value")).toBe(0)
  })

  it("ignores removing listeners for events that were never registered", () => {
    const bus = new EventBus<TestEvents>()
    expect(() => bus.off("value", vi.fn())).not.toThrow()
    expect(bus.hasListeners("value")).toBe(false)
  })

  it("fires once listeners a single time and removes them before invoking the callback", () => {
    const bus = new EventBus<TestEvents>()
    const listener = vi.fn(() => {
      expect(bus.hasListeners("value")).toBe(false)
      expect(bus.listenerCount("value")).toBe(0)
    })

    bus.once("value", listener)

    bus.emit("value", { count: 1 })
    bus.emit("value", { count: 2 })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ count: 1 })
  })

  it("snapshots listeners during emit so newly added listeners wait for the next emission", () => {
    const bus = new EventBus<TestEvents>()
    const lateListener = vi.fn()
    const earlyListener = vi.fn(() => {
      bus.on("value", lateListener)
    })

    bus.on("value", earlyListener)

    bus.emit("value", { count: 1 })
    expect(earlyListener).toHaveBeenCalledTimes(1)
    expect(lateListener).not.toHaveBeenCalled()

    bus.emit("value", { count: 2 })
    expect(lateListener).toHaveBeenCalledTimes(1)
    expect(lateListener).toHaveBeenCalledWith({ count: 2 })
  })

  it("clears all listeners at once", () => {
    const bus = new EventBus<TestEvents>()
    const valueListener = vi.fn()
    const otherListener = vi.fn()

    bus.on("value", valueListener)
    bus.on("other", otherListener)
    bus.clear()
    bus.emit("value", { count: 1 })
    bus.emit("other", "x")

    expect(valueListener).not.toHaveBeenCalled()
    expect(otherListener).not.toHaveBeenCalled()
    expect(bus.hasListeners("value")).toBe(false)
    expect(bus.hasListeners("other")).toBe(false)
  })

  it("returns early when emitting an event without listeners", () => {
    const bus = new EventBus<TestEvents>()
    expect(() => bus.emit("value", { count: 1 })).not.toThrow()
  })
})
