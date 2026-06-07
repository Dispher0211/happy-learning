/**
 * PokedexPage.js — 圖鑑收藏頁（Task 36）
 * 依賴：state.js（T02）、firebase.js（T05）、ui_manager.js（T28）、pokedex.js（T12.5）
 * 功能：顯示圖鑑收集狀態，已收集顯示圖片，未收集顯示❓
 * v1.2.11：RWD 優化（電腦/手機/平板）
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
      gap: 10px;
      padding: 14px 16px 10px;
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
      flex-shrink: 0;
    }
    .pokedex-back-btn:hover { background: rgba(255,255,255,0.25); }
    .pokedex-title {
      font-size: 18px;
      font-weight: 700;
      flex: 1;
      min-width: 80px;
    }
    .pokedex-count-badge {
      font-size: 13px;
      background: rgba(255,215,0,0.2);
      border: 1px solid rgba(255,215,0,0.5);
      color: #ffd700;
      padding: 4px 10px;
      border-radius: 20px;
      white-space: nowrap;
    }

    /* ── 進度條 ── */
    .pokedex-progress-wrap {
      padding: 0 16px 8px;
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
      padding: 8px 12px 20px;
    }
    .pokedex-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 8px;
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
      font-size: 28px;
      opacity: 0.7;
    }

    /* 未收集：❓ */
    .pokedex-cell-unknown {
      font-size: 26px;
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

    /* NEW 標 */
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

    /* ── 詳情面板 ── */
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
    .pokedex-detail-info-label { color: rgba(255,255,255,0.5); }
    .pokedex-detail-info-value { color: #fff; font-weight: 600; }

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

    /* ── 手機（≤480px）── */
    @media (max-width: 480px) {
      .pokedex-grid {
        grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
        gap: 6px;
      }
      .pokedex-header { padding: 12px 12px 8px; }
      .pokedex-title { font-size: 16px; }
    }

    /* ── 平板（481px ~ 1023px）── */
    @media (min-width: 481px) and (max-width: 1023px) {
      .pokedex-grid {
        grid-template-columns: repeat(auto-fill, minmax(85px, 1fr));
        gap: 9px;
      }
    }

    /* ── 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .pokedex-page { max-width: 1200px; margin: 0 auto; width: 100%; }
      .pokedex-grid {
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 12px;
      }
    }
  `
  document.head.appendChild(style)
}

// ─────────────────────────────────────────────
// PokedexPage 類別
// ─────────────────────────────────────────────
export class PokedexPage {
  constructor() {
    this._seriesId = null
    this._seriesConfig = null
    this._collected = {}
    this._detailEl = null
    this._boundHandlers = {}
    this._fetchingSet = new Set()
  }

  // ──────────────────────────────────────────
  // init
  // ──────────────────────────────────────────
  async init(params = {}) {
    injectStyle()

    const app = document.getElementById('app')
    if (!app) throw new Error('找不到 #app')

    const PM = globalThis.PokedexManager
    if (!PM) throw new Error('PokedexManager 尚未載入')

    this._seriesId = (AppState.pokedex?.active_series) || 'pokemon'
    this._seriesConfig = PM.getSeriesConfig(this._seriesId)
    this._collected = (await PM.getCollected(this._seriesId)) || {}

    app.innerHTML = this._buildHTML()
    await this.renderGrid()
    this._bindEvents()
  }

  // ──────────────────────────────────────────
  // _buildHTML
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
        <div class="pokedex-header">
          <button class="pokedex-back-btn" id="pokedex-back-btn" aria-label="返回">‹</button>
          <span class="pokedex-title">${seriesIcon} ${seriesName}</span>
          <span class="pokedex-count-badge">${collectedCount} / ${total}</span>
        </div>
        <div class="pokedex-progress-wrap">
          <div class="pokedex-progress-bar">
            <div class="pokedex-progress-fill" style="width:${progressPct.toFixed(1)}%"></div>
          </div>
        </div>
        <div class="pokedex-grid-wrap">
          <div class="pokedex-grid" id="pokedex-grid"></div>
        </div>
      </div>
    `
  }

  // ──────────────────────────────────────────
  // renderGrid
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

    let html = ''
    for (let i = 1; i <= total; i++) {
      const isCollected = this._collected[String(i)] !== undefined
      if (isCollected) {
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

    this._setupLazyLoad()
  }

  // ──────────────────────────────────────────
  // _setupLazyLoad
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

        observer.unobserve(cell)

        PM.fetchImage(index, this._seriesId)
          .then(url => { this._updateCellImage(cell, index, url) })
          .catch(() => { this._updateCellImage(cell, index, null) })
      })
    }, {
      root: document.querySelector('.pokedex-grid-wrap'),
      rootMargin: '100px',
      threshold: 0.01
    })

    const grid = document.getElementById('pokedex-grid')
    if (!grid) return
    grid.querySelectorAll('.pokedex-cell[data-collected="true"]').forEach(cell => {
      observer.observe(cell)
    })

    this._observer = observer
  }

  // ──────────────────────────────────────────
  // _updateCellImage
  // ──────────────────────────────────────────
  _updateCellImage(cell, index, url) {
    const fallback = cell.querySelector('.pokedex-cell-fallback')
    if (fallback) fallback.remove()

    if (url) {
      const img = document.createElement('img')
      img.src = url
      img.className = 'pokedex-cell-img'
      img.alt = `#${index}`
      img.loading = 'lazy'
      img.dataset.pokedexIndex = index
      img.onerror = () => {
        img.remove()
        const fb = document.createElement('span')
        fb.className = 'pokedex-cell-fallback'
        fb.textContent = '🎴'
        cell.prepend(fb)
      }
      cell.prepend(img)
    } else {
      const fb = document.createElement('span')
      fb.className = 'pokedex-cell-fallback'
      fb.textContent = '🎴'
      cell.prepend(fb)
    }

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
  // showDetail
  // ──────────────────────────────────────────
  async showDetail(index) {
    const info = this._collected[String(index)]
    if (!info) return

    const PM = globalThis.PokedexManager
    let imageUrl = null
    if (PM) {
      try { imageUrl = await PM.fetchImage(index, this._seriesId) } catch { /* 失敗使用預設 */ }
    }

    const dateStr = info.date
      ? new Date(info.date).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
      : '日期不明'

    const sourceMap = { sentence: '短句造詞答對', star: '累積星星解鎖' }
    const sourceStr = sourceMap[info.source] || info.source || '未知來源'

    const imgHTML = imageUrl
      ? `<img class="pokedex-detail-img" src="${imageUrl}" alt="#${index}" data-pokedex-index="${index}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">`
        + `<div class="pokedex-detail-fallback" style="display:none">🎴</div>`
      : `<div class="pokedex-detail-fallback">🎴</div>`

    let pokemonName = `No.${String(index).padStart(3, '0')}`
    if (PM) {
      try {
        const fetched = await PM.fetchName(index, this._seriesId)
        if (fetched) pokemonName = fetched
      } catch (_) { /* 取得失敗使用預設編號 */ }
    }

    const overlay = document.createElement('div')
    overlay.className = 'pokedex-detail-overlay'
    overlay.id = 'pokedex-detail-overlay'
    overlay.innerHTML = `
      <div class="pokedex-detail-card" role="dialog" aria-modal="true">
        <button class="pokedex-detail-close" id="pokedex-detail-close" aria-label="關閉">✕</button>
        ${imgHTML}
        <div class="pokedex-detail-name">${pokemonName}</div>
        <div class="pokedex-detail-num">No.${String(index).padStart(3, '0')} · ${this._seriesConfig?.name || '圖鑑'}</div>
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

    this._removeDetail()
    document.body.appendChild(overlay)
    this._detailEl = overlay

    const closeBtn = overlay.querySelector('#pokedex-detail-close')
    const closeHandler = () => this._removeDetail()
    closeBtn.addEventListener('click', closeHandler)

    const bgHandler = (e) => { if (e.target === overlay) this._removeDetail() }
    overlay.addEventListener('click', bgHandler)

    const escHandler = (e) => { if (e.key === 'Escape') this._removeDetail() }
    document.addEventListener('keydown', escHandler)

    this._detailCleanup = () => {
      closeBtn.removeEventListener('click', closeHandler)
      overlay.removeEventListener('click', bgHandler)
      document.removeEventListener('keydown', escHandler)
    }
  }

  // ──────────────────────────────────────────
  // _removeDetail
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
  // _bindEvents
  // ──────────────────────────────────────────
  _bindEvents() {
    const backBtn = document.getElementById('pokedex-back-btn')
    if (backBtn) {
      const handler = () => {
        const UIManager = globalThis.UIManager
        if (UIManager?.back) UIManager.back()
      }
      backBtn.addEventListener('click', handler)
      this._boundHandlers.back = { el: backBtn, type: 'click', fn: handler }
    }

    const grid = document.getElementById('pokedex-grid')
    if (grid) {
      const gridHandler = (e) => {
        const cell = e.target.closest('.pokedex-cell')
        if (!cell) return
        const index = parseInt(cell.dataset.index, 10)
        if (cell.dataset.collected === 'true') {
          this.showDetail(index)
        }
      }
      grid.addEventListener('click', gridHandler)
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
  // destroy
  // ──────────────────────────────────────────
  destroy() {
    Object.values(this._boundHandlers).forEach(({ el, type, fn }) => {
      if (el) el.removeEventListener(type, fn)
    })
    this._boundHandlers = {}

    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }

    this._removeDetail()
    this._fetchingSet.clear()
  }
}
