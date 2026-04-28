/**
 * ParentHomePage.js — 家長首頁
 * 位置：js/pages/ParentHomePage.js
 * Task 41 — 快樂學習 Happy Learning v4.1
 *
 * 依賴：firebase.js（T05）、ui_manager.js（T28）
 * 功能：顯示待審核數量、所有設定入口
 *       v4 新增：詞語簿（PARENT_WORDS）、成語簿（PARENT_IDIOMS）入口
 */

import { FirestoreAPI } from '../firebase.js'
import { UIManager } from '../ui/ui_manager.js'
import { PAGES } from '../ui/pages.js'
import { AppState } from '../state.js'

export class ParentHomePage {
  constructor () {
    // 儲存事件監聽器參考，供 destroy() 移除
    this._listeners = []
  }

  // ─────────────────────────────────────
  // init：渲染頁面並綁定所有按鈕事件
  // ─────────────────────────────────────
  async init (params = {}) {
    // 取得最新待審核數量（優先從 AppState，沒有才讀 Firestore）
    let pendingCount = AppState.pendingReviewCount ?? 0

    try {
      // 嘗試從 Firestore 取得最新數量
      const userData = await FirestoreAPI.getUser(AppState.uid)
      pendingCount = userData?.pendingReviewCount ?? pendingCount
      // 同步回 AppState
      AppState.pendingReviewCount = pendingCount
    } catch (e) {
      // 離線或錯誤時使用 AppState 現有值，不崩潰
      console.warn('[ParentHomePage] 無法讀取 pendingReviewCount，使用快取值', e)
    }

    // 渲染頁面 HTML
    this._render(pendingCount)

    // 綁定所有按鈕
    this._bindEvents()
  }

  // ─────────────────────────────────────
  // _render：輸出家長首頁 innerHTML
  // ─────────────────────────────────────
  _render (pendingCount) {
    const app = document.getElementById('app')

    // 待審核徽章：有待審核時顯示紅色數字
    const badgeHTML = pendingCount > 0
      ? `<span class="parent-home__badge">${pendingCount}</span>`
      : ''

    app.innerHTML = `
      <div class="parent-home">

        <!-- 頁首 -->
        <div class="parent-home__header">
          <button class="parent-home__back-btn" id="parentHomeBack">← 返回</button>
          <h1 class="parent-home__title">👨‍👩‍👧 家長設定</h1>
        </div>

        <!-- 待審核區塊 -->
        <section class="parent-home__section">
          <h2 class="parent-home__section-title">📝 作業審核</h2>
          <button class="parent-home__btn parent-home__btn--review" id="btnReview">
            查看待審核
            ${badgeHTML}
          </button>
        </section>

        <!-- 學習內容管理 -->
        <section class="parent-home__section">
          <h2 class="parent-home__section-title">📚 學習內容</h2>
          <div class="parent-home__btn-grid">

            <!-- 生字簿 -->
            <button class="parent-home__btn" id="btnChars">
              🈶 生字簿
            </button>

            <!-- 詞語簿（v4 新增） -->
            <button class="parent-home__btn" id="btnWords">
              📋 詞語簿
            </button>

            <!-- 成語簿（v4 新增） -->
            <button class="parent-home__btn" id="btnIdioms">
              🀄 成語簿
            </button>

          </div>
        </section>

        <!-- 圖鑑與 API 設定 -->
        <section class="parent-home__section">
          <h2 class="parent-home__section-title">⚙️ 進階設定</h2>
          <div class="parent-home__btn-grid">

            <button class="parent-home__btn" id="btnPokedex">
              🎴 圖鑑設定
            </button>

            <button class="parent-home__btn" id="btnApi">
              🔑 API 金鑰
            </button>

          </div>
        </section>

      </div>
    `
  }

  // ─────────────────────────────────────
  // _bindEvents：綁定所有按鈕，並記錄供 destroy 移除
  // ─────────────────────────────────────
  _bindEvents () {
    // 返回按鈕
    this._addListener('parentHomeBack', 'click', () => {
      UIManager.back()
    })

    // 待審核
    this._addListener('btnReview', 'click', () => {
      UIManager.navigate(PAGES.PARENT_REVIEW)
    })

    // 生字簿
    this._addListener('btnChars', 'click', () => {
      UIManager.navigate(PAGES.PARENT_CHARS)
    })

    // 詞語簿（v4 新增）
    this._addListener('btnWords', 'click', () => {
      UIManager.navigate(PAGES.PARENT_WORDS)
    })

    // 成語簿（v4 新增）
    this._addListener('btnIdioms', 'click', () => {
      UIManager.navigate(PAGES.PARENT_IDIOMS)
    })

    // 圖鑑設定
    this._addListener('btnPokedex', 'click', () => {
      UIManager.navigate(PAGES.PARENT_POKEDEX)
    })

    // API 金鑰設定
    this._addListener('btnApi', 'click', () => {
      UIManager.navigate(PAGES.PARENT_API)
    })
  }

  // ─────────────────────────────────────
  // _addListener：封裝 addEventListener，
  //               同時記錄以便 destroy() 清除
  // ─────────────────────────────────────
  _addListener (id, event, handler) {
    const el = document.getElementById(id)
    if (!el) return
    el.addEventListener(event, handler)
    // 記錄：{ 元素, 事件名, 處理函數 }
    this._listeners.push({ el, event, handler })
  }

  // ─────────────────────────────────────
  // destroy：移除所有事件監聽，釋放資源
  // ─────────────────────────────────────
  destroy () {
    for (const { el, event, handler } of this._listeners) {
      el.removeEventListener(event, handler)
    }
    this._listeners = []
  }
}
