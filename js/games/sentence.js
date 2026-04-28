/**
 * 短句造詞 × 拼圖圖鑑 遊戲模組
 * Task 26 — sentence.js
 *
 * 四種模式（比例 15%/15%/35%/35%）：
 *   模式1：填空（選字填入空格）— 直接比對，★+4（首次）
 *   模式2：拖曳排列（字卡排成正確短句）— 直接比對，★+4（首次）
 *   模式3：照樣造句（手寫）— GeminiManager 判斷，★+5（首次）
 *   模式4：造句（給詞，手寫完整句）— GeminiManager 判斷，★+5（首次）
 *
 * 圖鑑觸發：答對短句造詞 → sentence_count +1 → checkAndReveal('sentence')
 * 家長審核：模式3/4 score < 0.8 → pending_review；all_parent 模式全部送審核
 *
 * 依賴模組：
 *   GameEngine.js（T14）、state.js（T02）、firebase.js（T05）
 *   gemini.js（T12.6）、handwriting.js（T12.7）
 *   stars.js（T09）、forgetting.js（T10）、pokedex.js（T12.5）
 *   json_loader.js（T06）、audio.js（T08）、ui_manager.js（T28）
 */

import { GameEngine }        from './GameEngine.js'
import { AppState }          from '../state.js'
import { FirestoreAPI }      from '../firebase.js'
import { GeminiManager }     from '../gemini.js'
import { HandwritingManager } from '../handwriting.js'
import { StarsManager }      from '../stars.js'
import { ForgettingCurve }   from '../forgetting.js'
import { JSONLoader }         from '../json_loader.js'
import { AudioManager }       from '../audio.js'

// ─────────────────────────────────────────────
// 星星設定（參考 SECTION 3.3 GAME_STARS）
// ─────────────────────────────────────────────
const STARS_MODE12 = { first: 4,   retry: 2   }  // 模式1, 2
const STARS_MODE34 = { first: 5,   retry: 2.5 }  // 模式3, 4

// 模式分配比例（累計閾值）
const MODE_THRESHOLDS = [0.15, 0.30, 0.65, 1.00]

export class SentenceGame extends GameEngine {
  constructor() {
    super('sentence')

    // 句子資料庫（sentences.json）
    this._sentences = []

    // 當前題目的模式（1~4）
    this._currentMode = 1

    // 模式3/4：手寫 canvas 參考
    this._canvasEl = null
    this._canvasCtx = null

    // 拖曳排列（模式2）狀態
    this._dragItems  = []    // 已排列的字卡
    this._sourcePool = []    // 待拖曳的字卡池
    this._dragTarget = null  // 目前拖曳中的 DOM 元素

    // 模式1 填空：目前選中的字
    this._selectedFill = null

    // 答題結果快取（供 showCorrectAnswer 使用）
    this._lastResult = null
  }

  // ─────────────────────────────────────────────
  // 載入題目（override GameEngine.loadQuestions）
  // ─────────────────────────────────────────────
  async loadQuestions(config) {
    // 載入 sentences.json（第三波懶載入）
    this._sentences = JSONLoader.get('sentences') || []
    if (this._sentences.length === 0) {
      await JSONLoader.load('sentences')
      this._sentences = JSONLoader.get('sentences') || []
    }

    // 以生字簿篩選（只出現在 my_characters 中的字）
    const myChars = AppState.characters || []
    let pool = myChars.length > 0
      ? this._sentences.filter(s => myChars.includes(s.character))
      : this._sentences

    // 若過濾後沒有題目，退回全庫
    if (pool.length === 0) pool = this._sentences

    // 洗牌取前 config.count 筆
    const count   = config?.count || 10
    const shuffled = this._seededShuffle(pool)
    this.questions = shuffled.slice(0, count).map(s => ({ ...s }))

    if (this.questions.length === 0) {
      throw new Error('沒有可用的短句造詞題目，請先設定生字簿')
    }
  }

  // ─────────────────────────────────────────────
  // 決定本題模式（隨機依比例）
  // ─────────────────────────────────────────────
  _pickMode() {
    const r = Math.random()
    if (r < MODE_THRESHOLDS[0]) return 1
    if (r < MODE_THRESHOLDS[1]) return 2
    if (r < MODE_THRESHOLDS[2]) return 3
    return 4
  }

  // ─────────────────────────────────────────────
  // 渲染題目（override GameEngine.renderQuestion）
  // ─────────────────────────────────────────────
  renderQuestion(question) {
    this._currentMode = this._pickMode()
    this._lastResult   = null
    this._selectedFill = null

    const app = document.getElementById('app')
    if (!app) return

    // 頂部共用：題目資訊
    const modeLabel = ['', '選字填空', '排列字卡', '照樣造句', '看詞造句'][this._currentMode]
    const zhuyinOn  = AppState.settings?.zhuyinOn ?? true

    // 根據模式渲染不同介面
    switch (this._currentMode) {
      case 1: this._renderMode1(app, question, modeLabel, zhuyinOn); break
      case 2: this._renderMode2(app, question, modeLabel, zhuyinOn); break
      case 3: this._renderMode3(app, question, modeLabel, zhuyinOn); break
      case 4: this._renderMode4(app, question, modeLabel, zhuyinOn); break
    }

    // 綁定提示按鈕
    this._bindHintButtons(question)
  }

  // ──────────────────────────────────────────────────
  // 模式1：填空（選字填入空格）
  // ──────────────────────────────────────────────────
  _renderMode1(app, question, modeLabel, zhuyinOn) {
    // 生成錯誤選項（形近字或隨機生字）
    const distractors = this._generateDistractors(question.answer, 3)
    const options     = this._seededShuffle([question.answer, ...distractors])

    // 在句子中把答案位置換成「□」
    const displaySentence = this._buildFillSentence(question, zhuyinOn)

    app.innerHTML = `
      <div class="game-container sentence-game sentence-mode1">
        <div class="game-header">
          <span class="mode-badge">${modeLabel}</span>
          <span class="game-progress">第 ${this.currentIndex + 1} 題 / ${this.questions.length}</span>
        </div>

        <!-- 題目句子 -->
        <div class="sentence-display" id="sentence-display">
          ${displaySentence}
        </div>

        <!-- 選項按鈕 -->
        <div class="fill-options" id="fill-options">
          ${options.map(opt => `
            <button class="fill-option-btn" data-char="${opt}" onclick="window._sentenceGame._onFillSelect('${opt}', this)">
              ${zhuyinOn ? this._wrapZhuyin(opt) : opt}
            </button>
          `).join('')}
        </div>

        <!-- 確認按鈕 -->
        <button class="confirm-btn" id="confirm-btn" onclick="window._sentenceGame._submitFill()" disabled>
          ✓ 確認
        </button>

        <!-- 提示區 -->
        <div class="hint-area" id="hint-area"></div>
        <div class="hint-buttons">
          <button class="hint-btn" id="hint-btn-1" onclick="window._sentenceGame._onHint1()">
            💡 提示一（-0.5★）
          </button>
          <button class="hint-btn" id="hint-btn-2" onclick="window._sentenceGame._onHint2()">
            💡 提示二（-0.5★）
          </button>
        </div>

        <!-- 動畫層 -->
        <div class="anim-overlay" id="anim-overlay"></div>
      </div>
    `

    // 暴露 this 供 inline onclick 使用
    window._sentenceGame = this
  }

  /** 模式1：選字後暫存，啟用確認按鈕 */
  _onFillSelect(char, btn) {
    this._selectedFill = char
    // 清除其他選中狀態
    document.querySelectorAll('.fill-option-btn').forEach(b => b.classList.remove('selected'))
    btn.classList.add('selected')
    const confirmBtn = document.getElementById('confirm-btn')
    if (confirmBtn) confirmBtn.disabled = false
  }

  /** 模式1：確認提交 */
  _submitFill() {
    if (!this._selectedFill) return
    this._doSubmit(this._selectedFill)
  }

  /** 將句子中的答案位置替換為「□」，其餘字依注音開關包裝 */
  _buildFillSentence(question, zhuyinOn) {
    const chars     = question.sentence.split('')
    const positions = question.fill_position || []
    return chars.map((ch, i) => {
      if (positions.includes(i)) {
        return `<span class="fill-blank" id="fill-blank-${i}">□</span>`
      }
      // 生字簿字：純文字；非生字簿字：依注音開關
      const isMyChar = (AppState.characters || []).includes(ch)
      if (isMyChar || !zhuyinOn) return `<span class="sentence-char">${ch}</span>`
      return `<span class="sentence-char zhuyin-char">${this._wrapZhuyin(ch)}</span>`
    }).join('')
  }

  // ──────────────────────────────────────────────────
  // 模式2：拖曳排列（字卡排成正確短句）
  // ──────────────────────────────────────────────────
  _renderMode2(app, question, modeLabel, zhuyinOn) {
    // 將句中的字打散洗牌
    const correctChars = question.correct_orders?.[0] || question.sentence.split('')
    this._dragItems   = []
    this._sourcePool  = this._seededShuffle([...correctChars])

    app.innerHTML = `
      <div class="game-container sentence-game sentence-mode2">
        <div class="game-header">
          <span class="mode-badge">${modeLabel}</span>
          <span class="game-progress">第 ${this.currentIndex + 1} 題 / ${this.questions.length}</span>
        </div>

        <p class="sentence-prompt">把字卡排列成正確的句子：</p>

        <!-- 已排列的字卡槽 -->
        <div class="drag-result-area" id="drag-result-area">
          <p class="drag-hint-text">點選下方字卡，依序加入</p>
        </div>

        <!-- 字卡來源池 -->
        <div class="drag-source-pool" id="drag-source-pool">
          ${this._sourcePool.map((ch, i) => `
            <button class="drag-card" data-index="${i}" data-char="${ch}"
              onclick="window._sentenceGame._onDragCardClick(this)">
              ${ch}
            </button>
          `).join('')}
        </div>

        <!-- 操作按鈕 -->
        <div class="drag-actions">
          <button class="reset-btn" onclick="window._sentenceGame._resetDrag()">↺ 重置</button>
          <button class="confirm-btn" id="confirm-btn" onclick="window._sentenceGame._submitDrag()" disabled>
            ✓ 確認
          </button>
        </div>

        <!-- 提示區 -->
        <div class="hint-area" id="hint-area"></div>
        <div class="hint-buttons">
          <button class="hint-btn" id="hint-btn-1" onclick="window._sentenceGame._onHint1()">💡 提示一（-0.5★）</button>
          <button class="hint-btn" id="hint-btn-2" onclick="window._sentenceGame._onHint2()">💡 提示二（-0.5★）</button>
        </div>

        <div class="anim-overlay" id="anim-overlay"></div>
      </div>
    `
    window._sentenceGame = this
  }

  /** 模式2：點選字卡加入結果區 */
  _onDragCardClick(btn) {
    const ch    = btn.dataset.char
    const idx   = parseInt(btn.dataset.index)
    this._dragItems.push({ ch, idx })
    btn.classList.add('used')
    btn.disabled = true

    // 更新結果區
    const resultArea = document.getElementById('drag-result-area')
    if (resultArea) {
      resultArea.innerHTML = this._dragItems.map((item, pos) => `
        <button class="drag-result-card" data-pos="${pos}"
          onclick="window._sentenceGame._onResultCardClick(${pos})">
          ${item.ch}
        </button>
      `).join('')
    }

    // 全部字卡都放進去才可提交
    const sourceTotal = document.querySelectorAll('.drag-card').length
    if (this._dragItems.length >= sourceTotal) {
      const confirmBtn = document.getElementById('confirm-btn')
      if (confirmBtn) confirmBtn.disabled = false
    }
  }

  /** 模式2：點結果區字卡可移除（退回來源池） */
  _onResultCardClick(pos) {
    const item = this._dragItems[pos]
    if (!item) return
    this._dragItems.splice(pos, 1)

    // 恢復來源池對應按鈕
    const sourceBtn = document.querySelector(`.drag-card[data-index="${item.idx}"]`)
    if (sourceBtn) {
      sourceBtn.classList.remove('used')
      sourceBtn.disabled = false
    }

    // 更新結果區
    const resultArea = document.getElementById('drag-result-area')
    if (resultArea) {
      resultArea.innerHTML = this._dragItems.length === 0
        ? '<p class="drag-hint-text">點選下方字卡，依序加入</p>'
        : this._dragItems.map((it, i) => `
            <button class="drag-result-card" data-pos="${i}"
              onclick="window._sentenceGame._onResultCardClick(${i})">
              ${it.ch}
            </button>
          `).join('')
    }

    const confirmBtn = document.getElementById('confirm-btn')
    if (confirmBtn) confirmBtn.disabled = true
  }

  /** 模式2：重置拖曳狀態 */
  _resetDrag() {
    this._dragItems = []
    document.querySelectorAll('.drag-card').forEach(b => {
      b.classList.remove('used')
      b.disabled = false
    })
    const resultArea = document.getElementById('drag-result-area')
    if (resultArea) resultArea.innerHTML = '<p class="drag-hint-text">點選下方字卡，依序加入</p>'
    const confirmBtn = document.getElementById('confirm-btn')
    if (confirmBtn) confirmBtn.disabled = true
  }

  /** 模式2：提交排列結果 */
  _submitDrag() {
    const answer = this._dragItems.map(i => i.ch).join('')
    this._doSubmit(answer)
  }

  // ──────────────────────────────────────────────────
  // 模式3：照樣造句（手寫）
  // ──────────────────────────────────────────────────
  _renderMode3(app, question, modeLabel, zhuyinOn) {
    app.innerHTML = `
      <div class="game-container sentence-game sentence-mode3">
        <div class="game-header">
          <span class="mode-badge">${modeLabel}</span>
          <span class="game-progress">第 ${this.currentIndex + 1} 題 / ${this.questions.length}</span>
        </div>

        <!-- 句型與範例 -->
        <div class="sentence-pattern-box">
          <p class="pattern-label">句型：</p>
          <p class="pattern-text">${question.example_pattern || ''}</p>
          <p class="example-label">範例：</p>
          <p class="example-text">${question.example_sentence || ''}</p>
        </div>

        <p class="write-prompt">請依照句型照樣造句（手寫）：</p>

        <!-- 手寫區 -->
        <div class="handwriting-area">
          <canvas id="hw-canvas" width="320" height="100"
            style="border:2px solid #aaa; border-radius:8px; background:#fff; touch-action:none;">
          </canvas>
          <div class="hw-actions">
            <button class="undo-btn" onclick="window._sentenceGame._undoStroke()">↩ 撤銷</button>
            <button class="clear-btn" onclick="window._sentenceGame._clearCanvas()">✕ 清除</button>
            <button class="confirm-btn" id="confirm-btn" onclick="window._sentenceGame._submitHandwriting()">
              ✓ 確認
            </button>
          </div>
        </div>

        <!-- 識別結果顯示 -->
        <div class="hw-result" id="hw-result"></div>

        <!-- 提示區 -->
        <div class="hint-area" id="hint-area"></div>
        <div class="hint-buttons">
          <button class="hint-btn" id="hint-btn-1" onclick="window._sentenceGame._onHint1()">💡 提示一（-0.5★）</button>
          <button class="hint-btn" id="hint-btn-2" onclick="window._sentenceGame._onHint2()">💡 提示二（-0.5★）</button>
        </div>

        <div class="anim-overlay" id="anim-overlay"></div>
      </div>
    `
    window._sentenceGame = this
    this._initCanvas()
  }

  // ──────────────────────────────────────────────────
  // 模式4：看詞造句（手寫）
  // ──────────────────────────────────────────────────
  _renderMode4(app, question, modeLabel, zhuyinOn) {
    // 顯示目標生字（帶注音體）
    const charDisplay = zhuyinOn
      ? this._wrapZhuyin(question.character)
      : question.character

    app.innerHTML = `
      <div class="game-container sentence-game sentence-mode4">
        <div class="game-header">
          <span class="mode-badge">${modeLabel}</span>
          <span class="game-progress">第 ${this.currentIndex + 1} 題 / ${this.questions.length}</span>
        </div>

        <!-- 目標字 -->
        <div class="target-char-box">
          <p class="target-label">請用這個字造一個句子：</p>
          <div class="target-char">${charDisplay}</div>
        </div>

        <p class="write-prompt">用「${question.character}」寫出一個完整句子（手寫）：</p>

        <!-- 手寫區 -->
        <div class="handwriting-area">
          <canvas id="hw-canvas" width="320" height="100"
            style="border:2px solid #aaa; border-radius:8px; background:#fff; touch-action:none;">
          </canvas>
          <div class="hw-actions">
            <button class="undo-btn" onclick="window._sentenceGame._undoStroke()">↩ 撤銷</button>
            <button class="clear-btn" onclick="window._sentenceGame._clearCanvas()">✕ 清除</button>
            <button class="confirm-btn" id="confirm-btn" onclick="window._sentenceGame._submitHandwriting()">
              ✓ 確認
            </button>
          </div>
        </div>

        <!-- 識別結果顯示 -->
        <div class="hw-result" id="hw-result"></div>

        <!-- 提示區 -->
        <div class="hint-area" id="hint-area"></div>
        <div class="hint-buttons">
          <button class="hint-btn" id="hint-btn-1" onclick="window._sentenceGame._onHint1()">💡 提示一（-0.5★）</button>
          <button class="hint-btn" id="hint-btn-2" onclick="window._sentenceGame._onHint2()">💡 提示二（-0.5★）</button>
        </div>

        <div class="anim-overlay" id="anim-overlay"></div>
      </div>
    `
    window._sentenceGame = this
    this._initCanvas()
  }

  // ──────────────────────────────────────────────────
  // 手寫 Canvas 初始化
  // ──────────────────────────────────────────────────
  _initCanvas() {
    this._canvasEl = document.getElementById('hw-canvas')
    if (!this._canvasEl) return
    this._canvasCtx = this._canvasEl.getContext('2d')
    HandwritingManager.initCanvas(this._canvasEl, {
      mode: 'chinese',
      lineWidth: 3,
      strokeColor: '#222',
    })
  }

  /** 撤銷最後一筆劃 */
  _undoStroke() {
    HandwritingManager.undoLastStroke()
  }

  /** 清空手寫畫布 */
  _clearCanvas() {
    HandwritingManager.clearCanvas()
  }

  /** 手寫確認：送辨識 → 提交答案 */
  async _submitHandwriting() {
    if (!this._canvasEl) return

    const resultEl = document.getElementById('hw-result')
    if (resultEl) resultEl.textContent = '辨識中⋯'

    try {
      const recognized = await HandwritingManager.recognize(this._canvasEl, { mode: 'chinese' })

      // 辨識失敗（fallback: retry）
      if (recognized?.fallback === 'retry') {
        if (resultEl) resultEl.textContent = '請再寫一次（辨識失敗，不計答錯）'
        HandwritingManager.clearCanvas()
        return
      }

      const text = typeof recognized === 'string' ? recognized : recognized?.result || ''
      if (resultEl) resultEl.textContent = `辨識結果：${text}`

      // 提交答案
      await this._doSubmit(text)
    } catch (err) {
      console.warn('sentence.js 手寫辨識例外', err)
      if (resultEl) resultEl.textContent = '請再寫一次'
      HandwritingManager.clearCanvas()
    }
  }

  // ──────────────────────────────────────────────────
  // 統一提交入口（呼叫 GameEngine.submitAnswer）
  // ──────────────────────────────────────────────────
  async _doSubmit(answer) {
    await this.submitAnswer(answer)
  }

  // ──────────────────────────────────────────────────
  // judgeAnswer（override GameEngine.judgeAnswer）
  // 回傳 { correct: bool, score: number, needReview: bool }
  // ──────────────────────────────────────────────────
  async judgeAnswer(answer, question) {
    const mode = this._currentMode

    // 模式1：直接字元比對
    if (mode === 1) {
      const correct = answer.trim() === question.answer
      return { correct, score: correct ? 1 : 0, needReview: false }
    }

    // 模式2：比對排列結果（對照所有合法排列）
    if (mode === 2) {
      const validOrders = question.correct_orders || [question.sentence.split('')]
      const correct = validOrders.some(order => order.join('') === answer)
      return { correct, score: correct ? 1 : 0, needReview: false }
    }

    // 模式3/4：GeminiManager 判斷
    if (mode === 3 || mode === 4) {
      const reviewMode = AppState.settings?.parent_review_mode || 'notify'

      // all_parent 模式：全部送審核，不呼叫 Gemini
      if (reviewMode === 'all_parent') {
        return { correct: false, score: -1, needReview: true }
      }

      // all_ai 模式：全部 AI 判斷，不送審核
      const geminiResult = await GeminiManager.judgeAnswer(question, answer, mode)
      const score        = geminiResult?.score ?? 0

      if (reviewMode === 'all_ai') {
        return { correct: score >= 0.8, score, needReview: false }
      }

      // notify 模式（預設）：score >= 0.8 直接通過，否則送審核
      const needReview = score < 0.8
      return { correct: score >= 0.8, score, needReview }
    }

    return { correct: false, score: 0, needReview: false }
  }

  // ──────────────────────────────────────────────────
  // onCorrect（override）：答對後的處理
  // ──────────────────────────────────────────────────
  async onCorrect(result) {
    const mode        = this._currentMode
    const starConfig  = (mode === 3 || mode === 4) ? STARS_MODE34 : STARS_MODE12
    const starsEarned = this.calculateStars(this.attemptCount, this.consecutiveCorrect, starConfig)

    // 播放答對音效
    AudioManager.playEffect('correct').catch(() => {})

    // 增加遺忘曲線記錄
    const char = this.currentQuestion.character
    if (char) {
      ForgettingCurve.recordResult(char, true).catch(() => {})
    }

    // 發星星
    await StarsManager.add(starsEarned)

    // 圖鑑計數：sentence_count +1 → checkAndReveal
    const uid      = AppState.uid
    const seriesId = AppState.pokedex?.active_series || 'pokemon'
    if (uid) {
      try {
        await FirestoreAPI.incrementField(
          `users/${uid}`,
          `pokedex.${seriesId}.sentence_count`,
          1
        )
      } catch (e) {
        console.warn('sentence.js: incrementField sentence_count 失敗', e)
      }
    }

    // 觸發圖鑑揭曉檢查（PokedexManager 後期繫結，避免循環依賴）
    try {
      await globalThis.PokedexManager?.checkAndReveal?.('sentence')
    } catch (e) {
      console.warn('sentence.js: checkAndReveal 失敗', e)
    }

    // 播放答對動畫
    await this.playCorrectAnimation(starsEarned)

    // 連續答對 +1（GameEngine 繼承）
    this.consecutiveCorrect++

    // 連續模式：自動進下一題
    if (this._continuous) {
      await this.nextQuestion()
    } else {
      this._showNextButton()
    }
  }

  // ──────────────────────────────────────────────────
  // 需要家長審核的處理
  // ──────────────────────────────────────────────────
  async _handlePendingReview(answer, question, score) {
    const mode = this._currentMode
    const uid  = AppState.uid
    if (!uid) return

    const expectedStars = this.attemptCount <= 1
      ? STARS_MODE34.first
      : STARS_MODE34.retry

    const reviewData = {
      type:           mode === 3 ? 'sentence_pattern' : 'sentence_free',
      question:       mode === 3
        ? `句型：${question.example_pattern} 範例：${question.example_sentence}`
        : `用「${question.character}」造句`,
      answer:         answer,
      corrected_answer: null,
      ai_score:       score,         // all_parent 模式傳 -1
      status:         'pending',
      expected_stars: expectedStars,
      game_id:        'sentence',
      character:      question.character || '',
      pronunciation:  null,
    }

    try {
      await FirestoreAPI.addPendingReview(reviewData)
      AppState.pendingReviewCount = (AppState.pendingReviewCount || 0) + 1
      globalThis.UIManager?.showToast?.('已暫存，等家長確認 👪', 'info')
    } catch (e) {
      console.warn('sentence.js: addPendingReview 失敗', e)
    }

    // 進下一題（送審後繼續答題）
    this._showNextButton()
  }

  // ──────────────────────────────────────────────────
  // submitAnswer（override GameEngine.submitAnswer）
  // 包含審核邏輯分支
  // ──────────────────────────────────────────────────
  async submitAnswer(answer) {
    if (this.isAnswering) return
    this.isAnswering = true

    const reqId   = ++this.currentRequestId
    const question = this.currentQuestion

    try {
      // 8秒超時保護
      const judgePromise   = this.judgeAnswer(answer, question)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('答題超時')), 8000)
      )
      const result = await Promise.race([judgePromise, timeoutPromise])

      // 過期請求丟棄
      if (reqId !== this.currentRequestId) return

      this._lastResult = { ...result, answer }

      const mode = this._currentMode

      // ─── 模式3/4 需審核路徑 ───
      if ((mode === 3 || mode === 4) && result.needReview) {
        this.isAnswering = false
        await this._handlePendingReview(answer, question, result.score)
        return
      }

      if (result.correct) {
        // 答對
        this.attemptCount++
        this.isAnswering = false
        await this.onCorrect(result)
      } else {
        // 答錯
        if (this.attemptCount === 0) {
          // 第一次錯
          this.attemptCount++
          this.consecutiveCorrect = 0
          this.isAnswering = false
          if (!this.wrongPool.includes(question.character)) {
            this.wrongPool.push(question.character)
          }
          await this.onWrongFirstTime(result)
        } else {
          // 第二次錯
          this.isAnswering = false
          await this.onWrongSecondTime(result)
        }
      }
    } catch (err) {
      console.error('sentence.js submitAnswer 失敗', err)
      this.isAnswering = false
    }
  }

  // ──────────────────────────────────────────────────
  // 答對動畫（playCorrectAnimation）
  // ──────────────────────────────────────────────────
  async playCorrectAnimation(stars) {
    const overlay = document.getElementById('anim-overlay')
    if (!overlay) return

    // 產生飛星動畫
    overlay.innerHTML = `
      <div class="correct-anim">
        <div class="star-burst">✨</div>
        <div class="stars-earned">+${stars}★</div>
        ${Array.from({ length: Math.ceil(stars) }, (_, i) => `
          <div class="flying-star" style="
            left: ${30 + i * 15}%;
            animation-delay: ${i * 0.1}s
          ">★</div>
        `).join('')}
      </div>
    `

    // 等動畫播完
    await new Promise(r => setTimeout(r, 900))
    overlay.innerHTML = ''
  }

  // ──────────────────────────────────────────────────
  // 答錯動畫（playWrongAnimation）
  // ──────────────────────────────────────────────────
  async playWrongAnimation(result) {
    AudioManager.playEffect('wrong').catch(() => {})
    const container = document.querySelector('.game-container')
    if (container) {
      container.classList.add('shake-anim')
      await new Promise(r => setTimeout(r, 500))
      container.classList.remove('shake-anim')
    }

    // 模式3/4 手寫：清空畫布
    if (this._currentMode === 3 || this._currentMode === 4) {
      HandwritingManager.clearCanvas()
    }

    // 顯示「再試一次」提示
    const hintArea = document.getElementById('hint-area')
    if (hintArea) {
      hintArea.innerHTML = `<p class="wrong-msg">❌ 再試一次！</p>`
      setTimeout(() => { if (hintArea) hintArea.innerHTML = '' }, 1500)
    }

    // 重置填空/排列選擇
    if (this._currentMode === 1) {
      this._selectedFill = null
      document.querySelectorAll('.fill-option-btn').forEach(b => b.classList.remove('selected'))
      const confirmBtn = document.getElementById('confirm-btn')
      if (confirmBtn) confirmBtn.disabled = true
    }
    if (this._currentMode === 2) {
      this._resetDrag()
    }
  }

  // ──────────────────────────────────────────────────
  // 顯示正確答案（showCorrectAnswer）
  // ──────────────────────────────────────────────────
  showCorrectAnswer(result) {
    const question = this.currentQuestion
    const hintArea = document.getElementById('hint-area')
    if (!hintArea) return

    let correctDisplay = ''
    switch (this._currentMode) {
      case 1:
        correctDisplay = `正確答案是「${question.answer}」`
        break
      case 2:
        correctDisplay = `正確排列：${(question.correct_orders?.[0] || []).join('')}`
        break
      case 3:
        correctDisplay = `句型：${question.example_pattern}<br>範例：${question.example_sentence}`
        break
      case 4:
        correctDisplay = `需要正確使用「${question.character}」造完整句子`
        break
    }

    hintArea.innerHTML = `
      <div class="correct-answer-box">
        <p class="correct-label">💡 正確答案</p>
        <p class="correct-content">${correctDisplay}</p>
      </div>
    `

    this._showNextButton()
  }

  // ──────────────────────────────────────────────────
  // 第一次答錯的回呼
  // ──────────────────────────────────────────────────
  async onWrongFirstTime(result) {
    await this.playWrongAnimation(result)
    ForgettingCurve.recordResult(
      this.currentQuestion.character, false
    ).catch(() => {})
  }

  // ──────────────────────────────────────────────────
  // 第二次答錯的回呼
  // ──────────────────────────────────────────────────
  async onWrongSecondTime(result) {
    await this.playWrongAnimation(result)
    ForgettingCurve.recordResult(
      this.currentQuestion.character, false
    ).catch(() => {})
    // 加入錯題池（GameEngine 父類別的 wrongPool 已在第一次時加了，
    // 此處不重複加，但確保存在）
    if (!this.wrongPool.includes(this.currentQuestion.character)) {
      this.wrongPool.push(this.currentQuestion.character)
    }
    this.showCorrectAnswer(result)
  }

  // ──────────────────────────────────────────────────
  // 提示（getHint）
  // 模式1/2：提示一=句型說明；提示二=範例
  // 模式3：提示一=句型參考；提示二=再看範例
  // 模式4：提示一=字義；提示二=範例用法
  // ──────────────────────────────────────────────────
  getHint(level, question) {
    const mode = this._currentMode

    if (mode === 1 || mode === 2) {
      if (level === 1) return `提示：這題句子的意思是「${question.sentence}」`
      if (level === 2) return `再看一次：正確的字是 ${question.answer} 的相關字`
    }

    if (mode === 3) {
      if (level === 1) return `句型是：${question.example_pattern}`
      if (level === 2) return `範例是：${question.example_sentence}`
    }

    if (mode === 4) {
      if (level === 1) return `「${question.character}」的意思是：試著在句子中使用它`
      if (level === 2) return `參考範例：${question.example_sentence || '他每天學習'}`
    }

    return ''
  }

  // ──────────────────────────────────────────────────
  // 提示按鈕處理
  // ──────────────────────────────────────────────────
  _onHint1() { this.useHint(1) }
  _onHint2() { this.useHint(2) }

  /** 綁定提示按鈕（在 renderQuestion 後呼叫，更新提示內容顯示） */
  _bindHintButtons(question) {
    // 提示內容在 useHint 呼叫 getHint 時顯示到 hint-area
    // 此處僅確保按鈕存在（已由 innerHTML 建立）
  }

  // ──────────────────────────────────────────────────
  // 提示使用（override GameEngine.useHint）
  // ──────────────────────────────────────────────────
  useHint(level) {
    if (this.usedHints >= 2) return  // 最多2次
    if (level > this.usedHints + 1) return

    this.usedHints++
    const hintText = this.getHint(level, this.currentQuestion)

    // 扣半星（只扣 yellow_total，不影響 star_pokedex_count）
    StarsManager.spend(0.5).catch(() => {})

    // 顯示提示文字
    const hintArea = document.getElementById('hint-area')
    if (hintArea) {
      hintArea.innerHTML = `<div class="hint-content">💡 ${hintText}</div>`
    }

    // 停用已使用的提示按鈕
    const btn = document.getElementById(`hint-btn-${level}`)
    if (btn) {
      btn.disabled = true
      btn.textContent = `💡 提示${level === 1 ? '一' : '二'}（已使用）`
    }
    if (level === 2) {
      const btn2 = document.getElementById('hint-btn-2')
      if (btn2) btn2.disabled = true
    }

    // consecutiveCorrect 不重置（v4 規格明確）
  }

  // ──────────────────────────────────────────────────
  // 顯示「下一題」按鈕
  // ──────────────────────────────────────────────────
  _showNextButton() {
    const overlay = document.getElementById('anim-overlay')
    if (!overlay) return

    // 避免重複建立
    if (document.getElementById('next-btn')) return

    const btn = document.createElement('button')
    btn.id        = 'next-btn'
    btn.className = 'next-btn'
    btn.textContent = '下一題 →'
    btn.onclick = () => this.nextQuestion()
    overlay.appendChild(btn)
  }

  // ──────────────────────────────────────────────────
  // 計算星星（含 attemptCount）
  // ──────────────────────────────────────────────────
  calculateStars(attemptCount, consecutiveCorrect, starConfig) {
    const cfg    = starConfig || ((this._currentMode >= 3) ? STARS_MODE34 : STARS_MODE12)
    const earned = attemptCount <= 1 ? cfg.first : cfg.retry
    // consecutiveCorrect bonus 只有 random.js 處理
    return earned
  }

  // ──────────────────────────────────────────────────
  // 生成干擾選項（模式1）
  // ──────────────────────────────────────────────────
  _generateDistractors(correct, count) {
    const allChars = AppState.characters || []
    const pool     = allChars.filter(c => c !== correct)

    // 補充不足時從固定集合取
    const fallback = ['大','小','上','下','好','人','水','山','日','月']
      .filter(c => c !== correct && !pool.includes(c))
    const combined = [...pool, ...fallback]

    const result = []
    const shuffled = this._seededShuffle(combined)
    for (const c of shuffled) {
      if (result.length >= count) break
      result.push(c)
    }

    // 不足時補 X
    while (result.length < count) result.push('？')
    return result
  }

  // ──────────────────────────────────────────────────
  // 包裝注音體（使用 BpmfIVS 字體 CSS class）
  // ──────────────────────────────────────────────────
  _wrapZhuyin(char) {
    // 以 CSS class 觸發 BpmfIVS 注音體渲染
    return `<span class="bpmf-char">${char}</span>`
  }

  // ──────────────────────────────────────────────────
  // 日期 seed 洗牌（使用 UTC 日期，跨時區一致）
  // ──────────────────────────────────────────────────
  _seededShuffle(arr) {
    const copy   = [...arr]
    const seed   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    let   s      = parseInt(seed, 10) % 2147483647

    const rand = () => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  // ──────────────────────────────────────────────────
  // destroy（override GameEngine.destroy）
  // ──────────────────────────────────────────────────
  destroy() {
    // 呼叫父類別 _handleInterrupt（中斷時 wrongPool 加入 WrongQueue）
    super.destroy?.()

    // 清除手寫 Canvas 監聽器
    if (this._canvasEl) {
      HandwritingManager.cleanup?.()
      this._canvasEl = null
      this._canvasCtx = null
    }

    // 清除全域參照
    if (window._sentenceGame === this) {
      delete window._sentenceGame
    }
  }
}

// ─────────────────────────────────────────────
// 工廠函式（供 GamePage.js 呼叫）
// ─────────────────────────────────────────────
export function createSentenceGame() {
  return new SentenceGame()
}
