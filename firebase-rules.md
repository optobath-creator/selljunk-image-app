# JunkLister — Firebase Security Rules

Paste each block into the Firebase Console under the corresponding tab.

---

## Firestore Rules
**Console → Firestore Database → Rules**

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

## Storage Rules
**Console → Storage → Rules**

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

## Required Console Steps

1. **Authentication** → Sign-in method → Enable **Google**
2. **Firestore Database** → Create database (Production mode) → Apply rules above
3. **Storage** → Get started → Apply rules above
4. **Netlify** → Site config → Environment variables → Add `CLAUDE_API_KEY`

---

## Optional: Storage CORS (if analyze fails with CORS error)

If image re-download during analysis fails, create `cors.json` and run once:

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
gsutil cors set cors.json gs://junklisting-aa1db.firebasestorage.app
```

Requires `gsutil` (part of Google Cloud SDK).
