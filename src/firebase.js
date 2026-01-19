import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
    apiKey: "AIzaSyCG1mdRXz3RFDaGMcgL7_kmHZm4_eEi8oA",
    authDomain: "ukurair-a852a.firebaseapp.com",
    projectId: "ukurair-a852a",
    storageBucket: "ukurair-a852a.firebasestorage.app",
    messagingSenderId: "180109813985",
    appId: "1:180109813985:web:7aabd7533aa5cc19f6efa0",
    measurementId: "G-VZZFQRXW98",
    databaseURL: "https://ukurair-a852a-default-rtdb.firebaseio.com"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

export default app;
