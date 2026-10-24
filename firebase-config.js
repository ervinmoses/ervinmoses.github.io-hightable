// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBtFOHzpDYI0XDiEipIkKO3FAq33C3yNh8",
  authDomain: "hightable-a2a2e.firebaseapp.com",
  databaseURL: "https://hightable-a2a2e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hightable-a2a2e",
  storageBucket: "hightable-a2a2e.firebasestorage.app",
  messagingSenderId: "465460262501",
  appId: "1:465460262501:web:8f9d1be987c5a8dc32388c",
  measurementId: "G-WVWVXWPDD8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
export const db = getDatabase(app);