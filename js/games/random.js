/**
 * random.js — 隨機挑戰遊戲
 * Task 27：隨機抽取 11 種遊戲之一執行，並加入連續答對 bonus 機制
 *
 * 依賴模組：
 *   - GameEngine.js（T14）：遊戲共用基底類別
 *   - 所有遊戲模組（T16-26）：11 種遊戲實作
 *   - state.js（T02）：AppState 全域狀態
 *   - audio.js（T08）：音效管理
 *   - stars.js（T10）：星星管理
 *
 * 連續 bonus 規則（只有此遊戲有）：
 *   ≥3  題連對 → bonus ★+1（累計 +1）
 *   ≥5  題連對 → 再 +2（累計 +3）
 *   ≥10 題連對 → 再 +3（累計 +6）
 *
 * 答錯或跳題 → consecutiveCorrect 歸零，bonus tier 重置
 * 使用提示    → consecutiveCorrect 不重置（繼承自 GameEngine.useHint）
 */

import { GameEngine } from './GameEngine.js'
import { AppState }   from '../state.js'
import { AudioManager } from '../audio.js'
import { StarsManager } from '../stars.js'

// ─── 11 種遊戲的動態 import 對應表 ───────────────────────────────────────────
// 使用 lazy import 避免循環依賴；實際 class 在首次使用時才載入
const GAME_MODULES = {
  radical:       () => import('./radical.js').then(m => m.RadicalGame),
  strokes_count: () => import('./strokes_count.js').then(m => m.StrokesCountGame),
  listen:        () => import('./listen.js').then(m => m.ListenGame),
  stroke:        () => import('./stroke.js').then(m => m.StrokeGame),
  polyphone:     () => import('./polyphone.js').then(m => m.PolyphoneGame),
  words:         () => import('./words.js').then(m => m.WordsGame),
  idiom:         () => import('./idiom.js').then(m => m.IdiomGame),
  zhuyin:        () => import('./zhuyin.js').then(m => m.ZhuyinGame),
  writing:       () => import('./writing.js').then(m => m.WritingGame),
  typo:          () => import('./typo.js').then(m => m.TypoGame),
  sentence:      () => import('./sentence.js').then(m => m.SentenceGame),
}

// 11 個遊戲 key 列表（依規格 SECTION 9 順序）
const GAME_IDS = Object.keys(GAME_MODULES)

// ─── bonus 門檻定義 ────────────────────────────────────────────────────────────
// 每個門檻：{ threshold: 達到連對數, bonus: 此階段新增 bonus, label: UI 顯示文字 }
const BONUS_TIERS = [
  { threshold: 3,  bonus: 1, label: '連續3題！bonus ★+1' },
  { threshold: 5,  bonus: 2, label: '連續5題！bonus ★+2' },
  { threshold: 10, bonus: 3, label: '連續10題！bonus ★+3' },
]

// ─── RandomGame 主類別 ────────────────────────────────────────────────────────
export class RandomGame extends GameEngine {
  /**
   * @param {Object} options - 可傳入 { count: 題數, containerId: 容器ID }
   */
  constructor(options = {}) {
    super('random', options)

    // 當前執行中的子遊戲實例
    this._subGame = null

    // 當前隨機選到的遊戲 ID
    this._currentGameId = null

    // 累計已發送的 bonus 星星數（重置答錯時清零）
    this._totalBonusEarned = 0

    // 已達成的最高 bonus tier 索引（防止重複發放同一tier的bonus）
    this._lastBonusTierIndex = -1

    // 題目數量設定（預設 10 題）
    this._totalCount = options.count || 10

    // 當前題號（1-based）
    this._questionIndex = 0

    // 遊戲容器 ID
    this._containerId = options.containerId || 'app'

    // 本局總獲得星星（含 bonus）
    this._totalStarsEarned = 0

    // bonus 提示顯示計時器
    this._bonusToastTimer = null

    // 子遊戲完成後的回調（由外部 GamePage 注入）
    this.onGameComplete = options.onGameComplete || null
  }

  // ─── 初始化 ──────────────────────────────────────────────────────────────────

  /**
   * 初始化遊戲：清空容器，渲染框架，開始第一題
   * @param {Object} config
   */
  async init(config = {}) {
    if (config.count) this._totalCount = config.count

    this._questionIndex = 0
    this._totalStarsEarned = 0
    this.consecutiveCorrect = 0
    this._totalBonusEarned = 0
    this._lastBonusTierIndex = -1

    // 渲染隨機挑戰外框 UI
    this._renderShell()

    // 開始第一題
    await this._startNextQuestion()
  }

  // ─── UI 渲染 ─────────────────────────────────────────────────────────────────

  /**
   * 渲染隨機挑戰的外層 UI 框架（進度條、連續計數器、bonus 提示區）
   */
  _renderShell() {
    const container = this._getContainer()
    if (!container) {
      console.error('[RandomGame] 找不到遊戲容器')
      return
    }

    container.innerHTML = `
      <div id="random-game-shell" class="random-game-shell">

        <!-- 頂部資訊列 -->
        <div class="random-header">
          <div class="random-progress">
            <span id="random-current-q">0</span>
            <span class="random-progress-sep">/</span>
            <span id="random-total-q">${this._totalCount}</span>
            <span class="random-progress-label">題</span>
          </div>
          <div class="random-streak-info">
            <span class="random-streak-icon">🔥</span>
            <span id="random-streak-count">0</span>
            <span class="random-streak-label">連續</span>
          </div>
          <div class="random-stars-info">
            <span class="random-stars-icon">★</span>
            <span id="random-stars-earned">0</span>
          </div>
        </div>

        <!-- bonus 提示橫幅（平時隱藏） -->
        <div id="random-bonus-banner" class="random-bonus-banner" style="display:none;">
          <span id="random-bonus-text"></span>
        </div>

        <!-- 當前遊戲標題 -->
        <div id="random-game-title" class="random-game-title"></div>

        <!-- 子遊戲渲染區域 -->
        <div id="random-sub-game-area" class="random-sub-game-area"></div>

      </div>
    `

    // 注入基本樣式（若尚未存在）
    this._injectStyles()
  }

  /**
   * 注入 random.js 所需的 CSS 樣式
   * 只注入一次（檢查 id 是否已存在）
   */
  _injectStyles() {
    if (document.getElementById('random-game-styles')) return

    const style = document.createElement('style')
    style.id = 'random-game-styles'
    style.textContent = `
      .random-game-shell {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 0;
        box-sizing: border-box;
        font-family: 'Noto Sans TC', 'Arial', sans-serif;
      }

      /* 頂部資訊列 */
      .random-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: rgba(0,0,0,0.25);
        color: #fff;
        font-size: 16px;
        font-weight: bold;
      }
      .random-progress { font-size: 18px; }
      .random-progress-sep { margin: 0 2px; opacity: 0.6; }
      .random-progress-label { font-size: 13px; margin-left: 2px; opacity: 0.8; }
      .random-streak-info { display: flex; align-items: center; gap: 4px; }
      .random-streak-icon { font-size: 20px; }
      #random-streak-count { font-size: 22px; color: #FFD700; }
      .random-stars-info { display: flex; align-items: center; gap: 4px; }
      .random-stars-icon { color: #FFD700; font-size: 18px; }
      #random-stars-earned { font-size: 18px; color: #FFD700; }

      /* bonus 橫幅 */
      .random-bonus-banner {
        text-align: center;
        padding: 10px 16px;
        background: linear-gradient(90deg, #f7971e, #ffd200);
        color: #333;
        font-size: 17px;
        font-weight: bold;
        letter-spacing: 0.5px;
        animation: bonusPulse 0.4s ease-out;
      }
      @keyframes bonusPulse {
        0%   { transform: scale(0.9); opacity: 0; }
        60%  { transform: scale(1.05); }
        100% { transform: scale(1); opacity: 1; }
      }

      /* 當前遊戲標題 */
      .random-game-title {
        text-align: center;
        padding: 8px 16px 4px;
        color: rgba(255,255,255,0.85);
        font-size: 14px;
        letter-spacing: 1px;
      }

      /* 子遊戲渲染區 */
      .random-sub-game-area {
        flex: 1;
        background: #fff;
        border-radius: 20px 20px 0 0;
        margin-top: 4px;
        overflow: hidden;
        position: relative;
      }

      /* 結算畫面 */
      .random-complete-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        gap: 20px;
        padding: 40px 20px;
      }
      .random-complete-title {
        font-size: 32px;
        font-weight: bold;
        color: #333;
      }
      .random-complete-stars {
        font-size: 48px;
        color: #f39c12;
        font-weight: bold;
      }
      .random-complete-detail {
        font-size: 16px;
        color: #666;
        text-align: center;
        line-height: 1.6;
      }
      .random-complete-btn {
        padding: 14px 40px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        border: none;
        border-radius: 30px;
        font-size: 18px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(102,126,234,0.4);
        transition: transform 0.1s;
      }
      .random-complete-btn:active { transform: scale(0.97); }
    `
    document.head.appendChild(style)
  }

  // ─── 題目流程 ─────────────────────────────────────────────────────────────────

  /**
   * 隨機選取一個遊戲 ID（不重複使用上一個）
   * @returns {string} gameId
   */
  _pickRandomGameId() {
    let candidates = GAME_IDS.filter(id => id !== this._currentGameId)
    const idx = Math.floor(Math.random() * candidates.length)
    return candidates[idx]
  }

  /**
   * 啟動下一題（隨機挑一個遊戲）
   */
  async _startNextQuestion() {
    // 銷毀上一個子遊戲實例
    if (this._subGame) {
      try {
        this._subGame.destroy()
      } catch (e) {
        console.warn('[RandomGame] 子遊戲 destroy 失敗', e)
      }
      this._subGame = null
    }

    this._questionIndex++

    // 更新進度 UI
    this._updateProgressUI()

    // 清空子遊戲渲染區
    const area = document.getElementById('random-sub-game-area')
    if (area) {
      area.innerHTML = `
        <div style="
          display:flex;align-items:center;justify-content:center;
          height:200px;color:#aaa;font-size:16px;
        ">
          ⏳ 載入中…
        </div>
      `
    }

    // 隨機選取遊戲
    this._currentGameId = this._pickRandomGameId()

    // 更新遊戲標題
    const titleEl = document.getElementById('random-game-title')
    if (titleEl) {
      const gameLabel = this._getGameLabel(this._currentGameId)
      titleEl.textContent = `✨ 隨機挑戰：${gameLabel}`
    }

    // 動態載入並初始化子遊戲
    try {
      const GameClass = await GAME_MODULES[this._currentGameId]()
      this._subGame = new GameClass({
        containerId: 'random-sub-game-area',
        count: 1,            // 隨機模式每次只出 1 題
        isRandomMode: true,  // 告知子遊戲處於隨機模式
        // 子遊戲答對後的回調
        onCorrectCallback: (stars) => this._onSubGameCorrect(stars),
        // 子遊戲答錯後的回調
        onWrongCallback: () => this._onSubGameWrong(),
        // 子遊戲完成1題後的回調
        onQuestionComplete: (result) => this._onQuestionComplete(result),
      })

      // 以當前 AppState 生字作為題目來源，出 1 題
      await this._subGame.init({
        count: 1,
        chars: AppState.characters || [],
        isRandomMode: true,
      })

    } catch (err) {
      console.error('[RandomGame] 子遊戲載入失敗：', this._currentGameId, err)
      // 子遊戲載入失敗時，直接跳過此題
      if (area) {
        area.innerHTML = `
          <div style="padding:20px;text-align:center;color:#e74c3c;">
            ⚠️ 載入失敗，自動跳過
          </div>
        `
      }
      setTimeout(() => this._skipToNext(), 1500)
    }
  }

  /**
   * 取得遊戲的中文名稱標籤
   * @param {string} gameId
   * @returns {string}
   */
  _getGameLabel(gameId) {
    const labels = {
      radical:       '部首選擇 🏠',
      strokes_count: '算出筆劃 🏹',
      listen:        '聽音選字 🎣',
      stroke:        '筆順訓練 ✍️',
      polyphone:     '多音判斷 ✈️',
      words:         '詞語填空 🏎️',
      idiom:         '成語配對 🚂',
      zhuyin:        '寫出注音 ⭐',
      writing:       '寫出國字 📖',
      typo:          '改錯別字 📦',
      sentence:      '短句造詞 🧩',
    }
    return labels[gameId] || gameId
  }

  // ─── 子遊戲回調處理 ───────────────────────────────────────────────────────────

  /**
   * 子遊戲答對時的回調
   * 負責：更新 consecutiveCorrect、計算並發放 bonus、更新 UI
   * @param {number} baseStars - 子遊戲本身給予的基礎星星數
   */
  async _onSubGameCorrect(baseStars) {
    // consecutiveCorrect 由 GameEngine 的 onCorrect 已遞增
    // 此處直接讀取已更新後的值
    const streak = this.consecutiveCorrect

    // 計算本次 bonus（檢查是否達到新的 tier）
    const bonusStars = this._calculateNewBonus(streak)

    // 更新本局累計星星
    this._totalStarsEarned += (baseStars + bonusStars)

    // 更新連續計數 UI
    this._updateStreakUI(streak)
    this._updateStarsUI()

    // 若有 bonus，顯示 bonus 提示並發放星星
    if (bonusStars > 0) {
      await this._showBonusBanner(streak, bonusStars)
      // 發放 bonus 星星（額外加給玩家）
      try {
        await StarsManager.add(bonusStars)
      } catch (e) {
        console.warn('[RandomGame] bonus 星星發放失敗', e)
      }
    }
  }

  /**
   * 子遊戲答錯時的回調
   * 負責：重置 consecutiveCorrect 和 bonus tier
   */
  _onSubGameWrong() {
    // 重置連續計數
    this.consecutiveCorrect = 0
    this._lastBonusTierIndex = -1
    this._totalBonusEarned = 0

    // 更新 UI
    this._updateStreakUI(0)
  }

  /**
   * 一題完成（無論答對或答錯）後的回調
   * 判斷是否繼續下一題或結算
   * @param {Object} result - { correct: boolean, stars: number }
   */
  async _onQuestionComplete(result) {
    if (result && result.correct) {
      await this._onSubGameCorrect(result.stars || 0)
    } else {
      this._onSubGameWrong()
    }

    // 判斷是否繼續
    if (this._questionIndex >= this._totalCount) {
      // 全部題目完成，進入結算
      await this._onAllQuestionsComplete()
    } else {
      // 繼續下一題（短暫延遲讓玩家看到結果）
      setTimeout(() => this._startNextQuestion(), 1200)
    }
  }

  // ─── bonus 計算 ───────────────────────────────────────────────────────────────

  /**
   * 根據當前連續數，計算「這一次新增的 bonus」
   * 每個 tier 只發放一次（用 _lastBonusTierIndex 防止重複）
   * @param {number} streak - 當前連對數
   * @returns {number} 新增 bonus 星星數
   */
  _calculateNewBonus(streak) {
    let newBonus = 0

    for (let i = 0; i < BONUS_TIERS.length; i++) {
      const tier = BONUS_TIERS[i]
      // 已達門檻 且 尚未發放此 tier
      if (streak >= tier.threshold && i > this._lastBonusTierIndex) {
        newBonus += tier.bonus
        this._lastBonusTierIndex = i
        this._totalBonusEarned += tier.bonus
      }
    }

    return newBonus
  }

  // ─── UI 更新 ──────────────────────────────────────────────────────────────────

  /**
   * 更新題目進度顯示
   */
  _updateProgressUI() {
    const el = document.getElementById('random-current-q')
    if (el) el.textContent = this._questionIndex
  }

  /**
   * 更新連續計數顯示
   * @param {number} streak
   */
  _updateStreakUI(streak) {
    const el = document.getElementById('random-streak-count')
    if (el) {
      el.textContent = streak
      // 連對數 ≥3 時文字放大強調
      el.style.transform = streak >= 3 ? 'scale(1.3)' : 'scale(1)'
      el.style.transition = 'transform 0.2s ease'
    }
  }

  /**
   * 更新本局累計星星顯示
   */
  _updateStarsUI() {
    const el = document.getElementById('random-stars-earned')
    if (el) el.textContent = this._totalStarsEarned.toFixed(1).replace(/\.0$/, '')
  }

  /**
   * 顯示 bonus 提示橫幅
   * @param {number} streak - 當前連對數
   * @param {number} bonusStars - 本次 bonus 星星數
   */
  async _showBonusBanner(streak, bonusStars) {
    const banner = document.getElementById('random-bonus-banner')
    const textEl = document.getElementById('random-bonus-text')
    if (!banner || !textEl) return

    // 找到對應的 tier label
    let label = `連續${streak}題！bonus ★+${bonusStars}`
    for (const tier of BONUS_TIERS) {
      if (streak === tier.threshold) {
        label = tier.label
        break
      }
    }

    textEl.textContent = `🎉 ${label}（累計 ★+${this._totalBonusEarned}）`
    banner.style.display = 'block'

    // 播放 bonus 音效（靜音時無聲）
    try {
      AudioManager?.playSfx?.('bonus')
    } catch (e) { /* 靜音時忽略 */ }

    // 3秒後自動隱藏
    clearTimeout(this._bonusToastTimer)
    this._bonusToastTimer = setTimeout(() => {
      if (banner) banner.style.display = 'none'
    }, 3000)

    // 等待動畫完成（讓玩家看到）
    return new Promise(resolve => setTimeout(resolve, 600))
  }

  // ─── skipQuestion 覆寫（v4 規格：重置 consecutiveCorrect）────────────────────

  /**
   * 跳題：重置連續計數、bonus tier，將題目加到佇列尾端
   * v4 確認：跳題後 consecutiveCorrect 歸零
   */
  skipQuestion() {
    // 重置連續計數（v4 規格明確要求）
    this.consecutiveCorrect = 0
    this._lastBonusTierIndex = -1
    this._totalBonusEarned = 0

    // 更新連續計數 UI
    this._updateStreakUI(0)

    // 隱藏 bonus 橫幅
    const banner = document.getElementById('random-bonus-banner')
    if (banner) banner.style.display = 'none'

    // 跳過目前這題，直接進下一題
    this._skipToNext()
  }

  /**
   * 內部跳題邏輯（不重置 consecutiveCorrect，只切換題目）
   * 由 skipQuestion 和錯誤恢復呼叫
   */
  _skipToNext() {
    if (this._questionIndex >= this._totalCount) {
      this._onAllQuestionsComplete()
    } else {
      this._startNextQuestion()
    }
  }

  // ─── 遊戲完成結算 ────────────────────────────────────────────────────────────

  /**
   * 所有題目完成後的結算流程
   */
  async _onAllQuestionsComplete() {
    // 標記遊戲已完成（防止 _handleInterrupt 在正常結束後重複執行）
    this._gameCompleted = true

    // 銷毀子遊戲
    if (this._subGame) {
      try { this._subGame.destroy() } catch (e) {}
      this._subGame = null
    }

    // 渲染結算畫面
    this._renderCompleteScreen()

    // 呼叫外部完成回調（由 GamePage 注入，用於 navigate 回主頁）
    if (typeof this.onGameComplete === 'function') {
      this.onGameComplete({
        gameId: 'random',
        totalStars: this._totalStarsEarned,
        questionCount: this._totalCount,
        maxStreak: this.consecutiveCorrect,
      })
    }
  }

  /**
   * 渲染遊戲完成結算畫面
   */
  _renderCompleteScreen() {
    const area = document.getElementById('random-sub-game-area')
    if (!area) return

    const stars = this._totalStarsEarned.toFixed(1).replace(/\.0$/, '')
    const bonusText = this._totalBonusEarned > 0
      ? `（含連續 bonus ★+${this._totalBonusEarned}）`
      : ''

    area.innerHTML = `
      <div class="random-complete-screen">
        <div class="random-complete-title">🎊 太棒了！</div>
        <div class="random-complete-stars">★ ${stars}</div>
        <div class="random-complete-detail">
          完成 ${this._totalCount} 題隨機挑戰<br>
          共獲得 <strong>${stars}</strong> 顆星星${bonusText}
        </div>
        <button class="random-complete-btn" id="random-btn-done">
          繼續學習 →
        </button>
      </div>
    `

    // 綁定按鈕事件
    const btn = document.getElementById('random-btn-done')
    if (btn) {
      btn.addEventListener('click', () => {
        // 導航回上一頁（由外部 UIManager 處理）
        globalThis.UIManager?.back?.()
      })
    }
  }

  // ─── GameEngine 抽象方法實作 ──────────────────────────────────────────────────
  // RandomGame 本身不直接出題，由子遊戲負責
  // 以下方法保留供 GameEngine 基底類別呼叫，避免報錯

  /**
   * loadQuestions — 隨機模式不需預載全部題目
   * 由 _startNextQuestion 動態載入子遊戲
   */
  async loadQuestions(config) {
    // 隨機模式題目由子遊戲動態生成，此處不需實作
    return []
  }

  /**
   * renderQuestion — 由子遊戲負責渲染
   */
  renderQuestion(question) {
    // 由子遊戲的 renderQuestion 處理
  }

  /**
   * judgeAnswer — 由子遊戲負責判斷
   * @param {*} answer
   * @returns {boolean}
   */
  async judgeAnswer(answer) {
    if (this._subGame) {
      return this._subGame.judgeAnswer(answer)
    }
    return false
  }

  /**
   * playCorrectAnimation — 由子遊戲負責
   */
  playCorrectAnimation() {
    this._subGame?.playCorrectAnimation?.()
  }

  /**
   * playWrongAnimation — 由子遊戲負責
   */
  playWrongAnimation() {
    this._subGame?.playWrongAnimation?.()
  }

  /**
   * showCorrectAnswer — 由子遊戲負責
   */
  showCorrectAnswer() {
    this._subGame?.showCorrectAnswer?.()
  }

  /**
   * getHint — 由子遊戲負責
   * useHint 繼承自 GameEngine，consecutiveCorrect 不重置（v4 明確）
   * @param {number} level
   * @returns {string}
   */
  getHint(level) {
    return this._subGame?.getHint?.(level) || ''
  }

  // ─── destroy ─────────────────────────────────────────────────────────────────

  /**
   * 銷毀遊戲：清理計時器、子遊戲、事件監聽
   * 繼承自 GameEngine.destroy()，呼叫 _handleInterrupt()
   */
  destroy() {
    // 清理 bonus 計時器
    clearTimeout(this._bonusToastTimer)
    this._bonusToastTimer = null

    // 銷毀子遊戲
    if (this._subGame) {
      try { this._subGame.destroy() } catch (e) {}
      this._subGame = null
    }

    // 呼叫父類 destroy（包含 _handleInterrupt）
    super.destroy()
  }
}

// ─── 預設匯出 ─────────────────────────────────────────────────────────────────
export default RandomGame
