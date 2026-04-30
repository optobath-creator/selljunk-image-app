import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  initializeFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage,
  ref as sRef,
  uploadBytes,
  deleteObject,
  getBlob,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const app = initializeApp({
  apiKey:            "AIzaSyD2SXwreze3cSWF7bDz3WF-qsilxqmVZH0",
  authDomain:        "junklisting-aa1db.firebaseapp.com",
  projectId:         "junklisting-aa1db",
  storageBucket:     "junklisting-aa1db.firebasestorage.app",
  messagingSenderId: "752336005616",
  appId:             "1:752336005616:web:a190e24d75530916f21535"
});

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
// Safari/WebKit can block Firestore streaming channels with CORS-ish errors.
// Force long-polling + disable fetch streams for compatibility.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});
export const storage = getStorage(app, "gs://junklisting-aa1db.firebasestorage.app");

export const fb = {
  signIn: () => signInWithPopup(auth, provider),
  signOut: () => signOut(auth),
  onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),
  userGroupsQuery: (uid) => query(collection(db, 'users', uid, 'groups'), orderBy('createdAt', 'desc')),
  onGroupsSnapshot: (q, next, err) => onSnapshot(q, next, err),
  docRef: (uid, groupId) => doc(db, 'users', uid, 'groups', groupId),
  setGroup: (uid, groupId, data, merge = true) => setDoc(doc(db, 'users', uid, 'groups', groupId), data, { merge }),
  deleteGroupDoc: (uid, groupId) => deleteDoc(doc(db, 'users', uid, 'groups', groupId)),
  writeBatch,
  doc,
  getDoc,

  sRef,
  uploadBytes,
  deleteObject,
  getBlob,
};
