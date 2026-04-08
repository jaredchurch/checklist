/**
 * Rendering functions for the Checklist PWA
 * Handles DOM rendering, state management, and UI updates
 */

import { createNode, createListNode, findParent, findNodeById, getDescendantItemSummary, sortNodeChildren } from './tree.js'
import { getCurrentNodes } from './sorting.js'
import { saveData, saveSettings, getSettings } from './storage.js'

// Module-level state (fallback when refs not provided)
let nodesRaw
let currentPath
let showUpDownActions = false

/**
 * Set module-level state (for backward compatibility)
 */
export function setState(state) {
  nodesRaw = state.nodesRaw
  currentPath = state.currentPath
  showUpDownActions = state.showUpDownActions
}

/**
 * Get module-level state (for backward compatibility)
 */
export function getState() {
  return { nodesRaw, currentPath, showUpDownActions }
}

/**
 * Initialize state with initial data
 */
export function initState(initialNodesRaw) {
  nodesRaw = initialNodesRaw
  currentPath = []
  const settings = getSettings()
  showUpDownActions = settings.showUpDownActions
}

/**
 * Get the current parent node based on the current path
 */
export function getCurrentParentNode(nodes = nodesRaw, path = currentPath) {
  if (!path || path.length === 0) return nodes
  const node = findNodeById(nodes, path[path.length - 1])
  return node || nodes
}

/**
 * Focus and select a label input
 */
export function focusLabelInput(input) {
  if (!input) return
  input.focus()
  input.select()
}

/**
 * Toggle body class to lock interactions when menu is open
 */
export function updateMenuLock() {
  const anyOpen = document.querySelector('.context-menu.open')
  document.body.classList.toggle('menu-open', !!anyOpen)
}

/**
 * Main render function - updates the entire checklist UI
 */
export function render(onToggleDone, nodesRef, currentPathRef) {
  const container = document.getElementById('tree-content')
  if (!container) return

  const nodesRawRef = nodesRef?.current || nodesRaw
  const pathRef = currentPathRef?.current || currentPath || []

  const getParentNode = () => {
    if (pathRef.length === 0) return nodesRawRef
    const node = findNodeById(nodesRawRef, pathRef[pathRef.length - 1])
    return node || nodesRawRef
  }

  // Render breadcrumb navigation
  const breadcrumb = document.getElementById('breadcrumb')
  if (breadcrumb) {
    breadcrumb.innerHTML = ''
    const home = document.createElement('button')
    home.textContent = 'Home'
    home.addEventListener('click', () => {
      pathRef.length = 0
      onToggleDone()
    })
    breadcrumb.appendChild(home)

    let pathNodes = []
    let node = nodesRawRef
    pathRef.forEach((id) => {
      node = findNodeById(node, id)
      if (node) pathNodes.push(node)
    })

    pathNodes.forEach((pNode) => {
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
  
  // Show/hide back button
  const back = document.getElementById('back-up')
  if (back) {
    if (pathRef.length > 0) {
      back.classList.remove('hidden')
      back.style.visibility = 'visible'
    } else {
      back.classList.add('hidden')
      back.style.visibility = 'hidden'
    }
  }

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
export function renderTree(nodes, container, options = {}) {
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
  
  nodes.forEach((node, index) => {
    if (node.type === 'item') {
      node.children = []
    }

    const li = document.createElement('li')
    const wrapper = document.createElement('div')
    const isListDone = node.type === 'list' && getDescendantItemSummary(node).total > 0 && getDescendantItemSummary(node).done === getDescendantItemSummary(node).total
    wrapper.className = `tree-item${(node.type === 'item' && node.done) || isListDone ? ' done' : ''}`
    wrapper.setAttribute('data-node-id', node.id)

    // Right-click context menu support
    wrapper.addEventListener('contextmenu', (evt) => {
      evt.preventDefault()
      document.querySelectorAll('.item-context-menu.open').forEach(menu => menu.classList.remove('open'))
      const menu = wrapper.querySelector('.item-context-menu')
      if (menu) {
        menu.classList.add('open')
        updateMenuLock()
      }
    })

    const titleInput = document.createElement('input')

    // Create action control (checkbox for items, drill-in button for lists)
    const actionControl = document.createElement(node.type === 'item' ? 'input' : 'button')

    if (node.type === 'item') {
      // Checkbox for items
      actionControl.type = 'checkbox'
      actionControl.checked = node.done
      actionControl.addEventListener('change', () => {
        const wasDone = node.done
        node.done = actionControl.checked
        if (node.done && !wasDone) {
          node.lastCompletedDate = Date.now()
        }
        const currentNode = getParentNode()
        sortNodeChildren(currentNode)
        saveData(nodesRawRef)
        onToggleDone()
      })
      actionControl.style.minWidth = '1rem'
      actionControl.style.marginRight = '0.5rem'
    } else {
      // Drill-in button for lists
      actionControl.textContent = '↓'
      actionControl.className = 'small-button'
      actionControl.style.minWidth = '1rem'
      actionControl.style.marginRight = '0.5rem'
      actionControl.title = 'Drill In'
      actionControl.addEventListener('click', () => {
        currentPathRef.push(node.id)
        onToggleDone()
      })
    }

    // Title input field
    titleInput.type = 'text'
    titleInput.value = node.title
    titleInput.className = 'label'
    titleInput.addEventListener('change', () => {
      node.title = titleInput.value
      node.isNew = false
      saveData(nodesRawRef)
      onToggleDone()
    })
    titleInput.addEventListener('blur', () => {
      node.isNew = false
    })
    
    // Keyboard handling for Enter (create new item) and Escape (delete new item)
    titleInput.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault()
        node.title = titleInput.value
        node.isNew = false
        if (node.type === 'item') {
          const parent = findParent(nodesRawRef, node.id)
          const array = parent ? parent.children : nodesRawRef.children
          const idx = array.findIndex((c) => c.id === node.id)
          if (idx !== -1) {
            const newNode = createNode()
            const newNodeId = newNode.id
            array.splice(idx + 1, 0, newNode)
            saveData(nodesRawRef)
            onToggleDone()
            const newInput = document.querySelector(`[data-node-id="${newNodeId}"] input.label`)
            focusLabelInput(newInput)
          }
        } else if (node.type === 'list') {
          currentPathRef.push(node.id)
          const listNode = findNodeById(nodesRawRef, node.id)
          if (listNode) {
            listNode.children = listNode.children || []
            const newNode = createNode()
            const newNodeId = newNode.id
            listNode.children.push(newNode)
            saveData(nodesRawRef)
            onToggleDone()
            const newInput = document.querySelector(`[data-node-id="${newNodeId}"] input.label`)
            focusLabelInput(newInput)
          } else {
            onToggleDone()
          }
        }
      } else if (evt.key === 'Escape') {
        if (node.isNew) {
          evt.preventDefault()
          const parent = findParent(nodesRawRef, node.id)
          const array = parent ? parent.children : nodesRawRef.children
          const idx = array.findIndex((c) => c.id === node.id)
          if (idx !== -1) {
            array.splice(idx, 1)
            saveData(nodesRawRef)
            onToggleDone()
          }
        }
      }
    })

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
      document.querySelectorAll('.item-context-menu.open').forEach(menu => menu.classList.remove('open'))
      const menu = wrapper.querySelector('.item-context-menu')
      if (menu) {
        menu.classList.add('open')
        updateMenuLock()
      }
    })

    // Context menu with delete option
    const contextMenu = document.createElement('div')
    contextMenu.className = 'item-context-menu context-menu'

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

    contextMenu.appendChild(deleteButton)

    // Configure button states based on sort mode
    const parent = getParentNode()
    const isSortByCompleted = parent.sortMode === 'completed'
    
    upButton.disabled = index === 0
    downButton.disabled = index === nodes.length - 1

    // Build element array
    const elements = [actionControl, titleInput]
    
    if (showUpDownRef && !isSortByCompleted) {
      elements.push(upButton, downButton)
    }
    
    elements.push(contextToggle)

    // Add summary for lists
    if (node.type === 'list') {
      const summary = getDescendantItemSummary(node)
      const summaryEl = document.createElement('span')
      summaryEl.className = 'summary'
      summaryEl.textContent = `(${summary.done}/${summary.total})`
      elements.splice(2, 0, summaryEl)
    }

    wrapper.append(...elements)
    wrapper.appendChild(contextMenu)

    li.appendChild(wrapper)
    ul.appendChild(li)
  })
  
  container.appendChild(ul)
}

export { currentPath, nodesRaw, showUpDownActions }
