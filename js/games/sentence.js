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
import { toTextArray, getActiveItems, getPriorityKeySet } from '../content_filter.js'

// ─────────────────────────────────────────────
// 星星設定（參考 SECTION 3.3 GAME_STARS）
// ─────────────────────────────────────────────
const STARS_MODE12 = { first: 4,   retry: 2   }  // 模式1, 2
const STARS_MODE34 = { first: 5,   retry: 2.5 }  // 模式3, 4

// 模式分配比例（累計閾值）
const MODE_THRESHOLDS = [0.15, 0.30, 0.65, 1.00]

export class SentenceGame extends GameEngine {
  constructor(options = {}) {
    super('sentence', options)

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
    // 1. 確保 sentences 索引已載入（wave3）
    const index = JSONLoader.get('sentences')
    if (!index || !index.char_book || Object.keys(index.char_book).length === 0) {
      await JSONLoader.wave3('sentences')
    }

    // 2. 確定要用哪些字（生字簿優先，否則用索引全部字）
    // AppState.characters 可能是字串陣列或物件陣列 { 字, zhuyin }，統一取純字串
    // v4.3：過濾「暫停」生字；「優先」生字排在最前面
    const myChars = toTextArray(AppState.characters || [], ['字', 'char'])
    const priorityCharSet = getPriorityKeySet(AppState.characters || [], ['字', 'char'])
    const indexData = JSONLoader.get('sentences')
    const allIndexChars = Object.keys(indexData?.char_book || {})
    const targetChars = myChars.length > 0
      ? myChars.filter(c => allIndexChars.includes(c))
      : allIndexChars

    // 3. 若沒有符合索引的字，退回全部索引字
    const charList = targetChars.length > 0 ? targetChars : allIndexChars

    // 4. 載入所有需要的冊次 fill + compose 資料
    await Promise.all(charList.map(c => JSONLoader.loadSentencesForChar(c).catch(() => {})))

    // 5. 也載入句型庫（模式3用）
    await JSONLoader.loadPattern()

    // 6. 收集所有可用題目（fill + compose）
    const fillPool    = []
    const composePool = []
    for (const char of charList) {
      const data = JSONLoader.getSentenceData(char)
      for (const f of (data.fill || [])) {
        fillPool.push({ ...f, _type: 'fill' })
      }
      for (const c of (data.compose || [])) {
        composePool.push({ ...c, _type: 'compose' })
      }
    }

    // 句型庫（模式3）：與 character 無關，整體取
    // 家長自訂句型（my_sentence_patterns）優先；若家長未新增任何句型，才使用 sentences_pattern.json
    // v4.3：過濾「暫停」句型；「優先」句型排在最前面
    const customPatterns = getActiveItems(AppState.sentencePatterns || [])
    const priorityPatternIds = getPriorityKeySet(AppState.sentencePatterns || [], ['id'])
    const patternSource = customPatterns.length > 0
      ? customPatterns
      : (JSONLoader.get('sentences_pattern') || [])
    const patternPool = patternSource.map(p => ({
      ...p,
      _type:           'pattern',
      character:       p.character || '',
      example_pattern: p.template,
      example_sentence: p.example,
    }))

    // 7. 依四種模式比例組合題目
    const count = config?.count || 10

    // isRandomMode（count=1）：隨機選一個模式出1題
    let n1, n2, n3, n4
    if (count <= 1) {
      const modeIdx = Math.floor(Math.random() * 4)
      n1 = modeIdx === 0 ? 1 : 0
      n2 = modeIdx === 1 ? 1 : 0
      n3 = modeIdx === 2 ? 1 : 0
      n4 = modeIdx === 3 ? 1 : 0
    } else {
      n1 = Math.max(1, Math.round(count * 0.15))   // 模式1 fill
      n2 = Math.max(1, Math.round(count * 0.15))   // 模式2 fill
      n3 = Math.max(1, Math.round(count * 0.35))   // 模式3 pattern
      n4 = count - n1 - n2 - n3                    // 模式4 compose
    }

    const pick = (pool, n, prioritySet = null, keyFn = (x) => x.character) => {
      if (pool.length === 0) return []
      // v4.3：有優先項目時，優先項目（分別洗牌後）排在前面，提高被選中機率
      if (prioritySet && prioritySet.size > 0) {
        const priorityItems = pool.filter(item => prioritySet.has(keyFn(item)))
        const normalItems   = pool.filter(item => !prioritySet.has(keyFn(item)))
        const s = [
          ...this._seededShuffle([...priorityItems]),
          ...this._seededShuffle([...normalItems]),
        ]
        return s.slice(0, Math.min(n, s.length))
      }
      const s = this._seededShuffle([...pool])
      return s.slice(0, Math.min(n, s.length))
    }

    const mode1q = pick(fillPool, n1, priorityCharSet, q => q.character).map(q => ({ ...q, _mode: 1 }))
    const mode2q = pick(fillPool, n2, priorityCharSet, q => q.character).map(q => ({ ...q, _mode: 2 }))
    const mode3q = pick(patternPool, n3, priorityPatternIds, q => q.id).map(q => ({ ...q, _mode: 3 }))
    const mode4q = pick(composePool, n4, priorityCharSet, q => q.character).map(q => ({ ...q, _mode: 4 }))

    // 合併並洗牌
    const combined = this._seededShuffle([...mode1q, ...mode2q, ...mode3q, ...mode4q])
    this.questions = combined

    if (this.questions.length === 0) {
      throw new Error('沒有可用的短句造詞題目，請先設定生字簿或補充句子資料')
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
    this._currentMode = question._mode || this._pickMode()
    this._lastResult   = null
    this._selectedFill = null

    const app = this._getContainer()
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
          <span class="game-progress">第 ${this.questionIndex} 題 / ${this.questions.length}</span>
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
      // 句子本體只顯示大漢字，不加注音（避免 pv2 縮小字體）
      return `<span class="sentence-char">${ch}</span>`
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
          <span class="game-progress">第 ${this.questionIndex} 題 / ${this.questions.length}</span>
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
          <span class="game-progress">第 ${this.questionIndex} 題 / ${this.questions.length}</span>
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
          <canvas id="hw-canvas" width="560" height="280"
            style="border:2px solid #aaa; border-radius:8px; background:#fff; touch-action:none; width:100%; max-width:560px;">
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
          <span class="game-progress">第 ${this.questionIndex} 題 / ${this.questions.length}</span>
        </div>

        <!-- 目標字 -->
        <div class="target-char-box">
          <p class="target-label">請用這個字造一個句子：</p>
          <div class="target-char">${charDisplay}</div>
        </div>

        <p class="write-prompt">用「${question.character}」寫出一個完整句子（手寫）：</p>

        <!-- 手寫區 -->
        <div class="handwriting-area">
          <canvas id="hw-canvas" width="560" height="280"
            style="border:2px solid #aaa; border-radius:8px; background:#fff; touch-action:none; width:100%; max-width:560px;">
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

    // 清除舊監聽器
    this._removeCanvasListeners?.()

    // 筆劃狀態
    this._isDrawing    = false
    this._currentStroke = null
    HandwritingManager.clearStrokes()

    const canvas = this._canvasEl
    const ctx    = this._canvasCtx

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width  / rect.width
      const scaleY = canvas.height / rect.height
      const src = e.touches ? e.touches[0] : e
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top)  * scaleY,
      }
    }

    const onStart = (e) => {
      e.preventDefault()
      this._isDrawing = true
      const pos = getPos(e)
      this._currentStroke = { points: [pos] }
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
      ctx.strokeStyle = '#222'
      ctx.lineWidth   = 4
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
    }

    const onMove = (e) => {
      if (!this._isDrawing) return
      e.preventDefault()
      const pos = getPos(e)
      this._currentStroke.points.push(pos)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
    }

    const onEnd = (e) => {
      if (!this._isDrawing) return
      e.preventDefault()
      this._isDrawing = false
      if (this._currentStroke?.points?.length > 1) {
        HandwritingManager.recordStroke(this._currentStroke)
      }
      this._currentStroke = null
      ctx.beginPath()
    }

    canvas.addEventListener('mousedown',  onStart)
    canvas.addEventListener('mousemove',  onMove)
    canvas.addEventListener('mouseup',    onEnd)
    canvas.addEventListener('mouseleave', onEnd)
    canvas.addEventListener('touchstart', onStart, { passive: false })
    canvas.addEventListener('touchmove',  onMove,  { passive: false })
    canvas.addEventListener('touchend',   onEnd)

    this._removeCanvasListeners = () => {
      canvas.removeEventListener('mousedown',  onStart)
      canvas.removeEventListener('mousemove',  onMove)
      canvas.removeEventListener('mouseup',    onEnd)
      canvas.removeEventListener('mouseleave', onEnd)
      canvas.removeEventListener('touchstart', onStart)
      canvas.removeEventListener('touchmove',  onMove)
      canvas.removeEventListener('touchend',   onEnd)
    }
  }

  /** 撤銷最後一筆劃 */
  _undoStroke() {
    HandwritingManager.undoLastStroke()
    // 重繪 canvas
    const canvas = this._canvasEl
    const ctx    = this._canvasCtx
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#222'
    ctx.lineWidth   = 4
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    for (const stroke of HandwritingManager._strokeStack) {
      const pts = stroke.points || []
      if (pts.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
    }
  }

  /** 清空手寫畫布 */
  _clearCanvas() {
    HandwritingManager.clearStrokes()
    const canvas = this._canvasEl
    const ctx    = this._canvasCtx
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  /** 手寫確認：模式3/4 一律送家長審核，不需 AI 辨識，直接截圖送出 */
  async _submitHandwriting() {
    if (!this._canvasEl) return

    // 模式3/4：不需辨識，直接以 canvas base64 當作答案內容，送家長審核
    // （家長在審核頁面看到題目和 canvas 截圖即可判斷）
    const resultEl = document.getElementById('hw-result')
    if (resultEl) resultEl.textContent = '準備送出⋯'

    // 確認畫布有內容（至少有一筆劃）
    if (!HandwritingManager._strokeStack || HandwritingManager._strokeStack.length === 0) {
      if (resultEl) resultEl.textContent = '⚠️ 請先在畫布上寫字'
      return
    }

    // 用 canvas dataURL 作為 answer（家長審核時顯示圖片）
    const imageData = this._canvasEl.toDataURL('image/png')
    if (resultEl) resultEl.textContent = '已送出，等家長確認 👪'

    await this._doSubmit(imageData)
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

    // 模式3/4：一律交家長審核（不呼叫 Gemini）
    if (mode === 3 || mode === 4) {
      return { correct: false, score: -1, needReview: true }
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

    // 發星星（stars.js 內部已停用 onStarsAdded star 路徑，統一由此處觸發）
    await StarsManager.add(starsEarned)

    // 圖鑑計數：sentence_count +1（本機樂觀更新 + Firestore 持久化）
    const seriesId = AppState.pokedex?.active_series || 'pokemon'
    if (!AppState.pokedex[seriesId]) AppState.pokedex[seriesId] = {}
    AppState.pokedex[seriesId].sentence_count =
      (AppState.pokedex[seriesId].sentence_count || 0) + 1
    // Firestore 非同步寫入（fire-and-forget，不阻塞 UI）
    if (AppState.uid) {
      FirestoreAPI.incrementField(
        `users/${AppState.uid}`,
        `pokedex.${seriesId}.sentence_count`,
        1
      ).catch(e => console.warn('sentence.js: incrementField sentence_count 失敗', e))
    }

    // 觸發圖鑑揭曉檢查（sentence 路徑，閾值15題）
    // star 路徑已由 StarsManager.add → onStarsAdded → checkAndReveal('star') 串接
    // _isRevealing 鎖確保兩條路徑不同時執行
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
      // 欄位名稱與 ParentReviewPage 對齊
      type:             mode === 3 ? 'sentence_pattern' : 'sentence_free',
      game_id:          'sentence',
      game_mode:        mode,                          // ParentReviewPage 用 r.game_mode
      character:        question.character || '',
      pronunciation:    null,
      // 模式3 句型欄位
      example_pattern:  mode === 3 ? (question.example_pattern || '') : '',
      example_sentence: mode === 3 ? (question.example_sentence || question.example || '') : '',
      // 學生答案
      student_answer:   answer,                        // ParentReviewPage 用 r.student_answer
      corrected_answer: null,
      ai_score:         -1,                            // 不送 AI，標示未評
      status:           'pending',
      expected_stars:   expectedStars,
      stars_given:      false,                         // 發過星星後設 true
    }

    try {
      await FirestoreAPI.addPendingReview(reviewData)
      AppState.pendingReviewCount = (AppState.pendingReviewCount || 0) + 1
    } catch (e) {
      console.warn('sentence.js: addPendingReview 失敗', e)
    }

    // 顯示家長審核橫幅（明顯，置於題目頂部）
    this._showParentReviewBanner(answer)
  }

  /** 顯示家長審核橫幅 */
  _showParentReviewBanner(answer) {
    // 移除舊橫幅
    const old = document.getElementById('parent-review-banner')
    if (old) old.remove()

    const banner = document.createElement('div')
    banner.id = 'parent-review-banner'
    banner.className = 'parent-review-banner'
    banner.innerHTML = `
      <div class="prb-icon">👪</div>
      <div class="prb-text">
        <strong>已記錄！等家長確認</strong>
        <span>家長審核後，星星會在下次登入時發放 ⭐</span>
      </div>
    `
    // 插入 game-container 頂部
    const container = document.querySelector('.game-container')
    if (container) container.insertBefore(banner, container.firstChild)

    // 進下一題
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
      // 手寫模式（模式3/4）需要辨識+AI判斷，給較長時間
      const timeoutMs = (this._currentMode === 3 || this._currentMode === 4) ? 35000 : 8000
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('答題超時')), timeoutMs)
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
      // 超時或辨識失敗時顯示友善提示
      const hw = document.getElementById('hw-result')
      if (hw) hw.textContent = '⚠️ 辨識逾時，請重新書寫後再試一次'
      const confirmBtn = document.getElementById('confirm-btn')
      if (confirmBtn) confirmBtn.disabled = false
    }
  }

  // ──────────────────────────────────────────────────
  // 答對動畫（playCorrectAnimation）
  // ──────────────────────────────────────────────────
  async playCorrectAnimation(stars) {
    // 星星飛行動畫由 GameEngine._addStars() → StarsManager.add() → _flyStarsAnimation() 處理
    // 此處只播放答對音效並短暫等待，不再顯示靜態 +N★ 文字
    AudioManager.playEffect('correct').catch(() => {})
    await new Promise(r => setTimeout(r, 400))
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
      this._clearCanvas()
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

  // ──────────────────────────────────────────────────
  // pv2 直式注音渲染（與 typo.js 一致）
  // ──────────────────────────────────────────────────
  _renderZhuyinPv2(pron) {
    if (!pron) return ''
    const INITIALS = new Set('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ')
    const MEDIALS  = new Set('ㄧㄨㄩ')
    const TONES    = new Set(['ˊ','ˇ','ˋ','˙'])
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
    let src = pron, tone = ''
    if (src.startsWith('˙')) { tone = '˙'; src = src.slice(1) }
    else if (src.length > 0 && TONES.has(src[src.length-1])) {
      tone = src[src.length-1]; src = src.slice(0,-1)
    }
    let initial = '', medial = '', final = ''
    for (const ch of src) {
      if (INITIALS.has(ch)) initial = ch
      else if (MEDIALS.has(ch)) medial = ch
      else final += ch
    }
    const count   = [initial, medial, final].filter(Boolean).length
    const hasDot  = tone === '˙'
    const dotHtml = hasDot ? `<span class="pv2-dot">${esc(tone)}</span>` : ''
    const toneHtml = (tone && !hasDot)
      ? `<span class="pv2-tone">${esc(tone)}</span>`
      : `<span class="pv2-tone pv2-empty"></span>`
    const toneCol = `<span class="pv2-tone-col"><span class="pv2-empty pv2-tone-spacer"></span>${toneHtml}<span class="pv2-empty pv2-tone-spacer"></span></span>`
    const dotCls  = hasDot ? ' pv2--dot' : ''
    if (count <= 1) {
      const sym = initial || medial || final || src
      return `<span class="pv2 pv2-a${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1 pv2-empty"></span><span class="pv2-r2">${esc(sym)}</span><span class="pv2-r3 pv2-empty"></span></span>${toneCol}</span>`
    }
    if (count === 2) {
      const slots = [initial, medial, final].filter(Boolean)
      return `<span class="pv2 pv2-b${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1">${esc(slots[0])}</span><span class="pv2-r2 pv2-empty"></span><span class="pv2-r3">${esc(slots[1])}</span></span>${toneCol}</span>`
    }
    return `<span class="pv2 pv2-c${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1">${esc(initial)}</span><span class="pv2-r2">${esc(medial)}</span><span class="pv2-r3">${esc(final)}</span></span>${toneCol}</span>`
  }

  // ──────────────────────────────────────────────────
  // 從 characters.json 快取查詢字的部首與注音
  // ──────────────────────────────────────────────────
  _getCharInfo(char) {
    const allChars = JSONLoader.get('characters') || []
    const entry = Array.isArray(allChars) ? allChars.find(c => c['字'] === char) : null
    if (!entry) return { radical: null, zhuyin: null, _words: [] }
    const zhuyin = entry.pronunciations?.[0]?.zhuyin || null
    const _words = entry.pronunciations?.[0]?.words || []
    return { radical: entry.radical || null, zhuyin, _words }
  }

  // 提示（getHint）
  // 模式1/2：提示一=句型說明；提示二=範例
  // 模式3：提示一=句型參考；提示二=再看範例
  // 模式4：提示一=字義；提示二=範例用法
  // ──────────────────────────────────────────────────
  getHint(level, question) {
    const mode = this._currentMode

    if (mode === 1) {
      const { radical, zhuyin } = this._getCharInfo(question.answer)
      if (level === 1) {
        const radStr = radical ? `<span class="hint-big-char">${radical}</span>` : `-`
        return { html: `<div class="hint-radical">🔍 部首：${radStr}</div>` }
      }
      if (level === 2) {
        const zhuyinHtml = zhuyin
          ? `<span class="hint-zhuyin-wrap">${this._renderZhuyinPv2(zhuyin)}</span>`
          : question.answer
        return { html: `<div class="hint-zhuyin">🔊 注音：${zhuyinHtml}</div>` }
      }
    }

    if (mode === 2) {
      const chars = question.correct_orders?.[0] || question.sentence.split('')
      if (level === 1) {
        // 提示一：每個字的部首
        const radicals = chars.map(ch => {
          const info = this._getCharInfo(ch)
          return `<span class="hint-radical-item"><span class="hint-radical-val">${info.radical || '?'}</span></span>`
        }).join('')
        return { html: `<div class="hint-drag-radicals">🔍 各字部首：<div class="hint-radical-row">${radicals}</div></div>` }
      }
      if (level === 2) {
        // 提示二：顯示約1/3的字的正確位置
        const revealCount = Math.max(1, Math.floor(chars.length / 3))
        const revealIdx   = chars.slice(0, revealCount).map((_, i) => i)
        const partials = chars.map((ch, i) =>
          revealIdx.includes(i)
            ? `<span class="hint-reveal-char">${i+1}.${ch}</span>`
            : `<span class="hint-blank-pos">${i+1}._</span>`
        ).join('')
        return { html: `<div class="hint-drag-partial">💡 部分提示：<div class="hint-partial-row">${partials}</div></div>` }
      }
    }

    if (mode === 3) {
      if (level === 1) return `句型是：${question.example_pattern}`
      if (level === 2) return { html: `<div class="hint-content">💡 範例：<strong style="color:#333">${question.example_sentence || question.example || ''}</strong></div>` }
    }

    if (mode === 4) {
      if (level === 1) {
        // 從 characters.json 取詞語（最多3個）
        const charInfo = this._getCharInfo(question.character)
        let words = [...(charInfo._words || [])]
        if (question.prompt_word && !words.includes(question.prompt_word)) words.unshift(question.prompt_word)
        words = words.slice(0, 3)
        if (!words.length) words = [question.character]
        const wordsHtml = words.map(w => `<span class="hint-word-chip">${w}</span>`).join('')
        return { html: `<div class="hint-words">💡 可以用這些詞語造句：<div class="hint-word-row">${wordsHtml}</div></div>` }
      }
      if (level === 2) {
        const ex = question.example || question.example_sentence || ''
        return { html: `<div class="hint-content">💡 範例：<strong style="color:#333">${ex || question.character + '的例句'}</strong></div>` }
      }
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
    const hintResult = this.getHint(level, this.currentQuestion)

    // 扣半星（只扣 yellow_total，不影響 star_pokedex_count）
    StarsManager.spend(0.5).catch(() => {})

    // 顯示提示（支援純字串或 { html } 物件）
    const hintArea = document.getElementById('hint-area')
    if (hintArea) {
      const inner = (hintResult && typeof hintResult === 'object' && hintResult.html)
        ? hintResult.html
        : `<div class="hint-content">💡 ${hintResult || ''}</div>`
      hintArea.innerHTML = inner
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
    const _raw = AppState.characters || []
    // AppState.characters 可能是 { 字, zhuyin } 物件陣列，統一轉為純字串
    const allChars = _raw.map(c => (typeof c === 'object' && c !== null) ? (c['字'] || '') : String(c)).filter(Boolean)
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
  // 隨機洗牌（Fisher-Yates，每次遊戲皆不同順序）
  // ──────────────────────────────────────────────────
  _seededShuffle(arr) {
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  // ──────────────────────────────────────────────────
  // destroy（override GameEngine.destroy）
  // ──────────────────────────────────────────────────
  destroy() {
    // 呼叫父類別 _handleInterrupt（中斷時 wrongPool 加入 WrongQueue）
    super.destroy()

    // 清除手寫 Canvas 監聽器
    if (this._canvasEl) {
      this._removeCanvasListeners?.()
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
