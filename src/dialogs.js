/**
 * Dialog and export/import functions for the Checklist PWA
 * Handles data export, import dialogs, and the about dialog
 */

import { sanitizeTree, collectIds } from './tree.js'
import { saveData } from './storage.js'
import { updateMenuLock } from './render.js'

/**
 * Export entire checklist data as JSON file
 */
export function exportData(nodes) {
  const dataString = JSON.stringify(nodes, null, 2)
  const blob = new Blob([dataString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'checklist-backup.json'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Export current sub-list as JSON file
 */
export function exportSubListData(currentNode) {
  const dataString = JSON.stringify(currentNode, null, 2)
  const blob = new Blob([dataString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'checklist-sublist.json'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Prompt for import and replace entire data
 */
export function promptImportData(nodesRaw, renderFn) {
  const fallback = document.createElement('input')
  fallback.type = 'file'
  fallback.accept = 'application/json'
  fallback.style.display = 'none'
  fallback.addEventListener('change', async (evt) => {
    const file = evt.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const imported = JSON.parse(text)
      if (imported.type !== 'list') throw new Error('Invalid file format: must be a list node')
      const newNodesRaw = sanitizeTree(imported)
      saveData(newNodesRaw)
      renderFn()
      fallback.value = ''
    } catch (error) {
      alert('Import failed: ' + error.message)
      console.error(error)
    } finally {
      document.body.removeChild(fallback)
    }
  })
  document.body.appendChild(fallback)
  fallback.click()
}

/**
 * Prompt for import and add as sub-list to current location
 */
export function promptImportSubListData(nodesRaw, currentNode, renderFn) {
  const fallback = document.createElement('input')
  fallback.type = 'file'
  fallback.accept = 'application/json'
  fallback.style.display = 'none'
  fallback.addEventListener('change', async (evt) => {
    const file = evt.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const imported = JSON.parse(text)
      if (imported.type !== 'list') throw new Error('Invalid file format: must be a list node')
      
      currentNode.children = currentNode.children || []
      const existingIds = collectIds(nodesRaw)
      currentNode.children.push(sanitizeTree(imported, existingIds))
      saveData(nodesRaw)
      renderFn()
      fallback.value = ''
    } catch (error) {
      alert('Import failed: ' + error.message)
      console.error(error)
    } finally {
      document.body.removeChild(fallback)
    }
  })
  document.body.appendChild(fallback)
  fallback.click()
}

/**
 * Setup the about dialog with keyboard navigation and commit info
 */
export function setupAboutDialog() {
  const aboutDialog = document.getElementById('about-dialog')
  const aboutCommitInfo = document.getElementById('about-commit-info')
  const closeAbout = document.getElementById('close-about')
  const globalAbout = document.getElementById('global-about')
  const globalContext = document.getElementById('global-context')

  let lastFocusedElement = null

  // Handle Escape to close and Tab to cycle focus within dialog
  const onAboutKeydown = (evt) => {
    if (evt.key === 'Escape' && aboutDialog.style.display === 'flex') {
      evt.preventDefault()
      closeAboutDialog()
    }

    if (evt.key === 'Tab' && aboutDialog.style.display === 'flex') {
      const focusable = aboutDialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      if (!focusable.length) return
      const focusArray = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'))
      const currentIndex = focusArray.indexOf(document.activeElement)
      let nextIndex = currentIndex

      if (evt.shiftKey) {
        nextIndex = currentIndex <= 0 ? focusArray.length - 1 : currentIndex - 1
      } else {
        nextIndex = currentIndex === focusArray.length - 1 ? 0 : currentIndex + 1
      }

      evt.preventDefault()
      focusArray[nextIndex].focus()
    }
  }

  // Open about dialog
  const openAbout = async () => {
    if (!aboutDialog || !aboutCommitInfo) return

    lastFocusedElement = document.activeElement
    aboutDialog.style.display = 'flex'

    const focusable = aboutDialog.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    if (focusable) focusable.focus()

    document.addEventListener('keydown', onAboutKeydown)

    aboutCommitInfo.textContent = 'Loading commit info...'
    await fetchCommitInfo()
    globalContext?.classList.remove('open')
    updateMenuLock()
  }

  // Close about dialog and restore focus
  const closeAboutDialog = () => {
    if (!aboutDialog) return

    aboutDialog.style.display = 'none'
    document.removeEventListener('keydown', onAboutKeydown)

    if (lastFocusedElement && lastFocusedElement.focus) {
      lastFocusedElement.focus()
    }
  }

  // Click outside to close
  if (aboutDialog) {
    aboutDialog.addEventListener('click', (evt) => {
      if (evt.target === aboutDialog) {
        closeAboutDialog()
      }
    })
  }

  // Open button
  if (globalAbout) {
    globalAbout.addEventListener('click', openAbout)
  }

  // Close button
  if (closeAbout) {
    closeAbout.addEventListener('click', (evt) => {
      evt.stopPropagation()
      closeAboutDialog()
    })
  }
}

/**
 * Fetch latest commit info from GitHub
 */
async function fetchCommitInfo() {
  const el = document.getElementById('about-commit-info') || document.getElementById('commit-info')
  if (!el) return

  const repoOwner = 'jaredchurch'
  const repoName = 'checklist'

  try {
    let branch = 'main'

    const pagesResp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pages`)
    if (pagesResp.ok) {
      const pagesData = await pagesResp.json()
      branch = pagesData.source?.branch || branch
    } else {
      const repoResp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`)
      if (repoResp.ok) {
        const repoData = await repoResp.json()
        branch = repoData.default_branch || branch
      }
    }

    const commitResp = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/commits/${branch}`)
    if (!commitResp.ok) throw new Error(`Commits API ${commitResp.status}`)
    const commit = await commitResp.json()

    const hash = commit.sha.slice(0, 7)
    const date = new Date(commit.commit.committer.date).toLocaleString()
    el.textContent = `Commit ${hash} @ ${date} (${branch})`
  } catch (err) {
    console.warn('Failed to load commit info', err)
    el.textContent = 'Commit info unavailable'
  }
}

/**
 * Setup import dialog with replace and sub-list options
 */
export function setupImportDialog(nodesRef, currentPathRef, renderFn, getCurrentParentNodeFn) {
  const importDialog = document.getElementById('import-dialog')
  const importReplace = document.getElementById('import-replace')
  const importSublist = document.getElementById('import-sublist')
  const cancelImport = document.getElementById('cancel-import')

  let importFileData = null

  const showImportDialog = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.style.display = 'none'
    input.addEventListener('change', async (evt) => {
      const file = evt.target.files?.[0]
      if (!file) return
      
      try {
        const text = await file.text()
        const imported = JSON.parse(text)
        if (imported.type !== 'list') throw new Error('Invalid file format: must be a list node')
        
        importFileData = imported
        importDialog.style.display = 'flex'
        document.body.removeChild(input)
      } catch (error) {
        alert('Invalid file: ' + error.message)
        document.body.removeChild(input)
      }
    })
    document.body.appendChild(input)
    input.click()

    updateMenuLock()
  }

  const closeImportDialog = () => {
    if (!importDialog) return
    importDialog.style.display = 'none'
    importFileData = null
  }

  // Replace entire checklist
  if (importReplace) {
    importReplace.addEventListener('click', (evt) => {
      evt.stopPropagation()
      if (importFileData) {
        const newNodes = sanitizeTree(importFileData)
        saveData(newNodes)
        nodesRef.current = newNodes
        currentPathRef.current = []
        renderFn()
        closeImportDialog()
      }
    })
  }

  // Import as sub-list
  if (importSublist) {
    importSublist.addEventListener('click', (evt) => {
      evt.stopPropagation()
      if (importFileData) {
        const currentNode = getCurrentParentNodeFn()
        currentNode.children = currentNode.children || []
        const existingIds = collectIds(nodesRef.current)
        currentNode.children.push(sanitizeTree(importFileData, existingIds))
        saveData(nodesRef.current)
        renderFn()
        closeImportDialog()
      }
    })
  }

  // Cancel button
  if (cancelImport) {
    cancelImport.addEventListener('click', (evt) => {
      evt.stopPropagation()
      closeImportDialog()
    })
  }

  // Click outside to close
  if (importDialog) {
    importDialog.addEventListener('click', (evt) => {
      if (evt.target === importDialog) {
        closeImportDialog()
      }
    })
  }

  return { showImportDialog }
}
