/**
 * Authentication UI controller
 *
 * Renders and manages the sign-in / sign-up overlay.
 * Calls back into app.js when auth state changes.
 */

import {
  loginEmail,
  registerEmail,
  loginGoogle,
  loginApple,
  resetPassword,
  logout,
  watchAuthState,
  isFirebaseConfigured
} from './firebase.js'

let _onSignedIn  = null  // (user) => void
let _onSignedOut = null  // ()     => void

// ── Overlay elements ─────────────────────────────────────────────────────────
function overlay ()    { return document.getElementById('auth-overlay') }
function authForm ()   { return document.getElementById('auth-form') }
function authMsg ()    { return document.getElementById('auth-message') }
function authEmail ()  { return document.getElementById('auth-email') }
function authPwd ()    { return document.getElementById('auth-password') }
function authSubmit () { return document.getElementById('auth-submit') }

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Initialise auth module.
 * If Firebase is not configured the overlay is never shown and the app
 * runs in local-only mode (same as before).
 */
export function initAuth ({ onSignedIn, onSignedOut }) {
  _onSignedIn  = onSignedIn
  _onSignedOut = onSignedOut

  if (!isFirebaseConfigured()) {
    // No Firebase — run in local-only mode, hide any auth UI
    document.getElementById('auth-overlay')?.remove()
    document.getElementById('auth-user-bar')?.remove()
    onSignedOut?.()
    return
  }

  buildUserBar()
  watchAuthState(user => {
    if (user) {
      hideOverlay()
      updateUserBar(user)
      onSignedIn?.(user)
    } else {
      showOverlay()
      updateUserBar(null)
      onSignedOut?.()
    }
  })
}

export function signOut () {
  return logout()
}

// ── Overlay show / hide ───────────────────────────────────────────────────────
function showOverlay () {
  const el = overlay()
  if (el) el.style.display = 'flex'
}

function hideOverlay () {
  const el = overlay()
  if (el) el.style.display = 'none'
}

// ── User bar (top-right when signed in) ──────────────────────────────────────
function buildUserBar () {
  // Bind sign-out button if it exists in HTML
  const btn = document.getElementById('auth-signout-btn')
  if (btn) btn.addEventListener('click', () => logout())
}

function updateUserBar (user) {
  const bar   = document.getElementById('auth-user-bar')
  const name  = document.getElementById('auth-user-name')
  const avatar= document.getElementById('auth-user-avatar')
  if (!bar) return

  if (user) {
    bar.style.display = 'flex'
    if (name)   name.textContent  = user.displayName || user.email || 'Signed in'
    if (avatar) {
      if (user.photoURL) {
        avatar.src = user.photoURL
        avatar.style.display = 'inline-block'
      } else {
        avatar.style.display = 'none'
      }
    }
  } else {
    bar.style.display = 'none'
  }
}

// ── Overlay interaction ───────────────────────────────────────────────────────
let authMode = 'login' // 'login' | 'register' | 'reset'

export function bindAuthOverlay () {
  if (!isFirebaseConfigured()) return

  // Mode toggle links
  document.getElementById('auth-switch-register')?.addEventListener('click', e => {
    e.preventDefault(); setMode('register')
  })
  document.getElementById('auth-switch-login')?.addEventListener('click', e => {
    e.preventDefault(); setMode('login')
  })
  document.getElementById('auth-forgot-link')?.addEventListener('click', e => {
    e.preventDefault(); setMode('reset')
  })
  document.getElementById('auth-back-login')?.addEventListener('click', e => {
    e.preventDefault(); setMode('login')
  })

  // Email/password submit
  authForm()?.addEventListener('submit', async e => {
    e.preventDefault()
    const email = authEmail()?.value.trim()
    const pwd   = authPwd()?.value

    if (authMode === 'reset') {
      await handleReset(email)
      return
    }
    if (!email || !pwd) { showMsg('Please fill in all fields.', 'error'); return }

    setLoading(true)
    try {
      if (authMode === 'login') {
        await loginEmail(email, pwd)
      } else {
        await registerEmail(email, pwd)
      }
    } catch (err) {
      showMsg(friendlyError(err), 'error')
    } finally {
      setLoading(false)
    }
  })

  // Google
  document.getElementById('auth-google-btn')?.addEventListener('click', async () => {
    setLoading(true)
    try { await loginGoogle() }
    catch (err) { showMsg(friendlyError(err), 'error') }
    finally { setLoading(false) }
  })

  // Apple
  document.getElementById('auth-apple-btn')?.addEventListener('click', async () => {
    setLoading(true)
    try { await loginApple() }
    catch (err) { showMsg(friendlyError(err), 'error') }
    finally { setLoading(false) }
  })
}

async function handleReset (email) {
  if (!email) { showMsg('Enter your email address.', 'error'); return }
  setLoading(true)
  try {
    await resetPassword(email)
    showMsg('Password reset email sent — check your inbox.', 'success')
  } catch (err) {
    showMsg(friendlyError(err), 'error')
  } finally {
    setLoading(false)
  }
}

function setMode (mode) {
  authMode = mode
  clearMsg()

  const loginSection    = document.getElementById('auth-login-section')
  const registerSection = document.getElementById('auth-register-section')
  const resetSection    = document.getElementById('auth-reset-section')
  const pwdWrap         = document.getElementById('auth-pwd-wrap')
  const submitBtn       = authSubmit()

  loginSection?.classList.toggle('hidden', mode !== 'login')
  registerSection?.classList.toggle('hidden', mode !== 'register')
  resetSection?.classList.toggle('hidden', mode !== 'reset')
  if (pwdWrap) pwdWrap.style.display = mode === 'reset' ? 'none' : 'block'
  if (submitBtn) {
    submitBtn.textContent = mode === 'login' ? 'Sign in'
                          : mode === 'register' ? 'Create account'
                          : 'Send reset email'
  }
}

function setLoading (on) {
  const btn = authSubmit()
  if (btn) btn.disabled = on
  const google = document.getElementById('auth-google-btn')
  const apple  = document.getElementById('auth-apple-btn')
  if (google) google.disabled = on
  if (apple)  apple.disabled  = on
}

function showMsg (msg, type = 'error') {
  const el = authMsg()
  if (!el) return
  el.textContent = msg
  el.className   = 'auth-message ' + type
}
function clearMsg () {
  const el = authMsg()
  if (el) { el.textContent = ''; el.className = 'auth-message' }
}

function friendlyError (err) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/invalid-credential':   'Incorrect email or password.',
    'auth/email-already-in-use': 'An account already exists with that email.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed.',
    'auth/popup-blocked':        'Pop-up blocked — please allow pop-ups for this site.',
    'auth/cancelled-popup-request': 'Sign-in cancelled.'
  }
  return map[err.code] || err.message || 'Something went wrong. Please try again.'
}
