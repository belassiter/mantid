// Firebase configuration
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

// TODO: Replace with your Firebase project configuration
// Get these values from Firebase Console > Project Settings > Your Apps
const firebaseConfig = {
  apiKey: "AIzaSyDuE3E6Cl-KccdpfzVcOBkXfVtjmzFINNc",
  authDomain: "mantid-game.firebaseapp.com",
  projectId: "mantid-game",
  storageBucket: "mantid-game.firebasestorage.app",
  messagingSenderId: "1045375096175",
  appId: "1:1045375096175:web:2e2e11d0413e91bd37049a",
  measurementId: "G-Z7K16EQKQ2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export app for other services
export { app };

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Auth
export const auth = getAuth(app);

// Sign in anonymously (creates a temporary user ID)
export const signInAnonymous = async () => {
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (error) {
    console.error("Error signing in anonymously:", error);
    throw error;
  }
};
