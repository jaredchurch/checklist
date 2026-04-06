/**
 * Utility functions for the Checklist PWA
 * Contains: ID generation, order tracking, and tree traversal utilities
 */

let nextOrder = 1

export function uid() {
  return 'x' + Math.random().toString(16).slice(2) + Date.now().toString(16)
}

export function getNextOrder() {
  return nextOrder++
}

export function setNextOrder(value) {
  nextOrder = value
}

export function collectIds(node, ids = new Set()) {
  if (node && typeof node.id === 'string') {
    ids.add(node.id)
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectIds(child, ids)
    }
  }
  return ids
}

export { nextOrder }
