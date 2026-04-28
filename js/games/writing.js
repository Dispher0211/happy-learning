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

// ═══════════════════════════════════════════════════════════
// WritingGame 主類別
// ═══════════════════════════════════════════════════════════

export class WritingGame extends GameEngine {
  constructor() {
    super('writing')
    // 手寫 canvas 相關
    this._canvas = null
    this._ctx = null
    // 題目資料（loadQuestions 後填入）
    this._questions = []
    // 事件監聽器清理函式陣列
    this._cleanupFns = []
    // 是否正在等待辨識結果
    this._recognizing = false
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
     */
    const count = config?.count ?? 10

    // 從遺忘曲線取排序生字（整合 WrongQueue，前置高遺忘字）
    const sorted = await ForgettingCurve.getSortedQueue(
      AppState.characters,
      count
    )

    // 取得 characters.json 字典供查詢詞語、部首等資訊
    const charDict = this._buildCharDict(AppState.characters)

    // 組合每題資料
    this._questions = sorted.map(charEntry => {
      const char = typeof charEntry === 'string' ? charEntry : charEntry.char ?? charEntry['字']
      const dictEntry = charDict[char]
      return this._buildQuestion(char, dictEntry)
    }).filter(q => q !== null)

    return this._questions
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

    // 選出包含該字的詞語（從目標讀音的 words 中取一個）
    const words = targetPron?.words ?? []
    const selectedWord = words.find(w => w.includes(char)) ?? (char + '字')

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
      charIndex,                    // 目標字在詞語中的索引
      radical: dictEntry.radical ?? '',             // 部首
      radicalZhuyin: '',            // 部首注音（若有）
      meaning: targetPron?.meaning ?? '',           // 字義
      otherPronWords,               // 其他讀音的詞語
      totalStrokes: dictEntry.total_strokes ?? 0,
    }
  }

  /**
   * 將 AppState.characters 陣列轉成以「字」為 key 的字典
   * @param {Array} characters
   * @returns {Object}
   */
  _buildCharDict(characters) {
    const dict = {}
    for (const entry of (characters ?? [])) {
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

    const gameArea = document.getElementById('game-area')
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
    const { word, charIndex } = question
    const zhuyinOn = AppState.settings?.zhuyinOn ?? AppState.zhuyinOn ?? true
    const charSet = new Set((AppState.characters ?? []).map(c => c['字'] ?? c.char))

    return Array.from(word).map((ch, idx) => {
      if (idx === charIndex) {
        // □ 手寫佔位符
        return `<span class="writing-char-placeholder" aria-label="填入生字">□</span>`
      }

      const isInStudyList = charSet.has(ch)

      if (isInStudyList || !zhuyinOn) {
        // 生字簿內的字或注音關閉：純文字顯示
        return `<span class="writing-char-text">${ch}</span>`
      } else {
        // 非生字簿字且注音開：加注音體（ruby）
        // 注音資料從 characters.json 查找；查無時僅顯示文字
        const dictEntry = (AppState.characters ?? []).find(c => (c['字'] ?? c.char) === ch)
        const zhuyin = dictEntry?.pronunciations?.[0]?.zhuyin ?? ''
        if (zhuyin) {
          return `<ruby class="writing-char-ruby"><rb>${ch}</rb><rt class="zhuyin">${zhuyin}</rt></ruby>`
        } else {
          return `<span class="writing-char-text">${ch}</span>`
        }
      }
    }).join('')
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

    // 初始化 HandwritingManager（傳入 canvas，手寫 stack 重置）
    HandwritingManager.setCanvas(this._canvas)

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
      // 通知 HandwritingManager 開始新筆畫
      HandwritingManager.beginStroke(lastX, lastY)
    }

    const onMove = (e) => {
      e.preventDefault()
      if (!drawing) return
      const pos = getPos(e)
      this._ctx.lineTo(pos.x, pos.y)
      this._ctx.stroke()
      HandwritingManager.addPoint(pos.x, pos.y)
      lastX = pos.x
      lastY = pos.y
    }

    const onEnd = (e) => {
      if (!drawing) return
      drawing = false
      HandwritingManager.endStroke()
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
    const remaining = HandwritingManager.undoLastStroke()
    // 清空 canvas 後重繪剩餘筆畫
    this._redrawStrokes(remaining)
  }

  /**
   * 清除全部筆畫
   */
  _handleClear() {
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

    // 檢查是否有繪製任何筆畫
    if (HandwritingManager.getStrokeCount() === 0) {
      this._showRetryMessage('請先在魔法書上寫字 ✏️')
      return
    }

    this._recognizing = true
    this._setButtonsEnabled(false)

    try {
      // 呼叫 HandwritingManager 進行辨識
      const result = await HandwritingManager.recognize(this._canvas, { mode: 'chinese' })

      if (result && result.fallback === 'retry') {
        // 辨識失敗：顯示「請再寫一次」，清空 canvas，不計答錯
        this._handleRecognitionFailure()
      } else {
        // 辨識成功：取第一個候選字
        const recognized = result?.candidates?.[0] ?? result?.text ?? ''
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
  _showRetryMessage(msg) {
    const retryMsg = document.getElementById('writing-retry-msg')
    if (retryMsg) {
      retryMsg.textContent = msg
      retryMsg.style.display = 'block'
      // 2秒後自動隱藏
      setTimeout(() => {
        if (retryMsg) retryMsg.style.display = 'none'
      }, 2000)
    }
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
    if (!question) return false

    const normalized = (answer ?? '').trim()
    return normalized === question.character
  }

  // ═══════════════════════════════════════════════════════
  // 動畫效果
  // ═══════════════════════════════════════════════════════

  /**
   * 答對動畫：魔法書大放光芒，N顆★飛向右上角
   */
  async playCorrectAnimation() {
    const container = document.getElementById('writing-magic-book')
    if (!container) return

    // 移除答錯動畫 class（若有）
    container.classList.remove('writing-book-shake', 'writing-book-close')

    // 加入光芒動畫 class
    container.classList.add('writing-book-glow')

    // 播放答對音效
    if (AppState.settings?.soundOn !== false) {
      AudioManager.play('correct')
    }

    // 等待動畫完成
    await this._delay(1000)
    container.classList.remove('writing-book-glow')
  }

  /**
   * 答錯一次動畫：書本搖晃，清空重寫
   */
  async playWrongAnimation() {
    const container = document.getElementById('writing-magic-book')
    if (!container) return

    // 書本搖晃
    container.classList.remove('writing-book-glow')
    container.classList.add('writing-book-shake')

    // 播放答錯音效
    if (AppState.settings?.soundOn !== false) {
      AudioManager.play('wrong')
    }

    await this._delay(600)
    container.classList.remove('writing-book-shake')

    // 清空 canvas 供重寫
    this._handleClear()
  }

  /**
   * 顯示正確答案：書本合起，顯示答案
   */
  async showCorrectAnswer() {
    const container = document.getElementById('writing-magic-book')
    if (!container) return

    // 書本合起動畫
    container.classList.add('writing-book-close')

    // 顯示正確答案
    const revealDiv = document.getElementById('writing-correct-reveal')
    if (revealDiv) {
      revealDiv.style.display = 'flex'
    }

    // 隱藏手寫操作按鈕（已無需再寫）
    const btnRow = document.getElementById('writing-btn-row')
    if (btnRow) btnRow.style.display = 'none'

    await this._delay(500)
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
          hintText = `此字另一個讀音的詞語：${words.slice(0, 3).join('、')}`
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
      hintContent.textContent = hintText
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
      width: 240px;
      height: 240px;
    }

    .writing-canvas {
      position: absolute;
      top: 0; left: 0;
      width: 240px;
      height: 240px;
      cursor: crosshair;
      border-radius: 8px;
      background: #fff;
      touch-action: none; /* 防止觸控滾動干擾手寫 */
      z-index: 2;
    }

    .writing-grid-overlay {
      position: absolute;
      top: 0; left: 0;
      width: 240px;
      height: 240px;
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
  `
  document.head.appendChild(style)
}

// 模組載入時立即注入樣式
injectWritingStyles()
