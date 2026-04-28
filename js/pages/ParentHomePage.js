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
      // 嘗試從 Firestore 取得最新數量（使用通用 read 介面）
      const userData = await FirestoreAPI.read(`users/${AppState.uid}`)
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
  // 桌面版（≥1024px）使用兩欄佈局：
  //   左欄 .parent-sidebar 為固定選單
  //   右欄 .parent-main 為現有 section 內容
  // 手機版維持原有單欄垂直排列
  // ─────────────────────────────────────
  _render (pendingCount) {
    const app = document.getElementById('app')

    // 待審核徽章：有待審核時顯示紅色數字
    const badgeHTML = pendingCount > 0
      ? `<span class="parent-sidebar__badge">${pendingCount}</span>`
      : ''

    // 手機版待審核徽章（行內按鈕用）
    const mobileBadgeHTML = pendingCount > 0
      ? `<span class="parent-home__badge">${pendingCount}</span>`
      : ''

    app.innerHTML = `
      <div class="parent-layout">

        <!-- ══ 左欄：側邊欄（桌面版顯示）══ -->
        <aside class="parent-sidebar">

          <!-- 品牌區 -->
          <div class="parent-sidebar__brand">
            <div class="parent-sidebar__app-name">📚 快樂學習</div>
            <div class="parent-sidebar__subtitle">家長設定面板</div>
          </div>

          <!-- 返回兒童模式 -->
          <button class="parent-sidebar__back" id="sidebarBack">
            ← 返回兒童模式
          </button>

          <!-- 作業審核 -->
          <div class="parent-sidebar__section-label">作業</div>
          <button class="parent-sidebar__item" id="sidebarReview">
            <span class="parent-sidebar__item__icon">📝</span>
            作業審核
            ${badgeHTML}
          </button>

          <!-- 學習內容 -->
          <div class="parent-sidebar__section-label">學習內容</div>
          <button class="parent-sidebar__item" id="sidebarChars">
            <span class="parent-sidebar__item__icon">🈶</span>
            生字簿
          </button>
          <button class="parent-sidebar__item" id="sidebarWords">
            <span class="parent-sidebar__item__icon">📋</span>
            詞語簿
          </button>
          <button class="parent-sidebar__item" id="sidebarIdioms">
            <span class="parent-sidebar__item__icon">🀄</span>
            成語簿
          </button>

          <!-- 進階設定 -->
          <div class="parent-sidebar__section-label">進階設定</div>
          <button class="parent-sidebar__item" id="sidebarPokedex">
            <span class="parent-sidebar__item__icon">🎴</span>
            圖鑑設定
          </button>
          <button class="parent-sidebar__item" id="sidebarApi">
            <span class="parent-sidebar__item__icon">🔑</span>
            API 金鑰
          </button>

        </aside>

        <!-- ══ 右欄：主內容區 ══ -->
        <main class="parent-main">

          <!-- 桌面版右欄頁首 -->
          <div class="parent-main-header">
            <span class="parent-main-header__title">👨‍👩‍👧 家長設定</span>
          </div>

          <!-- 手機版頁首（桌面版由 CSS 隱藏） -->
          <div class="parent-home__header parent-header--mobile">
            <button class="parent-home__back-btn" id="parentHomeBack">← 返回</button>
            <h1 class="parent-home__title">👨‍👩‍👧 家長設定</h1>
          </div>

          <!-- 待審核區塊 -->
          <section class="parent-home__section">
            <h2 class="parent-home__section-title">📝 作業審核</h2>
            <button class="parent-home__btn parent-home__btn--review" id="btnReview">
              查看待審核
              ${mobileBadgeHTML}
            </button>
          </section>

          <!-- 學習內容管理 -->
          <section class="parent-home__section">
            <h2 class="parent-home__section-title">📚 學習內容</h2>
            <div class="parent-home__btn-grid">
              <button class="parent-home__btn" id="btnChars">🈶 生字簿</button>
              <button class="parent-home__btn" id="btnWords">📋 詞語簿</button>
              <button class="parent-home__btn" id="btnIdioms">🀄 成語簿</button>
            </div>
          </section>

          <!-- 圖鑑與 API 設定 -->
          <section class="parent-home__section">
            <h2 class="parent-home__section-title">⚙️ 進階設定</h2>
            <div class="parent-home__btn-grid">
              <button class="parent-home__btn" id="btnPokedex">🎴 圖鑑設定</button>
              <button class="parent-home__btn" id="btnApi">🔑 API 金鑰</button>
            </div>
          </section>

        </main>

      </div>
    `
  }

  // ─────────────────────────────────────
  // _bindEvents：綁定所有按鈕，並記錄供 destroy 移除
  // 包含手機版（btnXxx）與桌面側邊欄版（sidebarXxx）
  // ─────────────────────────────────────
  _bindEvents () {
    // ── 返回按鈕（手機版頁首 & 桌面側邊欄）──
    this._addListener('parentHomeBack', 'click', () => UIManager.back())
    this._addListener('sidebarBack',    'click', () => UIManager.back())

    // ── 待審核（手機 + 側邊欄）──
    const goReview = () => UIManager.navigate(PAGES.PARENT_REVIEW)
    this._addListener('btnReview',    'click', goReview)
    this._addListener('sidebarReview','click', goReview)

    // ── 生字簿 ──
    const goChars = () => UIManager.navigate(PAGES.PARENT_CHARS)
    this._addListener('btnChars',    'click', goChars)
    this._addListener('sidebarChars','click', goChars)

    // ── 詞語簿（v4 新增）──
    const goWords = () => UIManager.navigate(PAGES.PARENT_WORDS)
    this._addListener('btnWords',    'click', goWords)
    this._addListener('sidebarWords','click', goWords)

    // ── 成語簿（v4 新增）──
    const goIdioms = () => UIManager.navigate(PAGES.PARENT_IDIOMS)
    this._addListener('btnIdioms',    'click', goIdioms)
    this._addListener('sidebarIdioms','click', goIdioms)

    // ── 圖鑑設定 ──
    const goPokedex = () => UIManager.navigate(PAGES.PARENT_POKEDEX)
    this._addListener('btnPokedex',    'click', goPokedex)
    this._addListener('sidebarPokedex','click', goPokedex)

    // ── API 金鑰設定 ──
    const goApi = () => UIManager.navigate(PAGES.PARENT_API)
    this._addListener('btnApi',    'click', goApi)
    this._addListener('sidebarApi','click', goApi)
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
