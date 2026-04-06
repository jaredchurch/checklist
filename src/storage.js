/**
 * Storage utilities for the Checklist PWA
 * Handles persistence of checklist data and user settings to localStorage
 */

import { sanitizeTree } from './tree.js'

const KEY = 'checklist-pwa-data-v1'
const SETTINGS_KEY = 'checklist-pwa-settings-v1'

/**
 * Load checklist data from localStorage
 * Returns sanitized tree structure or null if not found/invalid
 */
export function getData() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.type !== 'list') {
      console.warn('Invalid root data, resetting to default')
      return null
    }
    return sanitizeTree(parsed)
  } catch (err) {
    console.error('Invalid saved data', err)
    localStorage.removeItem(KEY)
    return null
  }
}

/**
 * Save checklist data to localStorage
 */
export function saveData(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

/**
 * Load user settings from localStorage
 * Returns default settings if not found or invalid
 */
export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { showUpDownActions: false }
    const parsed = JSON.parse(raw)
    return {
      showUpDownActions: typeof parsed.showUpDownActions === 'boolean' ? parsed.showUpDownActions : false
    }
  } catch (err) {
    console.error('Invalid saved settings', err)
    localStorage.removeItem(SETTINGS_KEY)
    return { showUpDownActions: false }
  }
}

/**
 * Save user settings to localStorage
 */
export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export { KEY, SETTINGS_KEY }
