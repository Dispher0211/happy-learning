/**
 * GameListPage.js — 遊戲選單頁面
 * Task 34
 * 依賴：state.js（T02）、ui_manager.js（T28）
 * render 到 #app
 */

import { AppState } from '../state.js'
import { UIManager } from '../ui/ui_manager.js'
import { PAGES } from '../ui/pages.js'

// ──────────────────────────────────────
// 11 個遊戲定義（gameId / 名稱 / 圖示 / 星星數）
// ──────────────────────────────────────
const GAME_LIST = [
  { gameId: 'writing',      icon: '✍️',  label: '寫國字',   stars: 4 },
  { gameId: 'stroke',       icon: '🖊️',  label: '筆順訓練', stars: 2 },
  { gameId: 'zhuyin',       icon: '📝',  label: '寫出注音', stars: 2 },
  { gameId: 'polyphone',    icon: '🎵',  label: '多音判斷', stars: 4 },
  { gameId: 'radical',      icon: '🏠',  label: '部首選擇', stars: 1 },
  { gameId: 'strokes_count',icon: '🔢',  label: '算出筆劃', stars: 1 },
  { gameId: 'typo',         icon: '🔍',  label: '改錯別字', stars: 4 },
  { gameId: 'idiom',        icon: '🀄',  label: '成語配對', stars: 3 },
  { gameId: 'words',        icon: '📋',  label: '詞語填空', stars: 3 },
  { gameId: 'listen',       icon: '🔊',  label: '聽音選字', stars: 1 },
  { gameId: 'sentence',     icon: '📖',  label: '短句造詞', stars: '4/5' },
]

export class GameListPage {
  constructor () {
    // 儲存所有已綁定的事件處理器，供 destroy() 移除
    this._handlers = []
    // 儲存傳入的 params（含 char 等）
    this._params = {}
  }

  // ──────────────────────────────────────
  // init：接收 params，渲染遊戲列表
  // params.char：當前生字（可選）
  // ──────────────────────────────────────
  init (params = {}) {
    this._params = params
    const app = document.getElementById('app')
    if (!app) return

    // 注入 CSS（防止重複注入）
    this._injectCSS()

    // 渲染頁面
    app.innerHTML = this._buildHTML()

    // 綁定所有事件
    this._bindEvents()
  }

  // ──────────────────────────────────────
  // renderGameList：建立 11 個遊戲按鈕 HTML
  // ──────────────────────────────────────
  _buildHTML () {
    const char = this._params.char || ''
    const charDisplay = char
      ? `<div class="gl-current-char">當前生字：<span>${this._escapeHTML(char)}</span></div>`
      : ''

    const gameItems = GAME_LIST.map(g => `
      <button
        class="gl-game-btn"
        data-game-id="${this._escapeHTML(g.gameId)}"
        aria-label="${this._escapeHTML(g.label)}，可獲得${g.stars}顆星"
      >
        <span class="gl-icon" aria-hidden="true">${g.icon}</span>
        <span class="gl-name">${this._escapeHTML(g.label)}</span>
        <span class="gl-stars">★×${g.stars}</span>
      </button>
    `).join('')

    return `
      <div class="gl-page">
        <!-- 頂部標題列 -->
        <div class="gl-header">
          <button class="gl-back-btn" data-action="back" aria-label="返回">◀ 返回</button>
          <h1 class="gl-title">🎮 挑戰遊戲</h1>
        </div>

        <!-- 當前生字顯示（若有） -->
        ${charDisplay}

        <!-- 11 個遊戲按鈕 -->
        <div class="gl-grid" role="list">
          ${gameItems}
        </div>

        <!-- 隨機挑戰按鈕（獨立置底） -->
        <div class="gl-random-wrap">
          <button class="gl-random-btn" data-action="random" aria-label="隨機挑戰，連續答對有bonus加成">
            🎲 隨機挑戰
            <span class="gl-random-bonus">連續bonus加成！</span>
          </button>
        </div>
      </div>
    `
  }

  // ──────────────────────────────────────
  // 綁定事件：遊戲按鈕 + 隨機按鈕 + 返回按鈕
  // ──────────────────────────────────────
  _bindEvents () {
    // 使用事件委派，避免逐一綁定
    const app = document.getElementById('app')
    if (!app) return

    const clickHandler = (e) => {
      const btn = e.target.closest('[data-game-id]')
      const action = e.target.closest('[data-action]')?.dataset.action

      if (btn) {
        // 點選具體遊戲
        this.selectGame(btn.dataset.gameId)
      } else if (action === 'random') {
        // 點隨機挑戰
        this.selectRandom()
      } else if (action === 'back') {
        // 返回上一頁
        UIManager.back()
      }
    }

    app.addEventListener('click', clickHandler)
    // 記錄以便 destroy 時移除
    this._handlers.push({ el: app, type: 'click', fn: clickHandler })
  }

  // ──────────────────────────────────────
  // selectGame：導航到指定遊戲
  // ──────────────────────────────────────
  selectGame (gameId) {
    if (!gameId) return
    UIManager.navigate(PAGES.GAME, {
      gameId,
      char: this._params.char || null,
    })
  }

  // ──────────────────────────────────────
  // selectRandom：導航到隨機挑戰
  // ──────────────────────────────────────
  selectRandom () {
    UIManager.navigate(PAGES.GAME, {
      gameId: 'random',
      char: this._params.char || null,
    })
  }

  // ──────────────────────────────────────
  // destroy：清理所有事件監聽，避免 memory leak
  // ──────────────────────────────────────
  destroy () {
    for (const { el, type, fn } of this._handlers) {
      el.removeEventListener(type, fn)
    }
    this._handlers = []
  }

  // ──────────────────────────────────────
  // 工具：escapeHTML 防 XSS
  // ──────────────────────────────────────
  _escapeHTML (str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ──────────────────────────────────────
  // 動態注入 CSS（防重複）
  // ──────────────────────────────────────
  _injectCSS () {
    const CSS_ID = '__gl_style__'
    if (document.getElementById(CSS_ID)) return

    const style = document.createElement('style')
    style.id = CSS_ID
    style.textContent = `
      /* ── GameListPage 樣式 ── */
      .gl-page {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: #f0f8ff;
        padding: 0 0 24px;
        box-sizing: border-box;
        font-family: 'Noto Sans TC', sans-serif;
      }

      /* 頂部標題列 */
      .gl-header {
        display: flex;
        align-items: center;
        gap: 12px;
        background: #4a90e2;
        color: #fff;
        padding: 12px 16px;
      }
      .gl-back-btn {
        background: transparent;
        border: 1.5px solid rgba(255,255,255,0.7);
        border-radius: 8px;
        color: #fff;
        padding: 6px 12px;
        font-size: 14px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .gl-back-btn:hover { background: rgba(255,255,255,0.15); }
      .gl-title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
      }

      /* 當前生字 */
      .gl-current-char {
        text-align: center;
        font-size: 15px;
        color: #555;
        padding: 10px 16px 0;
      }
      .gl-current-char span {
        font-size: 22px;
        font-weight: 700;
        color: #e04040;
        margin-left: 4px;
      }

      /* 遊戲按鈕格線（2欄 on 手機，3欄 on 桌機） */
      .gl-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        padding: 16px;
      }
      @media (min-width: 600px) {
        .gl-grid { grid-template-columns: repeat(3, 1fr); }
      }

      /* ── 桌面（≥1024px）：限制最大寬度，置中 ── */
      @media (min-width: 1024px) {
        .gl-page {
          max-width: 1200px;
          margin-left: auto;
          margin-right: auto;
          width: 100%;
        }
      }

      .gl-game-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: #fff;
        border: 2px solid #dce8f5;
        border-radius: 16px;
        padding: 16px 8px;
        cursor: pointer;
        transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        min-height: 100px;
        font-family: inherit;
      }
      .gl-game-btn:hover {
        transform: translateY(-3px);
        box-shadow: 0 6px 16px rgba(74,144,226,0.22);
        border-color: #4a90e2;
      }
      .gl-game-btn:active { transform: scale(0.96); }

      .gl-icon  { font-size: 28px; line-height: 1; }
      .gl-name  { font-size: 14px; font-weight: 600; color: #333; }
      .gl-stars { font-size: 12px; color: #e6a000; font-weight: 700; }

      /* 隨機挑戰 */
      .gl-random-wrap {
        padding: 0 16px;
        margin-top: 4px;
      }
      .gl-random-btn {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        background: linear-gradient(135deg, #ff7b3b, #ff4081);
        color: #fff;
        border: none;
        border-radius: 16px;
        padding: 18px;
        font-size: 20px;
        font-weight: 700;
        cursor: pointer;
        transition: opacity 0.15s, transform 0.12s;
        font-family: inherit;
        box-shadow: 0 4px 14px rgba(255,64,129,0.3);
      }
      .gl-random-btn:hover  { opacity: 0.92; transform: translateY(-2px); }
      .gl-random-btn:active { transform: scale(0.97); }
      .gl-random-bonus {
        font-size: 12px;
        font-weight: 400;
        opacity: 0.9;
        letter-spacing: 0.5px;
      }
    `
    document.head.appendChild(style)
  }
}
