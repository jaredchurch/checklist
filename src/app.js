/**
 * Checklist PWA - Main Application Entry Point
 * A progressive web app for managing hierarchical checklists with sorting capabilities
 */

import { getData } from './storage.js'
import { registerControls } from './controls.js'
import { render, initState } from './render.js'

/**
 * Initialize the application
 * Sets up state, registers event handlers, and renders the initial UI
 */
function init() {
  document.title = 'Checklist'
  
  // Load initial data from storage
  const initialData = getData()
  initState(initialData)
  
  // Create refs for state that needs to be shared across modules
  const nodesRef = { current: initialData }
  const currentPathRef = { current: [] }
  
  // Render function that maintains correct state references
  const renderFn = () => {
    render(() => renderFn(), nodesRef, currentPathRef)
  }
  
  // Register all event handlers
  registerControls(nodesRef, currentPathRef, renderFn)
  
  // Initial render
  render(() => renderFn(), nodesRef, currentPathRef)
  
  // Fetch and display commit info in about dialog
  fetchCommitInfo()

  // Register service worker for PWA functionality
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      console.log('Service worker registered')
    }).catch((err) => console.error(err))
  }
}

/**
 * Fetch latest commit info from GitHub and display in about dialog
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

// Start the application when the DOM is loaded
window.addEventListener('load', init)

export { init }
