import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js';
import {
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
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js';
import {
  getStorage,
  ref as sRef,
  uploadBytes,
  deleteObject,
  getBlob,
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js';

const app = initializeApp({
  apiKey:            'AIzaSyA9XzoxEOek7MQRQSoXSwsHVTCFE0ByXyc',
  authDomain:        'perfectproject-b31c1.firebaseapp.com',
  projectId:         'perfectproject-b31c1',
  storageBucket:     'perfectproject-b31c1.firebasestorage.app',
  messagingSenderId: '302836589394',
  appId:             '1:302836589394:web:fe8be0e512b5a05944108b',
  measurementId:     'G-4PG5V6Y0CQ',
});

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
export const storage = getStorage(app, 'gs://perfectproject-b31c1.firebasestorage.app');

export const fb = {
  signIn:   () => signInAnonymously(auth),
  signOut:  () => signOut(auth),
  onAuth:   (cb) => onAuthStateChanged(auth, cb),

  groupsQuery: (uid) => query(collection(db, 'users', uid, 'groups'), orderBy('createdAt', 'desc')),
  onSnap:      (q, next, err) => onSnapshot(q, next, err),

  docRef:      (uid, gid) => doc(db, 'users', uid, 'groups', gid),
  setGroup:    (uid, gid, data, merge = true) => setDoc(doc(db, 'users', uid, 'groups', gid), data, { merge }),
  updateGroup: (uid, gid, data) => updateDoc(doc(db, 'users', uid, 'groups', gid), data),
  deleteGroup: (uid, gid) => deleteDoc(doc(db, 'users', uid, 'groups', gid)),

  writeBatch,
  doc,
  getDoc,

  sRef,
  uploadBytes,
  deleteObject,
  getBlob,
};
