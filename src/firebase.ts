import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, or, orderBy, limit, startAfter, addDoc, serverTimestamp, getDocFromServer, runTransaction, writeBatch, getCountFromServer, increment } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import firebaseConfigJson from '../firebase-applet-config.json';

// Detect if environment variables are "suspicious" (e.g., databaseId is a URL)
const envDatabaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const isSuspiciousEnv = envDatabaseId && envDatabaseId.startsWith('http');

if (isSuspiciousEnv) {
  console.warn('CRITICAL NOTICE: Detected invalid Firebase environment variables (Database ID is a URL).');
  console.warn('Ignoring VITE_FIREBASE_* environment variables and using firebase-applet-config.json instead.');
}

// Using firebase-applet-config.json as primary source, allowing env overrides ONLY if not suspicious
const firebaseConfig = {
  ...firebaseConfigJson,
  apiKey: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_API_KEY) || firebaseConfigJson.apiKey,
  authDomain: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) || firebaseConfigJson.authDomain,
  projectId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_PROJECT_ID) || firebaseConfigJson.projectId,
  storageBucket: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) || firebaseConfigJson.storageBucket,
  messagingSenderId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) || firebaseConfigJson.messagingSenderId,
  appId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_APP_ID) || firebaseConfigJson.appId,
  measurementId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) || firebaseConfigJson.measurementId
};

let rawDatabaseId = (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID) || (firebaseConfigJson as any).firestoreDatabaseId || '(default)';
let rawProjectId = firebaseConfig.projectId;

export const databaseId = rawDatabaseId;
export const projectId = rawProjectId;

const app = initializeApp(firebaseConfig);

// App Check Initialization (reCAPTCHA Enterprise)
if (typeof window !== 'undefined' && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);
export let db = getFirestore(app, databaseId);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export let messaging: any = null;
isSupported().then((supported) => {
  if (supported) {
    messaging = getMessaging(app);
  }
});

// Test connection to Firestore
async function testConnection() {
  try {
    // Try to reach the server
    await getDocFromServer(doc(db, 'system', 'connection_test'));
    console.log('Firestore connection successful.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Firebase configuration error: Client is offline. Check your project settings.");
      console.error("This usually means the databaseId or projectId is incorrect.");
      console.error("Current Database ID:", databaseId);
      console.error("Current Project ID:", firebaseConfig.projectId);
      console.error("Please verify that your firestoreDatabaseId matches the one in Firebase Console.");
    } else {
      // Other errors are fine, might just be a missing document
      console.log('Firestore connection test finished with:', error instanceof Error ? error.message : String(error));
    }
  }
}
setTimeout(testConnection, 2000); // Wait a bit for initialization

export { signInWithPopup, signOut, onAuthStateChanged, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, or, orderBy, limit, startAfter, addDoc, serverTimestamp, ref, uploadBytes, getDownloadURL, runTransaction, writeBatch, getCountFromServer, increment };
