/**
 * PokedexPage.js — 圖鑑收藏頁（Task 36）
 * 依賴：state.js（T02）、firebase.js（T05）、ui_manager.js（T28）、pokedex.js（T12.5）
 * 功能：顯示圖鑑收集狀態，已收集顯示圖片，未收集顯示❓
 */

import { AppState } from '../state.js'
import { PAGES } from '../ui/pages.js'

// ─────────────────────────────────────────────
// 內部樣式（動態注入，含去重複保護）
// ─────────────────────────────────────────────
const STYLE_ID = 'pokedex-page-style'

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* ── 圖鑑收藏頁容器 ── */
    .pokedex-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #fff;
      font-family: 'Noto Sans TC', sans-serif;
      overflow: hidden;
    }

    /* ── 頂部標題列 ── */
    .pokedex-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px 12px;
      background: rgba(0,0,0,0.3);
      border-bottom: 1px solid rgba(255,255,255,0.1);
      flex-shrink: 0;
    }
    .pokedex-back-btn {
      background: rgba(255,255,255,0.15);
      border: none;
      color: #fff;
      font-size: 20px;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .pokedex-back-btn:hover { background: rgba(255,255,255,0.25); }
    .pokedex-title {
      font-size: 20px;
      font-weight: 700;
      flex: 1;
    }
    .pokedex-count-badge {
      font-size: 13px;
      background: rgba(255,215,0,0.2);
      border: 1px solid rgba(255,215,0,0.5);
      color: #ffd700;
      padding: 4px 12px;
      border-radius: 20px;
      white-space: nowrap;
    }

    /* ── 系列切換標籤（預留，目前單系列） ── */
    .pokedex-series-bar {
      display: flex;
      gap: 8px;
      padding: 10px 20px;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .pokedex-series-chip {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #fff;
      border-radius: 20px;
      padding: 6px 16px;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.2s;
    }
    .pokedex-series-chip.active {
      background: rgba(255,215,0,0.25);
      border-color: #ffd700;
      color: #ffd700;
    }

    /* ── 進度條 ── */
    .pokedex-progress-wrap {
      padding: 0 20px 10px;
      flex-shrink: 0;
    }
    .pokedex-progress-bar {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
      overflow: hidden;
    }
    .pokedex-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #ffd700, #ff9500);
      border-radius: 3px;
      transition: width 0.5s ease;
    }

    /* ── 圖鑑格子容器 ── */
    .pokedex-grid-wrap {
      flex: 1;
      overflow-y: auto;
      padding: 10px 14px 20px;
    }
    .pokedex-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
      gap: 10px;
    }

    /* ── 單一圖鑑格子 ── */
    .pokedex-cell {
      aspect-ratio: 1;
      background: rgba(255,255,255,0.08);
      border: 2px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      transition: transform 0.15s, border-color 0.2s;
      overflow: hidden;
    }
    .pokedex-cell:hover { transform: scale(1.06); }
    .pokedex-cell.collected {
      border-color: rgba(255,215,0,0.5);
      background: rgba(0,0,0,0.4);
    }
    .pokedex-cell.collected:hover { border-color: #ffd700; }

    /* 已收集：圖片 */
    .pokedex-cell-img {
      width: 80%;
      height: 80%;
      object-fit: contain;
      image-rendering: -webkit-optimize-contrast;
    }
    /* 圖片載入失敗備用圖示 */
    .pokedex-cell-fallback {
      font-size: 32px;
      opacity: 0.7;
    }

    /* 未收集：❓ */
    .pokedex-cell-unknown {
      font-size: 28px;
      opacity: 0.4;
      user-select: none;
    }

    /* 格子編號小標 */
    .pokedex-cell-num {
      position: absolute;
      bottom: 3px;
      right: 5px;
      font-size: 10px;
      color: rgba(255,255,255,0.4);
      font-weight: 600;
    }

    /* 收集時間小標（已收集格子左下） */
    .pokedex-cell-new-badge {
      position: absolute;
      top: 4px;
      left: 4px;
      background: #ff4757;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      border-radius: 6px;
      padding: 1px 5px;
    }

    /* ── 詳情面板（點擊格子後出現） ── */
    .pokedex-detail-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
      padding: 20px;
    }
    .pokedex-detail-card {
      background: linear-gradient(145deg, #1e3a5f, #0d2137);
      border: 2px solid rgba(255,215,0,0.4);
      border-radius: 20px;
      padding: 24px;
      max-width: 320px;
      width: 100%;
      text-align: center;
      position: relative;
      box-shadow: 0 0 40px rgba(255,215,0,0.15);
    }
    .pokedex-detail-close {
      position: absolute;
      top: 12px;
      right: 14px;
      background: rgba(255,255,255,0.15);
      border: none;
      color: #fff;
      font-size: 18px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pokedex-detail-img {
      width: 140px;
      height: 140px;
      object-fit: contain;
      margin: 0 auto 12px;
      display: block;
      filter: drop-shadow(0 4px 16px rgba(255,215,0,0.3));
    }
    .pokedex-detail-fallback {
      font-size: 80px;
      margin-bottom: 12px;
    }
    .pokedex-detail-name {
      font-size: 18px;
      font-weight: 700;
      color: #ffd700;
      margin-bottom: 6px;
    }
    .pokedex-detail-num {
      font-size: 13px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 16px;
    }
    .pokedex-detail-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-top: 1px solid rgba(255,255,255,0.1);
      padding-top: 14px;
    }
    .pokedex-detail-info-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
    }
    .pokedex-detail-info-label {
      color: rgba(255,255,255,0.5);
    }
    .pokedex-detail-info-value {
      color: #fff;
      font-weight: 600;
    }

    /* ── 空狀態 ── */
    .pokedex-empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 40px 20px;
      color: rgba(255,255,255,0.4);
      font-size: 15px;
      line-height: 1.8;
    }
    .pokedex-empty-icon {
      font-size: 48px;
      display: block;
      margin-bottom: 12px;
    }

    /* ── 載入中轉圈 ── */
    .pokedex-loading {
      grid-column: 1 / -1;
      text-align: center;
      padding: 40px;
      color: rgba(255,255,255,0.5);
    }
    .pokedex-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #ffd700;
      border-radius: 50%;
      animation: pokedex-spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes pokedex-spin {
      to { transform: rotate(360deg); }
    }
    /* ── 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .pokedex-page { max-width: 1200px; margin: 0 auto; width: 100%; }
    }
  `
  document.head.appendChild(style)
}

// ─────────────────────────────────────────────
// PokedexPage 類別
// ─────────────────────────────────────────────
export class PokedexPage {
  constructor() {
    // 當前使用的系列 ID（從 AppState 取得，預設 pokemon）
    this._seriesId = null
    // 圖鑑系列設定（含 total、name 等）
    this._seriesConfig = null
    // 已收集資料：{ "1": { source, date }, "3": {...}, ... }
    this._collected = {}
    // 詳情面板用的 DOM（僅一個，重複使用）
    this._detailEl = null
    // 事件監聽參考（destroy 時移除）
    this._boundHandlers = {}
    // 用於記錄哪些格子已開始 fetch（避免重複請求）
    this._fetchingSet = new Set()
  }

  // ──────────────────────────────────────────
  // init：讀取收集狀態並渲染
  // ──────────────────────────────────────────
  async init(params = {}) {
    injectStyle()

    const app = document.getElementById('app')
    if (!app) throw new Error('找不到 #app')

    // 取得 PokedexManager（全域掛載）
    const PM = globalThis.PokedexManager
    if (!PM) throw new Error('PokedexManager 尚未載入')

    // 讀取系列設定
    this._seriesId = (AppState.pokedex?.active_series) || 'pokemon'
    this._seriesConfig = PM.getSeriesConfig(this._seriesId)

    // 讀取已收集資料
    this._collected = (await PM.getCollected(this._seriesId)) || {}

    // 渲染頁面骨架
    app.innerHTML = this._buildHTML()

    // 渲染格子
    await this.renderGrid()

    // 綁定事件
    this._bindEvents()
  }

  // ──────────────────────────────────────────
  // 建立頁面 HTML 骨架
  // ──────────────────────────────────────────
  _buildHTML() {
    const config = this._seriesConfig
    const total = config?.api?.total || 898
    const collectedCount = Object.keys(this._collected).length
    const progressPct = total > 0 ? Math.min(100, (collectedCount / total) * 100) : 0
    const seriesName = config?.name || '寶可夢圖鑑'
    const seriesIcon = config?.icon || '🐾'

    return `
      <div class="pokedex-page" id="pokedex-page-root">
        <!-- 頂部標題列 -->
        <div class="pokedex-header">
          <button class="pokedex-back-btn" id="pokedex-back-btn" aria-label="返回">‹</button>
          <span class="pokedex-title">${seriesIcon} ${seriesName}</span>
          <span class="pokedex-count-badge">${collectedCount} / ${total}</span>
        </div>

        <!-- 進度條 -->
        <div class="pokedex-progress-wrap">
          <div class="pokedex-progress-bar">
            <div class="pokedex-progress-fill" style="width:${progressPct.toFixed(1)}%"></div>
          </div>
        </div>

        <!-- 圖鑑格子區 -->
        <div class="pokedex-grid-wrap">
          <div class="pokedex-grid" id="pokedex-grid">
            <!-- renderGrid() 填入 -->
          </div>
        </div>
      </div>
    `
  }

  // ──────────────────────────────────────────
  // renderGrid：渲染所有格子
  // 已收集→顯示❓佔位（圖片延遲載入）；未收集→顯示❓
  // ──────────────────────────────────────────
  async renderGrid() {
    const grid = document.getElementById('pokedex-grid')
    if (!grid) return

    const config = this._seriesConfig
    const total = config?.api?.total || 898

    if (total === 0) {
      grid.innerHTML = `
        <div class="pokedex-empty">
          <span class="pokedex-empty-icon">📭</span>
          目前沒有圖鑑項目
        </div>
      `
      return
    }

    // 先顯示載入提示（格子數量大時先佔位）
    let html = ''
    for (let i = 1; i <= total; i++) {
      const isCollected = this._collected[String(i)] !== undefined
      if (isCollected) {
        // 已收集格子：先顯示載入佔位（圖片用 data-index 延遲載入）
        html += `
          <div class="pokedex-cell collected"
               data-index="${i}"
               data-collected="true"
               role="button"
               tabindex="0"
               aria-label="第 ${i} 號，已收集">
            <span class="pokedex-cell-fallback" id="pokedex-fallback-${i}">⏳</span>
            <span class="pokedex-cell-num">#${i}</span>
          </div>
        `
      } else {
        // 未收集格子：顯示❓，不呼叫 fetchImage（節省 API 請求）
        html += `
          <div class="pokedex-cell"
               data-index="${i}"
               data-collected="false"
               role="button"
               tabindex="0"
               aria-label="第 ${i} 號，未收集">
            <span class="pokedex-cell-unknown">❓</span>
            <span class="pokedex-cell-num">#${i}</span>
          </div>
        `
      }
    }
    grid.innerHTML = html

    // 使用 IntersectionObserver 延遲載入圖片（可視範圍才 fetch）
    this._setupLazyLoad()
  }

  // ──────────────────────────────────────────
  // 延遲載入：使用 IntersectionObserver 偵測可視格子後才 fetchImage
  // ──────────────────────────────────────────
  _setupLazyLoad() {
    const PM = globalThis.PokedexManager
    if (!PM) return

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        const cell = entry.target
        if (cell.dataset.collected !== 'true') return
        const index = parseInt(cell.dataset.index, 10)
        if (this._fetchingSet.has(index)) return
        this._fetchingSet.add(index)

        // 停止觀察（只載入一次）
        observer.unobserve(cell)

        // 非同步載入圖片（不阻塞 UI）
        PM.fetchImage(index, this._seriesId)
          .then(url => {
            this._updateCellImage(cell, index, url)
          })
          .catch(() => {
            // fetchImage 失敗：顯示預設圖示，不崩潰
            this._updateCellImage(cell, index, null)
          })
      })
    }, {
      root: document.querySelector('.pokedex-grid-wrap'),
      rootMargin: '100px',
      threshold: 0.01
    })

    // 觀察所有已收集格子
    const grid = document.getElementById('pokedex-grid')
    if (!grid) return
    grid.querySelectorAll('.pokedex-cell[data-collected="true"]').forEach(cell => {
      observer.observe(cell)
    })

    // 儲存 observer 供 destroy 時清理
    this._observer = observer
  }

  // ──────────────────────────────────────────
  // 更新格子圖片（fetchImage 成功或失敗後呼叫）
  // ──────────────────────────────────────────
  _updateCellImage(cell, index, url) {
    // 移除佔位符
    const fallback = cell.querySelector('.pokedex-cell-fallback')
    if (fallback) fallback.remove()

    if (url) {
      // 成功：顯示圖片
      const img = document.createElement('img')
      img.src = url
      img.className = 'pokedex-cell-img'
      img.alt = `#${index}`
      img.loading = 'lazy'
      img.onerror = () => {
        // 圖片 src 有效但載入失敗
        img.remove()
        const fb = document.createElement('span')
        fb.className = 'pokedex-cell-fallback'
        fb.textContent = '🎴'
        cell.prepend(fb)
      }
      cell.prepend(img)
    } else {
      // fetchImage 回傳 null：顯示預設圖示
      const fb = document.createElement('span')
      fb.className = 'pokedex-cell-fallback'
      fb.textContent = '🎴'
      cell.prepend(fb)
    }

    // 檢查是否為新收集（3天內）
    const info = this._collected[String(index)]
    if (info?.date) {
      const days = (Date.now() - new Date(info.date).getTime()) / 86400000
      if (days < 3) {
        const badge = document.createElement('span')
        badge.className = 'pokedex-cell-new-badge'
        badge.textContent = 'NEW'
        cell.appendChild(badge)
      }
    }
  }

  // ──────────────────────────────────────────
  // showDetail：顯示格子詳情（名稱/日期/來源）
  // ──────────────────────────────────────────
  async showDetail(index) {
    const info = this._collected[String(index)]
    if (!info) return // 未收集，不顯示詳情

    // 取得圖片（優先從快取，不重複請求）
    const PM = globalThis.PokedexManager
    let imageUrl = null
    if (PM) {
      try {
        imageUrl = await PM.fetchImage(index, this._seriesId)
      } catch {
        // fetchImage 失敗：使用預設圖示
      }
    }

    // 格式化日期
    const dateStr = info.date
      ? new Date(info.date).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
      : '日期不明'

    // 來源說明
    const sourceMap = {
      sentence: '短句造詞答對',
      star:     '累積星星解鎖',
    }
    const sourceStr = sourceMap[info.source] || info.source || '未知來源'

    // 圖片 or 備用圖示
    const imgHTML = imageUrl
      ? `<img class="pokedex-detail-img" src="${imageUrl}" alt="#${index}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">`
        + `<div class="pokedex-detail-fallback" style="display:none">🎴</div>`
      : `<div class="pokedex-detail-fallback">🎴</div>`

    // 建立詳情 overlay
    const overlay = document.createElement('div')
    overlay.className = 'pokedex-detail-overlay'
    overlay.id = 'pokedex-detail-overlay'
    overlay.innerHTML = `
      <div class="pokedex-detail-card" role="dialog" aria-modal="true">
        <button class="pokedex-detail-close" id="pokedex-detail-close" aria-label="關閉">✕</button>
        ${imgHTML}
        <div class="pokedex-detail-name">No.${String(index).padStart(3, '0')}</div>
        <div class="pokedex-detail-num">${this._seriesConfig?.name || '圖鑑'}</div>
        <div class="pokedex-detail-info">
          <div class="pokedex-detail-info-row">
            <span class="pokedex-detail-info-label">收集日期</span>
            <span class="pokedex-detail-info-value">${dateStr}</span>
          </div>
          <div class="pokedex-detail-info-row">
            <span class="pokedex-detail-info-label">解鎖方式</span>
            <span class="pokedex-detail-info-value">${sourceStr}</span>
          </div>
        </div>
      </div>
    `

    // 移除舊有詳情（防重複）
    this._removeDetail()
    document.body.appendChild(overlay)
    this._detailEl = overlay

    // 關閉按鈕
    const closeBtn = overlay.querySelector('#pokedex-detail-close')
    const closeHandler = () => this._removeDetail()
    closeBtn.addEventListener('click', closeHandler)

    // 點背景關閉
    const bgHandler = (e) => {
      if (e.target === overlay) this._removeDetail()
    }
    overlay.addEventListener('click', bgHandler)

    // ESC 關閉
    const escHandler = (e) => {
      if (e.key === 'Escape') this._removeDetail()
    }
    document.addEventListener('keydown', escHandler)

    // 儲存供 destroy 清理
    this._detailCleanup = () => {
      closeBtn.removeEventListener('click', closeHandler)
      overlay.removeEventListener('click', bgHandler)
      document.removeEventListener('keydown', escHandler)
    }
  }

  // ──────────────────────────────────────────
  // _removeDetail：移除詳情面板
  // ──────────────────────────────────────────
  _removeDetail() {
    if (this._detailCleanup) {
      this._detailCleanup()
      this._detailCleanup = null
    }
    if (this._detailEl) {
      this._detailEl.remove()
      this._detailEl = null
    }
  }

  // ──────────────────────────────────────────
  // 綁定頁面事件
  // ──────────────────────────────────────────
  _bindEvents() {
    // 返回按鈕
    const backBtn = document.getElementById('pokedex-back-btn')
    if (backBtn) {
      const handler = () => {
        const UIManager = globalThis.UIManager
        if (UIManager?.back) UIManager.back()
      }
      backBtn.addEventListener('click', handler)
      this._boundHandlers.back = { el: backBtn, type: 'click', fn: handler }
    }

    // 格子點擊（事件委派，避免 898 個監聽器）
    const grid = document.getElementById('pokedex-grid')
    if (grid) {
      const gridHandler = (e) => {
        const cell = e.target.closest('.pokedex-cell')
        if (!cell) return
        const index = parseInt(cell.dataset.index, 10)
        const isCollected = cell.dataset.collected === 'true'
        if (isCollected) {
          this.showDetail(index)
        }
        // 未收集格子：點擊無反應（不呼叫 fetchImage）
      }
      grid.addEventListener('click', gridHandler)
      // 鍵盤支援（Enter / Space）
      const keyHandler = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const cell = e.target.closest('.pokedex-cell')
          if (!cell) return
          e.preventDefault()
          cell.click()
        }
      }
      grid.addEventListener('keydown', keyHandler)
      this._boundHandlers.grid = { el: grid, type: 'click', fn: gridHandler }
      this._boundHandlers.gridKey = { el: grid, type: 'keydown', fn: keyHandler }
    }
  }

  // ──────────────────────────────────────────
  // destroy：清理資源（事件監聽、observer、詳情面板）
  // ──────────────────────────────────────────
  destroy() {
    // 移除所有事件監聽
    Object.values(this._boundHandlers).forEach(({ el, type, fn }) => {
      if (el) el.removeEventListener(type, fn)
    })
    this._boundHandlers = {}

    // 停止 IntersectionObserver
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }

    // 移除詳情面板
    this._removeDetail()

    // 清空 fetch 集合
    this._fetchingSet.clear()
  }
}
