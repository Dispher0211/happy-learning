/**
 * LoginPage.js — 登入頁面（Task 31）
 * 功能：顯示登入畫面、頭像輪播動畫、呼叫 Google 登入
 * 依賴：auth.js（T48）、ui_manager.js（T28）
 * render 到 #app
 */

import { Auth } from '../auth.js'
import { UIManager } from '../ui/ui_manager.js'

export class LoginPage {
  constructor() {
    // 儲存事件監聽參照，供 destroy() 移除
    this._boundSignIn = null
    // 頭像輪播計時器
    this._avatarTimer = null
    // 目前輪播到第幾個頭像
    this._avatarIndex = 0
    // 是否正在登入中（防連點）
    this._isSigningIn = false
  }

  /**
   * init() — 初始化登入頁面
   * 渲染 DOM、啟動頭像輪播、綁定登入按鈕
   */
  init() {
    const app = document.getElementById('app')

    // 頭像陣列（輪播用）
    this._avatars = ['🐱', '🐶', '🐻', '🐼', '🦊', '🐸']

    // 渲染登入頁面 HTML
    app.innerHTML = `
      <div class="login-page">

        <!-- 標題區域 -->
        <div class="login-title-area">
          <h1 class="login-app-name">快樂學習</h1>
          <p class="login-app-subtitle">Happy Learning</p>
        </div>

        <!-- 頭像輪播區域 -->
        <div class="login-avatar-row" id="login-avatar-row">
          ${this._avatars.map((emoji, i) => `
            <span
              class="login-avatar ${i === 0 ? 'login-avatar--active' : ''}"
              data-index="${i}"
            >${emoji}</span>
          `).join('')}
        </div>

        <!-- Google 登入按鈕 -->
        <div class="login-btn-area">
          <button
            class="login-google-btn"
            id="login-google-btn"
            type="button"
          >
            <span class="login-google-icon">🔑</span>
            <span class="login-google-text">使用 Google 登入</span>
          </button>
        </div>

        <!-- 提示文字 -->
        <p class="login-hint">第一次使用？登入後可建立子帳號</p>

      </div>
    `

    // 綁定 Google 登入按鈕
    this._boundSignIn = () => this.signIn()
    const btn = document.getElementById('login-google-btn')
    btn.addEventListener('click', this._boundSignIn)

    // 啟動頭像輪播動畫
    this._startAvatarAnimation()
  }

  /**
   * signIn() — 呼叫 Auth.signIn() 執行 Google 登入
   * 使用 _isSigningIn 旗標防止重複點擊
   */
  async signIn() {
    // 防止重複點擊
    if (this._isSigningIn) return
    this._isSigningIn = true

    // 按鈕顯示載入狀態
    const btn = document.getElementById('login-google-btn')
    if (btn) {
      btn.disabled = true
      btn.querySelector('.login-google-text').textContent = '登入中…'
    }

    try {
      // 呼叫 auth.js 的 signIn()
      // 成功後 Auth 的 onAuthStateChanged 會自動 navigate 到下一頁
      await Auth.signIn()
    } catch (err) {
      // 登入失敗：顯示 toast，恢復按鈕狀態
      console.warn('[LoginPage] Google 登入失敗：', err)

      // 使用者主動取消不顯示錯誤（popup_closed_by_user）
      const isCancelled =
        err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/cancelled-popup-request'

      if (!isCancelled) {
        UIManager.showToast('登入失敗，請再試一次', 'error', 3000)
      }

      // 恢復按鈕
      if (btn) {
        btn.disabled = false
        btn.querySelector('.login-google-text').textContent = '使用 Google 登入'
      }

      this._isSigningIn = false
    }
  }

  /**
   * _startAvatarAnimation() — 啟動頭像輪播
   * 每 600ms 切換到下一個頭像，active class 控制放大效果
   */
  _startAvatarAnimation() {
    this._avatarTimer = setInterval(() => {
      const row = document.getElementById('login-avatar-row')
      if (!row) {
        // 頁面已被銷毀，清除計時器
        clearInterval(this._avatarTimer)
        this._avatarTimer = null
        return
      }

      // 移除舊的 active
      const prev = row.querySelector('.login-avatar--active')
      if (prev) prev.classList.remove('login-avatar--active')

      // 設定下一個 active
      this._avatarIndex = (this._avatarIndex + 1) % this._avatars.length
      const next = row.querySelector(`[data-index="${this._avatarIndex}"]`)
      if (next) next.classList.add('login-avatar--active')
    }, 600)
  }

  /**
   * destroy() — 清理資源
   * 移除事件監聽、停止頭像輪播計時器
   */
  destroy() {
    // 停止頭像輪播計時器
    if (this._avatarTimer) {
      clearInterval(this._avatarTimer)
      this._avatarTimer = null
    }

    // 移除登入按鈕事件監聽
    const btn = document.getElementById('login-google-btn')
    if (btn && this._boundSignIn) {
      btn.removeEventListener('click', this._boundSignIn)
    }
    this._boundSignIn = null
    this._isSigningIn = false
  }
}
