/**
 * Sorting logic for the Checklist PWA
 * Handles sorting of nodes by completion status and last completed date
 */

import { getDescendantItemSummary } from './tree.js'

/**
 * Sort nodes based on the current sort mode
 * Manual mode: incomplete first, completed last
 * Completed mode: never completed first, then by last completed date
 * Lists always appear before items within each group
 * 
 * @param {array} nodes - Array of nodes to sort
 * @param {object} parent - The parent node (contains sortMode setting)
 * @returns {array} Sorted array of nodes
 */
export function getCurrentNodes(nodes, parent) {
  const currentSortMode = parent.sortMode || 'manual'
  
  const isNodeDone = (node) => {
    if (node.type === 'item') return node.done
    if (node.type === 'list') {
      const summary = getDescendantItemSummary(node)
      return summary.total > 0 && summary.done === summary.total
    }
    return false
  }
  
  const getLastCompletedDate = (node) => {
    if (node.type === 'item') return node.lastCompletedDate
    if (node.type === 'list') {
      let latest = 0
      let hasDate = false
      function findLatest(n) {
        for (const child of n.children || []) {
          if (child.type === 'item' && child.lastCompletedDate) {
            hasDate = true
            latest = Math.max(latest, child.lastCompletedDate)
          } else if (child.type === 'list') {
            findLatest(child)
          }
        }
      }
      findLatest(node)
      return hasDate ? latest : null
    }
    return null
  }
  
  if (currentSortMode === 'completed') {
    const neverCompleted = nodes.filter(n => !isNodeDone(n) && !getLastCompletedDate(n))
    const prevCompleted = nodes.filter(n => !isNodeDone(n) && getLastCompletedDate(n))
    const completed = nodes.filter(n => isNodeDone(n))
    
    const sortByListAndDate = (a, b) => {
      const listA = a.type === 'list' ? 0 : 1
      const listB = b.type === 'list' ? 0 : 1
      if (listA !== listB) return listA - listB
      const dateA = getLastCompletedDate(a) || 0
      const dateB = getLastCompletedDate(b) || 0
      return dateA - dateB
    }
    
    neverCompleted.sort(sortByListAndDate)
    prevCompleted.sort(sortByListAndDate)
    completed.sort(sortByListAndDate)
    
    return [...neverCompleted, ...prevCompleted, ...completed]
  }
  
  // Manual sort mode: incomplete first, completed last
  const incomplete = nodes.filter(n => !isNodeDone(n))
  const completedItems = nodes.filter(n => isNodeDone(n))
  return [...incomplete, ...completedItems]
}
