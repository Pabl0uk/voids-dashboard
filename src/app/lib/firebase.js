// src/lib/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCnR52Ego88hKBelb5MqaA7PUynxqbUNEg",
  authDomain: "empty-homes-hub.firebaseapp.com",
  projectId: "empty-homes-hub",
  storageBucket: "empty-homes-hub.firebasestorage.app",
  messagingSenderId: "154290775925",
  appId: "1:154290775925:web:8bd4e0aaf7abc67b3d953c",
  measurementId: "G-R45GQPSDLF"
};

// Initialise Firebase and Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };