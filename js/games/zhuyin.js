/**
 * zhuyin.js — 寫出注音 × 星星收集遊戲
 * Task 23  ／  規格 SECTION 9 D.3
 *
 * 遊戲規則：
 *   - 出題：60%多音字 / 40%單音字；多音字選 fail_rate 最高的讀音出題
 *   - 手寫辨識：HandwritingManager.recognize(canvas, { mode: 'zhuyin' })
 *   - 辨識失敗：{ fallback: 'keyboard' } → 自動顯示注音鍵盤備援
 *   - 鍵盤輸入後點確認 → 繼續走 judgeAnswer 流程
 *   - 判斷：normalizeZhuyin(recognized) === normalizeZhuyin(question.pronunciation)
 *   - 遺忘曲線：帶 pronunciation 參數（各讀音獨立計算）
 *   - 提示一：高亮正確聲調；提示二：拆解聲母＋韻母＋聲調
 *   - 答對：星星從天空落下，N 顆飛向右上角計數器
 *   - 答錯二次：顯示正確注音（直式注音體）
 *   - [↩撤銷]：呼叫 HandwritingManager.undoLastStroke() 並重繪 canvas
 *   - 星星：★+2（首次）/ ★+1（複習）
 *
 * 依賴模組：
 *   - GameEngine.js（T14）
 *   - GameConfig.js（T15）
 *   - state.js（T02）
 *   - firebase.js（T05）
 *   - audio.js（T08）
 *   - forgetting.js（T09）
 *   - stars.js（T10）
 *   - wrong_queue.js（T11）
 *   - sync.js（T12）
 *   - handwriting.js（T12.7）  ← window.HandwritingManager
 *
 * QA 修正紀錄（v2）：
 *   [FIX-1] renderQuestion 開頭先清除舊事件監聽，防止事件重複綁定堆積
 *   [FIX-2] _buildProgressHTML 加 fallback，防止 NaN 進度列
 *   [FIX-3] _getSessionStars 多層 fallback，相容 GameEngine 不同欄位名稱
 *   [FIX-4] _flyStarToCounter 加 DOM null 安全檢查，防止 destroy 後崩潰
 *   [FIX-5] _bindKeyboardEvents 高亮邏輯改為全面重算，避免舊選取殘留
 */

import { GameEngine } from './GameEngine.js'
import { GameConfig } from './GameConfig.js'
import { AppState } from '../state.js'
import { JSONLoader } from '../json_loader.js'
import { ForgettingCurve } from '../forgetting.js'
import { AudioManager } from '../audio.js'

// ─── 注音鍵盤佈局定義 ───────────────────────────────────────────────────────

/** 標準注音鍵盤（聲母 / 介音 / 韻母 / 聲調 分區） */
const ZHUYIN_KEYBOARD = {
  // 聲母（21 個）
  initials: [
    'ㄅ','ㄆ','ㄇ','ㄈ',
    'ㄉ','ㄊ','ㄋ','ㄌ',
    'ㄍ','ㄎ','ㄏ',
    'ㄐ','ㄑ','ㄒ',
    'ㄓ','ㄔ','ㄕ','ㄖ',
    'ㄗ','ㄘ','ㄙ',
  ],
  // 介音（3 個）
  medials: ['ㄧ', 'ㄨ', 'ㄩ'],
  // 韻母（13 個）
  finals: [
    'ㄚ','ㄛ','ㄜ','ㄝ',
    'ㄞ','ㄟ','ㄠ','ㄡ',
    'ㄢ','ㄣ','ㄤ','ㄥ','ㄦ',
  ],
  // 聲調（一聲不加符號，二至輕聲加符號）
  tones: [
    { label: '一聲', symbol: '' },
    { label: '二聲', symbol: 'ˊ' },
    { label: '三聲', symbol: 'ˇ' },
    { label: '四聲', symbol: 'ˋ' },
    { label: '輕聲', symbol: '˙' },
  ],
}

// ─── 注音工具函數 ────────────────────────────────────────────────────────────

/**
 * 去除空白並正規化注音字串，用於答案比對
 * @param {string} str
 * @returns {string}
 */
function normalizeZhuyin(str) {
  return (str || '').replace(/\s/g, '').trim()
}

/**
 * 拆解注音字串為聲母、韻母（含介音）、聲調
 * @param {string} zhuyin  例：'ㄉㄚˋ'
 * @returns {{ initial: string, final: string, tone: string }}
 */
function decomposeZhuyin(zhuyin) {
  if (!zhuyin) return { initial: '', final: '', tone: '' }

  const toneSymbols = ['ˊ', 'ˇ', 'ˋ', '˙']
  const toneNames   = { 'ˊ': '二聲', 'ˇ': '三聲', 'ˋ': '四聲', '˙': '輕聲' }
  let tone = '（一聲）'
  let rest = zhuyin

  // 步驟 1：取出聲調符號
  for (const sym of toneSymbols) {
    if (rest.includes(sym)) {
      tone = `（${toneNames[sym]}）`
      rest = rest.replace(sym, '')
      break
    }
  }

  // 步驟 2：取出聲母（依序比對 initials 陣列）
  let initial = ''
  for (const sym of ZHUYIN_KEYBOARD.initials) {
    if (rest.startsWith(sym)) {
      initial = sym
      rest = rest.slice(sym.length)
      break
    }
  }

  // 步驟 3：剩餘為韻母（含介音）
  const final = rest

  return { initial, final, tone }
}

/**
 * 建構提示一的 HTML：聲調符號標紅，其餘原色
 * @param {string} zhuyin
 * @returns {string}
 */
function buildHint1HTML(zhuyin) {
  const toneSymbols = ['ˊ', 'ˇ', 'ˋ', '˙']
  let html = ''
  for (const ch of zhuyin) {
    if (toneSymbols.includes(ch)) {
      html += `<span class="zy-hint-tone">${ch}</span>`
    } else {
      html += `<span class="zy-hint-char">${ch}</span>`
    }
  }
  // 一聲無符號：補文字提示
  if (!toneSymbols.some(s => zhuyin.includes(s))) {
    html += '<span class="zy-hint-tone">（一聲，不加符號）</span>'
  }
  return html
}

/**
 * HTML 特殊字元跳脫（防止 XSS）
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── ZhuyinGame 主類別 ───────────────────────────────────────────────────────

export class ZhuyinGame extends GameEngine {

  constructor() {
    super()

    /** 遊戲設定（從 GameConfig 讀取） */
    this.config = GameConfig['zhuyin'] || {
      stars: { first: 2, retry: 1 },
      name: '寫出注音',
      needHandwriting: true,
    }

    /** 目前手寫 canvas 元素 */
    this._canvas = null

    /** 目前 canvas 2D context */
    this._ctx = null

    /** 手寫進行中旗標（滑鼠 / 觸控按下中） */
    this._isDrawing = false

    /** 注音鍵盤備援啟用旗標 */
    this._keyboardFallbackActive = false

    /** 鍵盤備援：已選聲母 */
    this._kbInitial = ''

    /** 鍵盤備援：已選韻母（含介音） */
    this._kbFinal = ''

    /** 鍵盤備援：已選聲調符號 */
    this._kbTone = ''

    /**
     * 事件監聽器清理函數列表
     * [FIX-1] renderQuestion 換題時先清除，destroy 時再清一次
     */
    this._cleanupFns = []

    /** 手寫筆跡記錄（用於 undo 重繪） */
    this._strokeHistory = []

    /** 答對星星飛行動畫計時器 */
    this._starAnimTimer = null

    /** 是否已呼叫過 destroy（防止重複清除） */
    this._destroyed = false
  }

  // ═══════════════════════════════════════════════════════════════
  // GameEngine 抽象方法實作
  // ═══════════════════════════════════════════════════════════════

  /**
   * 載入題目列表
   * 從 GameEngine 提供的 questionPool（已依遺忘曲線排序）轉換為題目物件
   * @param {Object} options
   * @param {number} options.count  題數（預設 10）
   * @returns {Promise<Object[]>}
   */
  async loadQuestions({ count = 10 } = {}) {
    const myChars = AppState.characters || []
    if (myChars.length === 0) return []

    // 從 characters.json 全字典查詢完整資料（部首、字義等）
    const allCharsDict = JSONLoader.get('characters') || []

    // questionPool 由 GameEngine.init() 依遺忘曲線排好順序
    const pool = (this.questionPool || []).slice(0, count * 3)

    const questions = []
    for (const entry of pool) {
      // 相容 GameEngine 可能回傳字串或物件兩種格式
      const char = typeof entry === 'string'
        ? entry
        : (entry.char || entry['字'] || '')
      if (!char) continue

      // 從 my_characters 取注音（家長設定）；從 characters.json 取完整資料
      const myChar   = myChars.find(c => (c['字'] || c.char) === char)
      if (!myChar) continue
      const charData = allCharsDict.find(c => (c['字'] || c.char) === char) || myChar

      const zhuyin = myChar['注音'] || myChar.zhuyin ||
                     charData.pronunciations?.[0]?.zhuyin || ''
      if (!zhuyin) continue

      const readings    = this._parseReadings(zhuyin)
      const isPolyphone = readings.length > 1

      // 多音字選 fail_rate 最高的讀音出題；單音字直接取第一個
      const pronunciation = isPolyphone
        ? await this._getHighestFailRateReading(char, readings)
        : (readings[0] || zhuyin)

      questions.push({
        char,
        zhuyin,
        pronunciation,
        isPolyphone,
        readings,
        meaning:       charData.pronunciations?.[0]?.meaning || charData['解釋'] || charData.meaning       || '',
        radical:       charData.radical || charData['部首']       || '',
        radicalZhuyin: charData.radicalZhuyin || charData['部首注音'] || '',
      })

      if (questions.length >= count) break
    }

    // 若遺忘曲線 pool 不足，從剩餘生字補齊
    if (questions.length < count) {
      const usedChars = new Set(questions.map(q => q.char))
      for (const charData of characters) {
        if (questions.length >= count) break
        const char   = charData['字'] || charData.char || ''
        const zhuyin = charData['注音'] || charData.zhuyin || ''
        if (!char || !zhuyin || usedChars.has(char)) continue

        const readings = this._parseReadings(zhuyin)
        questions.push({
          char,
          zhuyin,
          pronunciation:  readings[0] || zhuyin,
          isPolyphone:    readings.length > 1,
          readings,
          meaning:        charData.pronunciations?.[0]?.meaning || charData['解釋'] || charData.meaning       || '',
          radical:        charData.radical || charData['部首']       || '',
          radicalZhuyin:  charData.radicalZhuyin || charData['部首注音'] || '',
        })
        usedChars.add(char)
      }
    }

    this.questions = questions
    return this.questions
  }

  /**
   * 渲染題目介面
   * [FIX-1] 換題時先清除上一題的所有事件監聽器，再重新渲染與綁定
   * @param {Object} question  目前題目物件
   */
  renderQuestion(question) {
    // [FIX-1] 清除上一題留下的事件監聽器
    this._flushCleanupFns()

    const app = this._getContainer()
    if (!app) return

    // 重置每題狀態
    this._keyboardFallbackActive = false
    this._kbInitial  = ''
    this._kbFinal    = ''
    this._kbTone     = ''
    this._strokeHistory = []

    app.innerHTML = `
      <div class="zy-game" id="zy-root">

        <!-- ── 頂部狀態列 ── -->
        <div class="zy-header">
          <button class="zy-back-btn" id="zy-back-btn" aria-label="跳過此題">←</button>
          <div class="zy-progress-wrap">
            ${this._buildProgressHTML()}
          </div>
          <div class="zy-star-display" id="zy-star-display" aria-label="本局星星">
            ⭐ ${this._getSessionStars().toFixed(1)}
          </div>
        </div>

        <!-- ── 題目卡片 ── -->
        <div class="zy-question-area">
          <div class="zy-char-card" id="zy-char-card">
            <div class="zy-char" aria-label="請寫出此字的注音">
              ${escapeHTML(question.char)}
            </div>
            ${question.isPolyphone
              ? '<div class="zy-poly-badge">多音字</div>'
              : ''}
          </div>
          <p class="zy-instruction">
            請用手寫方式寫出「${escapeHTML(question.char)}」的注音
          </p>
        </div>

        <!-- ── 手寫區 ── -->
        <div class="zy-write-area" id="zy-write-area">
          <div class="zy-canvas-wrap">
            <canvas id="zy-canvas" class="zy-canvas"
              width="320" height="200"
              aria-label="手寫注音畫布"></canvas>
            <span class="zy-canvas-watermark">在此書寫注音</span>
          </div>
          <div class="zy-toolbar">
            <button class="zy-btn zy-btn-undo"   id="zy-undo-btn"   title="撤銷上一筆">↩ 撤銷</button>
            <button class="zy-btn zy-btn-clear"  id="zy-clear-btn"  title="清空重寫">🗑 清空</button>
            <button class="zy-btn zy-btn-submit" id="zy-submit-btn">確認 ✓</button>
          </div>
        </div>

        <!-- ── 注音鍵盤備援（預設隱藏） ── -->
        <div class="zy-kb-fallback" id="zy-kb-fallback" style="display:none;" aria-live="polite">
          <div class="zy-kb-notice">⌨️ 手寫辨識失敗，請使用按鍵輸入</div>
          <div id="zy-kb-root"></div>
          <div class="zy-kb-preview bpmf-font" id="zy-kb-preview">——</div>
          <div class="zy-kb-actions">
            <button class="zy-btn zy-btn-clear"  id="zy-kb-clear-btn">清除</button>
            <button class="zy-btn zy-btn-submit" id="zy-kb-submit-btn">確認 ✓</button>
          </div>
        </div>

        <!-- ── 提示區（預設隱藏） ── -->
        <div class="zy-hint-area" id="zy-hint-area" style="display:none;" aria-live="polite"></div>

        <!-- ── 正確答案揭曉（答錯兩次後顯示） ── -->
        <div class="zy-answer-reveal" id="zy-answer-reveal" style="display:none;" aria-live="assertive">
          <div class="zy-answer-label">正確答案</div>
          <div class="zy-answer-bpmf bpmf-font" id="zy-answer-bpmf"></div>
          <button class="zy-btn zy-btn-next" id="zy-next-btn">下一題 →</button>
        </div>

        <!-- ── 提示按鈕列 ── -->
        <div class="zy-hint-btns">
          <button class="zy-hint-btn" id="zy-hint-btn-1">💡 提示一（−0.5★）</button>
          <button class="zy-hint-btn" id="zy-hint-btn-2">💡 提示二（−0.5★）</button>
        </div>

        <!-- ── 星星粒子動畫容器 ── -->
        <div class="zy-star-burst" id="zy-star-burst" aria-hidden="true"></div>

      </div>
    `

    // 初始化 canvas 手寫功能
    this._canvas = document.getElementById('zy-canvas')
    this._ctx    = this._canvas?.getContext('2d') ?? null
    this._initCanvas()

    // 綁定所有按鈕事件
    this._bindEvents(question)
  }

  /**
   * 判斷答案
   * 比對時去除全部空白；同時向 ForgettingCurve 回報結果（帶讀音參數）
   * @param {string} answer  辨識出的注音字串
   * @returns {Promise<boolean>}
   */
  async judgeAnswer(answer) {
    const question = this.currentQuestion
    if (!question) return false

    const isCorrect = normalizeZhuyin(answer) === normalizeZhuyin(question.pronunciation)

    // 回報遺忘曲線（各讀音獨立計算）
    try {
      await ForgettingCurve.recordResult(
        question.char,
        isCorrect,
        question.pronunciation  // 帶讀音參數，多音字各讀音分開追蹤
      )
    } catch (err) {
      console.warn('[ZhuyinGame] ForgettingCurve.recordResult 失敗', err)
    }

    return isCorrect
  }

  /**
   * 答對動畫：星星從天空落下後飛向計數器
   * @param {number} stars  獲得星星數
   */
  playCorrectAnimation(stars) {
    AudioManager.playCorrect?.()

    const burst = document.getElementById('zy-star-burst')
    if (!burst) return
    burst.innerHTML = ''

    const particleCount = Math.max(6, Math.round(stars * 3))

    for (let i = 0; i < particleCount; i++) {
      const el = document.createElement('div')
      el.className = 'zy-star-particle'
      el.textContent = '⭐'
      el.style.cssText = [
        `left:${10 + Math.random() * 80}vw`,
        `top:-40px`,
        `animation-delay:${i * 80}ms`,
        `animation-duration:${900 + Math.random() * 400}ms`,
        `font-size:${14 + Math.random() * 10}px`,
      ].join(';')
      burst.appendChild(el)

      // 最後一顆粒子動畫結束後飛向計數器
      el.addEventListener('animationend', () => {
        if (i === particleCount - 1) {
          this._flyStarToCounter(el)
        } else {
          el.remove()
        }
      }, { once: true })
    }

    // 卡片閃光動畫
    const card = document.getElementById('zy-char-card')
    card?.classList.add('zy-card-correct')
    setTimeout(() => card?.classList.remove('zy-card-correct'), 800)
  }

  /**
   * 答錯動畫：卡片搖晃 + canvas 清空讓玩家重寫
   */
  playWrongAnimation() {
    AudioManager.playWrong?.()

    const card      = document.getElementById('zy-char-card')
    const writeArea = document.getElementById('zy-write-area')
    card?.classList.add('zy-card-wrong')
    writeArea?.classList.add('zy-write-shake')
    setTimeout(() => {
      card?.classList.remove('zy-card-wrong')
      writeArea?.classList.remove('zy-write-shake')
    }, 600)

    // 清空 canvas 讓玩家重新書寫
    this._clearCanvas()
    this._strokeHistory = []
  }

  /**
   * 顯示正確答案（GameEngine 在答錯兩次後呼叫）
   * 以直式注音體呈現
   */
  showCorrectAnswer() {
    const question = this.currentQuestion
    const reveal   = document.getElementById('zy-answer-reveal')
    const bpmfEl   = document.getElementById('zy-answer-bpmf')
    if (!question || !reveal || !bpmfEl) return

    // 直式注音體（writing-mode: vertical-rl）
    bpmfEl.innerHTML = `<span class="zy-bpmf-vertical">${escapeHTML(question.pronunciation)}</span>`
    reveal.style.display = 'flex'

    // 弱化手寫區，表示此題已結束
    const writeArea = document.getElementById('zy-write-area')
    if (writeArea) writeArea.style.opacity = '0.3'

    // 隱藏備援鍵盤
    const kbFallback = document.getElementById('zy-kb-fallback')
    if (kbFallback) kbFallback.style.display = 'none'
  }

  /**
   * 提示系統
   *   hintIndex=1 → 高亮正確聲調
   *   hintIndex=2 → 拆解聲母 ＋ 韻母 ＋ 聲調
   * @param {number} hintIndex  1 或 2
   */
  getHint(hintIndex) {
    const question = this.currentQuestion
    const hintArea = document.getElementById('zy-hint-area')
    if (!question || !hintArea) return

    hintArea.style.display = 'block'

    if (hintIndex === 1) {
      hintArea.innerHTML = `
        <div class="zy-hint-label">💡 注意聲調：</div>
        <div class="zy-hint-content bpmf-font">${buildHint1HTML(question.pronunciation)}</div>
      `
    } else if (hintIndex === 2) {
      const { initial, final, tone } = decomposeZhuyin(question.pronunciation)
      hintArea.innerHTML = `
        <div class="zy-hint-label">💡 注音拆解：</div>
        <div class="zy-hint-decompose">
          <span class="zy-hint-part">
            <span class="zy-hint-part-label">聲母</span>
            <span class="zy-hint-part-val bpmf-font">${initial || '（無）'}</span>
          </span>
          <span class="zy-hint-sep">＋</span>
          <span class="zy-hint-part">
            <span class="zy-hint-part-label">韻母</span>
            <span class="zy-hint-part-val bpmf-font">${final || '（無）'}</span>
          </span>
          <span class="zy-hint-sep">＋</span>
          <span class="zy-hint-part">
            <span class="zy-hint-part-label">聲調</span>
            <span class="zy-hint-part-val bpmf-font">${tone}</span>
          </span>
        </div>
      `
    }
  }

  /**
   * 銷毀遊戲，釋放所有計時器與事件監聽
   * super.destroy() 由 GameEngine 負責 wrongPool → WrongQueue
   */
  destroy() {
    if (this._destroyed) return
    this._destroyed = true

    if (this._starAnimTimer) {
      clearTimeout(this._starAnimTimer)
      this._starAnimTimer = null
    }

    this._flushCleanupFns()
    super.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 私有輔助方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 執行並清空所有事件監聽器清理函數
   * [FIX-1] renderQuestion 換題及 destroy 時各呼叫一次
   */
  _flushCleanupFns() {
    for (const fn of this._cleanupFns) {
      try { fn() } catch (_) {}
    }
    this._cleanupFns = []
  }

  /**
   * 解析注音欄位為多個讀音陣列
   * 多音字在 characters.json 中以 '/' 或 '／' 分隔
   * @param {string} zhuyin
   * @returns {string[]}
   */
  _parseReadings(zhuyin) {
    if (!zhuyin) return []
    return zhuyin.split(/[/／]/).map(r => r.trim()).filter(Boolean)
  }

  /**
   * 找出多音字中 fail_rate 最高的讀音（讓孩子優先練最弱的）
   * @param {string} char
   * @param {string[]} readings
   * @returns {Promise<string>}
   */
  async _getHighestFailRateReading(char, readings) {
    if (readings.length <= 1) return readings[0] || ''
    try {
      let maxRate = -1
      let target  = readings[0]
      for (const pron of readings) {
        const prog = await ForgettingCurve.getCharProgress(char, pron)
        const rate = prog?.fail_rate ?? 0
        if (rate > maxRate) { maxRate = rate; target = pron }
      }
      return target
    } catch (e) {
      console.warn('[ZhuyinGame] 取得 fail_rate 失敗，使用第一個讀音', e)
      return readings[0]
    }
  }

  /**
   * 初始化 canvas 手寫事件（滑鼠 + 觸控）
   * 筆跡記錄至 this._strokeHistory 供 Undo 使用
   */
  _initCanvas() {
    if (!this._canvas || !this._ctx) return

    const canvas = this._canvas
    const ctx    = this._ctx

    // 畫筆樣式
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth   = 4
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    this._drawCanvasGrid()

    let currentStroke = []

    // 統一取座標（相容滑鼠與觸控，並修正 CSS scale 縮放）
    const getPos = (e) => {
      const rect   = canvas.getBoundingClientRect()
      const scaleX = canvas.width  / rect.width
      const scaleY = canvas.height / rect.height
      const src    = e.touches?.[0] ?? e
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top)  * scaleY,
      }
    }

    const onStart = (e) => {
      e.preventDefault()
      this._isDrawing = true
      currentStroke   = []
      const pos = getPos(e)
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
      currentStroke.push(pos)
    }

    const onMove = (e) => {
      if (!this._isDrawing) return
      e.preventDefault()
      const pos = getPos(e)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
      currentStroke.push(pos)
    }

    const onEnd = (e) => {
      if (!this._isDrawing) return
      e.preventDefault()
      this._isDrawing = false
      if (currentStroke.length > 0) {
        this._strokeHistory.push([...currentStroke])
      }
    }

    // 滑鼠事件
    canvas.addEventListener('mousedown',  onStart)
    canvas.addEventListener('mousemove',  onMove)
    canvas.addEventListener('mouseup',    onEnd)
    canvas.addEventListener('mouseleave', onEnd)
    // 觸控事件（passive: false 以允許 preventDefault）
    canvas.addEventListener('touchstart', onStart, { passive: false })
    canvas.addEventListener('touchmove',  onMove,  { passive: false })
    canvas.addEventListener('touchend',   onEnd)

    // 登記清理函數（換題或 destroy 時呼叫）
    this._cleanupFns.push(() => {
      canvas.removeEventListener('mousedown',  onStart)
      canvas.removeEventListener('mousemove',  onMove)
      canvas.removeEventListener('mouseup',    onEnd)
      canvas.removeEventListener('mouseleave', onEnd)
      canvas.removeEventListener('touchstart', onStart)
      canvas.removeEventListener('touchmove',  onMove)
      canvas.removeEventListener('touchend',   onEnd)
    })
  }

  /** 繪製 canvas 淡藍方格底紋 */
  _drawCanvasGrid() {
    if (!this._ctx || !this._canvas) return
    const ctx = this._ctx
    const { width: w, height: h } = this._canvas
    ctx.save()
    ctx.strokeStyle = 'rgba(148,196,255,0.3)'
    ctx.lineWidth   = 1
    for (let y = 0; y <= h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    for (let x = 0; x <= w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
    }
    ctx.restore()
  }

  /** 清空 canvas 並重繪底紋 */
  _clearCanvas() {
    if (!this._ctx || !this._canvas) return
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)
    this._drawCanvasGrid()
  }

  /**
   * 綁定所有按鈕事件（每題呼叫一次）
   * 使用輔助函數 reg 統一登記清理
   * @param {Object} question
   */
  _bindEvents(question) {
    /** 輔助：綁定並自動登記清理函數 */
    const reg = (id, event, handler) => {
      const el = document.getElementById(id)
      if (!el) return
      el.addEventListener(event, handler)
      this._cleanupFns.push(() => el.removeEventListener(event, handler))
    }

    reg('zy-back-btn',   'click', () => this.skipQuestion())
    reg('zy-undo-btn',   'click', () => this._handleUndo())
    reg('zy-clear-btn',  'click', () => {
      this._clearCanvas()
      this._strokeHistory = []
    })
    reg('zy-submit-btn', 'click', () => this._handleHandwritingSubmit(question))
    reg('zy-hint-btn-1', 'click', () => this.useHint(1))
    reg('zy-hint-btn-2', 'click', () => this.useHint(2))
    reg('zy-next-btn',   'click', () => this.nextQuestion())
  }

  /**
   * 處理手寫確認：呼叫 HandwritingManager 辨識，失敗時啟動鍵盤備援
   * @param {Object} question  目前題目（備援鍵盤需要）
   */
  async _handleHandwritingSubmit(question) {
    if (this.isAnswering) return
    if (!this._canvas) return

    // 防止確認按鈕重複點擊
    const submitBtn = document.getElementById('zy-submit-btn')
    if (submitBtn) submitBtn.disabled = true

    try {
      let recognized = null
      const HWM = window.HandwritingManager

      if (HWM) {
        try {
          recognized = await HWM.recognize(this._canvas, { mode: 'zhuyin' })
        } catch (e) {
          console.warn('[ZhuyinGame] HandwritingManager.recognize 拋出例外', e)
          recognized = null
        }
      }

      if (!recognized) {
        // 辨識全部失敗 → fallback: keyboard
        this._activateKeyboardFallback(question)
        return
      }

      // 辨識成功 → GameEngine.submitAnswer → judgeAnswer
      await this.submitAnswer(recognized)
    } finally {
      // 無論成功失敗，解鎖確認按鈕
      if (submitBtn) submitBtn.disabled = false
    }
  }

  /**
   * 處理撤銷（Undo）：同步通知 HandwritingManager 並重繪 canvas
   */
  _handleUndo() {
    if (this._strokeHistory.length === 0) return
    // 通知 HandwritingManager 撤銷其內部狀態
    window.HandwritingManager?.undoLastStroke?.()
    // 移除本地最後一筆
    this._strokeHistory.pop()
    // 依剩餘筆跡重繪
    this._redrawStrokes()
  }

  /**
   * 依 _strokeHistory 重繪所有筆跡（undo 後使用）
   */
  _redrawStrokes() {
    this._clearCanvas()
    if (!this._ctx) return

    const ctx = this._ctx
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth   = 4
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'

    for (const stroke of this._strokeHistory) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x, stroke[i].y)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(stroke[i].x, stroke[i].y)
      }
    }
  }

  /**
   * 啟動注音鍵盤備援：顯示鍵盤並綁定事件
   * @param {Object} question
   */
  _activateKeyboardFallback(question) {
    this._keyboardFallbackActive = true

    const fallbackDiv = document.getElementById('zy-kb-fallback')
    if (!fallbackDiv) return
    fallbackDiv.style.display = 'block'

    const kbRoot = document.getElementById('zy-kb-root')
    if (kbRoot) {
      kbRoot.innerHTML = this._buildKeyboardHTML()
      this._bindKeyboardEvents(question)
    }

    this._updateKeyboardPreview()
  }

  /**
   * 建構注音鍵盤 HTML（聲母 / 介音 / 韻母 / 聲調 四區）
   * @returns {string}
   */
  _buildKeyboardHTML() {
    const sections = [
      { title: '聲母', keys: ZHUYIN_KEYBOARD.initials, type: 'initial' },
      { title: '介音', keys: ZHUYIN_KEYBOARD.medials,  type: 'medial'  },
      { title: '韻母', keys: ZHUYIN_KEYBOARD.finals,   type: 'final'   },
    ]

    let html = '<div class="zy-kb-sections">'
    for (const sec of sections) {
      html += `<div class="zy-kb-sec">
        <div class="zy-kb-sec-title">${sec.title}</div>
        <div class="zy-kb-keys">`
      for (const k of sec.keys) {
        html += `<button class="zy-kb-key bpmf-font"
          data-type="${sec.type}" data-value="${k}">${k}</button>`
      }
      html += '</div></div>'
    }

    // 聲調列
    html += '<div class="zy-kb-sec"><div class="zy-kb-sec-title">聲調</div><div class="zy-kb-keys">'
    for (const t of ZHUYIN_KEYBOARD.tones) {
      html += `<button class="zy-kb-key zy-kb-tone-key"
        data-type="tone" data-value="${t.symbol}" title="${t.label}">
        ${t.label}${t.symbol ? `<span class="bpmf-font"> ${t.symbol}</span>` : ''}
      </button>`
    }
    html += '</div></div></div>'

    return html
  }

  /**
   * 綁定注音鍵盤按鍵點擊事件
   * [FIX-5] 每次點擊後全面重算高亮，避免舊選取殘留
   * @param {Object} question
   */
  _bindKeyboardEvents(question) {
    const kbRoot = document.getElementById('zy-kb-root')
    if (!kbRoot) return

    // 按鍵點擊（事件委派到 kbRoot）
    const onKeyClick = (e) => {
      const btn = e.target.closest('.zy-kb-key')
      if (!btn) return

      const type  = btn.dataset.type
      const value = btn.dataset.value

      switch (type) {
        case 'initial':
          // 聲母：互斥，再點同一個取消
          this._kbInitial = (this._kbInitial === value) ? '' : value
          break
        case 'medial': {
          // 介音：切換（再點取消）
          if (this._kbFinal.startsWith(value)) {
            this._kbFinal = this._kbFinal.slice(value.length)
          } else {
            this._kbFinal = value + this._kbFinal.replace(/^[ㄧㄨㄩ]/, '')
          }
          break
        }
        case 'final': {
          // 韻母：保留介音前綴，切換韻母部分
          const medial    = this._kbFinal.match(/^[ㄧㄨㄩ]/)?.[0] || ''
          const currentFinal = this._kbFinal.slice(medial.length)
          this._kbFinal = currentFinal === value
            ? medial           // 再點取消
            : medial + value   // 設定韻母
          break
        }
        case 'tone':
          // 聲調：互斥，再點取消
          this._kbTone = (this._kbTone === value) ? '' : value
          break
      }

      this._updateKeyboardPreview()
      // [FIX-5] 全面重算高亮
      this._updateKeyboardHighlight(kbRoot)
    }

    kbRoot.addEventListener('click', onKeyClick)
    this._cleanupFns.push(() => kbRoot.removeEventListener('click', onKeyClick))

    // 清除按鈕
    const kbClearBtn = document.getElementById('zy-kb-clear-btn')
    if (kbClearBtn) {
      const onClear = () => {
        this._kbInitial = ''
        this._kbFinal   = ''
        this._kbTone    = ''
        this._updateKeyboardPreview()
        this._updateKeyboardHighlight(kbRoot)
      }
      kbClearBtn.addEventListener('click', onClear)
      this._cleanupFns.push(() => kbClearBtn.removeEventListener('click', onClear))
    }

    // 備援鍵盤確認按鈕
    const kbSubmitBtn = document.getElementById('zy-kb-submit-btn')
    if (kbSubmitBtn) {
      const onKbSubmit = async () => {
        const composed = this._composeZhuyinFromKeyboard()
        if (!composed) return
        // 繼續走 GameEngine.submitAnswer → judgeAnswer 流程
        await this.submitAnswer(composed)
      }
      kbSubmitBtn.addEventListener('click', onKbSubmit)
      this._cleanupFns.push(() => kbSubmitBtn.removeEventListener('click', onKbSubmit))
    }
  }

  /**
   * 從鍵盤選取狀態組合注音字串
   * @returns {string}
   */
  _composeZhuyinFromKeyboard() {
    return (this._kbInitial + this._kbFinal + this._kbTone) || ''
  }

  /** 更新鍵盤輸入預覽區 */
  _updateKeyboardPreview() {
    const preview = document.getElementById('zy-kb-preview')
    if (!preview) return
    const composed = this._composeZhuyinFromKeyboard()
    preview.textContent = composed || '——'
    preview.classList.toggle('zy-kb-preview-filled', !!composed)
  }

  /**
   * [FIX-5] 全面重算並更新鍵盤高亮狀態
   * @param {HTMLElement} kbRoot
   */
  _updateKeyboardHighlight(kbRoot) {
    // 清除所有高亮
    kbRoot.querySelectorAll('.zy-kb-key-active')
      .forEach(k => k.classList.remove('zy-kb-key-active'))

    // 依目前選取重新標記
    if (this._kbInitial) {
      kbRoot.querySelectorAll(`[data-type="initial"][data-value="${this._kbInitial}"]`)
        .forEach(k => k.classList.add('zy-kb-key-active'))
    }
    if (this._kbTone !== '') {
      kbRoot.querySelectorAll(`[data-type="tone"][data-value="${this._kbTone}"]`)
        .forEach(k => k.classList.add('zy-kb-key-active'))
    }
    // 從 _kbFinal 反推介音和韻母高亮
    const medial    = this._kbFinal.match(/^[ㄧㄨㄩ]/)?.[0] || ''
    const finalPart = this._kbFinal.slice(medial.length)
    if (medial) {
      kbRoot.querySelectorAll(`[data-type="medial"][data-value="${medial}"]`)
        .forEach(k => k.classList.add('zy-kb-key-active'))
    }
    if (finalPart) {
      kbRoot.querySelectorAll(`[data-type="final"][data-value="${finalPart}"]`)
        .forEach(k => k.classList.add('zy-kb-key-active'))
    }
  }

  /**
   * 建構進度列 HTML
   * [FIX-2] 加 fallback 防止 currentQuestionIndex 為 undefined 導致 NaN
   * @returns {string}
   */
  _buildProgressHTML() {
    const total   = this.questions?.length ?? 0
    // 相容 GameEngine 可能使用不同欄位名稱
    const current = this.currentQuestionIndex ?? this.questionIndex ?? 0
    const pct     = total > 0 ? Math.round((current / total) * 100) : 0

    return `
      <div class="zy-progress-bar"
           role="progressbar"
           aria-valuenow="${current}"
           aria-valuemax="${total}"
           aria-label="題目進度 ${current}／${total}">
        <div class="zy-progress-fill" style="width:${pct}%"></div>
        <span class="zy-progress-text">${current}／${total}</span>
      </div>
    `
  }

  /**
   * 取得本局累計星星數（顯示用）
   * [FIX-3] 多層 fallback，相容 GameEngine 不同欄位命名
   * @returns {number}
   */
  _getSessionStars() {
    return this.sessionStars
      ?? this.totalStarsEarned
      ?? this.earnedStars
      ?? 0
  }

  /**
   * 讓最後一顆星星飛向右上角計數器
   * [FIX-4] DOM null 安全檢查，防止 destroy 後或換頁後崩潰
   * @param {HTMLElement} starEl
   */
  _flyStarToCounter(starEl) {
    // [FIX-4] 若元素不在 DOM 中（destroy 或換頁），靜默移除
    if (!document.contains(starEl)) {
      starEl.remove()
      return
    }

    const counter = document.getElementById('zy-star-display')
    if (!counter) { starEl.remove(); return }

    const cRect = counter.getBoundingClientRect()
    const sRect = starEl.getBoundingClientRect()

    // 邊界保護：若取不到有效矩形，直接移除
    if (!cRect.width || !sRect.width) { starEl.remove(); return }

    const dx = cRect.left - sRect.left
    const dy = cRect.top  - sRect.top

    starEl.style.transition = 'transform 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.5s'
    starEl.style.transform  = `translate(${dx}px,${dy}px) scale(0.3)`
    starEl.style.opacity    = '0'

    this._starAnimTimer = setTimeout(() => {
      starEl.remove()
      // 更新計數器顯示（再做一次 null 檢查）
      const display = document.getElementById('zy-star-display')
      if (display) {
        display.textContent = `⭐ ${this._getSessionStars().toFixed(1)}`
        display.classList.add('zy-star-pop')
        setTimeout(() => display.classList.remove('zy-star-pop'), 300)
      }
    }, 520)
  }
}

// ─── CSS 注入（遊戲樣式，每頁只注入一次） ───────────────────────────────────

;(function injectZhuyinStyles() {
  const STYLE_ID = 'zhuyin-game-styles'
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `

  /* ══ 整體佈局 ══════════════════════════════════════════════════ */
  .zy-game {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding-bottom: env(safe-area-inset-bottom, 0);
    background: linear-gradient(160deg, #e0f2fe 0%, #f0f9ff 50%, #fafcff 100%);
    font-family: 'Noto Sans TC', sans-serif;
    position: relative;
    overflow-x: hidden;
  }

  /* ══ 頂部狀態列 ════════════════════════════════════════════════ */
  .zy-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 8px;
    background: rgba(255,255,255,0.75);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(148,196,255,0.3);
    position: sticky;
    top: 0;
    z-index: 20;
  }
  .zy-back-btn {
    flex-shrink: 0;
    padding: 6px 12px;
    border: none;
    background: rgba(148,196,255,0.2);
    border-radius: 8px;
    cursor: pointer;
    font-size: 18px;
    color: #1d4ed8;
    line-height: 1;
    transition: background 0.2s;
  }
  .zy-back-btn:hover { background: rgba(148,196,255,0.4); }
  .zy-progress-wrap { flex: 1; min-width: 0; }
  .zy-progress-bar {
    position: relative;
    height: 20px;
    background: rgba(148,196,255,0.2);
    border-radius: 10px;
    overflow: hidden;
  }
  .zy-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #60a5fa, #3b82f6);
    border-radius: 10px;
    transition: width 0.5s ease;
  }
  .zy-progress-text {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    color: #1e40af;
    pointer-events: none;
  }
  .zy-star-display {
    flex-shrink: 0;
    font-size: 15px;
    font-weight: 700;
    color: #ca8a04;
    padding: 4px 10px;
    background: rgba(254,240,138,0.4);
    border-radius: 20px;
    white-space: nowrap;
  }
  .zy-star-pop { animation: zy-star-pop 0.3s ease; }
  @keyframes zy-star-pop {
    0%,100% { transform: scale(1);   }
    50%     { transform: scale(1.4); }
  }

  /* ══ 題目卡片 ══════════════════════════════════════════════════ */
  .zy-question-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 16px 8px;
    gap: 10px;
  }
  .zy-char-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: white;
    border-radius: 20px;
    padding: 16px 36px;
    box-shadow: 0 4px 20px rgba(59,130,246,0.15);
    transition: transform 0.2s;
  }
  .zy-char {
    font-size: 72px;
    line-height: 1.1;
    font-weight: 700;
    color: #1e40af;
    text-shadow: 0 2px 8px rgba(59,130,246,0.15);
    user-select: none;
  }
  .zy-poly-badge {
    margin-top: 4px;
    padding: 2px 12px;
    background: linear-gradient(90deg, #f59e0b, #d97706);
    color: white;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .zy-card-correct {
    animation: zy-card-flash-correct 0.8s ease forwards;
  }
  @keyframes zy-card-flash-correct {
    0%   { box-shadow: 0 4px 20px rgba(59,130,246,0.15); background: white; }
    35%  { box-shadow: 0 0 40px rgba(34,197,94,0.65);  background: #f0fdf4; }
    100% { box-shadow: 0 4px 20px rgba(59,130,246,0.15); background: white; }
  }
  .zy-card-wrong { animation: zy-card-shake 0.6s ease; }
  @keyframes zy-card-shake {
    0%,100% { transform: translateX(0)    rotate(0deg);  }
    20%     { transform: translateX(-8px)  rotate(-2deg); }
    40%     { transform: translateX(8px)   rotate(2deg);  }
    60%     { transform: translateX(-4px)  rotate(-1deg); }
    80%     { transform: translateX(4px);  }
  }
  .zy-instruction { font-size: 15px; color: #475569; text-align: center; margin: 0; }

  /* ══ 手寫區 ════════════════════════════════════════════════════ */
  .zy-write-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 16px 0;
    gap: 10px;
    transition: opacity 0.3s;
  }
  .zy-canvas-wrap { position: relative; }
  .zy-canvas {
    display: block;
    border: 2px solid #bfdbfe;
    border-radius: 16px;
    background: white;
    touch-action: none;
    cursor: crosshair;
    max-width: min(320px, calc(100vw - 32px));
  }
  .zy-canvas-watermark {
    position: absolute;
    bottom: 10px;
    right: 12px;
    font-size: 11px;
    color: rgba(148,196,255,0.55);
    pointer-events: none;
    user-select: none;
  }
  .zy-toolbar { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .zy-write-shake { animation: zy-write-shake 0.5s ease; }
  @keyframes zy-write-shake {
    0%,100% { transform: translateX(0);  }
    25%     { transform: translateX(-6px); }
    75%     { transform: translateX(6px);  }
  }

  /* ══ 共用按鈕 ══════════════════════════════════════════════════ */
  .zy-btn {
    padding: 10px 18px;
    border: none;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s, background 0.2s, box-shadow 0.2s;
    line-height: 1.2;
  }
  .zy-btn:active   { transform: scale(0.96) !important; }
  .zy-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none !important; }
  .zy-btn-undo   { background: #f1f5f9; color: #475569; }
  .zy-btn-undo:hover  { background: #e2e8f0; transform: translateY(-1px); }
  .zy-btn-clear  { background: #fee2e2; color: #b91c1c; }
  .zy-btn-clear:hover { background: #fecaca; transform: translateY(-1px); }
  .zy-btn-submit {
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    color: white;
    box-shadow: 0 4px 12px rgba(59,130,246,0.3);
  }
  .zy-btn-submit:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(59,130,246,0.4); }
  .zy-btn-next {
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    color: white;
    padding: 10px 28px;
    box-shadow: 0 4px 12px rgba(59,130,246,0.3);
    font-size: 15px;
  }
  .zy-btn-next:hover { transform: translateY(-2px); }

  /* ══ 注音鍵盤備援 ══════════════════════════════════════════════ */
  .zy-kb-fallback {
    margin: 8px 12px 0;
    background: white;
    border-radius: 16px;
    padding: 14px 12px;
    box-shadow: 0 4px 20px rgba(59,130,246,0.15);
  }
  .zy-kb-notice {
    font-size: 13px;
    color: #d97706;
    font-weight: 600;
    text-align: center;
    margin-bottom: 10px;
  }
  .zy-kb-sections  { display: flex; flex-direction: column; gap: 8px; }
  .zy-kb-sec-title { font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 4px; }
  .zy-kb-keys      { display: flex; flex-wrap: wrap; gap: 5px; }
  .zy-kb-key {
    min-width: 34px;
    height: 34px;
    padding: 2px 4px;
    border: 1.5px solid #bfdbfe;
    border-radius: 8px;
    background: #f8fafc;
    cursor: pointer;
    font-size: 16px;
    color: #1e3a8a;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    transition: background 0.15s, transform 0.1s, border-color 0.15s;
  }
  .zy-kb-key:hover      { background: #eff6ff; transform: scale(1.08); }
  .zy-kb-key-active     { background: #3b82f6 !important; color: white !important; border-color: #1d4ed8 !important; }
  .zy-kb-tone-key       { font-size: 12px; min-width: 52px; }
  .zy-kb-preview {
    text-align: center;
    font-size: 30px;
    color: #94a3b8;
    padding: 6px 0;
    letter-spacing: 4px;
    min-height: 44px;
    transition: color 0.2s;
  }
  .zy-kb-preview-filled { color: #1e40af; font-weight: 700; }
  .zy-kb-actions { display: flex; gap: 8px; justify-content: center; margin-top: 8px; }

  /* ══ 提示區 ════════════════════════════════════════════════════ */
  .zy-hint-area {
    margin: 8px 16px 0;
    padding: 12px 16px;
    background: rgba(254,240,138,0.3);
    border: 1.5px dashed #fbbf24;
    border-radius: 12px;
  }
  .zy-hint-label   { font-size: 13px; color: #b45309; font-weight: 600; margin-bottom: 6px; }
  .zy-hint-content { font-size: 22px; letter-spacing: 3px; color: #1e3a8a; }
  .zy-hint-tone    { color: #dc2626; font-weight: 900; }
  .zy-hint-char    { color: #1e3a8a; }
  .zy-hint-decompose {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    flex-wrap: wrap;
  }
  .zy-hint-part       { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .zy-hint-part-label { font-size: 11px; color: #64748b; }
  .zy-hint-part-val   { font-size: 24px; color: #1e40af; font-weight: 700; min-width: 32px; text-align: center; }
  .zy-hint-sep        { font-size: 18px; color: #94a3b8; padding-bottom: 6px; }

  /* ══ 正確答案揭曉 ═══════════════════════════════════════════════ */
  .zy-answer-reveal {
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px;
    background: rgba(254,240,138,0.15);
    border: 2px solid #fbbf24;
    border-radius: 16px;
    margin: 8px 16px 0;
  }
  .zy-answer-label { font-size: 13px; color: #b45309; font-weight: 600; }
  .zy-answer-bpmf  { font-size: 36px; color: #1e40af; letter-spacing: 6px; }
  .zy-bpmf-vertical {
    writing-mode: vertical-rl;
    text-orientation: upright;
    display: inline-block;
    letter-spacing: 4px;
    font-family: 'BpmfIVS', 'Noto Sans TC', serif;
  }

  /* ══ 提示按鈕列 ════════════════════════════════════════════════ */
  .zy-hint-btns {
    display: flex;
    gap: 8px;
    justify-content: center;
    padding: 8px 16px;
    flex-wrap: wrap;
    margin-top: auto;
  }
  .zy-hint-btn {
    padding: 8px 14px;
    border: 1.5px dashed #fbbf24;
    border-radius: 10px;
    background: rgba(254,240,138,0.2);
    color: #b45309;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s;
  }
  .zy-hint-btn:hover    { background: rgba(254,240,138,0.5); transform: translateY(-1px); }
  .zy-hint-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  /* ══ 星星粒子動畫 ═══════════════════════════════════════════════ */
  .zy-star-burst {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    overflow: hidden;
  }
  .zy-star-particle {
    position: absolute;
    animation: zy-star-fall 1s ease-in forwards;
    will-change: transform, opacity;
  }
  @keyframes zy-star-fall {
    0%   { transform: translateY(-40px) scale(1);                    opacity: 1;   }
    60%  {                                                            opacity: 1;   }
    100% { transform: translateY(65vh) scale(0.8) rotate(200deg);    opacity: 0.7; }
  }

  /* ══ 注音字型 ══════════════════════════════════════════════════ */
  .bpmf-font { font-family: 'BpmfIVS', 'Noto Sans TC', serif; }
    
      /* ── RWD 平板（≥600px）── */
      @media (min-width: 600px) {
        .zy-question-area { max-width: 520px; margin: 0 auto; }
        .zy-options       { max-width: 520px; margin: 0 auto; }
      }
/* ── RWD 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .zy-game { max-width: 760px; margin: 0 auto; }
    }
  `

  document.head.appendChild(style)
})()
