/**
 * Event handlers and controls for the Checklist PWA
 * Registers click handlers for buttons and manages state updates
 */

import { createNode, createListNode, setTreeDone, sortNodeChildren } from './tree.js'
import { saveData, saveSettings, getSettings } from './storage.js'
import { updateMenuLock, getCurrentParentNode, setState } from './render.js'
import { exportData, exportSubListData, setupImportDialog, setupAboutDialog, showRenameDialog } from './dialogs.js'

let showUpDownActions = getSettings().showUpDownActions || false

/**
 * Set the showUpDownActions state (for backward compatibility)
 */
export function setShowUpDownActions (value) {
  showUpDownActions = value
}

/**
 * Register all event handlers for the app
 * @param {object} nodesRef - Reference to the nodes object
 * @param {object} currentPathRef - Reference to the current path array
 * @param {function} renderFn - Function to call for re-rendering
 */
export function registerControls (nodesRef, currentPathRef, renderFn) {
  const globalAddItem = document.getElementById('global-add-item')
  const globalAddList = document.getElementById('global-add-list')
  const globalMarkAllDone = document.getElementById('global-mark-all-done')
  const globalMarkAllNotDone = document.getElementById('global-mark-all-not-done')
  const globalContext = document.getElementById('global-context')
  const globalContextLeft = document.getElementById('global-context-left')

  // Helper functions to access refs
  const getNodesRaw = () => nodesRef.current
  const getCurrentPath = () => currentPathRef.current
  const settings = getSettings()
  let continuousItemCreation = settings.continuousItemCreation !== false

  /**
   * Create a new item and optionally continue creating more
   * If cancelled, delete the item
   */
  function createItemAndContinue (nodesRaw, parent, firstNode) {
    let currentNode = firstNode

    function createNext (node) {
      showRenameDialog(node.title, (newTitle) => {
        node.title = newTitle
        saveData(nodesRaw)
        renderFn()

        if (continuousItemCreation) {
          parent.children = parent.children || []
          const newNode = createNode()
          parent.children.push(newNode)
          saveData(nodesRaw)
          renderFn()
          currentNode = newNode
          createNext(newNode)
        }
      }, () => {
        // Cancelled - remove the item
        const idx = parent.children.indexOf(node)
        if (idx !== -1) {
          parent.children.splice(idx, 1)
          saveData(nodesRaw)
          renderFn()
        }
      })
    }

    createNext(currentNode)
  }

  // Add item button - creates a new item and focuses it
  if (globalAddItem) {
    globalAddItem.addEventListener('click', () => {
      let nodesRaw = getNodesRaw()
      if (!nodesRaw) {
        const defaultList = createListNode('My Checklist')
        nodesRef.current = defaultList
        nodesRaw = defaultList
        saveData(nodesRaw)
      }
      const parent = getCurrentParentNode(nodesRaw, getCurrentPath())
      if (!parent) return
      parent.children = parent.children || []
      const newNode = createNode()
      parent.children.push(newNode)
      saveData(nodesRaw)
      renderFn()
      createItemAndContinue(nodesRaw, parent, newNode)
      globalContextLeft?.classList.remove('open')
    })
  }

  // Add list button - creates a new sub-list, enters it, and creates a new item
  if (globalAddList) {
    globalAddList.addEventListener('click', () => {
      const nodesRaw = getNodesRaw()
      const parent = getCurrentParentNode(nodesRaw, getCurrentPath())
      parent.children = parent.children || []
      const newNode = createListNode()
      parent.children.push(newNode)
      saveData(nodesRaw)
      renderFn()
      showRenameDialog(newNode.title, (newTitle) => {
        newNode.title = newTitle
        saveData(nodesRaw)
        // Navigate into the new sub-list
        currentPathRef.current.push(newNode.id)
        // Create a new item in the sub-list with continuous creation
        newNode.children = newNode.children || []
        const newItem = createNode()
        newNode.children.push(newItem)
        saveData(nodesRaw)
        renderFn()
        createItemAndContinue(nodesRaw, newNode, newItem)
      }, () => {
        // Cancelled list rename - remove the list
        const idx = parent.children.indexOf(newNode)
        if (idx !== -1) {
          parent.children.splice(idx, 1)
          saveData(nodesRaw)
          renderFn()
        }
      })
      globalContextLeft?.classList.remove('open')
    })
  }

  // Mark all done button
  if (globalMarkAllDone) {
    globalMarkAllDone.addEventListener('click', () => {
      const nodesRaw = getNodesRaw()
      const parent = getCurrentParentNode(nodesRaw, getCurrentPath())
      const nodes = Array.isArray(parent.children) ? parent.children : []
      setTreeDone(nodes, true, true)
      sortNodeChildren(parent)
      saveData(nodesRaw)
      renderFn()
      globalContext?.classList.remove('open')
    })
  }

  // Mark all not done button
  if (globalMarkAllNotDone) {
    globalMarkAllNotDone.addEventListener('click', () => {
      const nodesRaw = getNodesRaw()
      const parent = getCurrentParentNode(nodesRaw, getCurrentPath())
      const nodes = Array.isArray(parent.children) ? parent.children : []
      setTreeDone(nodes, false, true)
      sortNodeChildren(parent)
      saveData(nodesRaw)
      renderFn()
      globalContext?.classList.remove('open')
    })
  }

  // Sort by completed button - toggles between manual and completed sort mode
  const globalSortCompleted = document.getElementById('global-sort-completed')
  if (globalSortCompleted) {
    globalSortCompleted.addEventListener('click', () => {
      const nodesRaw = getNodesRaw()
      const parent = getCurrentParentNode(nodesRaw, getCurrentPath())
      parent.sortMode = parent.sortMode === 'completed' ? 'manual' : 'completed'
      saveData(nodesRaw)
      renderFn()
      globalContext?.classList.remove('open')
    })
  }

  // Show/hide sorting controls button
  const globalToggleUpDown = document.getElementById('global-toggle-up-down')
  if (globalToggleUpDown) {
    globalToggleUpDown.addEventListener('click', () => {
      const nodesRaw = getNodesRaw()
      const parent = getCurrentParentNode(nodesRaw, getCurrentPath())
      if (parent.sortMode === 'completed') return
      showUpDownActions = !showUpDownActions
      saveSettings({ showUpDownActions })
      setState({ showUpDownActions })
      renderFn()
      globalContext?.classList.remove('open')
    })
  }

  // Toggle continuous item creation
  const globalToggleContinuous = document.getElementById('global-toggle-continuous')
  if (globalToggleContinuous) {
    globalToggleContinuous.addEventListener('click', () => {
      continuousItemCreation = !continuousItemCreation
      saveSettings({ continuousItemCreation })
      renderFn()
      globalContext?.classList.remove('open')
    })
  }

  // Global context menu toggle
  const globalContextToggle = document.getElementById('global-context-toggle')
  const globalContextToggleLeft = document.getElementById('global-context-toggle-left')
  const globalExport = document.getElementById('global-export')
  const globalImport = document.getElementById('global-import')

  if (globalContextToggle && globalContext) {
    globalContextToggle.addEventListener('click', () => {
      const isOpen = globalContext.classList.contains('open')
      globalContext.classList.toggle('open')
      if (!isOpen) {
        // Position menu below the toggle button
        const btnRect = globalContextToggle.getBoundingClientRect()
        globalContext.style.position = 'fixed'
        globalContext.style.top = `${btnRect.bottom}px`
        globalContext.style.left = `${btnRect.right - globalContext.offsetWidth}px`
        globalContext.style.right = 'auto'
        globalContext.style.bottom = 'auto'

        const rect = globalContext.getBoundingClientRect()
        const breadcrumbBar = document.getElementById('breadcrumb-bar')
        const buffer = 10
        const bottomLimit = breadcrumbBar ? breadcrumbBar.getBoundingClientRect().top : window.innerHeight
        const windowWidth = window.innerWidth

        // Adjust if menu goes off bottom
        if (rect.bottom > bottomLimit - buffer) {
          globalContext.style.top = `${btnRect.top - rect.height}px`
        }
        // Adjust if menu goes off right
        if (rect.right > windowWidth - buffer) {
          globalContext.style.left = `${windowWidth - rect.width - buffer}px`
        }
      }
      updateMenuLock()
    })
  }

  if (globalContextToggleLeft && globalContextLeft) {
    globalContextToggleLeft.addEventListener('click', () => {
      const isOpen = globalContextLeft.classList.contains('open')
      globalContextLeft.classList.toggle('open')
      if (!isOpen) {
        // Position menu below the toggle button
        const btnRect = globalContextToggleLeft.getBoundingClientRect()
        globalContextLeft.style.position = 'fixed'
        globalContextLeft.style.top = `${btnRect.bottom}px`
        globalContextLeft.style.left = `${btnRect.left}px`
        globalContextLeft.style.right = 'auto'
        globalContextLeft.style.bottom = 'auto'

        const rect = globalContextLeft.getBoundingClientRect()
        const breadcrumbBar = document.getElementById('breadcrumb-bar')
        const buffer = 10
        const bottomLimit = breadcrumbBar ? breadcrumbBar.getBoundingClientRect().top : window.innerHeight
        const windowWidth = window.innerWidth

        // Adjust if menu goes off bottom
        if (rect.bottom > bottomLimit - buffer) {
          globalContextLeft.style.top = `${btnRect.top - rect.height}px`
        }
        // Adjust if menu goes off right
        if (rect.right > windowWidth - buffer) {
          globalContextLeft.style.left = `${windowWidth - rect.width - buffer}px`
        }
      }
      updateMenuLock()
    })
  }

  // Export button - exports entire tree or current sub-list
  if (globalExport) {
    globalExport.addEventListener('click', () => {
      const nodesRaw = getNodesRaw()
      const path = getCurrentPath()
      if (path.length === 0) {
        exportData(nodesRaw)
      } else {
        const currentNode = getCurrentParentNode(nodesRaw, path)
        exportSubListData(currentNode)
      }
      globalContext?.classList.remove('open')
    })
  }

  // Import button
  if (globalImport) {
    globalImport.addEventListener('click', () => {
      showImportDialog()
      globalContext?.classList.remove('open')
    })
  }

  // Setup about dialog
  setupAboutDialog()

  // Setup import dialog
  const { showImportDialog } = setupImportDialog(
    nodesRef,
    currentPathRef,
    renderFn,
    () => getCurrentParentNode(getNodesRaw(), getCurrentPath())
  )

  // Close context menus when clicking outside
  document.addEventListener('click', (evt) => {
    const target = evt.target
    const isInsideMenu = target.closest('.context-menu')
    const isToggle = target.closest('.context-toggle')
    if (!isInsideMenu && !isToggle) {
      document.querySelectorAll('.context-menu.open').forEach(menu => menu.classList.remove('open'))
      globalContext?.classList.remove('open')
      globalContextLeft?.classList.remove('open')
      updateMenuLock()
    }
  })
}
