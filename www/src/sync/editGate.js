/**
 * Whether the user is part-way through naming something.
 *
 * Exists because two unrelated modules need the same fact and neither should own
 * it: the rename dialogs in `dialogs.js` know when one opens and closes, and the
 * sync scheduler needs to know whether to hold a cycle. Wiring one to the other
 * directly would put a dependency from the dialog layer into the sync layer (or
 * the reverse) purely to share a counter.
 *
 * **Why it matters.** Adding an item creates the node, saves it, and only then
 * asks for its title. With a debounced sync, anyone who takes longer than the
 * debounce to type a name — which is most people — gets a cycle part-way through
 * and publishes the item under its placeholder title. The other device then
 * shows "New item", and when the real title arrives both devices have to
 * reconcile it. The data was never wrong; it was published while it was still
 * being written.
 *
 * **Why a depth counter and not a boolean.** With continuous item creation on,
 * saving one item opens the rename dialog for the next one *from inside* the save
 * handler, before the first dialog's close runs. So the moments overlap: begin,
 * begin, end, end. A boolean would report "not editing" at the point where the
 * second dialog is still open, and the cycle would fire during it. A counter
 * settles at zero only when the last dialog has actually closed.
 */

let depth = 0
const beganListeners = new Set()
const settledListeners = new Set()

/**
 * Note that an edit has begun.
 *
 * Balanced by exactly one `endEdit()` per call.
 *
 * Notifies subscribers on every begin, not only on the first: a scheduler may
 * have a cycle already armed when the next item's dialog opens from inside the
 * previous one's save handler, and it has to be told each time so it can
 * disreign that timer.
 */
export function beginEdit () {
  depth += 1
  for (const listener of beganListeners) {
    try {
      listener()
    } catch (err) {
      // One broken subscriber must not stop the others from being told.
      console.warn('Edit-gate listener failed', err)
    }
  }
}

/**
 * Note that an edit has finished.
 *
 * Notifies subscribers only on the transition to zero, so a nested dialog closing
 * does not look like the user having finished.
 */
export function endEdit () {
  if (depth === 0) return
  depth -= 1
  if (depth > 0) return
  for (const listener of settledListeners) {
    try {
      listener()
    } catch (err) {
      // One broken subscriber must not stop the others from being told.
      console.warn('Edit-gate listener failed', err)
    }
  }
}

/** True while at least one edit is open. */
export function isEditing () {
  return depth > 0
}

/**
 * Called whenever an edit opens.
 *
 * @returns {function} detach
 */
export function onEditBegan (listener) {
  beganListeners.add(listener)
  return () => beganListeners.delete(listener)
}

/**
 * Called when the last open edit finishes.
 *
 * @returns {function} detach
 */
export function onEditSettled (listener) {
  settledListeners.add(listener)
  return () => settledListeners.delete(listener)
}

/** Test seam: reset the counter and subscribers between cases. */
export function resetEditGate () {
  depth = 0
}
