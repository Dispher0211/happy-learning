/**
 * GameEngine.js — 遊戲共用基底類別
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js、wrong_queue.js、forgetting.js、sync.js
 * 位置：/js/games/GameEngine.js
 *
 * v4：
 *   - skipQuestion()：consecutiveCorrect = 0
 *   - _handleInterrupt()：中斷時 wrongPool 加入 WrongQueue
 *   - _gameCompleted：防止重複執行
 *   - useHint()：不重置 consecutiveCorrect
 *
 * 修正（Bug fix）：
 *   - class 方法結尾移除 `,`（Object literal 語法，在 class 中為 SyntaxError）
 */

import { AppState }        from '../state.js'
import { WrongQueue }      from '../wrong_queue.js'
import { ForgettingCurve } from '../forgetting.js'
import { SyncManager }     from '../sync.js'

// ── 星星發放規則 ──
const GAME_STARS = {
  writing:          { first: 4,   retry: 2   },
  stroke_handwrite: { first: 2,   retry: 1   },
  stroke_choice:    { first: 1,   retry: 0.5 },
  zhuyin:           { first: 2,   retry: 1   },
  polyphone:        { first: 4,   retry: 2   },
  radical:          { first: 1,   retry: 0.5 },
  strokes_count:    { first: 1,   retry: 0.5 },
  typo:             { first: 4,   retry: 2   },
  idiom:            { first: 3,   retry: 0.5 },
  words:            { first: 3,   retry: 0.5 },
  listen:           { first: 1,   retry: 0.5 },
  sentence_mode12:  { first: 4,   retry: 2   },
  sentence_mode34:  { first: 5,   retry: 2.5 },
}

export class GameEngine {

  constructor(gameId, options = {}) {
    this.gameId            = gameId
    this.options           = options
    this.isAnswering       = false
    this.currentRequestId  = 0
    this.attemptCount      = 0
    this.usedHints         = 0
    this.consecutiveCorrect = 0
    this.questions         = []
    this.currentQuestion   = null
    this.questionIndex     = 0
    this.totalQuestions    = 10
    this.wrongPool         = []
    this.sessionStars      = 0
    this._gameCompleted    = false
    this._gameStars        = GAME_STARS[gameId] || { first: 1, retry: 0.5 }
    this._listeners        = []
  }

  // ─────────────────────────────────────────────
  // init
  // ─────────────────────────────────────────────

  async init(config = {}) {
    this.totalQuestions = config.count || 10
    try {
      await this.loadQuestions(config)
    } catch (e) {
      console.error('GameEngine.init loadQuestions 失敗:', e)
      this.questions = []
    }
    if (this.questions.length === 0) {
      globalThis.UIManager?.showToast?.('家長還未設定生字簿，請先新增生字', 'warning', 3000)
      return
    }
    this.questionIndex = 0
    await this.nextQuestion()
  }

  // ─────────────────────────────────────────────
  // loadQuestions（子類別必須 override）
  // ─────────────────────────────────────────────

  async loadQuestions(config) {
    throw new Error(`${this.constructor.name} 必須實作 loadQuestions()`)
  }

  // ─────────────────────────────────────────────
  // nextQuestion
  // ─────────────────────────────────────────────

  async nextQuestion() {
    if (this.questionIndex >= this.questions.length) {
      await this.onGameComplete()
      return
    }
    this.currentQuestion = this.questions[this.questionIndex]
    this.questionIndex++
    this.attemptCount = 0
    this.usedHints    = 0
    this.isAnswering  = false
    this.renderQuestion(this.currentQuestion)
    this.updateProgress()
  }

  // ─────────────────────────────────────────────
  // skipQuestion（v4：重置 consecutiveCorrect）
  // ─────────────────────────────────────────────

  skipQuestion() {
    if (this.currentQuestion) {
      this.questions.push(this.currentQuestion)
    }
    this.consecutiveCorrect = 0   // v4：跳題重置連續計數
    this.usedHints          = 0
    this.nextQuestion()
  }

  // ─────────────────────────────────────────────
  // submitAnswer
  // ─────────────────────────────────────────────

  async submitAnswer(answer) {
    if (this.isAnswering) return
    this.isAnswering = true
    this.attemptCount++

    const reqId = ++this.currentRequestId

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('judgeAnswer timeout')), 8000)
      )

      const result = await Promise.race([
        this.judgeAnswer(answer, this.currentQuestion),
        timeoutPromise,
      ])

      if (reqId !== this.currentRequestId) return

      if (result.correct) {
        await this.onCorrect(result)
      } else {
        if (this.attemptCount === 1) {
          await this.onWrongFirstTime(result)
        } else {
          await this.onWrongSecondTime(result)
        }
      }
    } catch (e) {
      if (reqId !== this.currentRequestId) return
      console.error('GameEngine.submitAnswer 錯誤:', e.message)
      if (this.attemptCount === 1) {
        await this.onWrongFirstTime({ correct: false })
      }
    } finally {
      if (reqId === this.currentRequestId) {
        this.isAnswering = false
      }
    }
  }

  // ─────────────────────────────────────────────
  // onCorrect
  // ─────────────────────────────────────────────

  async onCorrect(result) {
    const char  = this.currentQuestion?.character || this.currentQuestion?.char || ''
    const pron  = this.currentQuestion?.pronunciation || null
    const stars = this.calculateStars(this.attemptCount, this.consecutiveCorrect)
    this.consecutiveCorrect++
    this.sessionStars += stars

    AppState.locks.animation = true
    try {
      await this.playCorrectAnimation(stars)
      await this._addStars(stars)
      if (char) ForgettingCurve.recordResult(char, true, pron).catch(() => {})
      globalThis.PokedexManager?.checkAndReveal?.('star')
    } finally {
      AppState.locks.animation = false
    }

    if (this.options.autoNext !== false) {
      await this.nextQuestion()
    }
  }

  // ─────────────────────────────────────────────
  // onWrongFirstTime
  // ─────────────────────────────────────────────

  async onWrongFirstTime(result) {
    this.consecutiveCorrect = 0
    const char = this.currentQuestion?.character || this.currentQuestion?.char
    if (char && !this.wrongPool.includes(char)) {
      this.wrongPool.push(char)
    }
    await this.playWrongAnimation(result)
    this.isAnswering = false
  }

  // ─────────────────────────────────────────────
  // onWrongSecondTime
  // ─────────────────────────────────────────────

  async onWrongSecondTime(result) {
    const char = this.currentQuestion?.character || this.currentQuestion?.char || ''
    const pron = this.currentQuestion?.pronunciation || null
    if (char) {
      ForgettingCurve.recordResult(char, false, pron).catch(() => {})
      WrongQueue.add(char).catch(() => {})
    }
    await this.showCorrectAnswer(result)
    this.isAnswering = false
  }

  // ─────────────────────────────────────────────
  // calculateStars
  // ─────────────────────────────────────────────

  calculateStars(attempt, consecutive) {
    return attempt === 1
      ? this._gameStars.first
      : this._gameStars.retry
  }

  // ─────────────────────────────────────────────
  // useHint（v4：不重置 consecutiveCorrect）
  // ─────────────────────────────────────────────

  async useHint(level) {
    if (this.usedHints >= 2) return null
    this.usedHints++
    // consecutiveCorrect 不重置（v4 明確規定）
    try {
      const { StarsManager } = await import('../stars.js')
      await StarsManager.spend(0.5)
    } catch (_e) {}
    return this.getHint(level, this.currentQuestion)
  }

  // ─────────────────────────────────────────────
  // updateProgress
  // ─────────────────────────────────────────────

  updateProgress() {
    const total    = this.totalQuestions
    const answered = Math.max(0, this.questionIndex - 1)
    const percent  = total > 0 ? Math.round((answered / total) * 100) : 0
    const el = document.getElementById('game-progress')
    if (el) {
      el.style.width = `${percent}%`
      el.setAttribute('aria-valuenow', answered)
      el.setAttribute('aria-valuemax', total)
    }
  }

  // ─────────────────────────────────────────────
  // onGameComplete
  // ─────────────────────────────────────────────

  async onGameComplete() {
    this._gameCompleted = true
    for (const char of this.wrongPool) {
      try { await WrongQueue.add(char) } catch (_e) {}
    }
    this.wrongPool = []
    globalThis.UIManager?.showToast?.(
      `太棒了！本局共獲得 ★${this.sessionStars}`, 'success', 3000
    )
    setTimeout(() => {
      globalThis.UIManager?.navigate?.('game_list')
    }, 2500)
  }

  // ─────────────────────────────────────────────
  // retryWrongPool
  // ─────────────────────────────────────────────

  retryWrongPool() {
    if (this.wrongPool.length === 0) return
    this.questions = [
      ...this.wrongPool.map(char => ({ ...this.currentQuestion, character: char })),
      ...this.questions.slice(this.questionIndex),
    ]
    this.wrongPool     = []
    this.questionIndex = 0
    this.nextQuestion()
  }

  // ─────────────────────────────────────────────
  // _handleInterrupt（v4 新增）
  // ─────────────────────────────────────────────

  async _handleInterrupt() {
    if (this._gameCompleted) return  // 正常結束不重複執行
    for (const char of this.wrongPool) {
      try { await WrongQueue.add(char) } catch (_e) {}
    }
    this.wrongPool = []
    // 不呼叫 onGameComplete（不結算星星）
  }

  // ─────────────────────────────────────────────
  // destroy
  // ─────────────────────────────────────────────

  destroy() {
    this._handleInterrupt()
    for (const { el, type, handler } of this._listeners) {
      try { el.removeEventListener(type, handler) } catch (_e) {}
    }
    this._listeners      = []
    this.isAnswering     = false
    AppState.locks.animation = false
  }

  // ─────────────────────────────────────────────
  // 工具方法
  // ─────────────────────────────────────────────

  async _addStars(amount) {
    if (amount <= 0) return
    try {
      const { StarsManager } = await import('../stars.js')
      if (AppState.isOnline) {
        await StarsManager.add(amount)
      } else {
        AppState.stars = {
          ...AppState.stars,
          yellow_total:       (AppState.stars.yellow_total       || 0) + amount,
          star_pokedex_count: (AppState.stars.star_pokedex_count || 0) + amount,
        }
        SyncManager.saveOfflineAction({
          type:      'add_stars',
          amount,
          timestamp: Date.now(),
        })
      }
    } catch (e) {
      console.error('GameEngine._addStars 失敗:', e)
    }
  }

  _addEventListener(el, type, handler) {
    el.addEventListener(type, handler)
    this._listeners.push({ el, type, handler })
  }

  // ─────────────────────────────────────────────
  // 抽象方法（子類別 override）
  // ─────────────────────────────────────────────

  renderQuestion(question) {
    throw new Error(`${this.constructor.name} 必須實作 renderQuestion()`)
  }

  judgeAnswer(answer, question) {
    throw new Error(`${this.constructor.name} 必須實作 judgeAnswer()`)
  }

  playCorrectAnimation(stars) { return Promise.resolve() }
  playWrongAnimation(result)  { return Promise.resolve() }
  showCorrectAnswer(result)   { return Promise.resolve() }
  getHint(level, question)    { return null }
}
