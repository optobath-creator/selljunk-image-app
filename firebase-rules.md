# JunkLister — Firebase Setup Guide

## Firebase Project: `perfectproject-b31c1`

---

## 1. Enable Authentication

**Console → Authentication → Sign-in method → Enable Google**

Then add your Netlify domain under **Authorized domains** (e.g. `your-site.netlify.app`).

---

## 2. Firestore Rules

**Console → Firestore Database → Create database (Production mode) → Rules**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## 3. Storage Rules

**Console → Storage → Get started → Rules**

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## 4. Netlify Environment Variable

**Netlify → Site config → Environment variables → Add:**

| Key | Value |
|-----|-------|
| `GEMINI_API_KEY` | Your Google AI Studio API key |

Get your key at: https://aistudio.google.com/apikey

---

## 5. Storage CORS (if image download fails)

Create `cors.json`:

```json
[
  {
    "origin": ["*"],
    "method": ["GET"],
    "maxAgeSeconds": 3600
  }
]
```

```bash
gsutil cors set cors.json gs://perfectproject-b31c1.firebasestorage.app
```
