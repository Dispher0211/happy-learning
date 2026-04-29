/**
 * auth.js — 認證系統（Task 48）
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 * 
 * 功能：
 *   signIn()           — Google 彈窗登入
 *   signOut()          — 登出，清除 AppState，導向登入頁
 *   onAuthStateChanged — Firebase Auth 狀態監聽，路由控制
 *   getParentPasswordHash(uid, pin) — SHA-256 雜湊計算
 *   verifyParentPassword(pin)       — 驗證家長 PIN
 *   setParentPassword(pin)          — 寫入新 PIN 雜湊到 Firestore
 *   resetParentPin()（v4 新增）     — 重新驗證 Google 後重設 PIN
 */

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged as _onAuthStateChanged,
  signOut as _signOut,
  reauthenticateWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'

import { AppState } from './state.js'
import { FirestoreAPI } from './firebase.js'

// ────────────────────────────────────────────────────────────
// 模組內部變數
// ────────────────────────────────────────────────────────────

/** Firebase Auth 實例（由 firebase.js 同一個 app 取得） */
let _auth = null

/** Google Auth Provider */
const _provider = new GoogleAuthProvider()

/** Auth 狀態監聽解除函式 */
let _unsubscribeAuth = null

// ────────────────────────────────────────────────────────────
// Auth 物件（對外 export）
// ────────────────────────────────────────────────────────────

export const Auth = {

  /**
   * 初始化 Auth 模組
   * 啟動 Firebase Auth 狀態監聽，依狀態路由
   * 由 app.js 的步驟 7 呼叫
   */
  async init() {
    // 取得與 firebase.js 共用的 app 的 auth 實例
    // 透過 globalThis.__firebaseApp 取得（firebase.js 需 expose）
    _auth = getAuth(globalThis.__firebaseApp)

    // 監聽 Firebase Auth 狀態變化
    _unsubscribeAuth = _onAuthStateChanged(_auth, async (user) => {
      if (user) {
        // ── 已登入 ──────────────────────────────────────
        AppState.uid = user.uid
        AppState.userEmail = user.email
        AppState.displayName = user.displayName

        // v4 規範：PokedexManager.init() 與 WrongQueue.dailyDecay() 在此 callback 內執行
        try {
          await globalThis.PokedexManager?.init?.()
        } catch (e) {
          console.warn('auth: PokedexManager.init 失敗', e)
        }

        try {
          await globalThis.WrongQueue?.dailyDecay?.()
        } catch (e) {
          console.warn('auth: WrongQueue.dailyDecay 失敗', e)
        }

        // 路由到選子帳號畫面
        const { PAGES } = await import('./ui/pages.js')
        globalThis.UIManager?.navigate(PAGES.SELECT_CHILD)

      } else {
        // ── 未登入 ──────────────────────────────────────
        AppState.uid = null
        AppState.userEmail = null
        AppState.displayName = null

        const { PAGES } = await import('./ui/pages.js')
        globalThis.UIManager?.navigate(PAGES.LOGIN)
      }
    })
  },

  /**
   * Google 彈窗登入
   * 登入成功後由 onAuthStateChanged 自動路由
   */
  async signIn() {
    try {
      await signInWithPopup(_auth, _provider)
      // onAuthStateChanged 會處理後續路由，此處不需額外操作
    } catch (err) {
      // 使用者取消或其他錯誤
      console.error('auth: signIn 失敗', err)
      // 通知 UI（LoginPage 會 catch 此錯誤並顯示 toast）
      throw err
    }
  },

  /**
   * 登出
   * 清除 AppState 相關欄位，導向登入頁
   */
  async signOut() {
    try {
      await _signOut(_auth)
    } catch (err) {
      console.error('auth: signOut 失敗', err)
    } finally {
      // 重置全部 AppState（不論 signOut 是否成功）
      AppState.reset()

      const { PAGES } = await import('./ui/pages.js')
      globalThis.UIManager?.navigate(PAGES.LOGIN)
    }
  },

  /**
   * 計算家長密碼雜湊
   * 格式：SHA-256( uid + ":" + pin + ":happylearn" )
   * @param {string} uid  — Firebase Auth 使用者 ID
   * @param {string} pin  — 4位數 PIN 碼（字串）
   * @returns {Promise<string>} — hex 編碼 SHA-256
   */
  async getParentPasswordHash(uid, pin) {
    const raw = `${uid}:${pin}:happylearn`
    const encoder = new TextEncoder()
    const data = encoder.encode(raw)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    // 轉成 hex 字串
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  },

  /**
   * 驗證家長密碼
   * 計算 hash 後與 Firestore parent_password_hash 比對
   * @param {string} pin — 使用者輸入的 PIN
   * @returns {Promise<boolean>} — true=正確 / false=錯誤
   */
  async verifyParentPassword(pin) {
    try {
      const uid = AppState.uid
      if (!uid) return false

      // 從 Firestore 讀取儲存的雜湊
      const userData = await FirestoreAPI.read(`users/${uid}`)
      const storedHash = userData?.parent_password_hash
      if (!storedHash) return false

      // 計算輸入的雜湊並比對
      const inputHash = await this.getParentPasswordHash(uid, pin)
      return inputHash === storedHash

    } catch (err) {
      console.error('auth: verifyParentPassword 失敗', err)
      return false
    }
  },

  /**
   * 設定新家長密碼
   * 計算 hash 後寫入 Firestore
   * @param {string} pin — 新 PIN 碼（字串）
   */
  async setParentPassword(pin) {
    const uid = AppState.uid
    if (!uid) throw new Error('auth: 尚未登入，無法設定家長密碼')

    const hash = await this.getParentPasswordHash(uid, pin)
    await FirestoreAPI.update(`users/${uid}`, {
      parent_password_hash: hash
    })
  },

  /**
   * 重設家長 PIN（v4 新增）
   * 流程：
   *   1. 呼叫 reauthenticateWithPopup 重新驗證 Google 帳號
   *   2. 成功 → 導向設定新 PIN 流程（呼叫 setParentPassword 流程）
   *   3. 失敗（使用者取消）→ showToast 錯誤提示，不拋出例外
   */
  async resetParentPin() {
    try {
      const currentUser = _auth.currentUser
      if (!currentUser) {
        globalThis.UIManager?.showToast('請先登入', 'error')
        return
      }

      // 重新驗證 Google 帳號（Firebase 要求敏感操作前重新驗證）
      await reauthenticateWithPopup(currentUser, _provider)

      // 驗證成功 → 進入設定新 PIN 流程
      // 顯示 PIN 輸入 UI：使用與新增子帳號相同的設定密碼介面
      // 實作方式：觸發 SelectChildPage 內的 setPin 流程
      // 這裡透過全域事件通知，讓 SelectChildPage 處理 UI 切換
      globalThis.dispatchEvent(new CustomEvent('auth:reauthSuccess', {
        detail: { type: 'resetPin' }
      }))

    } catch (err) {
      // 使用者取消或驗證失敗，不拋出例外
      console.warn('auth: resetParentPin 失敗或取消', err)
      globalThis.UIManager?.showToast('驗證失敗，請再試一次', 'error')
    }
  },

  /**
   * 取消 Auth 監聽（通常不需要呼叫，但測試或登出清理用）
   */
  destroy() {
    if (_unsubscribeAuth) {
      _unsubscribeAuth()
      _unsubscribeAuth = null
    }
  }
}

// 將 Auth 掛載到 globalThis 供其他模組後期繫結使用
globalThis.Auth = Auth
