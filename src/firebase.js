/**
 * Firebase configuration and initialisation
 *
 * Uses the Firebase JS SDK v10 loaded from CDN (compat-free modular API).
 * Configuration is injected at runtime from window.__FIREBASE_CONFIG__
 * which is set in index.html so it can be supplied per-deployment without
 * rebuilding the bundle.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  OAuthProvider,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'

// ── App config ──────────────────────────────────────────────────────────────
// Injected via index.html <script> block; fallback to empty so module loads OK
const firebaseConfig = window.__FIREBASE_CONFIG__ || null

let app = null
let auth = null
let db = null

export function isFirebaseConfigured () {
  return !!firebaseConfig
}

export function initFirebase () {
  if (!firebaseConfig) return false
  app  = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db   = getFirestore(app)

  // Enable offline persistence (IndexedDB-backed Firestore cache)
  enableIndexedDbPersistence(db).catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('Firestore persistence: multiple tabs open')
    } else if (err.code === 'unimplemented') {
      console.warn('Firestore persistence: browser not supported')
    }
  })

  return true
}

export { auth, db, serverTimestamp }

// ── Auth helpers ─────────────────────────────────────────────────────────────
export function watchAuthState (callback) {
  if (!auth) return () => {}
  return onAuthStateChanged(auth, callback)
}

export async function loginEmail (email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

export async function registerEmail (email, password) {
  return createUserWithEmailAndPassword(auth, email, password)
}

export async function loginGoogle () {
  const provider = new GoogleAuthProvider()
  return signInWithPopup(auth, provider)
}

export async function loginApple () {
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  return signInWithPopup(auth, provider)
}

export async function resetPassword (email) {
  return sendPasswordResetEmail(auth, email)
}

export async function logout () {
  return signOut(auth)
}

// ── Firestore helpers ────────────────────────────────────────────────────────
export function userDocRef (uid) {
  return doc(db, 'checklists', uid)
}

export async function loadFromFirestore (uid) {
  const snap = await getDoc(userDocRef(uid))
  return snap.exists() ? snap.data() : null
}

export async function saveToFirestore (uid, data) {
  await setDoc(userDocRef(uid), {
    data,
    updatedAt: serverTimestamp()
  })
}

/**
 * Subscribe to real-time updates for a user's checklist document.
 * Returns an unsubscribe function.
 */
export function subscribeToFirestore (uid, callback) {
  return onSnapshot(userDocRef(uid), snap => {
    if (snap.exists()) callback(snap.data())
  })
}
