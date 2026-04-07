# Firebase Setup Guide

This app runs in **local-only mode** out of the box (no auth, no sync).
To enable multi-device sync, Google sign-in, Apple sign-in, and email/password auth,
follow these steps — it takes about 10 minutes.

---

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com
2. Click **Add project** → name it (e.g. `checklist-pwa`) → Continue
3. Disable Google Analytics if you don't need it → **Create project**

---

## 2. Enable Authentication providers

In your project, go to **Authentication → Sign-in method**:

### Email / Password
- Click **Email/Password** → Enable → Save

### Google
- Click **Google** → Enable
- Set a support email → Save

### Apple
Apple sign-in requires:
- An **Apple Developer account** ($99/year)
- A registered **App ID** with "Sign In with Apple" capability
- A **Service ID** configured with your app's domain/redirect URI

Steps:
1. In Firebase Console → Authentication → Sign-in method → Apple → Enable
2. Copy the **OAuth redirect URI** shown (e.g. `https://your-project.firebaseapp.com/__/auth/handler`)
3. In Apple Developer Portal:
   - Create an **App ID** → enable "Sign In with Apple"
   - Create a **Services ID** → configure domains + redirect URI from step 2
   - Create a **Key** with "Sign In with Apple" → download it
4. Back in Firebase, fill in: Team ID, Key ID, and upload the private key file → Save

---

## 3. Enable Firestore

1. Go to **Firestore Database → Create database**
2. Choose **Start in production mode** → select a region → Enable
3. Go to **Rules** tab and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /checklists/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Click **Publish**

This ensures each user can only read/write their own data.

---

## 4. Register a Web App and get your config

1. In Project Overview → **Add app** → Web (</> icon)
2. Give it a nickname (e.g. `checklist-web`) → Register app
3. Copy the `firebaseConfig` object shown

---

## 5. Add config to index.html

Open `index.html` and find this block near the top:

```js
window.__FIREBASE_CONFIG__ = null
```

Replace `null` with your config object:

```js
window.__FIREBASE_CONFIG__ = {
  apiKey:            "AIza...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc"
}
```

---

## 6. Authorise your domain

1. Firebase Console → Authentication → Settings → **Authorised domains**
2. Add your GitHub Pages domain: `jaredchurch.github.io`

---

## 7. Deploy

Commit and push — GitHub Pages will serve the updated app automatically.

```bash
git add -A
git commit -m "Enable Firebase auth and sync"
git push
```

---

## How sync works

| Situation | Behaviour |
|-----------|-----------|
| Online, signed in | Every save is pushed to Firestore within ~600ms (debounced) |
| Another device opens app | Firestore real-time listener delivers updates instantly |
| Go offline | Writes queue locally in IndexedDB; pushed when connection returns |
| Conflict (two devices edit simultaneously) | Last write (by server timestamp) wins |
| Not signed in | App runs fully locally; data never leaves the device |
| Firebase not configured | App works identically to the original local-only version |
