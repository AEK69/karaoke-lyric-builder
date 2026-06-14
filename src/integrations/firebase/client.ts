import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCU4h3Z3HQA632plJYOodmI86gzAyL0jmg",
  authDomain: "karaoke-aek.firebaseapp.com",
  projectId: "karaoke-aek",
  storageBucket: "karaoke-aek.firebasestorage.app",
  messagingSenderId: "550681012055",
  appId: "1:550681012055:web:18731ead9e67ff6b430012",
  measurementId: "G-Z6E4ST344Y",
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
