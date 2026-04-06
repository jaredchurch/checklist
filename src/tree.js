/**
 * Tree manipulation functions for the Checklist PWA
 * Handles node creation, traversal, and modification
 */

import { uid, getNextOrder, setNextOrder, nextOrder, collectIds as collectIdsUtil } from './utils.js'

// Re-export collectIds from utils
export { collectIdsUtil as collectIds }

/**
 * Create a new item node
 * @param {string} title - The title of the new item
 * @returns {object} A new item node
 */
export function createNode(title = 'New item') {
  return {
    id: uid(),
    type: 'item',
    title,
    done: false,
    children: [],
    order: getNextOrder(),
    isNew: true
  }
}

/**
 * Create a new list (sub-list) node
 * @param {string} title - The title of the new list
 * @returns {object} A new list node
 */
export function createListNode(title = 'New list') {
  return {
    id: uid(),
    type: 'list',
    title,
    children: [],
    order: getNextOrder(),
    isNew: true
  }
}

/**
 * Sanitize and validate a tree structure
 * Regenerates duplicate/missing IDs and ensures valid structure
 */
export function sanitizeTree(node, existingIds = new Set()) {
  if (!node || typeof node !== 'object') {
    return createListNode('Root')
  }

  if (typeof node.id !== 'string' || existingIds.has(node.id)) {
    node.id = uid()
  }
  existingIds.add(node.id)

  if (typeof node.order !== 'number' || !Number.isFinite(node.order)) {
    node.order = getNextOrder()
  } else {
    setNextOrder(Math.max(nextOrder, node.order + 1))
  }

  if (node.type === 'item') {
    node.children = []
    if (typeof node.done !== 'boolean') node.done = false
    if (typeof node.isNew !== 'boolean') node.isNew = false
    return node
  }

  if (node.type === 'list') {
    node.children = Array.isArray(node.children)
      ? node.children.map((child) => sanitizeTree(child, existingIds))
      : []
    if (typeof node.isNew !== 'boolean') node.isNew = false
    return node
  }

  return createListNode(node.title || 'Root')
}

/**
 * Find a node by its ID in the tree
 * @param {object} root - The root node to search from
 * @param {string} id - The ID to find
 * @returns {object|null} The found node or null
 */
export function findNodeById(root, id) {
  if (root.id === id) return root
  for (const n of root.children) {
    const found = findNodeById(n, id)
    if (found) return found
  }
  return null
}

/**
 * Find the parent of a node by its ID
 * @param {object} root - The root node to search from
 * @param {string} childId - The ID of the child node
 * @param {object} parent - The current parent (used internally for recursion)
 * @returns {object|null} The parent node or null
 */
export function findParent(root, childId, parent = null) {
  if (root.id === childId) return parent
  for (const node of root.children) {
    const found = findParent(node, childId, root)
    if (found) return found
  }
  return null
}

/**
 * Update a node by ID with a callback function
 * @param {object} root - The root node to search from
 * @param {string} id - The ID of the node to update
 * @param {function} callback - Function to call with the found node
 * @returns {boolean} Whether the node was found and updated
 */
export function updateNode(root, id, callback) {
  if (root.id === id) {
    callback(root)
    return true
  }
  for (const n of root.children) {
    if (updateNode(n, id, callback)) return true
  }
  return false
}

/**
 * Set the done status for nodes (items only, not their descendants)
 * @param {array} nodes - Array of nodes to update
 * @param {boolean} done - The done status to set
 * @param {boolean} includeDescendants - Whether to recursively update list children
 */
export function setTreeDone(nodes, done, includeDescendants = true) {
  for (const n of nodes) {
    if (n.type === 'item') {
      n.done = done
      continue
    }
    if (includeDescendants && n.type === 'list') {
      setTreeDone(n.children, done, true)
    }
  }
}

/**
 * Get the count of done and total items in a list (including nested lists)
 * @param {object} node - A list node
 * @returns {{done: number, total: number}} Counts of done and total items
 */
export function getDescendantItemSummary(node) {
  let done = 0
  let total = 0

  function recurse(n) {
    for (const c of n.children || []) {
      if (c.type === 'item') {
        total += 1
        if (c.done) done += 1
      } else if (c.type === 'list') {
        recurse(c)
      }
    }
  }

  if (node.type === 'list') {
    recurse(node)
  }

  return { done, total }
}

/**
 * Check if a node is considered complete
 * Items are complete when done=true, lists are complete when all descendants are done
 * @param {object} node - The node to check
 * @returns {boolean} Whether the node is complete
 */
export function isNodeComplete(node) {
  if (node.type === 'item') {
    return node.done === true
  }

  if (node.type === 'list') {
    const summary = getDescendantItemSummary(node)
    return summary.total > 0 && summary.done === summary.total
  }

  return false
}

/**
 * Sort children of a list node by: done status, type, then order
 * Incomplete items/lists appear before completed ones
 * @param {object} node - A list node whose children to sort
 */
export function sortNodeChildren(node) {
  if (!node || node.type !== 'list' || !Array.isArray(node.children)) return

  node.children = node.children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const completeA = isNodeComplete(a.child) ? 1 : 0
      const completeB = isNodeComplete(b.child) ? 1 : 0
      if (completeA !== completeB) return completeA - completeB

      const typeA = a.child.type === 'list' ? 0 : 1
      const typeB = b.child.type === 'list' ? 0 : 1
      if (typeA !== typeB) return typeA - typeB

      return (a.child.order ?? a.index) - (b.child.order ?? b.index)
    })
    .map((entry) => entry.child)

  // Recursively sort nested lists
  for (const child of node.children) {
    if (child.type === 'list') {
      sortNodeChildren(child)
    }
  }
}

/**
 * Set done status for items at a specific depth level
 * @param {array} nodes - Array of nodes to process
 * @param {number} level - Depth level to target (0 = top level)
 * @param {boolean} done - The done status to set
 */
export function setLevelDone(nodes, level, done) {
  if (level === 0) {
    for (const n of nodes) {
      if (n.type === 'item') {
        n.done = done
      }
    }
    return
  }
  for (const n of nodes) {
    if (n.type === 'list') {
      setLevelDone(n.children, level - 1, done)
    }
  }
}
