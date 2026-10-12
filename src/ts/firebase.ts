import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyAiLKXMcx7zn2vl-mmVg-fhbgMswQzKHYk',
  authDomain: 'shutsujin-pouch.firebaseapp.com',
  projectId: 'shutsujin-pouch',
  storageBucket: 'shutsujin-pouch.firebasestorage.app',
  messagingSenderId: '553604195222',
  appId: '1:553604195222:web:d9b2e26a593f1ad18e73b7',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
