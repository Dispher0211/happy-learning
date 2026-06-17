/**
 * ParentSentencePatternsPage.js — 句型設定頁面（v4.2 新增）
 * 位置：js/pages/ParentSentencePatternsPage.js
 * 層級：第八層頁面
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 *
 * 功能：
 *   - 家長可新增自訂句型（句型 template + 範例 example）
 *   - 自訂句型存於 Firestore users/{uid}.my_sentence_patterns（物件陣列）
 *   - 「短句造詞」遊戲模式3（照樣造句）：
 *       家長有新增自訂句型 → 優先使用自訂句型
 *       家長尚未新增任何句型 → 使用系統內建 sentences_pattern.json
 */

import { FirestoreAPI } from '../firebase.js'
import { AppState }     from '../state.js'
import { UIManager }    from '../ui/ui_manager.js'
import { isItemEnabled, isItemPriority } from '../content_filter.js'

export class ParentSentencePatternsPage {

  constructor () {
    this._listeners = []
  }

  // ─────────────────────────────────────
  // init：讀取 Firestore my_sentence_patterns → 渲染
  // ─────────────────────────────────────
  async init (params = {}) {
    this._injectStyles()

    const app = document.getElementById('app')
    app.innerHTML = this._renderSkeleton()

    // 讀取 Firestore 自訂句型清單
    let patterns = []
    try {
      const uid = AppState.uid
      const userData = await FirestoreAPI.read(`users/${uid}`)
      patterns = Array.isArray(userData?.my_sentence_patterns) ? userData.my_sentence_patterns : []
    } catch (e) {
      console.warn('[ParentSentencePatternsPage] 讀取 my_sentence_patterns 失敗，使用空清單', e)
    }

    // 同步到 AppState
    AppState.sentencePatterns = patterns

    this._renderList(patterns)
    this._bindEvents()
  }

  // ─────────────────────────────────────
  // 頁面骨架
  // ─────────────────────────────────────
  _renderSkeleton () {
    return `
      <div class="psp-page">
        <div class="psp-header">
          <button class="psp-back-btn" id="psp-back-btn">&#8592;</button>
          <h1 class="psp-title">✍️ 句型設定</h1>
          <button class="psp-clear-all-btn" id="psp-clear-all-btn" title="一鍵刪除所有自訂句型">
            🗑️ 清空
          </button>
        </div>

        <p class="psp-desc">
          新增自訂句型，將優先用於「短句造詞」的照樣造句題型。<br>
          若未新增任何句型，遊戲將使用系統內建句型庫。
        </p>

        <div class="psp-add-box">
          <label class="psp-field-label">句型</label>
          <input
            type="text"
            id="psp-template-input"
            class="psp-input"
            placeholder="例如：雖然……但是……"
            maxlength="40"
          />

          <label class="psp-field-label">範例句</label>
          <textarea
            id="psp-example-input"
            class="psp-textarea"
            placeholder="例如：雖然外面下著大雨，但是我們還是準時出發了。"
            maxlength="120"
            rows="3"
          ></textarea>

          <button class="psp-add-btn" id="psp-add-btn">＋ 新增句型</button>
        </div>

        <p class="psp-error" id="psp-error"></p>

        <ul class="psp-list" id="psp-list"></ul>
      </div>
    `
  }

  // ─────────────────────────────────────
  // 渲染自訂句型清單
  // ─────────────────────────────────────
  _renderList (patterns) {
    const list = document.getElementById('psp-list')
    if (!list) return

    if (!patterns || patterns.length === 0) {
      list.innerHTML = '<li class="psp-empty">尚未新增任何句型，目前使用系統內建句型庫</li>'
      return
    }

    list.innerHTML = patterns.map(p => {
      const enabled  = isItemEnabled(p)
      const priority = isItemPriority(p)
      const safeId   = this._escapeHtml(p.id)

      return `
      <li class="psp-item ${enabled ? '' : 'psp-item--disabled'}" data-id="${safeId}">
        <button
          class="psp-priority-btn ${priority ? 'psp-priority-btn--active' : ''}"
          data-priority-id="${safeId}"
          title="${priority ? '取消優先' : '設為優先（更常出現在學習與考題中）'}"
        >★</button>
        <div class="psp-content">
          <div class="psp-template">${this._escapeHtml(p.template || '')}</div>
          <div class="psp-example">${this._escapeHtml(p.example || '')}</div>
        </div>
        <button
          class="psp-toggle-btn ${enabled ? '' : 'psp-toggle-btn--off'}"
          data-toggle-id="${safeId}"
          title="${enabled ? '點擊暫停（暫停後不會出現在學習與考題中）' : '點擊恢復啟用'}"
        >${enabled ? '啟用中' : '已暫停'}</button>
        <button class="psp-delete-btn" data-delete-id="${safeId}" aria-label="刪除">
          🗑️
        </button>
      </li>
      `
    }).join('')
    // 事件委派：由 _bindEvents() 中統一監聽，不在此重複綁定
  }

  // ─────────────────────────────────────
  // 綁定新增按鈕、返回按鈕
  // ─────────────────────────────────────
  _bindEvents () {
    const addBtn = document.getElementById('psp-add-btn')
    if (addBtn) {
      const handler = () => this._addPattern()
      addBtn.addEventListener('click', handler)
      this._listeners.push({ el: addBtn, type: 'click', fn: handler })
    }

    const backBtn = document.getElementById('psp-back-btn')
    if (backBtn) {
      const handler = () => UIManager.back()
      backBtn.addEventListener('click', handler)
      this._listeners.push({ el: backBtn, type: 'click', fn: handler })
    }

    const clearAllBtn = document.getElementById('psp-clear-all-btn')
    if (clearAllBtn) {
      const handler = () => this._clearAllPatterns()
      clearAllBtn.addEventListener('click', handler)
      this._listeners.push({ el: clearAllBtn, type: 'click', fn: handler })
    }

    // 清單點擊（事件代理：刪除／啟用切換／優先切換）
    const list = document.getElementById('psp-list')
    if (list) {
      const listHandler = (e) => {
        const deleteBtn = e.target.closest('[data-delete-id]')
        if (deleteBtn) {
          this._deletePattern(deleteBtn.getAttribute('data-delete-id'))
          return
        }
        const toggleBtn = e.target.closest('[data-toggle-id]')
        if (toggleBtn) {
          this._toggleEnabled(toggleBtn.getAttribute('data-toggle-id'))
          return
        }
        const priorityBtn = e.target.closest('[data-priority-id]')
        if (priorityBtn) {
          this._togglePriority(priorityBtn.getAttribute('data-priority-id'))
          return
        }
      }
      list.addEventListener('click', listHandler)
      this._listeners.push({ el: list, type: 'click', fn: listHandler })
    }
  }

  // ─────────────────────────────────────
  // 新增句型：驗證 → 寫入 Firestore（整陣列覆寫）→ 同步 AppState
  // ─────────────────────────────────────
  async _addPattern () {
    const templateInput = document.getElementById('psp-template-input')
    const exampleInput  = document.getElementById('psp-example-input')
    const errorEl       = document.getElementById('psp-error')
    if (!templateInput || !exampleInput || !errorEl) return

    const template = templateInput.value.trim()
    const example  = exampleInput.value.trim()

    errorEl.textContent = ''

    if (!template) {
      errorEl.textContent = '請輸入句型'
      return
    }
    if (!example) {
      errorEl.textContent = '請輸入範例句'
      return
    }

    const addBtn = document.getElementById('psp-add-btn')
    if (addBtn) addBtn.disabled = true

    const newPattern = {
      id: `custom_${Date.now()}`,
      template,
      example,
      example_alt: '',
      character: '',
      enabled: true,
      priority: false,
    }

    try {
      const uid = AppState.uid
      const current = Array.isArray(AppState.sentencePatterns) ? AppState.sentencePatterns : []
      const updated = [...current, newPattern]

      await FirestoreAPI.write(`users/${uid}`, {
        my_sentence_patterns: updated
      })

      // 同步 AppState
      AppState.sentencePatterns = updated
      AppState.save()

      // 清空輸入框並重新渲染
      templateInput.value = ''
      exampleInput.value  = ''
      this._renderList(updated)

      UIManager.showToast('已新增句型', 'success', 2000)
    } catch (e) {
      console.error('[ParentSentencePatternsPage] 新增句型失敗', e)
      errorEl.textContent = '新增失敗，請稍後再試'
      UIManager.showToast('新增失敗，請稍後再試', 'error', 2000)
    } finally {
      if (addBtn) addBtn.disabled = false
    }
  }

  // ─────────────────────────────────────
  // 刪除句型：整陣列覆寫 → 同步 AppState
  // ─────────────────────────────────────
  async _deletePattern (id) {
    try {
      const uid = AppState.uid
      const current = Array.isArray(AppState.sentencePatterns) ? AppState.sentencePatterns : []
      const updated = current.filter(p => p.id !== id)

      await FirestoreAPI.write(`users/${uid}`, {
        my_sentence_patterns: updated
      })

      AppState.sentencePatterns = updated
      AppState.save()

      this._renderList(updated)

      UIManager.showToast('已刪除句型', 'success', 2000)
    } catch (e) {
      console.error('[ParentSentencePatternsPage] 刪除句型失敗', e)
      UIManager.showToast('刪除失敗，請稍後再試', 'error', 2000)
    }
  }

  // ─────────────────────────────────────
  // 切換句型的啟用／暫停狀態
  // ─────────────────────────────────────
  async _toggleEnabled (id) {
    const existing = Array.isArray(AppState.sentencePatterns) ? AppState.sentencePatterns : []
    const idx = existing.findIndex(p => p.id === id)
    if (idx === -1) return

    const current = existing[idx]
    const updated = [...existing]
    updated[idx] = { ...current, enabled: !isItemEnabled(current) }

    AppState.sentencePatterns = updated
    AppState.save()
    this._renderList(updated)

    try {
      const uid = AppState.uid
      await FirestoreAPI.write(`users/${uid}`, { my_sentence_patterns: updated })
    } catch (e) {
      console.error('[ParentSentencePatternsPage] 切換啟用狀態失敗', e)
      UIManager.showToast('更新失敗，請稍後再試', 'error', 2000)
    }
  }

  // ─────────────────────────────────────
  // 切換句型的優先狀態
  // ─────────────────────────────────────
  async _togglePriority (id) {
    const existing = Array.isArray(AppState.sentencePatterns) ? AppState.sentencePatterns : []
    const idx = existing.findIndex(p => p.id === id)
    if (idx === -1) return

    const current = existing[idx]
    const updated = [...existing]
    updated[idx] = { ...current, priority: !isItemPriority(current) }

    AppState.sentencePatterns = updated
    AppState.save()
    this._renderList(updated)

    try {
      const uid = AppState.uid
      await FirestoreAPI.write(`users/${uid}`, { my_sentence_patterns: updated })
    } catch (e) {
      console.error('[ParentSentencePatternsPage] 切換優先狀態失敗', e)
      UIManager.showToast('更新失敗，請稍後再試', 'error', 2000)
    }
  }

  // ─────────────────────────────────────
  // 一鍵刪除全部自訂句型：覆寫為空陣列 → 同步 AppState
  // ─────────────────────────────────────
  async _clearAllPatterns () {
    const current = Array.isArray(AppState.sentencePatterns) ? AppState.sentencePatterns : []

    if (current.length === 0) {
      UIManager.showToast('目前沒有自訂句型可刪除', 'info', 2000)
      return
    }

    const confirmed = window.confirm(
      `⚠️ 確定要刪除全部 ${current.length} 個自訂句型嗎？\n\n刪除後遊戲將改用系統內建句型庫，此動作無法復原！`
    )
    if (!confirmed) return

    const clearAllBtn = document.getElementById('psp-clear-all-btn')
    if (clearAllBtn) clearAllBtn.disabled = true

    try {
      const uid = AppState.uid

      await FirestoreAPI.write(`users/${uid}`, {
        my_sentence_patterns: []
      })

      AppState.sentencePatterns = []
      AppState.save()

      this._renderList([])

      UIManager.showToast('已清空所有自訂句型', 'success', 2000)
    } catch (e) {
      console.error('[ParentSentencePatternsPage] 一鍵刪除句型失敗', e)
      UIManager.showToast('刪除失敗，請稍後再試', 'error', 2000)
    } finally {
      if (clearAllBtn) clearAllBtn.disabled = false
    }
  }

  // ─────────────────────────────────────
  // CSS 注入
  // ─────────────────────────────────────
  _injectStyles () {
    const STYLE_ID = 'parent-sentence-patterns-page-styles'
    if (document.getElementById(STYLE_ID)) return

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .psp-page {
        max-width: 600px;
        margin: 0 auto;
        padding: 16px;
        font-family: 'Noto Sans TC', sans-serif;
        min-height: 100vh;
        box-sizing: border-box;
      }

      .psp-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }

      .psp-clear-all-btn {
        margin-left: auto;
        flex-shrink: 0;
        height: 32px;
        padding: 0 12px;
        background: #fdecea;
        color: #e53935;
        border: 1.5px solid #f5c6c2;
        border-radius: 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, opacity 0.15s;
        font-family: 'Noto Sans TC', sans-serif;
      }

      .psp-clear-all-btn:hover:not(:disabled) {
        background: #fbdad7;
      }

      .psp-clear-all-btn:disabled {
        opacity: .55;
        cursor: not-allowed;
      }

      .psp-back-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        padding: 4px 8px;
        color: #555;
        line-height: 1;
      }

      .psp-back-btn:hover {
        color: #000;
      }

      .psp-title {
        font-size: 22px;
        font-weight: 700;
        color: #2c2c2c;
        margin: 0;
      }

      .psp-desc {
        font-size: 14px;
        color: #777;
        margin: 0 0 16px 0;
        line-height: 1.6;
      }

      .psp-add-box {
        background: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 12px;
        padding: 14px;
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .psp-field-label {
        font-size: 13px;
        font-weight: 600;
        color: #555;
        margin-top: 4px;
      }

      .psp-input,
      .psp-textarea {
        padding: 10px 14px;
        font-size: 16px;
        border: 2px solid #ccc;
        border-radius: 10px;
        outline: none;
        transition: border-color 0.2s;
        font-family: 'Noto Sans TC', sans-serif;
        box-sizing: border-box;
        width: 100%;
        resize: vertical;
      }

      .psp-input:focus,
      .psp-textarea:focus {
        border-color: #5b8dee;
      }

      .psp-add-btn {
        margin-top: 8px;
        padding: 10px 18px;
        font-size: 16px;
        font-weight: 700;
        background: #5b8dee;
        color: #fff;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.2s;
        font-family: 'Noto Sans TC', sans-serif;
      }

      .psp-add-btn:hover:not(:disabled) {
        background: #3a6fdb;
      }

      .psp-add-btn:disabled {
        background: #aac2f5;
        cursor: not-allowed;
      }

      .psp-error {
        color: #e53935;
        font-size: 13px;
        min-height: 18px;
        margin: 0 0 8px 2px;
      }

      .psp-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .psp-empty {
        text-align: center;
        color: #999;
        padding: 32px 0;
        font-size: 15px;
        line-height: 1.6;
      }

      .psp-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 16px;
        margin-bottom: 8px;
        background: #f8f9fa;
        border-radius: 10px;
        border: 1px solid #e9ecef;
        transition: background 0.15s, opacity 0.15s;
      }

      .psp-item:hover {
        background: #f0f4ff;
      }

      .psp-item--disabled {
        opacity: .5;
      }

      .psp-priority-btn {
        flex-shrink: 0;
        background: none;
        border: none;
        font-size: 16px;
        color: #d8dde6;
        cursor: pointer;
        padding: 2px 2px;
        line-height: 1.4;
        transition: color 0.15s;
      }

      .psp-priority-btn--active {
        color: #f5a623;
      }

      .psp-toggle-btn {
        flex-shrink: 0;
        margin-top: 2px;
        font-size: 11px;
        padding: 3px 10px;
        border-radius: 10px;
        border: 1px solid #cfe8d8;
        background: #eafaf0;
        color: #2e9e5b;
        cursor: pointer;
        font-weight: 600;
        white-space: nowrap;
        transition: background 0.15s;
      }

      .psp-toggle-btn--off {
        border-color: #e3e6ec;
        background: #f0f2f5;
        color: #93a0b0;
      }

      .psp-content {
        flex: 1;
        min-width: 0;
      }

      .psp-template {
        font-size: 17px;
        font-weight: 700;
        color: #2c2c2c;
        margin-bottom: 4px;
      }

      .psp-example {
        font-size: 14px;
        color: #666;
        line-height: 1.5;
      }

      .psp-delete-btn {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        transition: background 0.15s;
        line-height: 1;
        flex-shrink: 0;
      }

      .psp-delete-btn:hover {
        background: #ffebee;
      }
    `
    document.head.appendChild(style)
  }

  // ─────────────────────────────────────
  // 防 XSS
  // ─────────────────────────────────────
  _escapeHtml (str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // ─────────────────────────────────────
  // destroy：移除所有事件監聽
  // ─────────────────────────────────────
  destroy () {
    this._listeners.forEach(({ el, type, fn }) => {
      if (el && el.removeEventListener) {
        el.removeEventListener(type, fn)
      }
    })
    this._listeners = []
  }
}
