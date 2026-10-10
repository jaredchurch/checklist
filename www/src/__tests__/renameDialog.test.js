import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { showRenameDialog } from '../dialogs.js'
import { isEditing, resetEditGate } from '../sync/editGate.js'

/**
 * The gate is only worth anything if the dialog that is supposed to raise it
 * actually raises it, on every exit path. Asserting the gate's behaviour in
 * isolation would pass just as happily against a dialog that never called it.
 */

const overlay = () => document.querySelector('.rename-dialog')
const input = () => overlay()?.querySelector('input')
const button = (label) =>
  [...(overlay()?.querySelectorAll('button') || [])].find((b) => b.textContent === label)

/** Resolve once the dialog is in the DOM. */
async function openDialog (name, onRename, onCancel) {
  showRenameDialog(name, onRename, onCancel)
  await vi.waitFor(() => expect(overlay()).not.toBeNull())
  return { input: input(), save: button('Save'), cancel: button('Cancel') }
}

beforeEach(() => {
  resetEditGate()
  document.body.innerHTML = ''
})

afterEach(() => {
  resetEditGate()
  document.body.innerHTML = ''
})

describe('the rename dialog holds the edit gate', () => {
  it('opens the gate when shown', async () => {
    await openDialog('New item', () => {})

    expect(isEditing()).toBe(true)
  })

  it('closes it on Save', async () => {
    const { save } = await openDialog('New item', () => {})

    save.click()

    expect(isEditing()).toBe(false)
  })

  it('closes it on Cancel', async () => {
    const { cancel } = await openDialog('New item', () => {}, () => {})

    cancel.click()

    expect(isEditing()).toBe(false)
  })

  it('closes it on the backdrop', async () => {
    await openDialog('New item', () => {}, () => {})

    overlay().click()

    expect(isEditing()).toBe(false)
  })

  it('closes it on Enter', async () => {
    await openDialog('New item', () => {})

    input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))

    expect(isEditing()).toBe(false)
  })

  it('closes it on Escape', async () => {
    await openDialog('New item', () => {}, () => {})

    input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))

    expect(isEditing()).toBe(false)
  })
})

describe('the gate balances on every path', () => {
  it('does not go negative when a dialog is closed twice', async () => {
    // Escape removes the overlay, but the click handler on the backdrop is still
    // attached to a detached node and can be reached programmatically. A leaked
    // depth would leave sync held for the rest of the session.
    const { cancel } = await openDialog('New item', () => {}, () => {})

    cancel.click()
    cancel.click()

    expect(isEditing()).toBe(false)
  })

  it('nests correctly when the save callback opens the next dialog', async () => {
    /*
     * The continuous-item-creation flow, exactly: saving item two opens item
     * three's dialog from inside item two's save handler, so the gate is opened
     * twice and released once. A boolean would read "done" while item three was
     * still open, and the cycle would fire during it.
     */
    showRenameDialog('New item', () => {
      showRenameDialog('New item', () => {})
    })
    await vi.waitFor(() => expect(overlay()).not.toBeNull())
    expect(isEditing()).toBe(true)

    // Saving item two: its callback opens item three *before* item two's dialog
    // closes, so the gate goes 1 → 2 → 1 rather than reaching zero.
    button('Save').click()
    expect(document.querySelectorAll('.rename-dialog')).toHaveLength(1)
    expect(isEditing()).toBe(true)

    // Item three's dialog is the one still open, and its callback opens nothing.
    button('Save').click()
    expect(overlay()).toBeNull()
    expect(isEditing()).toBe(false)
  })

  it('survives a run of dialogs with nothing left open', async () => {
    for (let i = 0; i < 3; i += 1) {
      const { save } = await openDialog('New item', () => {})
      save.click()
      await vi.waitFor(() => expect(overlay()).toBeNull())
    }

    expect(isEditing()).toBe(false)
  })
})

describe('callbacks still run on every path', () => {
  it('saves the typed name', async () => {
    const onRename = vi.fn()
    const { input: field, save } = await openDialog('New item', onRename)

    field.value = 'Milk'
    save.click()

    expect(onRename).toHaveBeenCalledWith('Milk')
  })

  it('reports cancellation', async () => {
    const onRename = vi.fn()
    const onCancel = vi.fn()
    const { cancel } = await openDialog('New item', onRename, onCancel)

    cancel.click()

    expect(onCancel).toHaveBeenCalled()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('runs the save callback while the gate is still held', async () => {
    // The order matters. `onRename` saves the node, and that save must still
    // find the gate held — otherwise the debounce starts from the save rather
    // than from the dialog closing, and the next dialog's placeholder title
    // becomes publishable again.
    let heldDuringCallback = null
    showRenameDialog('New item', () => {
      heldDuringCallback = isEditing()
    })

    await vi.waitFor(() => expect(overlay()).not.toBeNull())
    button('Save').click()

    expect(heldDuringCallback).toBe(true)
  })
})
