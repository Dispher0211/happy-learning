/**
 * ForgetRankPage.js — 遺忘排名頁面
 * Task 37
 * 依賴模組：state.js（T02）、forgetting.js（T09）、ui_manager.js（T28）
 * 功能（UI SECTION 2.14）：
 *   init()：從 Firestore 讀取所有生字進度，依 fail_rate 降序排列顯示
 *   clickChar(char)：navigate 到生字卡片頁
 *   [開始練習高遺忘生字] → navigate 到遊戲頁面
 */

import { AppState } from '../state.js'
import { ForgettingCurve } from '../forgetting.js'
import { UIManager } from '../ui/ui_manager.js'
import { PAGES } from '../ui/pages.js'

export class ForgetRankPage {
  constructor() {
    // 當前頁面的容器元素
    this._container = null
    // 已排序的生字清單（{char, level, failRate, history}）
    this._sortedChars = []
    // 事件監聽器清單（destroy 時移除）
    this._listeners = []
  }

  /**
   * init()
   * 讀取 AppState.characters（當前孩子的生字表），
   * 取得每個字的遺忘等級與失敗率，依失敗率降序排列後渲染。
   */
  async init() {
    // 取得 #app 容器
    const app = document.getElementById('app')
    if (!app) return

    // 初始顯示載入中
    app.innerHTML = `
      <div class="forget-rank-page">
        <div class="forget-rank-header">
          <button class="btn-back" id="frp-back">← 返回</button>
          <h2 class="forget-rank-title">📊 遺忘排名</h2>
        </div>
        <div class="forget-rank-loading">載入中…</div>
      </div>
    `
    this._container = app.querySelector('.forget-rank-page')

    // 綁定返回按鈕
    const backBtn = app.querySelector('#frp-back')
    if (backBtn) {
      const onBack = () => UIManager.back()
      backBtn.addEventListener('click', onBack)
      this._listeners.push({ el: backBtn, type: 'click', fn: onBack })
    }

    // 注入 CSS（含去重複保護）
    this._injectCSS()

    // 取得當前孩子的生字清單
    const characters = AppState.characters || []
    if (characters.length === 0) {
      this._renderEmpty()
      return
    }

    // 從 ForgettingCurve 讀取所有字的進度，計算 fail_rate
    const sorted = await this._buildSortedList(characters)
    this._sortedChars = sorted

    // 渲染完整排名清單
    this._renderList()
  }

  /**
   * _buildSortedList(characters)
   * 讀取每個字的遺忘進度，計算加權失敗率，依失敗率降序排序。
   * @param {string[]} characters 生字陣列
   * @returns {Array<{char, level, failRate, history}>}
   */
  async _buildSortedList(characters) {
    const results = []

    for (const char of characters) {
      try {
        // 讀取遺忘等級
        const level = await ForgettingCurve.getLevel(char)
        // 讀取進度文件（含 history）以計算失敗率
        const progress = await ForgettingCurve.readProgress(char)
        let failRate = 0

        if (progress && progress.history && progress.history.length > 0) {
          // 近期加權失敗率計算（weights=[1,1,2,2,3,3,4,4,5,5]）
          failRate = this._calcWeightedFailRate(progress.history)
        } else if (level === 'hard') {
          failRate = 0.6  // hard 但無歷史記錄，給予預設值
        } else if (level === 'medium') {
          failRate = 0.3
        }

        results.push({
          char,
          level: level || 'medium',
          failRate,
          history: progress?.history || []
        })
      } catch (err) {
        // 讀取失敗的字仍列入，失敗率設 0
        results.push({ char, level: 'medium', failRate: 0, history: [] })
      }
    }

    // 依失敗率降序排列，失敗率相同時 hard > medium > easy
    results.sort((a, b) => {
      if (Math.abs(b.failRate - a.failRate) > 0.001) {
        return b.failRate - a.failRate
      }
      const levelOrder = { hard: 3, medium: 2, easy: 1, easy_plus: 0 }
      return (levelOrder[b.level] || 1) - (levelOrder[a.level] || 1)
    })

    return results
  }

  /**
   * _calcWeightedFailRate(history)
   * 使用近期加權計算失敗率（weights=[1,1,2,2,3,3,4,4,5,5]，越近越高權重）
   * @param {Array<{result:0|1, time:number}>} history 近10筆記錄
   * @returns {number} 0.0 ~ 1.0
   */
  _calcWeightedFailRate(history) {
    const weights = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    // history 最新的在後面，weights 越後越高
    const len = Math.min(history.length, 10)
    // 取最後 len 筆
    const recent = history.slice(-len)
    let totalWeight = 0
    let failWeight = 0
    for (let i = 0; i < len; i++) {
      // weights 對應最後10筆，從 10-len 開始對應
      const w = weights[10 - len + i]
      totalWeight += w
      if (recent[i].result === 0) {
        failWeight += w
      }
    }
    return totalWeight > 0 ? failWeight / totalWeight : 0
  }

  /**
   * _renderList()
   * 渲染排名清單到 #app。
   */
  _renderList() {
    if (!this._container) return

    const list = this._sortedChars

    // 無任何生字記錄
    if (list.length === 0) {
      this._renderEmpty()
      return
    }

    // 取出失敗率 > 0 的高遺忘生字（用於「開始練習」按鈕）
    const highForgetChars = list
      .filter(item => item.failRate > 0.3 || item.level === 'hard')
      .map(item => item.char)

    // 渲染 HTML
    const itemsHTML = list.map((item, idx) => {
      const rank = idx + 1
      const levelIcon = this._getLevelIcon(item.level)
      const levelLabel = this._getLevelLabel(item.level)
      const pct = Math.round(item.failRate * 100)
      // 進度條寬度（最少 4% 避免完全看不見）
      const barWidth = item.failRate > 0 ? Math.max(pct, 4) : 0

      return `
        <div class="frp-item frp-level-${item.level}"
             data-char="${item.char}"
             role="button"
             tabindex="0"
             aria-label="${item.char}，${levelLabel}，失敗率${pct}%">
          <div class="frp-rank">#${rank}</div>
          <div class="frp-level-badge">${levelIcon} ${levelLabel}</div>
          <div class="frp-char">${item.char}</div>
          <div class="frp-bar-wrap">
            <div class="frp-bar" style="width:${barWidth}%"></div>
          </div>
          <div class="frp-pct">${pct}%</div>
        </div>
      `
    }).join('')

    // 練習按鈕：有高遺忘字才可點
    const btnDisabled = highForgetChars.length === 0 ? 'disabled' : ''
    const btnTitle = highForgetChars.length === 0
      ? '目前沒有高遺忘生字'
      : `開始練習 ${highForgetChars.length} 個高遺忘生字`

    this._container.innerHTML = `
      <div class="forget-rank-header">
        <button class="btn-back" id="frp-back">← 返回</button>
        <h2 class="forget-rank-title">📊 遺忘排名</h2>
      </div>
      <p class="frp-subtitle">依失敗率排序，點擊任一生字可查看卡片</p>
      <div class="frp-list" id="frp-list">
        ${itemsHTML}
      </div>
      <div class="frp-footer">
        <button class="frp-practice-btn ${btnDisabled ? 'frp-btn-disabled' : ''}"
                id="frp-practice"
                ${btnDisabled}
                title="${btnTitle}">
          🎯 開始練習高遺忘生字
          ${highForgetChars.length > 0 ? `<span class="frp-badge">${highForgetChars.length}</span>` : ''}
        </button>
      </div>
    `

    // 重新綁定返回按鈕
    const backBtn = this._container.querySelector('#frp-back')
    if (backBtn) {
      const onBack = () => UIManager.back()
      backBtn.addEventListener('click', onBack)
      this._listeners.push({ el: backBtn, type: 'click', fn: onBack })
    }

    // 綁定每個生字列的點擊
    const listEl = this._container.querySelector('#frp-list')
    if (listEl) {
      const onItemClick = (e) => {
        const item = e.target.closest('.frp-item')
        if (!item) return
        const char = item.dataset.char
        if (char) this.clickChar(char)
      }
      const onItemKeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const item = e.target.closest('.frp-item')
          if (!item) return
          const char = item.dataset.char
          if (char) this.clickChar(char)
        }
      }
      listEl.addEventListener('click', onItemClick)
      listEl.addEventListener('keydown', onItemKeydown)
      this._listeners.push({ el: listEl, type: 'click', fn: onItemClick })
      this._listeners.push({ el: listEl, type: 'keydown', fn: onItemKeydown })
    }

    // 綁定「開始練習高遺忘生字」按鈕
    const practiceBtn = this._container.querySelector('#frp-practice')
    if (practiceBtn && !btnDisabled) {
      const onPractice = () => this._startPractice(highForgetChars)
      practiceBtn.addEventListener('click', onPractice)
      this._listeners.push({ el: practiceBtn, type: 'click', fn: onPractice })
    }
  }

  /**
   * clickChar(char)
   * 點擊生字 → navigate 到生字卡片頁
   * @param {string} char 生字（如 '大'）
   */
  clickChar(char) {
    UIManager.navigate(PAGES.CARD, { char })
  }

  /**
   * _startPractice(chars)
   * [開始練習高遺忘生字] → navigate 到遊戲頁面，
   * 使用 gameId: 'random'，config 傳入高遺忘生字清單。
   * @param {string[]} chars 高遺忘生字陣列
   */
  _startPractice(chars) {
    UIManager.navigate(PAGES.GAME, {
      gameId: 'random',
      config: {
        characters: chars,
        mode: 'auto',         // 連續模式
        sourceLabel: '高遺忘生字練習'
      }
    })
  }

  /**
   * _renderEmpty()
   * 尚無生字記錄時顯示提示。
   */
  _renderEmpty() {
    if (!this._container) return
    this._container.innerHTML = `
      <div class="forget-rank-header">
        <button class="btn-back" id="frp-back">← 返回</button>
        <h2 class="forget-rank-title">📊 遺忘排名</h2>
      </div>
      <div class="frp-empty">
        <p>📚 還沒有挑戰記錄</p>
        <p>快去挑戰遊戲，累積學習記錄吧！</p>
      </div>
    `
    const backBtn = this._container.querySelector('#frp-back')
    if (backBtn) {
      const onBack = () => UIManager.back()
      backBtn.addEventListener('click', onBack)
      this._listeners.push({ el: backBtn, type: 'click', fn: onBack })
    }
  }

  /**
   * _getLevelIcon(level)
   * 依等級回傳對應圓點圖示
   */
  _getLevelIcon(level) {
    const map = {
      hard: '🔴',
      medium: '🟠',
      easy: '🟡',
      easy_plus: '🟢'
    }
    return map[level] || '🟠'
  }

  /**
   * _getLevelLabel(level)
   * 依等級回傳中文標籤
   */
  _getLevelLabel(level) {
    const map = {
      hard: '困難',
      medium: '中等',
      easy: '簡單',
      easy_plus: '極簡單'
    }
    return map[level] || '中等'
  }

  /**
   * _injectCSS()
   * 動態注入頁面樣式（含去重複保護）
   */
  _injectCSS() {
    const STYLE_ID = '__frp_styles__'
    if (document.getElementById(STYLE_ID)) return

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      /* ===== ForgetRankPage 樣式 ===== */
      .forget-rank-page {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: #f9f6ff;
        font-family: 'BpmfIVS', 'Noto Sans TC', sans-serif;
      }

      /* 頂部標題列 */
      .forget-rank-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 20px 8px;
        background: #fff;
        border-bottom: 2px solid #e8e0f8;
      }
      .forget-rank-title {
        font-size: 20px;
        font-weight: 700;
        color: #5c3d9e;
        margin: 0;
      }
      .btn-back {
        background: none;
        border: 2px solid #c4b5f4;
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 14px;
        color: #5c3d9e;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
      }
      .btn-back:hover {
        background: #ede9ff;
      }

      /* 副標題 */
      .frp-subtitle {
        font-size: 13px;
        color: #888;
        margin: 8px 20px 4px;
      }

      /* 載入中 */
      .forget-rank-loading {
        text-align: center;
        padding: 60px 20px;
        color: #aaa;
        font-size: 16px;
      }

      /* 清單區 */
      .frp-list {
        flex: 1;
        padding: 8px 16px 0;
        overflow-y: auto;
      }

      /* 單行項目 */
      .frp-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        margin-bottom: 8px;
        background: #fff;
        border-radius: 12px;
        border: 2px solid #f0ecff;
        cursor: pointer;
        transition: box-shadow 0.15s, border-color 0.15s;
        user-select: none;
      }
      .frp-item:hover,
      .frp-item:focus {
        box-shadow: 0 2px 12px rgba(92,61,158,0.12);
        border-color: #c4b5f4;
        outline: none;
      }
      .frp-item:active {
        background: #f5f0ff;
      }

      /* 等級色調 */
      .frp-item.frp-level-hard   { border-left: 5px solid #e74c3c; }
      .frp-item.frp-level-medium { border-left: 5px solid #f39c12; }
      .frp-item.frp-level-easy   { border-left: 5px solid #f1c40f; }
      .frp-item.frp-level-easy_plus { border-left: 5px solid #2ecc71; }

      /* 排名 */
      .frp-rank {
        min-width: 36px;
        font-size: 13px;
        color: #999;
        font-weight: 600;
      }

      /* 等級標籤 */
      .frp-level-badge {
        min-width: 64px;
        font-size: 12px;
        color: #555;
        white-space: nowrap;
      }

      /* 生字（大字顯示） */
      .frp-char {
        font-size: 26px;
        font-weight: 700;
        color: #3a2060;
        min-width: 36px;
        text-align: center;
        letter-spacing: 0;
      }

      /* 進度條 */
      .frp-bar-wrap {
        flex: 1;
        height: 12px;
        background: #f0ecff;
        border-radius: 6px;
        overflow: hidden;
      }
      .frp-bar {
        height: 100%;
        border-radius: 6px;
        background: linear-gradient(90deg, #f39c12, #e74c3c);
        transition: width 0.4s ease;
        min-width: 0;
      }
      /* 高失敗率時加深 */
      .frp-item.frp-level-hard .frp-bar {
        background: linear-gradient(90deg, #e74c3c, #c0392b);
      }
      .frp-item.frp-level-easy .frp-bar,
      .frp-item.frp-level-easy_plus .frp-bar {
        background: linear-gradient(90deg, #f1c40f, #2ecc71);
      }

      /* 失敗率百分比 */
      .frp-pct {
        min-width: 40px;
        text-align: right;
        font-size: 13px;
        font-weight: 600;
        color: #e74c3c;
      }

      /* 底部練習按鈕區 */
      .frp-footer {
        padding: 16px 20px 24px;
        background: #f9f6ff;
      }
      .frp-practice-btn {
        width: 100%;
        padding: 14px 20px;
        background: linear-gradient(135deg, #7c3aed, #5c3d9e);
        color: #fff;
        border: none;
        border-radius: 16px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(92,61,158,0.25);
        transition: transform 0.1s, box-shadow 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .frp-practice-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(92,61,158,0.35);
      }
      .frp-practice-btn:active:not(:disabled) {
        transform: translateY(0);
      }
      .frp-btn-disabled,
      .frp-practice-btn:disabled {
        background: #ccc;
        box-shadow: none;
        cursor: not-allowed;
        color: #999;
      }
      .frp-badge {
        background: #fff;
        color: #5c3d9e;
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 13px;
        font-weight: 700;
      }

      /* 空狀態 */
      .frp-empty {
        text-align: center;
        padding: 80px 20px;
        color: #aaa;
      }
      .frp-empty p {
        margin: 8px 0;
        font-size: 16px;
      }
    `
    document.head.appendChild(style)
  }

  /**
   * destroy()
   * 移除所有事件監聽器，釋放資源。
   * super.destroy() 模式：此頁面無繼承，直接清理。
   */
  destroy() {
    // 移除所有已綁定的事件監聽器
    for (const { el, type, fn } of this._listeners) {
      try {
        el.removeEventListener(type, fn)
      } catch (_) {
        // 元素已消失，忽略
      }
    }
    this._listeners = []
    this._container = null
    this._sortedChars = []
  }
}
