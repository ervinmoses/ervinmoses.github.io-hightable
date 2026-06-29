// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDewCnOF9r2ADMTcnxOBPQ6gR_qgOvV6sc",
  authDomain: "hightable-games.firebaseapp.com",
  databaseURL: "https://hightable-games-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hightable-games",
  storageBucket: "hightable-games.firebasestorage.app",
  messagingSenderId: "927858547128",
  appId: "1:927858547128:web:e6d5f153af37f318a0574d",
  measurementId: "G-C9BY6MR05P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);