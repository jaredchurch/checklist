/**
 * Rendering functions for the Checklist PWA
 * Handles DOM rendering, state management, and UI updates
 */

import { findParent, findNodeById, getDescendantItemSummary, sortNodeChildren } from './tree.js'
import { getCurrentNodes } from './sorting.js'
import { saveData, saveSettings, getSettings } from './storage.js'
import { showRenameDialog } from './dialogs.js'

// Module-level state (fallback when refs not provided)
let nodesRaw
let currentPath
let showUpDownActions = false

/**
 * Set module-level state (for backward compatibility)
 */
export function setState (state) {
  nodesRaw = state.nodesRaw
  currentPath = state.currentPath
  showUpDownActions = state.showUpDownActions
}

/**
 * Get module-level state (for backward compatibility)
 */
export function getState () {
  return { nodesRaw, currentPath, showUpDownActions }
}

/**
 * Initialize state with initial data
 */
export function initState (initialNodesRaw) {
  nodesRaw = initialNodesRaw
  currentPath = []
  const settings = getSettings()
  showUpDownActions = settings.showUpDownActions
}

/**
 * Get the current parent node based on the current path
 */
export function getCurrentParentNode (nodes = nodesRaw, path = currentPath) {
  if (!path || path.length === 0) return nodes
  const node = findNodeById(nodes, path[path.length - 1])
  return node || nodes
}

/**
 * Focus and select a label input
 */
export function focusLabelInput (input) {
  if (!input) return
  input.focus()
  input.select()
}

/**
 * Toggle body class to lock interactions when menu is open
 */
export function updateMenuLock () {
  const anyOpen = document.querySelector('.context-menu.open')
  document.body.classList.toggle('menu-open', !!anyOpen)
}

/**
 * Main render function - updates the entire checklist UI
 */
export function render (onToggleDone, nodesRef, currentPathRef) {
  const container = document.getElementById('tree-content')
  if (!container) return

  const nodesRawRef = nodesRef?.current || nodesRaw
  const pathRef = currentPathRef?.current || currentPath || []

  const getParentNode = () => {
    if (pathRef.length === 0) return nodesRawRef
    const node = findNodeById(nodesRawRef, pathRef[pathRef.length - 1])
    return node || nodesRawRef
  }

  // Update page title to current list name
  const titleEl = document.getElementById('list-title')
  if (titleEl) {
    const parent = getParentNode()
    titleEl.textContent = parent?.title || 'Checklist'
    document.title = parent?.title || 'Checklist'
  }

  // Render breadcrumb navigation
  const breadcrumb = document.getElementById('breadcrumb')
  if (breadcrumb) {
    breadcrumb.innerHTML = ''
    const rootTitle = nodesRawRef?.title || 'Home'
    const home = document.createElement('button')
    home.textContent = rootTitle
    home.addEventListener('click', () => {
      pathRef.length = 0
      onToggleDone()
    })
    breadcrumb.appendChild(home)

    const pathNodes = []
    let node = nodesRawRef
    pathRef.forEach((id) => {
      node = findNodeById(node, id)
      if (node) pathNodes.push(node)
    })

    pathNodes.forEach((pNode, idx) => {
      if (idx === pathNodes.length - 1) return
      const sep = document.createElement('span')
      sep.textContent = ' / '
      breadcrumb.appendChild(sep)

      const segment = document.createElement('button')
      segment.textContent = pNode.title
      segment.addEventListener('click', () => {
        const idx = pathRef.indexOf(pNode.id)
        if (idx === -1) return
        pathRef.length = idx + 1
        onToggleDone()
      })
      breadcrumb.appendChild(segment)
    })
  }

  // Get sorted nodes and render
  const parent = getParentNode()
  const nodeArray = Array.isArray(parent.children) ? parent.children : []
  const sortedNodes = getCurrentNodes(nodeArray, parent)

  renderTree(sortedNodes, container, {
    nodesRaw: nodesRawRef,
    currentPath: pathRef,
    showUpDownActions,
    onToggleDone
  })

  // Update sort button text
  const sortBtn = document.getElementById('global-sort-completed')
  if (sortBtn) {
    const isCompleted = parent.sortMode === 'completed'
    sortBtn.textContent = isCompleted ? 'Sorting by Last Completed ✓' : 'Sort by Last Completed'
  }

  // Update show/hide sorting button
  const toggleButton = document.getElementById('global-toggle-up-down')
  if (toggleButton) {
    const isCompleted = parent.sortMode === 'completed'
    if (isCompleted) {
      showUpDownActions = false
      saveSettings({ showUpDownActions })
    }
    toggleButton.disabled = isCompleted
    toggleButton.textContent = showUpDownActions ? 'Hide Sorting' : 'Show Sorting'
  }
}

/**
 * Render a tree of nodes into a container
 * Creates DOM elements for each node with appropriate controls
 */
export function renderTree (nodes, container, options = {}) {
  const {
    nodesRaw: optNodesRaw,
    currentPath: optCurrentPath = [],
    showUpDownActions: optShowUpDown = false,
    onToggleDone = () => {}
  } = options

  const nodesRawRef = optNodesRaw || nodesRaw
  const currentPathRef = optCurrentPath || currentPath || []
  const showUpDownRef = optShowUpDown || showUpDownActions

  const getParentNode = () => {
    if (currentPathRef.length === 0) return nodesRawRef
    const node = findNodeById(nodesRawRef, currentPathRef[currentPathRef.length - 1])
    return node || nodesRawRef
  }

  container.innerHTML = ''
  const ul = document.createElement('ul')
  ul.style.listStyle = 'none'
  ul.style.paddingLeft = '0'

  let draggedLi = null
  let draggedNodeId = null

  const parentNode = getParentNode()
  const isSortByCompleted = parentNode.sortMode === 'completed'

  const handleDrop = () => {
    if (isSortByCompleted) return
    if (!draggedNodeId) return
    const newOrder = Array.from(ul.children).map((li) => li.querySelector('.item-card').getAttribute('data-node-id'))
    const parent = getParentNode()
    if (!parent || !parent.children) return
    const sortedNodes = newOrder.map((id) => parent.children.find((c) => c.id === id)).filter(Boolean)
    parent.children = sortedNodes
    saveData(nodesRawRef)
    onToggleDone()
    draggedLi = null
    draggedNodeId = null
  }

  ul.addEventListener('dragover', (evt) => {
    if (isSortByCompleted) return
    evt.preventDefault()
    const afterCard = getDragAfterElement(ul, evt.clientY)
    if (afterCard == null) {
      ul.appendChild(draggedLi)
    } else {
      ul.insertBefore(draggedLi, afterCard.parentNode)
    }
  })

  ul.addEventListener('drop', (evt) => {
    evt.preventDefault()
    handleDrop()
  })

  function getDragAfterElement (container, y) {
    const draggableElements = [...container.querySelectorAll('.item-card:not(.dragging)')]
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect()
      const offset = y - box.top - box.height / 2
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child }
      } else {
        return closest
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element
  }

  nodes.forEach((node, index) => {
    if (node.type === 'item') {
      node.children = []
    }

    const li = document.createElement('li')
    const card = document.createElement('div')
    card.className = 'item-card'
    card.draggable = !isSortByCompleted
    card.style.cssText = `display:flex;align-items:center;gap:0.5rem;padding:0.5rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.5rem;margin-bottom:0.5rem;position:relative;width:100%;cursor:${isSortByCompleted ? 'default' : 'grab'};`
    card.setAttribute('data-node-id', node.id)

    // Desktop drag events
    card.addEventListener('dragstart', () => {
      draggedLi = li
      draggedNodeId = node.id
      setTimeout(() => card.classList.add('dragging'), 0)
    })

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging')
    })

    // Touch events for iOS (touch and hold to resort)
    let touchTimeout
    let isTouchDragging = false
    let startY = 0

    card.addEventListener('touchstart', (e) => {
      if (isSortByCompleted) return
      startY = e.touches[0].clientY
      if (touchTimeout) clearTimeout(touchTimeout)

      touchTimeout = setTimeout(() => {
        isTouchDragging = true
        draggedLi = li
        draggedNodeId = node.id
        card.classList.add('dragging')
        if (window.navigator.vibrate) window.navigator.vibrate(50)
      }, 600) // 600ms for long press
    }, { passive: true })

    card.addEventListener('touchmove', (e) => {
      const currentY = e.touches[0].clientY
      if (isTouchDragging) {
        if (e.cancelable) e.preventDefault()
        const afterCard = getDragAfterElement(ul, currentY)
        if (afterCard == null) {
          ul.appendChild(draggedLi)
        } else {
          ul.insertBefore(draggedLi, afterCard.parentNode)
        }
      } else {
        // If they move too much before the long press, cancel it
        if (Math.abs(currentY - startY) > 10) {
          if (touchTimeout) clearTimeout(touchTimeout)
        }
      }
    }, { passive: false })

    card.addEventListener('touchend', () => {
      if (touchTimeout) clearTimeout(touchTimeout)
      if (isTouchDragging) {
        isTouchDragging = false
        card.classList.remove('dragging')
        handleDrop()
      }
    })

    card.addEventListener('touchcancel', () => {
      if (touchTimeout) clearTimeout(touchTimeout)
      if (isTouchDragging) {
        isTouchDragging = false
        card.classList.remove('dragging')
        draggedLi = null
        draggedNodeId = null
      }
    })
    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex:1;width:100%;'
    const isListDone = node.type === 'list' && getDescendantItemSummary(node).total > 0 && getDescendantItemSummary(node).done === getDescendantItemSummary(node).total
    const isDone = (node.type === 'item' && node.done) || isListDone
    wrapper.className = `tree-item${isDone ? ' done' : ''}`
    wrapper.setAttribute('data-node-id', node.id)

    // Right-click context menu support
    wrapper.addEventListener('contextmenu', (evt) => {
      evt.preventDefault()
      const isAlreadyOpen = card.querySelector('.item-context-menu.open')
      document.querySelectorAll('.context-menu.open').forEach(menu => menu.classList.remove('open'))
      const menu = card.querySelector('.item-context-menu')
      if (menu && !isAlreadyOpen) {
        menu.classList.add('open')
        
        // Reset styles for measurement
        menu.style.top = '100%'
        menu.style.bottom = 'auto'
        menu.style.marginTop = '0.25rem'
        menu.style.marginBottom = '0'

        const rect = menu.getBoundingClientRect()
        const breadcrumbBar = document.getElementById('breadcrumb-bar')
        const buffer = 10
        const bottomLimit = breadcrumbBar ? breadcrumbBar.getBoundingClientRect().top : window.innerHeight

        if (rect.bottom > bottomLimit - buffer) {
          menu.style.top = 'auto'
          menu.style.bottom = '100%'
          menu.style.marginTop = '0'
          menu.style.marginBottom = '0.25rem'
        }
        updateMenuLock()
      } else {
        updateMenuLock()
      }
    })

    const actionControl = document.createElement('button')

    if (node.type === 'item') {
      // Checkmark button for items (always shows checkmark, styled differently when done)
      actionControl.textContent = '✓'
      actionControl.className = 'small-button'
      actionControl.style.minWidth = '1.5rem'
      actionControl.style.height = '1.5rem'
      actionControl.style.marginRight = '0.25rem'
      actionControl.style.color = node.done ? '#16a34a' : '#9ca3af'
      actionControl.title = node.done ? 'Mark as not done' : 'Mark as done'
      actionControl.addEventListener('click', () => {
        node.done = !node.done
        if (node.done && !node.lastCompletedDate) {
          node.lastCompletedDate = Date.now()
        }
        actionControl.style.color = node.done ? '#16a34a' : '#9ca3af'
        actionControl.title = node.done ? 'Mark as not done' : 'Mark as done'
        const currentNode = getParentNode()
        sortNodeChildren(currentNode)
        saveData(nodesRawRef)
        onToggleDone()
      })
    } else {
      // Drill-in button for lists (folder icon)
      actionControl.innerHTML = '📁'
      actionControl.className = 'small-button'
      actionControl.style.minWidth = '1.5rem'
      actionControl.style.height = '1.5rem'
      actionControl.style.marginRight = '0.5rem'
      actionControl.title = 'Drill In'
      actionControl.addEventListener('click', () => {
        currentPathRef.push(node.id)
        onToggleDone()
      })
    }

    // Title span (click to toggle done for items, drill in for lists)
    const titleLabel = document.createElement(node.type === 'item' ? 'span' : 'button')
    titleLabel.textContent = node.title
    titleLabel.className = 'title'
    titleLabel.style.cssText = 'flex:1;font-size:inherit;padding:0.5rem;cursor:pointer;text-align:left;background:transparent;border:none;'

    if (node.type === 'item') {
      titleLabel.addEventListener('click', () => {
        actionControl.click()
      })
    } else if (node.type === 'list') {
      titleLabel.style.fontWeight = '500'
      titleLabel.addEventListener('click', () => {
        currentPathRef.push(node.id)
        onToggleDone()
      })
    }

    if (isDone) {
      titleLabel.style.textDecoration = 'line-through'
      titleLabel.style.opacity = '0.6'
    }

    // Move up button
    const upButton = document.createElement('button')
    upButton.textContent = '↑'
    upButton.className = 'small-button'
    upButton.style.minWidth = '1rem'
    upButton.style.marginRight = '0.5rem'
    upButton.title = 'Move Up'
    upButton.addEventListener('click', () => {
      const parent = findParent(nodesRawRef, node.id)
      const array = parent ? parent.children : nodesRawRef.children
      const idx = array.findIndex((c) => c.id === node.id)
      if (idx > 0) {
        const tempOrder = array[idx].order
        array[idx].order = array[idx - 1].order
        array[idx - 1].order = tempOrder
        sortNodeChildren(parent || nodesRawRef)
        saveData(nodesRawRef)
        onToggleDone()
      }
    })

    // Move down button
    const downButton = document.createElement('button')
    downButton.textContent = '↓'
    downButton.className = 'small-button'
    downButton.style.minWidth = '1rem'
    downButton.style.marginRight = '0.5rem'
    downButton.title = 'Move Down'
    downButton.addEventListener('click', () => {
      const parent = findParent(nodesRawRef, node.id)
      const array = parent ? parent.children : nodesRawRef.children
      const idx = array.findIndex((c) => c.id === node.id)
      if (idx < array.length - 1) {
        const tempOrder = array[idx].order
        array[idx].order = array[idx + 1].order
        array[idx + 1].order = tempOrder
        sortNodeChildren(parent || nodesRawRef)
        saveData(nodesRawRef)
        onToggleDone()
      }
    })

    // Context menu toggle button
    const contextToggle = document.createElement('button')
    contextToggle.textContent = '⋮'
    contextToggle.className = 'small-button context-toggle'
    contextToggle.style.minWidth = '1rem'
    contextToggle.title = 'More options'
    contextToggle.addEventListener('click', (evt) => {
      evt.stopPropagation()
      const isAlreadyOpen = card.querySelector('.item-context-menu.open')
      document.querySelectorAll('.context-menu.open').forEach(menu => menu.classList.remove('open'))
      const menu = card.querySelector('.item-context-menu')
      if (menu && !isAlreadyOpen) {
        menu.classList.add('open')
        
        // Reset styles for measurement
        menu.style.top = '100%'
        menu.style.bottom = 'auto'
        menu.style.marginTop = '0.25rem'
        menu.style.marginBottom = '0'

        const rect = menu.getBoundingClientRect()
        const breadcrumbBar = document.getElementById('breadcrumb-bar')
        const buffer = 10
        const bottomLimit = breadcrumbBar ? breadcrumbBar.getBoundingClientRect().top : window.innerHeight

        if (rect.bottom > bottomLimit - buffer) {
          menu.style.top = 'auto'
          menu.style.bottom = '100%'
          menu.style.marginTop = '0'
          menu.style.marginBottom = '0.25rem'
        }
        updateMenuLock()
      } else {
        updateMenuLock()
      }
    })

    // Context menu with delete and rename options
    const contextMenu = document.createElement('div')
    contextMenu.className = 'item-context-menu context-menu'

    const renameButton = document.createElement('button')
    renameButton.textContent = 'Rename'
    renameButton.addEventListener('click', () => {
      showRenameDialog(node.title, (newTitle) => {
        node.title = newTitle
        saveData(nodesRawRef)
        onToggleDone()
      })
      contextMenu.classList.remove('open')
      updateMenuLock()
    })

    const deleteButton = document.createElement('button')
    deleteButton.textContent = 'Delete'
    deleteButton.className = 'destructive'
    deleteButton.addEventListener('click', () => {
      const parent = findParent(nodesRawRef, node.id)
      const array = parent ? parent.children : nodesRawRef.children
      const idx = array.findIndex((c) => c.id === node.id)
      if (idx !== -1) {
        array.splice(idx, 1)
        saveData(nodesRawRef)
        onToggleDone()
      }
      contextMenu.classList.remove('open')
      updateMenuLock()
    })

    contextMenu.appendChild(renameButton)
    contextMenu.appendChild(deleteButton)

    // Configure button states based on sort mode
    upButton.disabled = index === 0

    downButton.disabled = index === nodes.length - 1

    // Build element array
    const elements = [actionControl, titleLabel]

    // Container for right-aligned items
    const rightContainer = document.createElement('div')
    rightContainer.style.cssText = 'display:flex;align-items:center;gap:0.25rem;margin-left:auto;'

    // Add summary for lists (before arrows when shown)
    if (node.type === 'list') {
      const summary = getDescendantItemSummary(node)
      const summaryEl = document.createElement('span')
      summaryEl.className = 'summary'
      summaryEl.textContent = `(${summary.done}/${summary.total})`
      rightContainer.appendChild(summaryEl)
    }

    if (showUpDownRef && !isSortByCompleted) {
      rightContainer.appendChild(upButton)
      rightContainer.appendChild(downButton)
    }

    rightContainer.appendChild(contextToggle)
    elements.push(rightContainer)

    wrapper.append(...elements)

    card.appendChild(wrapper)
    card.appendChild(contextMenu)
    li.appendChild(card)
    ul.appendChild(li)
  })

  container.appendChild(ul)
}

export { currentPath, nodesRaw, showUpDownActions }
