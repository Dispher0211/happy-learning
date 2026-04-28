/**
 * firebase.js — FirestoreAPI + Firebase 初始化
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）
 * v4 修改：
 *   - Firestore import 加入 arrayRemove（供 ParentWordsPage / ParentIdiomsPage）
 *   - Auth import 加入 reauthenticateWithPopup（供 auth.js PIN 重設）
 *   - 修正：所有 export 集中在一處，避免 Duplicate export of 'auth' 錯誤
 *
 * ⚠️ Firebase config 使用 PLACEHOLDER，開發者需填入自己的專案設定
 * 位置：/js/firebase.js
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  runTransaction,
  increment,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  initializeFirestore,
  persistentLocalCache,
  writeBatch,
  addDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  reauthenticateWithPopup,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'

// ─────────────────────────────────────────────
// ⚠️ TODO：開發者需填入自己的 Firebase 專案設定
// ─────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCCWsoev178KLCNg0IQJoJHiJaNq-F3_X4",
  authDomain: "happylearing-3c48b.firebaseapp.com",
  projectId: "happylearing-3c48b",
  storageBucket: "happylearing-3c48b.firebasestorage.app",
  messagingSenderId: "1078205147897",
  appId: "1:1078205147897:web:69c631bbd97cd291589028",
  measurementId: "G-9E5HL47RBR"
}

// ── 初始化 Firebase App ──
const app = initializeApp(FIREBASE_CONFIG)

// ── 初始化 Firestore（啟用本地持久化快取）──
const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
})

// ── 初始化 Auth ──
const auth = getAuth(app)

// ─────────────────────────────────────────────
// 統一 export（所有 named export 集中在此一處）
// 修正：原版在底部第二次 export { auth } 導致 Duplicate export 錯誤
// ─────────────────────────────────────────────
export {
  db,
  auth,
  GoogleAuthProvider,
  signInWithPopup,
  reauthenticateWithPopup,
  onAuthStateChanged,
  signOut,
  arrayRemove,
  arrayUnion,
  increment,
  serverTimestamp,
}

// ─────────────────────────────────────────────
// FirestoreAPI — 統一讀寫介面
// ─────────────────────────────────────────────
export const FirestoreAPI = {

  /**
   * read(path) — 讀取單一 Firestore 文件
   * @param {string} path  如 'users/uid123'
   * @returns {Object|null}
   */
  async read(path) {
    try {
      const ref  = doc(db, ...path.split('/'))
      const snap = await getDoc(ref)
      return snap.exists() ? snap.data() : null
    } catch (e) {
      console.error('FirestoreAPI.read 失敗:', path, e)
      throw e
    }
  },

  /**
   * write(path, data, merge) — 寫入文件（預設 merge: true）
   * 自動加入 last_updated: serverTimestamp()
   */
  async write(path, data, merge = true) {
    try {
      const ref = doc(db, ...path.split('/'))
      await setDoc(ref, { ...data, last_updated: serverTimestamp() }, { merge })
    } catch (e) {
      console.error('FirestoreAPI.write 失敗:', path, e)
      throw e
    }
  },

  /**
   * update(path, fields) — 更新指定欄位（支援點記法）
   * 自動加入 last_updated: serverTimestamp()
   */
  async update(path, fields) {
    try {
      const ref = doc(db, ...path.split('/'))
      await updateDoc(ref, { ...fields, last_updated: serverTimestamp() })
    } catch (e) {
      console.error('FirestoreAPI.update 失敗:', path, e)
      throw e
    }
  },

  /**
   * delete(path) — 刪除文件
   */
  async delete(path) {
    try {
      const ref = doc(db, ...path.split('/'))
      await deleteDoc(ref)
    } catch (e) {
      console.error('FirestoreAPI.delete 失敗:', path, e)
      throw e
    }
  },

  /**
   * readProgressAll(uid) — 批次讀取整個 progress collection
   * 避免 N+1 讀取；回傳 Map<encodeURIComponent(char), data>
   */
  async readProgressAll(uid) {
    try {
      const colRef = collection(db, 'users', uid, 'progress')
      const snap   = await getDocs(colRef)
      const map    = new Map()
      snap.forEach(d => map.set(d.id, d.data()))
      return map
    } catch (e) {
      console.error('FirestoreAPI.readProgressAll 失敗:', uid, e)
      throw e
    }
  },

  /**
   * transaction(path, updateFn) — 讀-改-寫交易
   * Firestore 內建衝突重試
   */
  async transaction(path, updateFn) {
    try {
      const ref = doc(db, ...path.split('/'))
      return await runTransaction(db, async (txn) => {
        const snap    = await txn.get(ref)
        const current = snap.exists() ? snap.data() : {}
        const updated = await updateFn(current)
        txn.set(ref, { ...updated, last_updated: serverTimestamp() }, { merge: true })
        return updated
      })
    } catch (e) {
      console.error('FirestoreAPI.transaction 失敗:', path, e)
      throw e
    }
  },

  /**
   * incrementField(path, field, value) — 原子加法
   */
  async incrementField(path, field, value) {
    try {
      const ref = doc(db, ...path.split('/'))
      await updateDoc(ref, {
        [field]:      increment(value),
        last_updated: serverTimestamp(),
      })
    } catch (e) {
      console.error('FirestoreAPI.incrementField 失敗:', path, field, e)
      throw e
    }
  },

  /**
   * readCollection(path) — 讀取整個集合
   * @returns {Array<{id, ...data}>}
   */
  async readCollection(path) {
    try {
      const colRef = collection(db, ...path.split('/'))
      const snap   = await getDocs(colRef)
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) {
      console.error('FirestoreAPI.readCollection 失敗:', path, e)
      throw e
    }
  },

  /**
   * subscribe(path, callback) — 即時監聽文件變動
   * @returns {function} unsubscribe
   */
  subscribe(path, callback) {
    try {
      const ref = doc(db, ...path.split('/'))
      return onSnapshot(ref,
        snap => callback(snap.exists() ? snap.data() : null),
        e    => console.error('FirestoreAPI.subscribe 錯誤:', path, e)
      )
    } catch (e) {
      console.error('FirestoreAPI.subscribe 設定失敗:', path, e)
      return () => {}
    }
  },

  /**
   * addPendingReview(data) — 新增待審核題目，自動生成 ID
   * @returns {string} 新建文件的 ID
   */
  async addPendingReview(data) {
    try {
      const { AppState } = await import('./state.js')
      const colRef = collection(db, 'users', AppState.uid, 'pending_reviews')
      const docRef = await addDoc(colRef, {
        ...data,
        status:       'pending',
        created_at:   serverTimestamp(),
        last_updated: serverTimestamp(),
      })
      return docRef.id
    } catch (e) {
      console.error('FirestoreAPI.addPendingReview 失敗:', e)
      throw e
    }
  },

  /**
   * resolvePendingReview(reviewId, action, correctedAnswer) — 審核結果寫入
   */
  async resolvePendingReview(reviewId, action, correctedAnswer = null) {
    try {
      const { AppState } = await import('./state.js')
      const ref = doc(db, 'users', AppState.uid, 'pending_reviews', reviewId)
      const data = {
        status:       action,
        resolved_at:  serverTimestamp(),
        last_updated: serverTimestamp(),
      }
      if (correctedAnswer !== null) data.corrected_answer = correctedAnswer
      await updateDoc(ref, data)
    } catch (e) {
      console.error('FirestoreAPI.resolvePendingReview 失敗:', reviewId, e)
      throw e
    }
  },

  /**
   * batchWrite(operations) — 批次寫入（最多500筆）
   * @param {Array<{type:'set'|'update'|'delete', path, data?}>} operations
   */
  async batchWrite(operations) {
    try {
      const batch = writeBatch(db)
      for (const op of operations) {
        const ref = doc(db, ...op.path.split('/'))
        if (op.type === 'set') {
          batch.set(ref, { ...op.data, last_updated: serverTimestamp() }, { merge: true })
        } else if (op.type === 'update') {
          batch.update(ref, { ...op.data, last_updated: serverTimestamp() })
        } else if (op.type === 'delete') {
          batch.delete(ref)
        }
      }
      await batch.commit()
    } catch (e) {
      console.error('FirestoreAPI.batchWrite 失敗:', e)
      throw e
    }
  },
}
