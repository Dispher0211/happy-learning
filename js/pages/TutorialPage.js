/**
 * TutorialPage.js — 首次使用引導（5頁）
 * 快樂學習 Happy Learning v4.1.0
 *
 * 規格（SECTION 2.5）：
 *   共 5 頁：歡迎 → 學習卡片 → 挑戰遊戲 → 圖鑑收藏 → 出發
 *   每頁：✕跳過、●分頁點、[← 上一頁][下一頁 →]
 *   complete()：儲存 tutorial_done=true → Firestore，navigate 到 CARD
 *
 * 依賴模組：
 *   state.js（T02）、firebase.js（T05）、ui_manager.js（T28）
 */

import { AppState } from '../state.js'
import { FirestoreAPI } from '../firebase.js'
import { UIManager } from '../ui_manager.js'
import { PAGES } from '../ui/pages.js'

// ─────────────────────────────────────────────
// 5 頁引導內容定義
// ─────────────────────────────────────────────
const TUTORIAL_PAGES = [
  {
    icon    : '🌟',
    title   : '歡迎來到快樂學習！',
    desc    : '這裡是你的國語學習小天地。每天學一點，每天進步一點點！',
    color   : '#E3F2FD',
    accent  : '#42A5F5',
    detail  : '透過有趣的遊戲，讓學習國字變成每天最期待的事！',
  },
  {
    icon    : '📖',
    title   : '學習卡片',
    desc    : '每個生字都有專屬的卡片，包含注音、筆順、詞語和例句。',
    color   : '#F3E5F5',
    accent  : '#AB47BC',
    detail  : '往左右滑動可以切換生字，點「▶筆順」可以看筆順動畫！',
  },
  {
    icon    : '🎮',
    title   : '挑戰遊戲',
    desc    : '11種有趣的遊戲，包含寫國字、聽音選字、成語配對等！',
    color   : '#E8F5E9',
    accent  : '#66BB6A',
    detail  : '每答對一題就能獲得星星⭐，累積星星可以解鎖神奇圖鑑！',
  },
  {
    icon    : '📚',
    title   : '圖鑑收藏',
    desc    : '答對題目可以解鎖神秘圖鑑，收集所有圖鑑吧！',
    color   : '#FFF8E1',
    accent  : '#FFA726',
    detail  : '累積 100 顆黃星，或完成 10 道造句題，就能揭曉一隻新夥伴！',
  },
  {
    icon    : '🚀',
    title   : '準備出發！',
    desc    : '一切準備就緒！讓我們開始快樂學習的旅程吧！',
    color   : '#FCE4EC',
    accent  : '#EC407A',
    detail  : '每天練習，遺忘曲線會幫你找出最需要複習的字，讓你事半功倍！',
  },
]

// ─────────────────────────────────────────────
// TutorialPage 類別
// ─────────────────────────────────────────────
export class TutorialPage {
  constructor () {
    // 目前頁面索引（0-4）
    this._currentPage = 0
    // 事件監聽清單（destroy 時統一移除）
    this._listeners   = []
    // 動畫計時器（destroy 時清除）
    this._animTimer   = null
  }

  // ═══════════════════════════════════════════
  // init() — 渲染頁面，顯示第 1 頁
  // ═══════════════════════════════════════════
  async init (_params = {}) {
    this._currentPage = 0
    this._injectStyle()
    this._render()
  }

  // ═══════════════════════════════════════════
  // destroy() — 清除事件監聽與計時器
  // ═══════════════════════════════════════════
  destroy () {
    // 清除所有事件監聽
    this._listeners.forEach(({ el, type, fn }) => {
      try { el.removeEventListener(type, fn) } catch (_) { /* 忽略 */ }
    })
    this._listeners = []

    // 清除動畫計時器
    if (this._animTimer !== null) {
      clearTimeout(this._animTimer)
      this._animTimer = null
    }
  }

  // ═══════════════════════════════════════════
  // nextPage() — 下一頁
  // ═══════════════════════════════════════════
  nextPage () {
    if (this._currentPage < TUTORIAL_PAGES.length - 1) {
      this._currentPage++
      this._updateContent('slide-left')
    }
  }

  // ═══════════════════════════════════════════
  // prevPage() — 上一頁
  // ═══════════════════════════════════════════
  prevPage () {
    if (this._currentPage > 0) {
      this._currentPage--
      this._updateContent('slide-right')
    }
  }

  // ═══════════════════════════════════════════
  // skip() — 直接完成（點 ✕ 跳過）
  // ═══════════════════════════════════════════
  async skip () {
    await this.complete()
  }

  // ═══════════════════════════════════════════
  // complete() — 儲存完成狀態，navigate 到卡片頁
  // ═══════════════════════════════════════════
  async complete () {
    try {
      // 寫入 Firestore tutorial_done=true
      if (AppState.uid) {
        await FirestoreAPI.updateUser(AppState.uid, { tutorial_done: true })
      }
      // 更新本地狀態
      if (AppState.settings) {
        AppState.settings.tutorial_done = true
      }
    } catch (err) {
      // 寫入失敗不阻擋跳轉（非關鍵操作）
      console.warn('[TutorialPage] 寫入 tutorial_done 失敗，繼續導航', err)
    }

    // 導航到卡片主頁
    UIManager.navigate(PAGES.CARD)
  }

  // ═══════════════════════════════════════════
  // _render() — 初始完整渲染
  // ═══════════════════════════════════════════
  _render () {
    const app  = document.getElementById('app')
    if (!app) return

    const page = TUTORIAL_PAGES[this._currentPage]

    app.innerHTML = `
      <div class="tutorial-wrap" id="tutorial-wrap" style="background:${page.color}">

        <!-- ✕ 跳過按鈕 -->
        <button class="tutorial-skip-btn" id="tutorial-skip-btn" aria-label="跳過引導">
          ✕ 跳過
        </button>

        <!-- 主要內容區 -->
        <div class="tutorial-content" id="tutorial-content">
          ${this._buildPageHTML(page)}
        </div>

        <!-- 分頁點 -->
        <div class="tutorial-dots" id="tutorial-dots" role="tablist" aria-label="引導頁進度">
          ${this._buildDotsHTML()}
        </div>

        <!-- 導航按鈕 -->
        <div class="tutorial-nav">
          <button
            class="tutorial-nav-btn tutorial-nav-prev"
            id="tutorial-prev-btn"
            aria-label="上一頁"
            ${this._currentPage === 0 ? 'style="visibility:hidden"' : ''}
          >
            ← 上一頁
          </button>

          <button
            class="tutorial-nav-btn tutorial-nav-next ${this._currentPage === TUTORIAL_PAGES.length - 1 ? 'tutorial-nav-finish' : ''}"
            id="tutorial-next-btn"
            aria-label="${this._currentPage === TUTORIAL_PAGES.length - 1 ? '出發' : '下一頁'}"
          >
            ${this._currentPage === TUTORIAL_PAGES.length - 1 ? '🚀 出發！' : '下一頁 →'}
          </button>
        </div>

      </div>
    `

    // 綁定事件
    this._bindEvents()

    // 入場動畫
    this._playEntrance()
  }

  // ─────────────────────────────────────────────
  // _buildPageHTML() — 建立單頁內容 HTML
  // ─────────────────────────────────────────────
  _buildPageHTML (page) {
    return `
      <div class="tutorial-icon" role="img" aria-label="${page.title}">
        ${page.icon}
      </div>
      <h1 class="tutorial-title">${page.title}</h1>
      <p class="tutorial-desc">${page.desc}</p>
      <div class="tutorial-detail-card">
        <p class="tutorial-detail">${page.detail}</p>
      </div>
    `
  }

  // ─────────────────────────────────────────────
  // _buildDotsHTML() — 建立分頁點 HTML
  // ─────────────────────────────────────────────
  _buildDotsHTML () {
    return TUTORIAL_PAGES.map((_, i) => `
      <button
        class="tutorial-dot ${i === this._currentPage ? 'active' : ''}"
        data-page="${i}"
        role="tab"
        aria-selected="${i === this._currentPage}"
        aria-label="第 ${i + 1} 頁"
      ></button>
    `).join('')
  }

  // ─────────────────────────────────────────────
  // _bindEvents() — 綁定所有事件監聽
  // ─────────────────────────────────────────────
  _bindEvents () {
    // 跳過按鈕
    this._on('tutorial-skip-btn', 'click', () => this.skip())

    // 下一頁 / 出發按鈕
    this._on('tutorial-next-btn', 'click', () => {
      if (this._currentPage === TUTORIAL_PAGES.length - 1) {
        this.complete()
      } else {
        this.nextPage()
      }
    })

    // 上一頁按鈕
    this._on('tutorial-prev-btn', 'click', () => this.prevPage())

    // 分頁點點擊（直接跳到指定頁）
    const dots = document.getElementById('tutorial-dots')
    if (dots) {
      const dotFn = (e) => {
        const btn = e.target.closest('.tutorial-dot')
        if (!btn) return
        const targetPage = parseInt(btn.dataset.page, 10)
        if (!isNaN(targetPage) && targetPage !== this._currentPage) {
          const dir = targetPage > this._currentPage ? 'slide-left' : 'slide-right'
          this._currentPage = targetPage
          this._updateContent(dir)
        }
      }
      dots.addEventListener('click', dotFn)
      this._listeners.push({ el: dots, type: 'click', fn: dotFn })
    }

    // 左右滑動手勢（手機）
    this._bindSwipe()
  }

  // ─────────────────────────────────────────────
  // _bindSwipe() — 左右滑動手勢支援
  // ─────────────────────────────────────────────
  _bindSwipe () {
    const wrap = document.getElementById('tutorial-wrap')
    if (!wrap) return

    let startX = 0
    let startY = 0

    const onTouchStart = (e) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }

    const onTouchEnd = (e) => {
      const dx = e.changedTouches[0].clientX - startX
      const dy = e.changedTouches[0].clientY - startY

      // 水平滑動量 > 50px 且大於垂直方向才觸發
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
          // 向左滑：下一頁
          if (this._currentPage < TUTORIAL_PAGES.length - 1) {
            this.nextPage()
          }
        } else {
          // 向右滑：上一頁
          if (this._currentPage > 0) {
            this.prevPage()
          }
        }
      }
    }

    wrap.addEventListener('touchstart', onTouchStart, { passive: true })
    wrap.addEventListener('touchend',   onTouchEnd,   { passive: true })
    this._listeners.push({ el: wrap, type: 'touchstart', fn: onTouchStart })
    this._listeners.push({ el: wrap, type: 'touchend',   fn: onTouchEnd   })
  }

  // ─────────────────────────────────────────────
  // _on() — 便捷事件綁定，自動加入清單
  // ─────────────────────────────────────────────
  _on (elementId, eventType, handler) {
    const el = document.getElementById(elementId)
    if (!el) return
    el.addEventListener(eventType, handler)
    this._listeners.push({ el, type: eventType, fn: handler })
  }

  // ─────────────────────────────────────────────
  // _updateContent() — 換頁時更新 DOM（動畫切換）
  // ─────────────────────────────────────────────
  _updateContent (direction = 'slide-left') {
    const wrap    = document.getElementById('tutorial-wrap')
    const content = document.getElementById('tutorial-content')
    const dots    = document.getElementById('tutorial-dots')
    const prevBtn = document.getElementById('tutorial-prev-btn')
    const nextBtn = document.getElementById('tutorial-next-btn')
    if (!wrap || !content || !dots) return

    const page = TUTORIAL_PAGES[this._currentPage]

    // 更新背景色（平滑過渡）
    wrap.style.transition  = 'background 0.4s ease'
    wrap.style.background  = page.color

    // 滑出動畫（舊內容）
    const outClass = direction === 'slide-left' ? 'tutorial-slide-out-left' : 'tutorial-slide-out-right'
    content.classList.add(outClass)

    this._animTimer = setTimeout(() => {
      this._animTimer = null

      // 更新內容
      content.innerHTML = this._buildPageHTML(page)
      content.classList.remove(outClass)

      // 滑入動畫（新內容）
      const inClass = direction === 'slide-left' ? 'tutorial-slide-in-right' : 'tutorial-slide-in-left'
      content.classList.add(inClass)

      setTimeout(() => content.classList.remove(inClass), 350)

      // 更新分頁點
      dots.innerHTML = this._buildDotsHTML()

      // 重新綁定分頁點事件（innerHTML 已重建）
      const dotFn = (e) => {
        const btn = e.target.closest('.tutorial-dot')
        if (!btn) return
        const targetPage = parseInt(btn.dataset.page, 10)
        if (!isNaN(targetPage) && targetPage !== this._currentPage) {
          const dir = targetPage > this._currentPage ? 'slide-left' : 'slide-right'
          this._currentPage = targetPage
          this._updateContent(dir)
        }
      }
      // 移除舊的分頁點監聽
      this._listeners = this._listeners.filter(l => l.el !== dots)
      dots.addEventListener('click', dotFn)
      this._listeners.push({ el: dots, type: 'click', fn: dotFn })

      // 更新上一頁按鈕
      if (prevBtn) {
        prevBtn.style.visibility = this._currentPage === 0 ? 'hidden' : 'visible'
      }

      // 更新下一頁 / 出發按鈕
      if (nextBtn) {
        const isLast = this._currentPage === TUTORIAL_PAGES.length - 1
        nextBtn.textContent = isLast ? '🚀 出發！' : '下一頁 →'
        nextBtn.className   = `tutorial-nav-btn tutorial-nav-next${isLast ? ' tutorial-nav-finish' : ''}`
        nextBtn.setAttribute('aria-label', isLast ? '出發' : '下一頁')
      }
    }, 250)
  }

  // ─────────────────────────────────────────────
  // _playEntrance() — 初始入場動畫
  // ─────────────────────────────────────────────
  _playEntrance () {
    const content = document.getElementById('tutorial-content')
    if (!content) return
    content.classList.add('tutorial-entrance')
    setTimeout(() => content.classList.remove('tutorial-entrance'), 600)
  }

  // ═══════════════════════════════════════════
  // _injectStyle() — 注入 CSS（防重複）
  // ═══════════════════════════════════════════
  _injectStyle () {
    if (document.getElementById('tutorial-page-style')) return

    const style = document.createElement('style')
    style.id    = 'tutorial-page-style'
    style.textContent = `
      /* ── TutorialPage 樣式 ─────────────────────── */
      .tutorial-wrap {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        padding: 16px 24px 32px;
        transition: background 0.4s ease;
        font-family: 'BpmfIVS', 'Noto Sans TC', sans-serif;
        overflow: hidden;
        position: relative;
      }

      /* ✕ 跳過按鈕 */
      .tutorial-skip-btn {
        align-self: flex-end;
        padding: 6px 14px;
        border-radius: 20px;
        border: 1.5px solid rgba(0,0,0,0.2);
        background: rgba(255,255,255,0.7);
        color: #666;
        font-size: 0.85rem;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
        backdrop-filter: blur(4px);
      }
      .tutorial-skip-btn:hover {
        background: rgba(255,255,255,0.95);
        color: #333;
      }

      /* 主要內容 */
      .tutorial-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: 16px;
        padding: 20px 0;
        width: 100%;
        max-width: 420px;
      }

      /* 圖示 */
      .tutorial-icon {
        font-size: 5rem;
        line-height: 1;
        filter: drop-shadow(0 4px 12px rgba(0,0,0,0.15));
      }

      /* 標題 */
      .tutorial-title {
        font-size: 1.5rem;
        font-weight: bold;
        color: #1A237E;
        margin: 0;
        line-height: 1.4;
      }

      /* 主要描述 */
      .tutorial-desc {
        font-size: 1.05rem;
        color: #37474F;
        margin: 0;
        line-height: 1.7;
        max-width: 360px;
      }

      /* 詳細說明卡片 */
      .tutorial-detail-card {
        background: rgba(255,255,255,0.65);
        border-radius: 16px;
        padding: 14px 18px;
        width: 100%;
        max-width: 360px;
        backdrop-filter: blur(6px);
        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      }
      .tutorial-detail {
        font-size: 0.92rem;
        color: #546E7A;
        margin: 0;
        line-height: 1.7;
      }

      /* 分頁點 */
      .tutorial-dots {
        display: flex;
        gap: 10px;
        align-items: center;
        padding: 8px 0;
      }
      .tutorial-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: rgba(0,0,0,0.2);
        border: none;
        cursor: pointer;
        transition: width 0.3s ease, background 0.3s ease, border-radius 0.3s ease;
        padding: 0;
      }
      .tutorial-dot.active {
        width: 28px;
        border-radius: 5px;
        background: rgba(0,0,0,0.5);
      }

      /* 導航按鈕區 */
      .tutorial-nav {
        display: flex;
        gap: 12px;
        width: 100%;
        max-width: 420px;
        justify-content: space-between;
        align-items: center;
      }
      .tutorial-nav-btn {
        padding: 12px 24px;
        border-radius: 28px;
        border: 2px solid rgba(0,0,0,0.15);
        background: rgba(255,255,255,0.75);
        color: #37474F;
        font-size: 1rem;
        font-family: inherit;
        font-weight: bold;
        cursor: pointer;
        transition: transform 0.15s, background 0.2s, box-shadow 0.2s;
        backdrop-filter: blur(4px);
        min-width: 110px;
      }
      .tutorial-nav-btn:hover {
        transform: scale(1.03);
        background: rgba(255,255,255,0.95);
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      }
      .tutorial-nav-next {
        background: rgba(255,255,255,0.85);
      }
      .tutorial-nav-finish {
        background: linear-gradient(135deg, #EC407A, #FF6F00) !important;
        color: #fff !important;
        border-color: transparent !important;
        box-shadow: 0 4px 16px rgba(236,64,122,0.4) !important;
        animation: tutorial-pulse 1.5s ease-in-out infinite;
      }
      .tutorial-nav-finish:hover {
        transform: scale(1.05) !important;
      }

      /* 動畫 */
      @keyframes tutorial-pulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(236,64,122,0.4); }
        50%       { box-shadow: 0 6px 24px rgba(236,64,122,0.65); }
      }

      /* 入場 */
      @keyframes tutorial-entrance-kf {
        from { opacity: 0; transform: translateY(24px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .tutorial-entrance {
        animation: tutorial-entrance-kf 0.5s ease forwards;
      }

      /* 滑出動畫 */
      @keyframes tutorial-slide-out-left-kf {
        from { opacity: 1; transform: translateX(0); }
        to   { opacity: 0; transform: translateX(-40px); }
      }
      @keyframes tutorial-slide-out-right-kf {
        from { opacity: 1; transform: translateX(0); }
        to   { opacity: 0; transform: translateX(40px); }
      }
      .tutorial-slide-out-left  { animation: tutorial-slide-out-left-kf  0.25s ease forwards; }
      .tutorial-slide-out-right { animation: tutorial-slide-out-right-kf 0.25s ease forwards; }

      /* 滑入動畫 */
      @keyframes tutorial-slide-in-right-kf {
        from { opacity: 0; transform: translateX(40px); }
        to   { opacity: 1; transform: translateX(0); }
      }
      @keyframes tutorial-slide-in-left-kf {
        from { opacity: 0; transform: translateX(-40px); }
        to   { opacity: 1; transform: translateX(0); }
      }
      .tutorial-slide-in-right { animation: tutorial-slide-in-right-kf 0.35s ease forwards; }
      .tutorial-slide-in-left  { animation: tutorial-slide-in-left-kf  0.35s ease forwards; }
      /* ── 桌面（≥1024px）── */
      @media (min-width: 1024px) {
        .tutorial-wrap { max-width: 1200px; margin: 0 auto; width: 100%; }
      }
    `
    document.head.appendChild(style)
  }
}
