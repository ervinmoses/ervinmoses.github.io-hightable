// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDewCnOF9r2ADMTcnxOBPQ6gR_qgOvV6sc",
  authDomain: "hightable-games.firebaseapp.com",
  projectId: "hightable-games",
  storageBucket: "hightable-games.firebasestorage.app",
  messagingSenderId: "927858547128",
  appId: "1:927858547128:web:e6d5f153af37f318a0574d",
  measurementId: "G-C9BY6MR05P",
  databaseURL: "https://hightable-games-default-rtdb.firebaseio.com"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
export const db = getDatabase(app);
