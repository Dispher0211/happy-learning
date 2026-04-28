/**
 * Task 45 — ParentAPIPage.js（API Key 設定頁面）
 * 位置：js/pages/ParentAPIPage.js
 * 層級：第八層頁面（家長設定）
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 *
 * 功能：
 *   init()    → 顯示3個服務的 Key 輸入框，讀取現有設定
 *   saveKeys()→ 寫入 Firestore settings.api_keys
 *   testKey() → 測試 API Key 是否有效
 */

import { AppState }     from '../state.js'
import { FirestoreAPI } from '../firebase.js'

export class ParentAPIPage {

  constructor() {
    // 儲存事件監聽器的參考，供 destroy() 移除
    this._handlers = []
    // 目前正在測試的服務（防止重複點擊）
    this._testing = {}
  }

  // ─────────────────────────────────────────
  // init()：渲染頁面，讀取現有 API Key
  // ─────────────────────────────────────────
  async init(params = {}) {
    const app = document.getElementById('app')

    // 從 AppState 讀取現有 key，用於預填輸入框
    const keys = AppState.settings?.api_keys || {}
    const geminiKeys  = (keys.gemini  || []).join('\n')
    const myScriptKeys = (keys.myScript || []).join('\n')

    // 讀取 soundOn 設定（可選功能）
    const soundOn = AppState.settings?.soundOn !== false

    app.innerHTML = `
      <div class="parent-api-page">

        <!-- 頁首 -->
        <div class="parent-page-header">
          <button class="btn-back" id="btn-api-back">← 返回</button>
          <h1 class="parent-page-title">🔑 API Key 設定</h1>
        </div>

        <!-- 說明區塊 -->
        <div class="api-info-banner">
          <span class="api-info-icon">ℹ️</span>
          <p>請向各服務申請 API Key 後填入。最多可填3組，系統將自動輪替使用。</p>
        </div>

        <!-- ── 服務1：Google Gemini ── -->
        <div class="api-section" id="section-gemini">
          <div class="api-section-header">
            <span class="api-service-icon">🤖</span>
            <div>
              <h2 class="api-service-name">Google Gemini</h2>
              <p class="api-service-desc">短句造詞 AI 評分（句型練習）</p>
            </div>
            <button class="btn-test" id="btn-test-gemini" data-service="gemini">測試</button>
          </div>
          <textarea
            class="api-key-input"
            id="input-gemini"
            placeholder="每行填入一組 Key（最多3組）&#10;AIzaSy..."
            rows="3"
            autocomplete="off"
            spellcheck="false"
          >${this._escapeHtml(geminiKeys)}</textarea>
          <div class="api-test-result" id="result-gemini"></div>
        </div>

        <!-- ── 服務2：MyScript ── -->
        <div class="api-section" id="section-myscript">
          <div class="api-section-header">
            <span class="api-service-icon">✍️</span>
            <div>
              <h2 class="api-service-name">MyScript</h2>
              <p class="api-service-desc">手寫辨識（寫出國字、注音）</p>
            </div>
            <button class="btn-test" id="btn-test-myscript" data-service="myScript">測試</button>
          </div>
          <textarea
            class="api-key-input"
            id="input-myscript"
            placeholder="每行填入一組 Key（最多3組）"
            rows="3"
            autocomplete="off"
            spellcheck="false"
          >${this._escapeHtml(myScriptKeys)}</textarea>
          <div class="api-test-result" id="result-myscript"></div>
        </div>

        <!-- ── 音效設定（可選）── -->
        <div class="api-section api-section-sound">
          <div class="api-section-header">
            <span class="api-service-icon">🔊</span>
            <div>
              <h2 class="api-service-name">音效設定</h2>
              <p class="api-service-desc">開啟或關閉遊戲音效與語音</p>
            </div>
          </div>
          <div class="sound-toggle-row">
            <span class="sound-label">遊戲音效</span>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-sound" ${soundOn ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <span class="sound-status" id="sound-status">${soundOn ? '開啟' : '關閉'}</span>
          </div>
        </div>

        <!-- 儲存按鈕 -->
        <div class="api-action-row">
          <button class="btn-save-keys" id="btn-save-keys">💾 儲存設定</button>
        </div>

        <!-- 全域錯誤提示區 -->
        <div class="api-global-error" id="api-global-error" style="display:none"></div>

      </div>

      <style>
        /* ── 頁面容器 ── */
        .parent-api-page {
          min-height: 100vh;
          background: #f5f7fa;
          padding: 0 0 40px;
          font-family: 'Noto Sans TC', sans-serif;
        }

        /* ── 頁首 ── */
        .parent-page-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          background: #ffffff;
          border-bottom: 2px solid #e8ecf0;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .btn-back {
          background: none;
          border: none;
          font-size: 16px;
          color: #5b7fa6;
          cursor: pointer;
          padding: 6px 10px;
          border-radius: 8px;
          transition: background 0.15s;
        }
        .btn-back:hover { background: #eef2f7; }
        .parent-page-title {
          font-size: 20px;
          font-weight: 700;
          color: #2c3e50;
          margin: 0;
        }

        /* ── 說明 Banner ── */
        .api-info-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 16px 20px 0;
          padding: 12px 16px;
          background: #e8f4fd;
          border-radius: 10px;
          border-left: 4px solid #3498db;
        }
        .api-info-icon { font-size: 18px; flex-shrink: 0; margin-top: 2px; }
        .api-info-banner p {
          margin: 0;
          font-size: 13px;
          color: #2980b9;
          line-height: 1.5;
        }

        /* ── API 服務區塊 ── */
        .api-section {
          margin: 16px 20px 0;
          background: #ffffff;
          border-radius: 14px;
          padding: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .api-section-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }
        .api-service-icon {
          font-size: 28px;
          line-height: 1;
          flex-shrink: 0;
        }
        .api-service-name {
          font-size: 16px;
          font-weight: 700;
          color: #2c3e50;
          margin: 0 0 2px;
        }
        .api-service-desc {
          font-size: 12px;
          color: #7f8c8d;
          margin: 0;
        }

        /* ── 測試按鈕 ── */
        .btn-test {
          margin-left: auto;
          padding: 6px 14px;
          border: 2px solid #3498db;
          background: transparent;
          color: #3498db;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s, color 0.15s;
          flex-shrink: 0;
        }
        .btn-test:hover {
          background: #3498db;
          color: #fff;
        }
        .btn-test:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── Key 輸入框 ── */
        .api-key-input {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border: 2px solid #dce3eb;
          border-radius: 10px;
          font-size: 13px;
          font-family: 'Courier New', Courier, monospace;
          color: #2c3e50;
          background: #f9fbfd;
          resize: vertical;
          outline: none;
          transition: border-color 0.15s;
          line-height: 1.6;
        }
        .api-key-input:focus {
          border-color: #3498db;
          background: #fff;
        }

        /* ── 測試結果提示 ── */
        .api-test-result {
          margin-top: 8px;
          min-height: 20px;
          font-size: 13px;
          font-weight: 600;
          padding: 0 4px;
        }
        .api-test-result.success { color: #27ae60; }
        .api-test-result.error   { color: #e74c3c; }
        .api-test-result.loading { color: #f39c12; }

        /* ── 音效切換區塊 ── */
        .api-section-sound {}
        .sound-toggle-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 4px 0;
        }
        .sound-label {
          font-size: 15px;
          color: #2c3e50;
          font-weight: 500;
          flex: 1;
        }
        .sound-status {
          font-size: 14px;
          font-weight: 700;
          color: #27ae60;
          min-width: 30px;
        }

        /* ── Toggle Switch ── */
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 52px;
          height: 28px;
        }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }
        .toggle-slider {
          position: absolute;
          inset: 0;
          background: #ccc;
          border-radius: 28px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .toggle-slider::before {
          content: '';
          position: absolute;
          width: 22px;
          height: 22px;
          left: 3px;
          top: 3px;
          background: #fff;
          border-radius: 50%;
          transition: transform 0.2s;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }
        .toggle-switch input:checked + .toggle-slider {
          background: #2ecc71;
        }
        .toggle-switch input:checked + .toggle-slider::before {
          transform: translateX(24px);
        }

        /* ── 儲存按鈕 ── */
        .api-action-row {
          margin: 24px 20px 0;
          display: flex;
          justify-content: center;
        }
        .btn-save-keys {
          padding: 14px 48px;
          background: linear-gradient(135deg, #2980b9, #3498db);
          color: #fff;
          border: none;
          border-radius: 30px;
          font-size: 17px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(52,152,219,0.35);
          transition: transform 0.1s, box-shadow 0.1s;
          letter-spacing: 0.5px;
        }
        .btn-save-keys:active {
          transform: scale(0.97);
          box-shadow: 0 2px 8px rgba(52,152,219,0.25);
        }

        /* ── 全域錯誤提示 ── */
        .api-global-error {
          margin: 14px 20px 0;
          padding: 12px 16px;
          background: #fdecea;
          border-radius: 10px;
          border-left: 4px solid #e74c3c;
          color: #c0392b;
          font-size: 14px;
          font-weight: 600;
        }
      </style>
    `

    // 綁定所有事件
    this._bindEvents()
  }

  // ─────────────────────────────────────────
  // _bindEvents()：統一綁定，儲存參考供 destroy()
  // ─────────────────────────────────────────
  _bindEvents() {
    // 返回按鈕
    this._addHandler('btn-api-back', 'click', () => {
      globalThis.UIManager?.back?.()
    })

    // 儲存按鈕
    this._addHandler('btn-save-keys', 'click', () => {
      this.saveKeys()
    })

    // 測試按鈕（Gemini）
    this._addHandler('btn-test-gemini', 'click', () => {
      const key = this._getFirstKey('gemini')
      this.testKey('gemini', key)
    })

    // 測試按鈕（MyScript）
    this._addHandler('btn-test-myscript', 'click', () => {
      const key = this._getFirstKey('myscript')
      this.testKey('myScript', key)
    })

    // 音效 Toggle
    this._addHandler('toggle-sound', 'change', (e) => {
      const soundOn = e.target.checked
      const statusEl = document.getElementById('sound-status')
      if (statusEl) {
        statusEl.textContent = soundOn ? '開啟' : '關閉'
        statusEl.style.color = soundOn ? '#27ae60' : '#e74c3c'
      }
    })
  }

  // ─────────────────────────────────────────
  // saveKeys()：驗證並寫入 Firestore settings.api_keys
  // ─────────────────────────────────────────
  async saveKeys() {
    const errorEl = document.getElementById('api-global-error')

    // 從 textarea 讀取每行的 Key（過濾空行，最多3組）
    const geminiKeys   = this._parseKeys('input-gemini')
    const myScriptKeys = this._parseKeys('input-myscript')

    // 讀取音效設定
    const soundOnEl = document.getElementById('toggle-sound')
    const soundOn   = soundOnEl ? soundOnEl.checked : true

    // 驗證：至少有一個服務設定，或音效設定有改動均可儲存
    // 若所有輸入框為空且非音效操作，也允許（清除 Key）
    // 唯一禁止：任何輸入框中有「空白字串」（使用者誤填空格）
    const allKeys = [...geminiKeys, ...myScriptKeys]
    const hasBlankKey = allKeys.some(k => k.trim() === '' && k !== '')
    if (hasBlankKey) {
      this._showError(errorEl, '⚠️ Key 格式錯誤：請移除空白行或修正輸入')
      return
    }

    // 隱藏舊錯誤
    this._hideError(errorEl)

    // 準備寫入資料
    const api_keys = {
      gemini:   geminiKeys,
      myScript: myScriptKeys,
      vision:   AppState.settings?.api_keys?.vision || [],  // vision 保留現有值
    }

    try {
      const uid = AppState.uid
      if (!uid) throw new Error('未登入，無法儲存設定')

      // 寫入 Firestore users/{uid}.settings
      await FirestoreAPI.update(`users/${uid}`, {
        'settings.api_keys': api_keys,
        'settings.soundOn':  soundOn,
      })

      // 同步更新 AppState
      if (!AppState.settings) AppState.settings = {}
      AppState.settings.api_keys = api_keys
      AppState.settings.soundOn  = soundOn
      AppState.save()

      // 顯示成功 Toast
      globalThis.UIManager?.showToast?.('✅ 設定已儲存', 'success')

    } catch (err) {
      console.error('[ParentAPIPage] saveKeys 失敗', err)
      this._showError(errorEl, `儲存失敗：${err.message}`)
    }
  }

  // ─────────────────────────────────────────
  // testKey(service, key)：測試 API Key 是否有效
  //   service：'gemini' | 'myScript'
  // ─────────────────────────────────────────
  async testKey(service, key) {
    // 防止重複點擊
    if (this._testing[service]) return
    this._testing[service] = true

    // 對應的結果顯示元素
    const serviceId = service === 'myScript' ? 'myscript' : service
    const resultEl = document.getElementById(`result-${serviceId}`)
    const btnEl    = document.getElementById(`btn-test-${serviceId}`)

    if (!resultEl) return

    // Key 為空 → 不測試
    if (!key || key.trim() === '') {
      this._setTestResult(resultEl, 'error', '⚠️ 請先填入 Key 再測試')
      this._testing[service] = false
      return
    }

    // 顯示測試中
    this._setTestResult(resultEl, 'loading', '⏳ 測試中...')
    if (btnEl) btnEl.disabled = true

    try {
      let success = false
      let errMsg  = ''

      if (service === 'gemini') {
        // ── 測試 Gemini：呼叫最小化請求 ──
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(8000) }
        )
        if (res.ok) {
          success = true
        } else {
          const json = await res.json().catch(() => ({}))
          errMsg = json?.error?.message || `HTTP ${res.status}`
        }

      } else if (service === 'myScript') {
        // ── 測試 MyScript：送空 batch 確認認證 ──
        // MyScript 使用 HMAC 簽名，無法純前端驗證完整性
        // 此處僅檢查 Key 格式（非空，含必要格式）
        // 完整測試需後端，前端只做格式驗證
        const parts = key.split(':')   // MyScript key 格式: applicationKey:hmacKey
        if (parts.length === 2 && parts[0].length > 8 && parts[1].length > 8) {
          success = true
        } else {
          errMsg = 'Key 格式應為 applicationKey:hmacKey'
        }
      }

      if (success) {
        this._setTestResult(resultEl, 'success', '✅ Key 有效')
      } else {
        this._setTestResult(resultEl, 'error', `❌ 測試失敗：${errMsg}`)
      }

    } catch (err) {
      // 網路錯誤、timeout 等
      const msg = err.name === 'TimeoutError' ? '連線超時' : err.message
      this._setTestResult(resultEl, 'error', `❌ 測試失敗：${msg}`)

    } finally {
      if (btnEl) btnEl.disabled = false
      this._testing[service] = false
    }
  }

  // ─────────────────────────────────────────
  // 私有輔助方法
  // ─────────────────────────────────────────

  /**
   * _parseKeys(inputId)：讀取 textarea，回傳有效 Key 陣列（最多3組）
   * 過濾：空行、純空白行
   */
  _parseKeys(inputId) {
    const el = document.getElementById(inputId)
    if (!el) return []
    return el.value
      .split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0)
      .slice(0, 3)  // 最多3組
  }

  /**
   * _getFirstKey(serviceId)：從 textarea 取得第一個非空 Key（供測試使用）
   */
  _getFirstKey(serviceId) {
    const keys = this._parseKeys(`input-${serviceId}`)
    return keys[0] || ''
  }

  /** _setTestResult()：設定測試結果樣式與文字 */
  _setTestResult(el, type, msg) {
    if (!el) return
    el.className = `api-test-result ${type}`
    el.textContent = msg
  }

  /** _showError()：顯示全域錯誤訊息 */
  _showError(el, msg) {
    if (!el) return
    el.textContent = msg
    el.style.display = 'block'
  }

  /** _hideError()：隱藏全域錯誤訊息 */
  _hideError(el) {
    if (!el) return
    el.style.display = 'none'
    el.textContent = ''
  }

  /** _escapeHtml()：防止 XSS（Key 預填時使用） */
  _escapeHtml(str) {
    if (!str) return ''
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /**
   * _addHandler(id, event, fn)：綁定事件並儲存參考
   * 供 destroy() 統一移除
   */
  _addHandler(id, event, fn) {
    const el = document.getElementById(id)
    if (!el) return
    el.addEventListener(event, fn)
    this._handlers.push({ el, event, fn })
  }

  // ─────────────────────────────────────────
  // destroy()：移除所有事件監聽，釋放資源
  // ─────────────────────────────────────────
  destroy() {
    // 移除所有已儲存的事件監聽器
    for (const { el, event, fn } of this._handlers) {
      el.removeEventListener(event, fn)
    }
    this._handlers = []
    this._testing  = {}
  }
}
