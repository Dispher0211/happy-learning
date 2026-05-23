/**
 * writing.js — 寫出國字 × 🪄 魔法書
 * Task 24：手寫辨識遊戲，玩家根據詞語提示手寫出□中的生字
 *
 * 依賴模組：
 *   GameEngine.js（T14）、GameConfig.js（T15）
 *   state.js（T02）、firebase.js（T05）、audio.js（T08）
 *   forgetting.js（T09）、stars.js（T10）、wrong_queue.js（T11）
 *   sync.js（T12）、handwriting.js（T12.7）
 *
 * 遊戲規格（SECTION 9 D.1）：
 *   - 出題：從遺忘曲線排序取生字，選包含該字的詞語，該字位置顯示□
 *   - 手寫辨識：HandwritingManager.recognize(canvas, { mode: 'chinese' })
 *   - 辨識失敗：{ fallback: 'retry' } → 顯示「請再寫一次」，canvas 清空，不計答錯
 *   - 提示（多音字）：提示一=不同音詞語；提示二=部首（帶注音）
 *   - 提示（非多音）：提示一=部首；提示二=字義
 *   - 答對：魔法書大放光芒，N顆★飛向右上角
 *   - 答錯一次：書本搖晃，清空重寫
 *   - 答錯二次：書本合起，顯示正確答案
 *   - 手寫 Undo：[↩撤銷] 按鈕可用，呼叫 HandwritingManager.undoLastStroke()
 */

import { GameEngine } from './GameEngine.js'
import { GameConfig } from './GameConfig.js'
import { AppState } from '../state.js'
import { AudioManager } from '../audio.js'
import { ForgettingCurve } from '../forgetting.js'
import { HandwritingManager } from '../handwriting.js'
import { JSONLoader } from '../json_loader.js'

// ═══════════════════════════════════════════════════════════
// WritingGame 主類別
// ═══════════════════════════════════════════════════════════

export class WritingGame extends GameEngine {
  constructor(options = {}) {
    super('writing', options)
    // 手寫 canvas 相關
    this._canvas = null
    this._ctx = null
    // 題目資料（loadQuestions 後填入）
    this._questions = []
    // 事件監聽器清理函式陣列
    this._cleanupFns = []
    // 是否正在等待辨識結果
    this._recognizing = false
    // 本地筆畫 stack（每筆畫為 { points: [{x,y},...] }）
    this._localStrokes = []
    // 目前正在繪製的筆畫點陣
    this._currentStrokePoints = []
    // retryMsg timer
    this._retryMsgTimer = null
  }

  // ═══════════════════════════════════════════════════════
  // loadQuestions — 從遺忘曲線取排序生字，組合成題目
  // ═══════════════════════════════════════════════════════

  async loadQuestions(config) {
    /**
     * config 來自 GameEngine.init(config)，包含：
     *   count   — 題數
     *   mode    — 'all' | 'custom'
     *   autoNext — 連續模式
     *
     * 注意：AppState.characters 為生字簿清單（精簡格式 {字, zhuyin}），
     *       僅用於決定「出哪些字」及遺忘曲線排序。
     *       題目的完整字典資料（pronunciations、definitions 等）
     *       必須從 JSONLoader.get('characters')（完整字典）取得。
     */
    const count = config?.count ?? 10

    // 從遺忘曲線取排序生字（整合 WrongQueue，前置高遺忘字）
    const sorted = await ForgettingCurve.getSortedQueue(
      AppState.characters,
      count
    )

    // 從完整字典（characters.json）建立查詢字典
    const fullCharList = JSONLoader.get('characters') || []
    const charDict = this._buildCharDict(fullCharList)

    // 組合每題資料
    this._questions = sorted.map(charEntry => {
      const char = typeof charEntry === 'string' ? charEntry : charEntry.char ?? charEntry['字']
      const dictEntry = charDict[char]
      return this._buildQuestion(char, dictEntry)
    }).filter(q => q !== null)

    this.questions = this._questions
    return this.questions
  }

  /**
   * 建立單題資料物件
   * @param {string} char - 目標生字
   * @param {object|null} dictEntry - characters.json 中的字典資料
   * @returns {object|null}
   */
  _buildQuestion(char, dictEntry) {
    if (!dictEntry) {
      console.warn(`[WritingGame] 字典找不到「${char}」，跳過此題`)
      return null
    }

    const isPolyphone = dictEntry.pronunciations && dictEntry.pronunciations.length > 1

    // 選擇出題用的讀音（fail_rate 最高者，若無則取第一個）
    const targetPron = dictEntry.pronunciations?.[0]

    // 選出包含該字的詞語：從 definitions.ex 取（含正確注音），隨機選取增加變化
    const allExCandidates = []
    for (const d of (targetPron?.definitions ?? [])) {
      for (const ex of (d.ex ?? [])) {
        if (ex.w?.includes(char) && ex.w.length >= 2 && ex.w.length <= 6) {
          allExCandidates.push(ex)
        }
      }
    }

    let selectedWord = null
    let selectedWordZhuyinList = null
    if (allExCandidates.length > 0) {
      // 隨機選一個候選詞（增加每次玩題目的變化性）
      const chosen = allExCandidates[Math.floor(Math.random() * allExCandidates.length)]
      selectedWord = chosen.w
      selectedWordZhuyinList = chosen.chars
    } else {
      // fallback：從 words 陣列取
      const words = targetPron?.words ?? []
      const valid = words.filter(w => w.includes(char))
      selectedWord = valid.length > 0
        ? valid[Math.floor(Math.random() * valid.length)]
        : (char + '字')
    }

    // 計算該字在詞語中的位置，以顯示□
    const charIndex = selectedWord.indexOf(char)

    // 組合其他讀音的詞語（用於多音字提示一）
    const otherPronWords = isPolyphone
      ? dictEntry.pronunciations
          .filter(p => p !== targetPron)
          .flatMap(p => p.words ?? [])
      : []

    return {
      character: char,              // 目標生字
      dictEntry,                    // 完整字典資料
      isPolyphone,                  // 是否多音字
      targetPronunciation: targetPron?.zhuyin ?? '',
      word: selectedWord,           // 出題詞語
      wordZhuyinList: selectedWordZhuyinList,  // 詞語各字注音（from ex.chars）
      charIndex,                    // 目標字在詞語中的索引
      radical: dictEntry.radical ?? '',             // 部首
      radicalZhuyin: '',            // 部首注音（若有）
      meaning: targetPron?.meaning ?? '',           // 字義
      otherPronWords,               // 其他讀音的詞語
      totalStrokes: dictEntry.total_strokes ?? 0,
    }
  }

  /**
   * 將完整字典陣列（JSONLoader.get('characters')）轉成以「字」為 key 的查詢字典
   * @param {Array} fullCharList - characters.json 完整資料陣列
   * @returns {Object}
   */
  _buildCharDict(fullCharList) {
    const dict = {}
    for (const entry of (fullCharList ?? [])) {
      const key = entry['字'] ?? entry.char
      if (key) dict[key] = entry
    }
    return dict
  }

  // ═══════════════════════════════════════════════════════
  // renderQuestion — 渲染題目 DOM
  // ═══════════════════════════════════════════════════════

  renderQuestion(question) {
    /**
     * UI 規格（SECTION 2.13）：
     * │  看詞語，寫出□的國字：           │
     * │  喜  □  （生字簿字純文字，□手寫）│
     * │  🪄魔法書：米字格手寫區          │
     * │   [↩撤銷]  [清除]    [確認]      │
     * │  [提示一 -半★]  [提示二 -半★]   │
     */

    // 建立詞語顯示 HTML（□=手寫佔位符，其餘字依注音規則）
    const wordDisplayHTML = this._buildWordDisplayHTML(question)

    const gameArea = this._getContainer()
    if (!gameArea) return

    gameArea.innerHTML = `
      <div class="writing-game" id="writing-game-container">

        <!-- 遊戲說明 -->
        <p class="writing-instruction">看詞語，寫出□的國字：</p>

        <!-- 詞語顯示區（含□） -->
        <div class="writing-word-display" id="writing-word-display">
          ${wordDisplayHTML}
        </div>

        <!-- 🪄 魔法書手寫區 -->
        <div class="writing-magic-book" id="writing-magic-book">
          <div class="magic-book-label">🪄 魔法書</div>
          <!-- 米字格 canvas -->
          <div class="writing-canvas-wrapper">
            <canvas
              id="writing-canvas"
              width="240"
              height="240"
              class="writing-canvas"
              aria-label="手寫輸入區"
            ></canvas>
            <!-- 米字格輔助線（SVG 疊加） -->
            <svg class="writing-grid-overlay" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
              <!-- 外框 -->
              <rect x="1" y="1" width="238" height="238" fill="none" stroke="#c8d8f0" stroke-width="1.5"/>
              <!-- 橫中線 -->
              <line x1="0" y1="120" x2="240" y2="120" stroke="#c8d8f0" stroke-width="1" stroke-dasharray="4,4"/>
              <!-- 縱中線 -->
              <line x1="120" y1="0" x2="120" y2="240" stroke="#c8d8f0" stroke-width="1" stroke-dasharray="4,4"/>
              <!-- 左上到右下斜線 -->
              <line x1="0" y1="0" x2="240" y2="240" stroke="#e8eef8" stroke-width="1" stroke-dasharray="4,4"/>
              <!-- 右上到左下斜線 -->
              <line x1="240" y1="0" x2="0" y2="240" stroke="#e8eef8" stroke-width="1" stroke-dasharray="4,4"/>
            </svg>
          </div>

          <!-- 手寫操作按鈕列 -->
          <div class="writing-btn-row" id="writing-btn-row">
            <button class="writing-btn writing-btn-undo" id="btn-undo" title="撤銷最後一筆">↩撤銷</button>
            <button class="writing-btn writing-btn-clear" id="btn-clear" title="清除全部">清除</button>
            <button class="writing-btn writing-btn-confirm writing-btn-primary" id="btn-confirm" title="確認答案">確認</button>
          </div>

          <!-- 辨識失敗提示（預設隱藏） -->
          <div class="writing-retry-msg" id="writing-retry-msg" style="display:none;">
            ✏️ 請再寫一次
          </div>

          <!-- 答錯二次後顯示正確答案 -->
          <div class="writing-correct-reveal" id="writing-correct-reveal" style="display:none;">
            <span class="writing-correct-label">正確答案：</span>
            <span class="writing-correct-char" id="writing-correct-char">${question.character}</span>
          </div>
        </div>

        <!-- 提示按鈕列 -->
        <div class="writing-hint-row" id="writing-hint-row">
          <button class="hint-btn" id="btn-hint1" data-level="1">
            💡 提示一 <span class="hint-cost">-½★</span>
          </button>
          <button class="hint-btn" id="btn-hint2" data-level="2">
            💡 提示二 <span class="hint-cost">-½★</span>
          </button>
        </div>

        <!-- 提示內容顯示區（預設隱藏） -->
        <div class="writing-hint-content" id="writing-hint-content" style="display:none;"></div>

      </div>
    `

    // 初始化 canvas 手寫
    this._initCanvas()

    // 綁定按鈕事件
    this._bindButtonEvents(question)
  }

  /**
   * 建立詞語的 HTML 顯示（□為手寫佔位符，其餘字依注音規則）
   * 注音規則：
   *   □ = 手寫區（不顯示文字）
   *   生字簿字 = 純文字（不加注音）
   *   非生字簿字 + 注音開 = 注音體
   */
  _buildWordDisplayHTML(question) {
    const { word, charIndex, wordZhuyinList, targetPronunciation } = question
    const zhuyinOn = AppState.settings?.zhuyinOn ?? AppState.zhuyinOn ?? true
    const charSet = new Set((AppState.characters ?? []).map(c => c['字'] ?? c.char))
    const allCharsDict = JSONLoader.get('characters') || []

    // 查詞語中某字的注音（優先用 wordZhuyinList）
    const getZhuyin = (ch, idx) => {
      if (wordZhuyinList?.length > idx) return wordZhuyinList[idx]?.z ?? ''
      const entry = allCharsDict.find(c => (c['字'] ?? c.char) === ch)
      return entry?.pronunciations?.[0]?.zhuyin ?? ''
    }

    return Array.from(word).map((ch, idx) => {
      if (idx === charIndex) {
        // □ + 目標生字注音：注音永遠顯示（題目提示，不受注音開關影響）
        if (targetPronunciation) {
          return `<span class="writing-char-blank-wrap">` +
            `<span class="writing-char-placeholder">□</span>` +
            `<span class="writing-blank-pron">${this._renderZhuyinHint(targetPronunciation)}</span>` +
            `</span>`
        }
        return `<span class="writing-char-placeholder">□</span>`
      }

      // 非目標字：生字簿字→純文字；非生字簿字+注音開→帶注音
      const inWordbook = charSet.has(ch)
      const z = (!inWordbook && zhuyinOn) ? getZhuyin(ch, idx) : ''
      if (z) {
        return `<span class="writing-char-unit">` +
          `<span class="writing-char-text">${ch}</span>` +
          `<span class="writing-char-pron">${this._renderZhuyinHint(z)}</span>` +
          `</span>`
      }
      return `<span class="writing-char-text">${ch}</span>`
    }).join('')
  }

  // 渲染詞語旁的小型直式注音（使用 pv2 系統）
  _renderZhuyinHint(pron) {
    if (!pron) return ''
    // 直接使用 CardPage 的 pv2 系統
    const INITIALS = new Set('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ')
    const MEDIALS  = new Set('ㄧㄨㄩ')
    const TONES    = new Set(['ˊ','ˇ','ˋ','˙'])
    let src = pron, tone = ''
    if (src.startsWith('˙')) { tone = '˙'; src = src.slice(1) }
    else if (src.length > 0 && TONES.has(src[src.length - 1])) {
      tone = src[src.length - 1]; src = src.slice(0, -1)
    }
    let initial = '', medial = '', final = ''
    for (const c of src) {
      if (INITIALS.has(c)) initial = c
      else if (MEDIALS.has(c)) medial = c
      else final += c
    }
    const count = [initial, medial, final].filter(Boolean).length
    const hasDot = tone === '˙'
    const dotCls = hasDot ? ' pv2--dot' : ''
    const dotHtml = hasDot ? `<span class="pv2-dot">${tone}</span>` : ''
    const toneHtml = (tone && tone !== '˙')
      ? `<span class="pv2-tone">${tone}</span>`
      : `<span class="pv2-tone pv2-empty"></span>`
    const toneCol = `<span class="pv2-tone-col"><span class="pv2-tone-spacer"></span>${toneHtml}<span class="pv2-tone-spacer"></span></span>`
    if (count === 1) {
      const sym = initial || medial || final
      return `<span class="pv2 pv2-a writing-pv2${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1 pv2-empty"></span><span class="pv2-r2">${sym}</span><span class="pv2-r3 pv2-empty"></span></span>${toneCol}</span>`
    }
    if (count === 2) {
      const slots = [initial, medial, final].filter(Boolean)
      return `<span class="pv2 pv2-b writing-pv2${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1">${slots[0]}</span><span class="pv2-r2 pv2-empty"></span><span class="pv2-r3">${slots[1]}</span></span>${toneCol}</span>`
    }
    return `<span class="pv2 pv2-c writing-pv2${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1">${initial}</span><span class="pv2-r2">${medial}</span><span class="pv2-r3">${final}</span></span>${toneCol}</span>`
  }

  // ═══════════════════════════════════════════════════════
  // _initCanvas — 初始化 canvas 手寫區
  // ═══════════════════════════════════════════════════════

  _initCanvas() {
    this._canvas = document.getElementById('writing-canvas')
    if (!this._canvas) return

    this._ctx = this._canvas.getContext('2d')

    // 設定繪圖樣式
    this._ctx.strokeStyle = '#1a1a2e'
    this._ctx.lineWidth = 6
    this._ctx.lineCap = 'round'
    this._ctx.lineJoin = 'round'

    // 重置本地筆畫 stack
    this._localStrokes = []
    this._currentStrokePoints = []
    // 同步清空 HandwritingManager 的 undo stack
    HandwritingManager.clearStrokes()

    // 綁定觸控/滑鼠事件
    this._bindDrawingEvents()
  }

  /**
   * 綁定手寫繪圖事件（滑鼠 + 觸控）
   */
  _bindDrawingEvents() {
    const canvas = this._canvas
    if (!canvas) return

    let drawing = false
    let lastX = 0
    let lastY = 0

    // 取得 canvas 相對坐標
    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      if (e.touches) {
        return {
          x: (e.touches[0].clientX - rect.left) * scaleX,
          y: (e.touches[0].clientY - rect.top) * scaleY,
        }
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      }
    }

    const onStart = (e) => {
      e.preventDefault()
      drawing = true
      const pos = getPos(e)
      lastX = pos.x
      lastY = pos.y
      this._ctx.beginPath()
      this._ctx.moveTo(lastX, lastY)
      // 開始收集本筆畫點陣
      this._currentStrokePoints = [{ x: lastX, y: lastY }]
    }

    const onMove = (e) => {
      e.preventDefault()
      if (!drawing) return
      const pos = getPos(e)
      this._ctx.lineTo(pos.x, pos.y)
      this._ctx.stroke()
      // 記錄點陣
      this._currentStrokePoints.push({ x: pos.x, y: pos.y })
      lastX = pos.x
      lastY = pos.y
    }

    const onEnd = (e) => {
      if (!drawing) return
      drawing = false
      // 將本筆畫存入本地 stack 並通知 HandwritingManager
      if (this._currentStrokePoints.length > 0) {
        const strokeData = { points: [...this._currentStrokePoints] }
        this._localStrokes.push(strokeData)
        HandwritingManager.recordStroke(strokeData)
        this._currentStrokePoints = []
      }
    }

    // 滑鼠事件
    canvas.addEventListener('mousedown', onStart)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseup', onEnd)
    canvas.addEventListener('mouseleave', onEnd)

    // 觸控事件
    canvas.addEventListener('touchstart', onStart, { passive: false })
    canvas.addEventListener('touchmove', onMove, { passive: false })
    canvas.addEventListener('touchend', onEnd)

    // 記錄清理函式
    this._cleanupFns.push(() => {
      canvas.removeEventListener('mousedown', onStart)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseup', onEnd)
      canvas.removeEventListener('mouseleave', onEnd)
      canvas.removeEventListener('touchstart', onStart)
      canvas.removeEventListener('touchmove', onMove)
      canvas.removeEventListener('touchend', onEnd)
    })
  }

  // ═══════════════════════════════════════════════════════
  // _bindButtonEvents — 綁定操作按鈕事件
  // ═══════════════════════════════════════════════════════

  _bindButtonEvents(question) {
    // [↩撤銷] 按鈕
    const btnUndo = document.getElementById('btn-undo')
    if (btnUndo) {
      const onUndo = () => this._handleUndo()
      btnUndo.addEventListener('click', onUndo)
      this._cleanupFns.push(() => btnUndo.removeEventListener('click', onUndo))
    }

    // [清除] 按鈕
    const btnClear = document.getElementById('btn-clear')
    if (btnClear) {
      const onClear = () => this._handleClear()
      btnClear.addEventListener('click', onClear)
      this._cleanupFns.push(() => btnClear.removeEventListener('click', onClear))
    }

    // [確認] 按鈕
    const btnConfirm = document.getElementById('btn-confirm')
    if (btnConfirm) {
      const onConfirm = () => this._handleConfirm()
      btnConfirm.addEventListener('click', onConfirm)
      this._cleanupFns.push(() => btnConfirm.removeEventListener('click', onConfirm))
    }

    // [提示一] 按鈕
    const btnHint1 = document.getElementById('btn-hint1')
    if (btnHint1) {
      const onHint1 = () => this.useHint(1)
      btnHint1.addEventListener('click', onHint1)
      this._cleanupFns.push(() => btnHint1.removeEventListener('click', onHint1))
    }

    // [提示二] 按鈕
    const btnHint2 = document.getElementById('btn-hint2')
    if (btnHint2) {
      const onHint2 = () => this.useHint(2)
      btnHint2.addEventListener('click', onHint2)
      this._cleanupFns.push(() => btnHint2.removeEventListener('click', onHint2))
    }
  }

  // ═══════════════════════════════════════════════════════
  // 手寫操作處理
  // ═══════════════════════════════════════════════════════

  /**
   * 撤銷最後一筆筆畫
   * 呼叫 HandwritingManager.undoLastStroke() 並重繪 canvas
   */
  _handleUndo() {
    // 從本地 stack 移除最後一筆
    this._localStrokes.pop()
    // 同步 HandwritingManager undo stack（會回傳剩餘，但我們用本地 stack 重繪）
    HandwritingManager.undoLastStroke()
    // 用本地 stack 重繪 canvas
    this._redrawStrokes(this._localStrokes)
  }

  /**
   * 清除全部筆畫
   */
  _handleClear() {
    // 清空本地筆畫 stack
    this._localStrokes = []
    this._currentStrokePoints = []
    HandwritingManager.clearStrokes()
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)
    }
    // 隱藏辨識失敗提示（清除後重新開始）
    const retryMsg = document.getElementById('writing-retry-msg')
    if (retryMsg) retryMsg.style.display = 'none'
  }

  /**
   * 確認送出手寫結果
   */
  async _handleConfirm() {
    // 防止重複觸發
    if (this._recognizing || this.isAnswering) return

    // 檢查是否有繪製任何筆畫（用本地 stack 判斷）
    if (this._localStrokes.length === 0) {
      this._showRetryMessage('請先在魔法書上寫字 ✏️')
      return
    }

    this._recognizing = true
    this._setButtonsEnabled(false)
    this._showRetryMessage('🔍 辨識中…', true)

    try {
      // 呼叫 HandwritingManager 進行辨識
      const result = await HandwritingManager.recognize(this._canvas, { mode: 'chinese' })

      // 辨識完成，隱藏「辨識中」提示
      this._hideRetryMessage()

      if (result && result.fallback === 'retry') {
        // 辨識失敗：顯示「請再寫一次」，清空 canvas，不計答錯
        this._handleRecognitionFailure()
      } else {
        // 辨識成功：取第一個漢字（Gemini 可能回傳詞語或帶空白）
        const rawText = result?.candidates?.[0] ?? result?.text ?? ''
        const recognized = (rawText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/)?.[0] ?? rawText.trim().charAt(0) ?? '')
        console.log(`[WritingGame] 辨識結果：「${rawText}」→ 取字「${recognized}」，答案「${this.currentQuestion?.character}」`)
        // 透過 GameEngine.submitAnswer 走標準流程
        await this.submitAnswer(recognized)
      }
    } catch (err) {
      console.error('[WritingGame] 辨識失敗：', err)
      this._handleRecognitionFailure()
    } finally {
      this._recognizing = false
      this._setButtonsEnabled(true)
    }
  }

  /**
   * 辨識失敗處理：顯示提示，清空 canvas，不計答錯
   */
  _handleRecognitionFailure() {
    this._handleClear()
    this._showRetryMessage('✏️ 請再寫一次')
  }

  /**
   * 顯示辨識重試訊息
   */
  _showRetryMessage(msg, persistent = false) {
    const retryMsg = document.getElementById('writing-retry-msg')
    if (retryMsg) {
      retryMsg.textContent = msg
      retryMsg.style.display = 'block'
      if (!persistent) {
        // 一般提示 2 秒後自動隱藏
        clearTimeout(this._retryMsgTimer)
        this._retryMsgTimer = setTimeout(() => {
          if (retryMsg) retryMsg.style.display = 'none'
        }, 2000)
      }
    }
  }

  _hideRetryMessage() {
    const retryMsg = document.getElementById('writing-retry-msg')
    if (retryMsg) retryMsg.style.display = 'none'
    clearTimeout(this._retryMsgTimer)
  }

  /**
   * 重繪筆畫（撤銷後使用）
   * @param {Array} strokes - 筆畫點陣資料 [{ points: [{x,y}] }]
   */
  _redrawStrokes(strokes) {
    if (!this._ctx || !this._canvas) return
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)
    if (!strokes || strokes.length === 0) return

    this._ctx.strokeStyle = '#1a1a2e'
    this._ctx.lineWidth = 6
    this._ctx.lineCap = 'round'
    this._ctx.lineJoin = 'round'

    for (const stroke of strokes) {
      const pts = stroke.points ?? stroke
      if (!pts || pts.length < 2) continue
      this._ctx.beginPath()
      this._ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        this._ctx.lineTo(pts[i].x, pts[i].y)
      }
      this._ctx.stroke()
    }
  }

  /**
   * 設定操作按鈕的啟用/停用狀態
   */
  _setButtonsEnabled(enabled) {
    const ids = ['btn-undo', 'btn-clear', 'btn-confirm']
    for (const id of ids) {
      const btn = document.getElementById(id)
      if (btn) btn.disabled = !enabled
    }
  }

  // ═══════════════════════════════════════════════════════
  // judgeAnswer — 答案判斷（GameEngine 呼叫）
  // ═══════════════════════════════════════════════════════

  async judgeAnswer(answer) {
    /**
     * 判斷邏輯（SECTION 9 D.1）：
     *   recognized === question.character → 答對
     * 注意：answer 已是 HandwritingManager 辨識出的文字
     */
    const question = this.currentQuestion
    if (!question) return { correct: false }

    const normalized = (answer ?? '').trim()
    const correct = normalized === question.character
    return { correct }
  }

  // ═══════════════════════════════════════════════════════
  // 動畫效果
  // ═══════════════════════════════════════════════════════

  async playCorrectAnimation(stars = 4) {
    console.log(`[WritingGame] 答對動畫開始，星星=${stars}`)
    const container = document.getElementById('writing-magic-book')
    if (container) {
      container.classList.remove('writing-book-shake', 'writing-book-close')
      container.classList.add('writing-book-glow')
    } else {
      console.warn('[WritingGame] 找不到 writing-magic-book')
    }

    // 播放答對音效
    if (AppState.settings?.soundOn !== false) {
      AudioManager.playEffect('correct')
    }

    // ★ 飛向右上角
    this._flyStarsToHeader(Math.min(Math.ceil(stars), 8))

    await this._delay(1000)
    if (container) container.classList.remove('writing-book-glow')
    this._updateHeaderStars()
    console.log('[WritingGame] 答對動畫完成')
  }

  async playWrongAnimation() {
    console.log('[WritingGame] 答錯一次動畫開始')
    const container = document.getElementById('writing-magic-book')
    if (container) {
      // 先移除所有動畫 class
      container.classList.remove('writing-book-glow', 'writing-book-shake', 'writing-book-close')
      // 強制 reflow：確保瀏覽器在移除後重新計算，使動畫每次都能重新播放
      void container.offsetWidth
      container.classList.add('writing-book-shake')
    } else {
      console.warn('[WritingGame] 找不到 writing-magic-book')
    }

    if (AppState.settings?.soundOn !== false) {
      AudioManager.playEffect('wrong')
    }

    await this._delay(600)
    if (container) container.classList.remove('writing-book-shake')
    this._handleClear()
    console.log('[WritingGame] 答錯一次動畫完成，canvas 已清空')
  }

  async showCorrectAnswer() {
    console.log('[WritingGame] 答錯二次，書本合起')
    const container = document.getElementById('writing-magic-book')
    if (container) {
      container.classList.remove('writing-book-shake', 'writing-book-glow')
      void container.offsetWidth
      container.classList.add('writing-book-close')
    }

    if (AppState.settings?.soundOn !== false) {
      AudioManager.playEffect('wrong')
    }

    // 等書本合起動畫結束（0.5s）
    await this._delay(550)

    // 顯示魔法書圖片（等比例縮入寫字框大小）
    const bookEl = document.getElementById('writing-magic-book')
    if (bookEl) {
      // 重置書本形變，讓圖片正常顯示
      bookEl.classList.remove('writing-book-close')
      void bookEl.offsetWidth

      // 覆蓋書本內容為魔法書圖片
      bookEl.innerHTML = `
        <div class="writing-book-reveal" style="
          display:flex; flex-direction:column; align-items:center; gap:10px;
          width:100%; padding:8px 0;
        ">
          <img
            src="./images/magic-book.png"
            alt="魔法書"
            class="writing-magic-book-img"
            style="
              width: min(72vw, 220px);
              height: min(72vw, 220px);
              object-fit: contain;
              border-radius: 12px;
              animation: sw-appear 0.4s ease;
            "
          />
          <div style="
            font-size:1rem; font-weight:700; color:#5a4fcf;
            background:#f0f4ff; border-radius:10px; padding:6px 16px;
          ">
            正確答案：<span style="font-size:2rem; color:#c0392b; font-weight:900;" id="writing-correct-char-reveal">${this.currentQuestion?.character || ''}</span>
          </div>
          <div style="font-size:0.82rem; color:#94a3b8; margin-top:4px;">即將進入下一題…</div>
        </div>
      `
    }

    // 2 秒後自動進下一題
    await this._delay(2000)
    this.nextQuestion()
  }

  /**
   * 星星飛向右上角動畫
   * @param {number} count - 顆數
   */
  _flyStarsToHeader(count) {
    if (typeof document === 'undefined' || count <= 0) return
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const star = document.createElement('div')
        star.textContent = '★'
        star.style.cssText = `
          position: fixed;
          font-size: 22px;
          color: #FFD700;
          text-shadow: 0 0 6px #FFA500;
          pointer-events: none;
          z-index: 9999;
          left: ${25 + Math.random() * 50}%;
          top: ${35 + Math.random() * 20}%;
          transition: all 0.75s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          opacity: 1;
        `
        document.body.appendChild(star)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          star.style.left = 'calc(100% - 100px)'
          star.style.top = '10px'
          star.style.opacity = '0'
          star.style.fontSize = '10px'
        }))
        setTimeout(() => star.remove(), 900)
      }, i * 80)
    }
  }

  /**
   * 更新 game-header 星星顯示（委派給 GameEngine.updateProgress）
   */
  _updateHeaderStars() {
    this.updateProgress()
  }

  // ═══════════════════════════════════════════════════════
  // getHint — 提示內容
  // ═══════════════════════════════════════════════════════

  getHint(level) {
    /**
     * 提示規則（SECTION 9 D.1）：
     *   多音字：提示一=不同音詞語；提示二=部首（帶注音）
     *   非多音：提示一=部首；提示二=字義
     */
    const question = this.currentQuestion
    if (!question) return ''

    const zhuyinOn = AppState.settings?.zhuyinOn ?? AppState.zhuyinOn ?? true
    const hintContent = document.getElementById('writing-hint-content')

    let hintText = ''

    if (question.isPolyphone) {
      // 多音字
      if (level === 1) {
        // 提示一：不同音的詞語
        const words = question.otherPronWords
        if (words && words.length > 0) {
          // 將詞語中的目標生字替換成注音 pv2（不直接顯示生字）
          const charSet = new Set((AppState.characters ?? []).map(c => c['字'] ?? c.char))
          const targetChar = question.character
          // 找目標字的其他讀音注音
          const allProns = question.dictEntry?.pronunciations ?? []
          const targetPron = allProns.find(p => p.zhuyin === question.targetPronunciation)
          const otherPronsMap = {}
          allProns.forEach(p => {
            if (p !== targetPron) {
              for (const w of (p.words ?? [])) {
                otherPronsMap[w] = p.zhuyin
              }
            }
          })
          const maskedWords = words.slice(0, 3).map(w => {
            const pronForWord = otherPronsMap[w] || ''
            if (!pronForWord) return w.replace(targetChar, '□')
            // 將詞語中目標字替換為 pv2 注音 HTML
            const zhuyinHtml = this._renderZhuyinHint(pronForWord)
            return w.replace(targetChar, `<span class="writing-hint-zhuyin">${zhuyinHtml}</span>`)
          }).join('、')
          hintText = `此字另一個讀音的詞語：<span class="writing-hint-words">${maskedWords}</span>`
        } else {
          hintText = `這個字有多種讀音，仔細想想這個詞語的讀音`
        }
      } else if (level === 2) {
        // 提示二：部首（帶注音）
        const radical = question.radical
        const radZhuyin = question.radicalZhuyin
        if (zhuyinOn && radZhuyin) {
          hintText = `部首是：${radical}（${radZhuyin}）`
        } else {
          hintText = `部首是：${radical}`
        }
      }
    } else {
      // 非多音字
      if (level === 1) {
        // 提示一：部首
        const radical = question.radical
        const radZhuyin = question.radicalZhuyin
        if (zhuyinOn && radZhuyin) {
          hintText = `部首是：${radical}（${radZhuyin}）`
        } else {
          hintText = `部首是：${radical}`
        }
      } else if (level === 2) {
        // 提示二：字義
        hintText = `意思是：${question.meaning || '請參考詞語語境'}`
      }
    }

    // 顯示提示內容
    if (hintContent) {
      hintContent.innerHTML = hintText
      hintContent.style.display = 'block'
    }

    // 停用已使用的提示按鈕
    const hintBtn = document.getElementById(`btn-hint${level}`)
    if (hintBtn) {
      hintBtn.disabled = true
      hintBtn.classList.add('hint-btn-used')
    }

    return hintText
  }

  // ═══════════════════════════════════════════════════════
  // onCorrect — 答對後處理（覆寫 GameEngine 的 hook）
  // ═══════════════════════════════════════════════════════

  /**
   * 答對後：重置 canvas，讓 GameEngine 繼續處理星星等邏輯
   */
  onAfterCorrect() {
    this._handleClear()
    // 隱藏提示內容
    const hintContent = document.getElementById('writing-hint-content')
    if (hintContent) hintContent.style.display = 'none'
  }

  /**
   * 換題前重置 UI（GameEngine 呼叫）
   */
  resetQuestionUI() {
    // 清空 canvas
    this._handleClear()
    // 隱藏各種訊息
    const retryMsg = document.getElementById('writing-retry-msg')
    if (retryMsg) retryMsg.style.display = 'none'
    const revealDiv = document.getElementById('writing-correct-reveal')
    if (revealDiv) revealDiv.style.display = 'none'
    const hintContent = document.getElementById('writing-hint-content')
    if (hintContent) hintContent.style.display = 'none'
    // 移除「下一題」按鈕（答錯二次才出現）
    const nextBtn = document.getElementById('btn-next-question')
    if (nextBtn) nextBtn.remove()
    // 恢復按鈕列
    const btnRow = document.getElementById('writing-btn-row')
    if (btnRow) btnRow.style.display = 'flex'
    // 重新啟用提示按鈕
    const hint1 = document.getElementById('btn-hint1')
    const hint2 = document.getElementById('btn-hint2')
    if (hint1) { hint1.disabled = false; hint1.classList.remove('hint-btn-used') }
    if (hint2) { hint2.disabled = false; hint2.classList.remove('hint-btn-used') }
    // 移除書本動畫 class
    const book = document.getElementById('writing-magic-book')
    if (book) {
      book.classList.remove('writing-book-glow', 'writing-book-shake', 'writing-book-close')
    }
  }

  // ═══════════════════════════════════════════════════════
  // 工具方法
  // ═══════════════════════════════════════════════════════

  /**
   * 非同步延遲
   * @param {number} ms
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ═══════════════════════════════════════════════════════
  // destroy — 清理資源（GameEngine 呼叫）
  // ═══════════════════════════════════════════════════════

  destroy() {
    // 執行所有清理函式（移除事件監聽）
    for (const fn of this._cleanupFns) {
      try { fn() } catch (e) { /* 忽略清理錯誤 */ }
    }
    this._cleanupFns = []

    // 清理 canvas 參考
    this._canvas = null
    this._ctx = null
    this._recognizing = false
    this._localStrokes = []
    this._currentStrokePoints = []

    // 清理 HandwritingManager canvas 綁定
    try {
      HandwritingManager.clearStrokes()
    } catch (e) { /* 忽略 */ }

    // 呼叫父類 destroy（處理中斷邏輯、WrongQueue 等）
    super.destroy()
  }
}

// ═══════════════════════════════════════════════════════════
// CSS 樣式（注入到 <head>，遊戲專用樣式）
// ═══════════════════════════════════════════════════════════

/**
 * 注入 writing.js 專用 CSS
 * 如果已存在則跳過（支援 HMR / 重複載入）
 */
function injectWritingStyles() {
  if (document.getElementById('writing-game-styles')) return

  const style = document.createElement('style')
  style.id = 'writing-game-styles'
  style.textContent = `
    /* ── 寫出國字遊戲整體容器 ── */
    .writing-game {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 12px 16px 24px;
      max-width: 420px;
      margin: 0 auto;
      font-family: 'Noto Sans TC', sans-serif;
    }

    /* ── 說明文字 ── */
    .writing-instruction {
      font-size: 1rem;
      color: #5a5a8a;
      margin: 0;
      font-weight: 500;
    }

    /* ── 詞語顯示區 ── */
    .writing-word-display {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      font-size: 2.2rem;
      font-weight: 700;
      color: #1a1a2e;
      min-height: 60px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .writing-char-text {
      line-height: 1.2;
    }

    /* □ 佔位符 */
    .writing-char-placeholder {
      display: inline-block;
      width: 2.2rem;
      height: 2.4rem;
      line-height: 2.4rem;
      text-align: center;
      color: #7b8cde;
      border-bottom: 3px solid #7b8cde;
      font-size: 2.2rem;
    }

    .writing-char-ruby {
      text-align: center;
    }
    .writing-char-ruby rt.zhuyin {
      font-family: 'BpmfIVS', 'Noto Sans TC', sans-serif;
      font-size: 0.45em;
      color: #6677aa;
    }

    /* ── 魔法書容器 ── */
    .writing-magic-book {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 16px;
      background: linear-gradient(135deg, #f0f4ff 0%, #e8eeff 100%);
      border: 2px solid #c0caee;
      border-radius: 16px;
      width: 100%;
      max-width: 290px;
      position: relative;
      transition: box-shadow 0.3s ease, transform 0.1s ease;
    }

    .magic-book-label {
      font-size: 0.95rem;
      font-weight: 600;
      color: #5a4fcf;
      letter-spacing: 1px;
    }

    /* ── Canvas 及米字格 ── */
    .writing-canvas-wrapper {
      position: relative;
      /* 響應式：小螢幕縮小，最大 240px
         canvas DOM 屬性 240×240 不變，scaleX/scaleY 由 getBoundingClientRect 動態補償 */
      width: min(72vw, 240px);
      height: min(72vw, 240px);
    }

    .writing-canvas {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      border-radius: 8px;
      background: #fff;
      touch-action: none; /* 防止觸控滾動干擾手寫 */
      z-index: 2;
    }

    .writing-grid-overlay {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none; /* 不擋手寫事件 */
      z-index: 1;
    }

    /* ── 操作按鈕列 ── */
    .writing-btn-row {
      display: flex;
      gap: 8px;
      width: 100%;
      justify-content: center;
    }

    .writing-btn {
      flex: 1;
      max-width: 80px;
      padding: 8px 4px;
      border: 2px solid #c0caee;
      border-radius: 10px;
      background: #fff;
      color: #5a5a8a;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }

    .writing-btn:hover:not(:disabled) {
      background: #eef0ff;
      transform: translateY(-1px);
    }

    .writing-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .writing-btn-primary {
      background: linear-gradient(135deg, #6c63ff, #5a4fcf);
      color: #fff;
      border-color: #5a4fcf;
    }

    .writing-btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #7c73ff, #6a5fdf);
    }

    /* ── 辨識失敗提示 ── */
    .writing-retry-msg {
      font-size: 0.9rem;
      color: #e05b5b;
      font-weight: 600;
      padding: 4px 10px;
      background: #fff0f0;
      border-radius: 8px;
      animation: fadeInOut 2s ease-in-out;
    }

    /* ── 正確答案顯示 ── */
    .writing-correct-reveal {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: #f0fff4;
      border: 1px solid #6fcf97;
      border-radius: 10px;
      font-size: 1rem;
    }

    .writing-correct-label {
      color: #27ae60;
      font-weight: 500;
    }

    .writing-correct-char {
      font-size: 2rem;
      font-weight: 700;
      color: #27ae60;
    }

    /* ── 提示按鈕列 ── */
    .writing-hint-row {
      display: flex;
      gap: 10px;
      width: 100%;
      max-width: 290px;
    }

    .hint-btn {
      flex: 1;
      padding: 9px 8px;
      border: 2px solid #f0c040;
      border-radius: 10px;
      background: #fffbea;
      color: #7a5e00;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .hint-btn:hover:not(:disabled) {
      background: #fff3b0;
    }

    .hint-btn:disabled,
    .hint-btn-used {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .hint-cost {
      color: #e07030;
      font-size: 0.8em;
    }

    /* ── 提示內容 ── */
    .writing-hint-content {
      width: 100%;
      max-width: 290px;
      padding: 10px 14px;
      background: #fffbe8;
      border: 1px solid #ffe082;
      border-radius: 10px;
      font-size: 0.95rem;
      color: #5a4a00;
      line-height: 1.5;
    }

    /* ── 動畫：魔法書光芒（答對） ── */
    @keyframes bookGlow {
      0%   { box-shadow: 0 0 0 0 rgba(108,99,255,0); }
      40%  { box-shadow: 0 0 32px 12px rgba(108,99,255,0.6); transform: scale(1.04); }
      100% { box-shadow: 0 0 0 0 rgba(108,99,255,0); transform: scale(1); }
    }

    .writing-book-glow {
      animation: bookGlow 1s ease-in-out;
    }

    /* ── 動畫：書本搖晃（答錯） ── */
    @keyframes bookShake {
      0%, 100% { transform: translateX(0); }
      20%      { transform: translateX(-8px) rotate(-3deg); }
      40%      { transform: translateX(8px) rotate(3deg); }
      60%      { transform: translateX(-6px) rotate(-2deg); }
      80%      { transform: translateX(6px) rotate(2deg); }
    }

    .writing-book-shake {
      animation: bookShake 0.6s ease-in-out;
    }

    /* ── 動畫：書本合起（答錯二次） ── */
    @keyframes bookClose {
      0%   { transform: scaleY(1); }
      50%  { transform: scaleY(0.05) scaleX(0.9); }
      100% { transform: scaleY(0.1) scaleX(0.9); }
    }

    .writing-book-close {
      animation: bookClose 0.5s ease-in-out forwards;
    }

    /* ── 動畫：淡入淡出 ── */
    @keyframes fadeInOut {
      0%   { opacity: 0; }
      20%  { opacity: 1; }
      70%  { opacity: 1; }
      100% { opacity: 0; }
    }

    @keyframes sw-appear {
      from { opacity: 0; transform: scale(0.85) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    
      /* ── RWD 平板（≥600px）── */
      @media (min-width: 600px) {
        .writing-game     { max-width: 520px; }
      }
/* ── RWD 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .writing-game { max-width: 760px; margin: 0 auto; }
    }
  `
  document.head.appendChild(style)
}

// 模組載入時立即注入樣式
injectWritingStyles()
