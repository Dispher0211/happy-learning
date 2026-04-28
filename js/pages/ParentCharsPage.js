/**
 * ParentCharsPage.js — 家長生字簿管理頁面
 * Task 42 / 快樂學習 Happy Learning
 * 位置：js/pages/ParentCharsPage.js
 *
 * 依賴：
 *   firebase.js（T05） — FirestoreAPI、arrayUnion、arrayRemove
 *   state.js（T02）    — AppState
 *   ui_manager.js（T28）— UIManager、PAGES
 */

import { AppState } from '../state.js'
import { FirestoreAPI } from '../firebase.js'
import { arrayUnion, arrayRemove } from '../firebase.js'
import { UIManager } from '../ui/ui_manager.js'
import { PAGES } from '../ui/pages.js'

export class ParentCharsPage {
  constructor() {
    // 事件監聽器參照（destroy 時移除用）
    this._onAddClick    = null
    this._onInputKeyup  = null
    this._onDeleteClick = null
    this._onBackClick   = null
  }

  // ─────────────────────────────────────────
  // init：讀取 my_characters，渲染清單
  // ─────────────────────────────────────────
  async init(params = {}) {
    const app = document.getElementById('app')
    if (!app) return

    // 注入 CSS（僅第一次）
    this._injectCSS()

    // 初始 HTML 骨架
    app.innerHTML = `
      <div class="pcp-root">

        <!-- 頂部導覽列 -->
        <header class="pcp-header">
          <button class="pcp-back-btn" id="pcpBack">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h1 class="pcp-title">📚 生字簿管理</h1>
          <div class="pcp-header-space"></div>
        </header>

        <!-- 新增生字區 -->
        <section class="pcp-add-section">
          <div class="pcp-input-row">
            <input
              id="pcpInput"
              class="pcp-input"
              type="text"
              maxlength="1"
              placeholder="輸入一個漢字"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
            />
            <button id="pcpAddBtn" class="pcp-add-btn">
              新增
            </button>
          </div>
          <p id="pcpError" class="pcp-error" aria-live="polite"></p>
        </section>

        <!-- 生字統計 -->
        <div class="pcp-stats" id="pcpStats">
          <span id="pcpCount">共 0 個生字</span>
        </div>

        <!-- 生字清單 -->
        <section class="pcp-list-section">
          <div id="pcpLoading" class="pcp-loading">
            <span class="pcp-spinner"></span>
            <span>載入中…</span>
          </div>
          <div id="pcpEmpty" class="pcp-empty" style="display:none">
            <div class="pcp-empty-icon">📖</div>
            <p>尚未加入任何生字</p>
            <p class="pcp-empty-hint">在上方輸入框新增第一個生字吧！</p>
          </div>
          <ul id="pcpList" class="pcp-list" role="list"></ul>
        </section>

      </div>
    `

    // 綁定事件
    this._bindEvents()

    // 讀取並渲染現有生字
    await this._loadAndRender()
  }

  // ─────────────────────────────────────────
  // 事件綁定
  // ─────────────────────────────────────────
  _bindEvents() {
    // 返回按鈕
    const backBtn = document.getElementById('pcpBack')
    this._onBackClick = () => UIManager.back()
    backBtn?.addEventListener('click', this._onBackClick)

    // 新增按鈕
    const addBtn = document.getElementById('pcpAddBtn')
    this._onAddClick = () => this._handleAdd()
    addBtn?.addEventListener('click', this._onAddClick)

    // 輸入框 Enter 鍵觸發新增
    const input = document.getElementById('pcpInput')
    this._onInputKeyup = (e) => {
      if (e.key === 'Enter') this._handleAdd()
    }
    input?.addEventListener('keyup', this._onInputKeyup)

    // 清單點擊（事件代理：刪除按鈕）
    const list = document.getElementById('pcpList')
    this._onDeleteClick = (e) => {
      const btn = e.target.closest('[data-delete-char]')
      if (!btn) return
      const char = btn.getAttribute('data-delete-char')
      if (char) this._handleDelete(char)
    }
    list?.addEventListener('click', this._onDeleteClick)
  }

  // ─────────────────────────────────────────
  // 讀取 Firestore → AppState → 渲染清單
  // ─────────────────────────────────────────
  async _loadAndRender() {
    try {
      const uid = AppState.uid
      if (!uid) {
        this._showError('請先登入')
        return
      }

      // 從 Firestore 讀取 my_characters（陣列，每項為 { 字, zhuyin, ... }）
      const data = await FirestoreAPI.read(`users/${uid}`)
      const chars = data?.my_characters || []

      // 同步到 AppState（確保本地狀態最新）
      AppState.characters = chars

      this._renderList(chars)
    } catch (err) {
      console.error('[ParentCharsPage] 讀取生字失敗', err)
      this._showError('讀取失敗，請稍後再試')
    } finally {
      // 隱藏載入中
      const loading = document.getElementById('pcpLoading')
      if (loading) loading.style.display = 'none'
    }
  }

  // ─────────────────────────────────────────
  // 渲染生字清單
  // ─────────────────────────────────────────
  _renderList(chars) {
    const list   = document.getElementById('pcpList')
    const empty  = document.getElementById('pcpEmpty')
    const count  = document.getElementById('pcpCount')

    if (!list) return

    // 更新統計
    if (count) count.textContent = `共 ${chars.length} 個生字`

    if (chars.length === 0) {
      list.innerHTML = ''
      if (empty) empty.style.display = 'flex'
      return
    }

    if (empty) empty.style.display = 'none'

    // 渲染清單項目
    list.innerHTML = chars.map((item, idx) => {
      // my_characters 的元素可能是物件 { 字, zhuyin } 或純字串
      const char   = (typeof item === 'object') ? (item['字'] || item.char || '') : String(item)
      const zhuyin = (typeof item === 'object') ? (item.zhuyin || item['注音'] || '') : ''
      const safeChar   = this._escapeHTML(char)
      const safeZhuyin = this._escapeHTML(zhuyin)

      return `
        <li class="pcp-item" data-char="${safeChar}" style="animation-delay:${idx * 30}ms">
          <div class="pcp-item-char">
            <span class="pcp-char-display">${safeChar}</span>
            ${zhuyin ? `<span class="pcp-char-zhuyin">${safeZhuyin}</span>` : ''}
          </div>
          <button
            class="pcp-delete-btn"
            data-delete-char="${safeChar}"
            aria-label="刪除生字：${safeChar}"
            title="刪除「${safeChar}」"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </li>
      `
    }).join('')
  }

  // ─────────────────────────────────────────
  // 新增生字
  // ─────────────────────────────────────────
  async _handleAdd() {
    const input = document.getElementById('pcpInput')
    const addBtn = document.getElementById('pcpAddBtn')
    if (!input) return

    const raw  = input.value.trim()
    this._clearError()

    // 驗證：必須是一個漢字
    if (!raw) {
      this._showError('請輸入一個漢字')
      return
    }
    if (raw.length !== 1) {
      this._showError('只能輸入一個漢字')
      return
    }
    if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(raw)) {
      this._showError('請輸入中文漢字')
      return
    }

    // 防重複點擊
    if (addBtn) {
      addBtn.disabled = true
      addBtn.textContent = '新增中…'
    }

    try {
      const uid = AppState.uid
      if (!uid) throw new Error('未登入')

      // 檢查是否已存在（從 AppState 快速判斷）
      const existing = AppState.characters || []
      const alreadyIn = existing.some(item => {
        const c = (typeof item === 'object') ? (item['字'] || item.char || '') : String(item)
        return c === raw
      })

      if (alreadyIn) {
        this._showError(`「${raw}」已在生字簿中`)
        return
      }

      // 從 characters.json 查詢注音（透過 AppState.characterMap 或直接查找）
      const charData  = this._findCharData(raw)
      const newEntry  = charData
        ? { 字: raw, zhuyin: charData.zhuyin || charData['注音'] || '' }
        : { 字: raw, zhuyin: '' }

      // 寫入 Firestore（arrayUnion 防重複）
      await FirestoreAPI.update(`users/${uid}`, {
        my_characters: arrayUnion(newEntry)
      })

      // 同步 AppState
      AppState.characters = [...existing, newEntry]

      // 清空輸入框
      input.value = ''

      // 重新渲染清單
      this._renderList(AppState.characters)

      // 短暫提示
      this._flashSuccess(`「${raw}」已新增`)

    } catch (err) {
      console.error('[ParentCharsPage] 新增生字失敗', err)
      this._showError('新增失敗，請稍後再試')
    } finally {
      if (addBtn) {
        addBtn.disabled  = false
        addBtn.textContent = '新增'
      }
    }
  }

  // ─────────────────────────────────────────
  // 刪除生字
  // ─────────────────────────────────────────
  async _handleDelete(char) {
    try {
      const uid = AppState.uid
      if (!uid) return

      const existing = AppState.characters || []

      // 找到完整物件（arrayRemove 需傳相同物件）
      const target = existing.find(item => {
        const c = (typeof item === 'object') ? (item['字'] || item.char || '') : String(item)
        return c === char
      })

      if (!target) return

      // 從清單立即移除（樂觀更新 → 畫面更流暢）
      const updated = existing.filter(item => {
        const c = (typeof item === 'object') ? (item['字'] || item.char || '') : String(item)
        return c !== char
      })
      AppState.characters = updated
      this._renderList(updated)

      // 寫入 Firestore
      await FirestoreAPI.update(`users/${uid}`, {
        my_characters: arrayRemove(target)
      })

    } catch (err) {
      console.error('[ParentCharsPage] 刪除生字失敗', err)
      // 回復：重新讀取
      await this._loadAndRender()
    }
  }

  // ─────────────────────────────────────────
  // 工具：從已載入的 characters 資料查找注音
  // ─────────────────────────────────────────
  _findCharData(char) {
    // AppState.allCharacters 為 characters.json 全字表（T05 json_loader 會載入）
    const all = AppState.allCharacters || []
    return all.find(item => (item['字'] || item.char || '') === char) || null
  }

  // ─────────────────────────────────────────
  // 錯誤提示
  // ─────────────────────────────────────────
  _showError(msg) {
    const el = document.getElementById('pcpError')
    if (el) {
      el.textContent = msg
      el.classList.add('pcp-error--visible')
    }
  }

  _clearError() {
    const el = document.getElementById('pcpError')
    if (el) {
      el.textContent = ''
      el.classList.remove('pcp-error--visible')
    }
  }

  // 新增成功短暫閃訊
  _flashSuccess(msg) {
    const statsEl = document.getElementById('pcpStats')
    if (!statsEl) return
    const toast = document.createElement('span')
    toast.className = 'pcp-flash-success'
    toast.textContent = msg
    statsEl.appendChild(toast)
    setTimeout(() => toast.remove(), 1800)
  }

  // ─────────────────────────────────────────
  // HTML 跳脫（防 XSS）
  // ─────────────────────────────────────────
  _escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // ─────────────────────────────────────────
  // 注入 CSS（含去重複保護）
  // ─────────────────────────────────────────
  _injectCSS() {
    if (document.getElementById('pcp-style')) return

    const style = document.createElement('style')
    style.id = 'pcp-style'
    style.textContent = `
      /* ──── ParentCharsPage 整體佈局 ──── */
      .pcp-root {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: #f7f8fc;
        font-family: 'Noto Sans TC', sans-serif;
        color: #2d3a4a;
      }

      /* ──── 頂部導覽列 ──── */
      .pcp-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        background: #ffffff;
        border-bottom: 1px solid #e8eaf0;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .pcp-back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: #f0f2f8;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        color: #4a6280;
        flex-shrink: 0;
        transition: background .15s;
      }
      .pcp-back-btn:hover { background: #e4e7f2; }
      .pcp-title {
        font-size: 18px;
        font-weight: 700;
        margin: 0;
        flex: 1;
        letter-spacing: 0.5px;
      }
      .pcp-header-space { width: 36px; }

      /* ──── 新增區 ──── */
      .pcp-add-section {
        background: #ffffff;
        padding: 16px;
        border-bottom: 1px solid #e8eaf0;
      }
      .pcp-input-row {
        display: flex;
        gap: 10px;
      }
      .pcp-input {
        flex: 1;
        height: 44px;
        border: 2px solid #d6dbe8;
        border-radius: 10px;
        padding: 0 14px;
        font-size: 22px;
        text-align: center;
        font-family: 'BpmfIVS', 'Noto Sans TC', serif;
        color: #2d3a4a;
        outline: none;
        transition: border-color .2s;
        max-width: 80px;
      }
      .pcp-input:focus { border-color: #4d8cf5; }
      .pcp-add-btn {
        height: 44px;
        padding: 0 22px;
        background: #4d8cf5;
        color: #fff;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: background .15s, opacity .15s;
        letter-spacing: 1px;
      }
      .pcp-add-btn:hover:not(:disabled) { background: #3576e0; }
      .pcp-add-btn:disabled { opacity: .55; cursor: not-allowed; }

      /* ──── 錯誤提示 ──── */
      .pcp-error {
        margin: 6px 0 0;
        min-height: 18px;
        font-size: 13px;
        color: #e05252;
        opacity: 0;
        transition: opacity .2s;
      }
      .pcp-error--visible { opacity: 1; }

      /* ──── 統計列 ──── */
      .pcp-stats {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        font-size: 13px;
        color: #6b7a90;
        position: relative;
      }

      /* ──── 新增成功閃訊 ──── */
      .pcp-flash-success {
        position: absolute;
        right: 16px;
        background: #34c97a;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 20px;
        animation: pcpFlashFade 1.8s forwards;
        pointer-events: none;
      }
      @keyframes pcpFlashFade {
        0%   { opacity: 0; transform: translateY(4px); }
        15%  { opacity: 1; transform: translateY(0);   }
        70%  { opacity: 1; }
        100% { opacity: 0; }
      }

      /* ──── 清單區 ──── */
      .pcp-list-section {
        flex: 1;
        padding: 8px 16px 32px;
        overflow-y: auto;
      }

      /* 載入中 */
      .pcp-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: center;
        padding: 40px 0;
        color: #a0aab8;
        font-size: 14px;
      }
      .pcp-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid #d0d8e8;
        border-top-color: #4d8cf5;
        border-radius: 50%;
        animation: pcpSpin .8s linear infinite;
        display: inline-block;
      }
      @keyframes pcpSpin { to { transform: rotate(360deg); } }

      /* 空狀態 */
      .pcp-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 50px 20px;
        text-align: center;
        color: #8fa0b8;
      }
      .pcp-empty-icon { font-size: 48px; margin-bottom: 12px; }
      .pcp-empty p { margin: 4px 0; font-size: 14px; }
      .pcp-empty-hint { font-size: 12px; color: #b0bcc8; }

      /* 清單 */
      .pcp-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
        gap: 12px;
      }

      /* 清單項目 */
      .pcp-item {
        background: #ffffff;
        border-radius: 14px;
        border: 1.5px solid #e8eaf0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 14px 8px 10px;
        position: relative;
        animation: pcpItemIn .25s ease both;
        transition: box-shadow .15s;
      }
      .pcp-item:hover { box-shadow: 0 4px 14px rgba(77,140,245,.12); }
      @keyframes pcpItemIn {
        from { opacity: 0; transform: scale(.88) translateY(6px); }
        to   { opacity: 1; transform: scale(1)   translateY(0);   }
      }

      .pcp-item-char {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
      }
      .pcp-char-display {
        font-size: 32px;
        line-height: 1;
        font-family: 'BpmfIVS', 'Noto Sans TC', serif;
        font-weight: 500;
      }
      .pcp-char-zhuyin {
        font-size: 11px;
        color: #7b90ac;
        font-family: 'BpmfIVS', 'Noto Sans TC', serif;
        letter-spacing: 1px;
      }

      /* 刪除按鈕 */
      .pcp-delete-btn {
        position: absolute;
        top: 5px;
        right: 5px;
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        color: #c8d0dc;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity .15s, color .15s, background .15s;
        pointer-events: none;
      }
      .pcp-item:hover .pcp-delete-btn {
        opacity: 1;
        pointer-events: auto;
      }
      .pcp-delete-btn:hover {
        color: #e05252;
        background: #fdecea;
      }
    `
    document.head.appendChild(style)
  }

  // ─────────────────────────────────────────
  // destroy：移除所有事件監聽
  // ─────────────────────────────────────────
  destroy() {
    const backBtn = document.getElementById('pcpBack')
    const addBtn  = document.getElementById('pcpAddBtn')
    const input   = document.getElementById('pcpInput')
    const list    = document.getElementById('pcpList')

    if (backBtn && this._onBackClick) {
      backBtn.removeEventListener('click', this._onBackClick)
    }
    if (addBtn && this._onAddClick) {
      addBtn.removeEventListener('click', this._onAddClick)
    }
    if (input && this._onInputKeyup) {
      input.removeEventListener('keyup', this._onInputKeyup)
    }
    if (list && this._onDeleteClick) {
      list.removeEventListener('click', this._onDeleteClick)
    }

    this._onBackClick   = null
    this._onAddClick    = null
    this._onInputKeyup  = null
    this._onDeleteClick = null
  }
}
