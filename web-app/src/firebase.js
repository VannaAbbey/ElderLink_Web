// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCU0B_2j6tSISP6IAR4ajOdAy9CctBiX3M",
  authDomain: "elderlink-firebase.firebaseapp.com",
  projectId: "elderlink-firebase",
  storageBucket: "elderlink-firebase.firebasestorage.app",
  messagingSenderId: "586605125696",
  appId: "1:586605125696:web:47458a64e1a5fafa75bfa5"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
