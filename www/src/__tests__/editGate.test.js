import { describe, it, expect, beforeEach, vi } from 'vitest'
import { beginEdit, endEdit, isEditing, onEditSettled, resetEditGate } from '../sync/editGate.js'

beforeEach(() => {
  resetEditGate()
})

describe('isEditing', () => {
  it('is false with nothing open', () => {
    expect(isEditing()).toBe(false)
  })

  it('tracks one open edit', () => {
    beginEdit()
    expect(isEditing()).toBe(true)
    endEdit()
    expect(isEditing()).toBe(false)
  })
})

describe('nesting', () => {
  /*
   * The case the counter exists for. With continuous item creation, saving one
   * item opens the next item's rename dialog from inside the first dialog's save
   * handler — so the gate is opened twice before it is released once. A boolean
   * would report "finished" while the second dialog was still open.
   */
  it('stays open until the last of several overlapping edits closes', () => {
    beginEdit() // item 2 named
    beginEdit() // item 3 named, opened from item 2's save handler
    endEdit() // item 2's dialog closes

    expect(isEditing()).toBe(true)
  })

  it('settles only when the depth reaches zero', () => {
    beginEdit()
    beginEdit()
    endEdit()
    endEdit()

    expect(isEditing()).toBe(false)
  })

  it('ignores an unmatched endEdit rather than going negative', () => {
    // A stray release would otherwise leave the gate permanently open, which
    // means sync never runs again with nothing on screen to say why.
    endEdit()
    expect(isEditing()).toBe(false)

    beginEdit()
    expect(isEditing()).toBe(true)
  })
})

describe('onEditSettled', () => {
  it('fires when the last edit closes', () => {
    const listener = vi.fn()
    onEditSettled(listener)

    beginEdit()
    endEdit()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not fire when an inner edit closes', () => {
    // Otherwise the scheduler would re-arm a cycle mid-flow, which is the
    // behaviour this gate exists to prevent.
    const listener = vi.fn()
    onEditSettled(listener)

    beginEdit()
    beginEdit()
    endEdit()

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops firing once detached', () => {
    const listener = vi.fn()
    const detach = onEditSettled(listener)
    detach()

    beginEdit()
    endEdit()

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps notifying other subscribers when one throws', () => {
    // One broken listener must not silently stop the scheduler from ever
    // re-arming.
    const good = vi.fn()
    onEditSettled(() => { throw new Error('boom') })
    onEditSettled(good)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    beginEdit()
    endEdit()

    expect(good).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
