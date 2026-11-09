import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
    apiKey: "AIzaSyBVGwQL1Sh51q8Q33DbHNjsKnkeN5Z_CuA",
    authDomain: "monitoring-ketinggian-air-1.firebaseapp.com",
    databaseURL: "https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com",
    projectId: "monitoring-ketinggian-air-1",
    storageBucket: "monitoring-ketinggian-air-1.firebasestorage.app",
    messagingSenderId: "776209845832",
    appId: "1:776209845832:web:ae0645c0ae72672c4e927d",
    measurementId: "G-DKRKWLF9RK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

export default app;
