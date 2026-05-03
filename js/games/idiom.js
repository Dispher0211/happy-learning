/**
 * idiom.js — 成語配對 × 🚂 火車遊戲
 * Task 22
 *
 * 遊戲規則：
 *   模式一（30%）：拖曳4個字卡，排列成正確成語（排列車廂）
 *   模式二（70%）：火車叉路，選擇正確成語路線
 *
 * 題目來源：my_idioms（優先）→ idioms.json（related_characters含生字）
 * 提示一（模式一）：「第二個字是X」；（模式二）：「包含X字」
 * 提示二（共用）：顯示例句（依注音開關帶注音體）
 *
 * 星星：首次 ★3，重試 ★0.5
 *
 * 依賴：
 *   GameEngine.js（T14）、GameConfig.js（T15）
 *   state.js（T02）、firebase.js（T05）、audio.js（T08）
 *   forgetting.js（T09）、stars.js（T10）、wrong_queue.js（T11）
 *   sync.js（T12）
 */

import { GameEngine }   from './GameEngine.js'
import { GameConfig }   from './GameConfig.js'
import { AppState }     from '../state.js'
import { AudioManager } from '../audio.js'

// ═══════════════════════════════════════════════════════
//  常數
// ═══════════════════════════════════════════════════════

/** 模式一（拖曳排列車廂）佔全部題目的比例 */
const MODE1_RATIO = 0.30

/** 火車動畫速度（毫秒），連續答對時縮短 */
const TRAIN_SPEED_BASE = 3000
const TRAIN_SPEED_MIN  = 800

/** 火車進站後的慶祝暫停（毫秒） */
const ARRIVE_PAUSE = 1200

// ═══════════════════════════════════════════════════════
//  IdiomGame class
// ═══════════════════════════════════════════════════════

export class IdiomGame extends GameEngine {

  constructor () {
    super()

    // 本局成語題庫（已解析成題目物件的陣列）
    this._idiomPool = []

    // 目前火車速度（毫秒），連續答對時加速
    this._trainSpeed = TRAIN_SPEED_BASE

    // 火車動畫計時器 ID
    this._trainTimer = null

    // 目前模式：1 = 拖曳排列；2 = 叉路選擇
    this._currentMode = 2

    // 模式一：記錄目前拖曳狀態
    this._dragSrc = null

    // 全部答對計數，用於判斷進站特效
    this._allCorrect = true
  }

  // ───────────────────────────────────────────────────
  //  GameEngine 抽象方法實作
  // ───────────────────────────────────────────────────

  /**
   * loadQuestions(config)
   * 從 AppState 讀取成語池，建立本局題目清單
   * config: { count: number }
   */
  async loadQuestions (config) {
    const count = config?.count ?? 5

    // 1. 合併來源：my_idioms（優先）+ idioms.json（過濾 related_characters 含生字）
    const myIdioms    = AppState.idioms ?? []
    const allIdioms   = AppState.jsonData?.idioms ?? []
    const charSet     = new Set(AppState.characters?.map(c => c.char) ?? [])

    // idioms.json 中，related_characters 至少含一個生字簿字的成語
    const relatedIdioms = allIdioms.filter(entry =>
      entry.related_characters?.some(ch => charSet.has(ch))
    )

    // 將 my_idioms（字串陣列）轉換成統一格式
    const myIdiomEntries = myIdioms.map(idiomStr => {
      // 嘗試在 allIdioms 中找到完整資料
      const found = allIdioms.find(e => e.idiom === idiomStr)
      if (found) return found
      // 找不到：建立最小物件
      return {
        idiom:              idiomStr,
        zhuyin:             '',
        meaning:            '',
        example:            '',
        related_characters: []
      }
    })

    // 合併（my_idioms 去重後優先），最少需要2題
    const seen    = new Set()
    const merged  = []
    for (const entry of [...myIdiomEntries, ...relatedIdioms]) {
      if (!seen.has(entry.idiom)) {
        seen.add(entry.idiom)
        merged.push(entry)
      }
    }

    if (merged.length === 0) {
      // 沒有任何成語資料 → 回傳空陣列，GameEngine 會顯示提示
      return []
    }

    // 2. 打亂題庫（使用 GameEngine 提供的 _seededShuffle 或 Fisher-Yates）
    const shuffled = this._shuffle([...merged])

    // 3. 依 MODE1_RATIO 分配模式，並截取 count 題
    const questions = []
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      const entry  = shuffled[i]
      // 前 30% 為模式一（拖曳）
      const mode   = i < Math.round(count * MODE1_RATIO) ? 1 : 2
      // 錯誤選項：替換一個字為形近/同音字（模式二用）
      const distractors = this._buildDistractors(entry, shuffled)
      questions.push({
        char:        entry.related_characters?.[0] ?? entry.idiom[0],
        idiom:       entry.idiom,           // 4字成語字串
        zhuyin:      entry.zhuyin,
        meaning:     entry.meaning,
        example:     entry.example,
        mode,
        distractors  // 3個錯誤成語選項（模式二用）
      })
    }

    // 4. 存入 _idiomPool（供 renderQuestion 參考）
    this._idiomPool = questions
    return questions
  }

  /**
   * renderQuestion(question)
   * 依模式渲染題目 DOM
   */
  renderQuestion (question) {
    const app = document.getElementById('app')
    if (!app) return

    this._currentMode = question.mode
    this._allCorrect  = true   // 每題重置

    if (question.mode === 1) {
      app.innerHTML = this._renderMode1(question)
      this._bindMode1Events(question)
    } else {
      app.innerHTML = this._renderMode2(question)
      this._bindMode2Events(question)
    }

    // 啟動火車行駛動畫
    this._startTrain()
  }

  /**
   * judgeAnswer(answer)
   * answer: { idiom: string }  ← 玩家答案
   * 回傳 { correct: boolean, correctAnswer: string }
   */
  async judgeAnswer (answer) {
    const q       = this.currentQuestion
    const correct = answer?.idiom?.trim() === q.idiom.trim()
    return { correct, correctAnswer: q.idiom }
  }

  /**
   * playCorrectAnimation()
   * 答對特效：火車加速行駛
   */
  async playCorrectAnimation () {
    // 火車加速
    this._trainSpeed = Math.max(TRAIN_SPEED_MIN, this._trainSpeed - 400)
    this._animateTrain('correct')
    AudioManager.playEffect('correct')

    // 若所有題目已答完，播放進站特效
    if (this.questionIndex >= this.questions.length - 1) {
      await this._playArriveAnimation()
    }

    return Promise.resolve()
  }

  /**
   * playWrongAnimation()
   * 答錯特效：火車剎車抖動
   */
  async playWrongAnimation () {
    this._animateTrain('wrong')
    AudioManager.playEffect('wrong')
    return Promise.resolve()
  }

  /**
   * showCorrectAnswer(question)
   * 顯示正確答案（第二次答錯後呼叫）
   */
  showCorrectAnswer (question) {
    // 模式一：高亮正確排列
    if (question.mode === 1) {
      const slots = document.querySelectorAll('.idiom-slot')
      const chars = question.idiom.split('')
      slots.forEach((slot, i) => {
        slot.textContent  = chars[i]
        slot.className    = 'idiom-slot correct-reveal'
      })
    } else {
      // 模式二：高亮正確叉路
      document.querySelectorAll('.fork-option').forEach(btn => {
        if (btn.dataset.idiom === question.idiom) {
          btn.classList.add('correct-reveal')
        } else {
          btn.classList.add('wrong-reveal')
        }
      })
    }
  }

  /**
   * getHint(level)
   * level 1：模式一→「第二個字是X」；模式二→「包含X字」
   * level 2：顯示例句（依注音開關）
   */
  getHint (level) {
    const q = this.currentQuestion
    if (level === 1) {
      if (q.mode === 1) {
        return `第二個字是「${q.idiom[1]}」`
      } else {
        return `成語中包含「${q.idiom[1]}」這個字`
      }
    }
    if (level === 2) {
      const example = q.example || q.meaning || '（無例句）'
      return example
    }
    return null
  }

  // ───────────────────────────────────────────────────
  //  模式一：拖曳排列車廂
  // ───────────────────────────────────────────────────

  /** 產生模式一的 HTML */
  _renderMode1 (q) {
    const chars = q.idiom.split('')
    // 打亂字卡順序（避免直接顯示正確順序）
    const shuffled = this._shuffle([...chars])

    const cardHtml = shuffled.map((ch, i) =>
      `<div class="idiom-card" draggable="true" data-char="${ch}" data-idx="${i}">
        ${ch}
      </div>`
    ).join('')

    const slotHtml = chars.map((_, i) =>
      `<div class="idiom-slot" data-pos="${i}"></div>`
    ).join('')

    return `
      <div class="game-container idiom-game mode1">
        ${this._renderTrainScene()}
        <div class="game-title">🚂 排列車廂，組成成語</div>
        <div class="idiom-cards-area">
          ${cardHtml}
        </div>
        <div class="idiom-slots-area">
          ${slotHtml}
        </div>
        <div class="idiom-hint-display" id="idiom-hint"></div>
        ${this._renderHintButton()}
        ${this._renderProgressBar()}
      </div>
    `
  }

  /** 綁定模式一的拖曳事件 */
  _bindMode1Events (q) {
    const cards = document.querySelectorAll('.idiom-card')
    const slots = document.querySelectorAll('.idiom-slot')

    // 字卡：可拖曳到格子，也可互相交換
    cards.forEach(card => {
      card.addEventListener('dragstart', e => {
        this._dragSrc = { type: 'card', el: card }
        e.dataTransfer.effectAllowed = 'move'
      })
    })

    slots.forEach(slot => {
      slot.addEventListener('dragover', e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        slot.classList.add('drag-over')
      })
      slot.addEventListener('dragleave', () => {
        slot.classList.remove('drag-over')
      })
      slot.addEventListener('drop', e => {
        e.preventDefault()
        slot.classList.remove('drag-over')
        if (!this._dragSrc) return

        const src = this._dragSrc
        this._dragSrc = null

        if (src.type === 'card') {
          // 格子原有字換回字卡區
          if (slot.textContent.trim()) {
            const prevChar = slot.textContent.trim()
            this._returnToCardArea(prevChar)
          }
          // 放入格子
          slot.textContent = src.el.dataset.char
          slot.dataset.char = src.el.dataset.char
          // 隱藏原字卡
          src.el.style.visibility = 'hidden'
        }

        // 每次 drop 後檢查是否全部填完
        this._checkMode1Complete(q)
      })
    })

    // 點擊格子可取回字卡
    slots.forEach(slot => {
      slot.addEventListener('click', () => {
        if (slot.dataset.char) {
          this._returnToCardArea(slot.dataset.char)
          slot.textContent   = ''
          slot.dataset.char  = ''
        }
      })
    })
  }

  /** 將字放回字卡區（讓對應的 .idiom-card 重新可見） */
  _returnToCardArea (ch) {
    const card = [...document.querySelectorAll('.idiom-card')]
      .find(c => c.dataset.char === ch && c.style.visibility === 'hidden')
    if (card) card.style.visibility = 'visible'
  }

  /** 檢查模式一是否全部填完並自動送出 */
  _checkMode1Complete (q) {
    const slots = [...document.querySelectorAll('.idiom-slot')]
    const allFilled = slots.every(s => s.dataset.char)
    if (!allFilled) return

    const answer = slots.map(s => s.dataset.char).join('')
    // 自動提交
    this.submitAnswer({ idiom: answer })
  }

  // ───────────────────────────────────────────────────
  //  模式二：叉路選正確成語
  // ───────────────────────────────────────────────────

  /** 產生模式二的 HTML */
  _renderMode2 (q) {
    // 4個選項：1個正確 + 3個干擾
    const options = this._shuffle([
      { idiom: q.idiom, correct: true },
      ...q.distractors.map(d => ({ idiom: d, correct: false }))
    ])

    const optionsHtml = options.map((opt, i) => {
      const label = ['左線', '右線', '直行', '迴轉'][i] ?? `路線${i + 1}`
      return `
        <button class="fork-option" data-idiom="${opt.idiom}" aria-label="${opt.idiom}">
          <span class="fork-label">${label}</span>
          <span class="fork-idiom">${opt.idiom}</span>
        </button>
      `
    }).join('')

    return `
      <div class="game-container idiom-game mode2">
        ${this._renderTrainScene()}
        <div class="game-title">🚂 選對叉路，讓火車通過！</div>
        <div class="fork-options">
          ${optionsHtml}
        </div>
        <div class="idiom-hint-display" id="idiom-hint"></div>
        ${this._renderHintButton()}
        ${this._renderProgressBar()}
      </div>
    `
  }

  /** 綁定模式二的點擊事件 */
  _bindMode2Events (q) {
    document.querySelectorAll('.fork-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.isAnswering) return
        const idiom = btn.dataset.idiom
        this.submitAnswer({ idiom })
      })
    })
  }

  // ───────────────────────────────────────────────────
  //  提示系統
  // ───────────────────────────────────────────────────

  /**
   * 覆寫 useHint：在 DOM 更新提示文字後呼叫父類
   */
  useHint (level) {
    // 先取得提示文字
    const hintText = this.getHint(level)
    if (hintText) {
      const el = document.getElementById('idiom-hint')
      if (el) {
        el.textContent = `💡 ${hintText}`
        el.classList.add('hint-shown')
      }
    }
    // 呼叫父類（扣星、記錄 usedHints）
    super.useHint(level)
  }

  // ───────────────────────────────────────────────────
  //  火車動畫輔助
  // ───────────────────────────────────────────────────

  /** 渲染火車場景 HTML 骨架 */
  _renderTrainScene () {
    return `
      <div class="train-scene" id="train-scene">
        <div class="train-track"></div>
        <div class="train" id="game-train">🚂</div>
        <div class="train-smoke" id="train-smoke"></div>
      </div>
    `
  }

  /** 啟動火車持續行駛動畫 */
  _startTrain () {
    const train = document.getElementById('game-train')
    if (!train) return
    train.style.transition = `transform ${this._trainSpeed}ms linear`
    train.style.transform  = 'translateX(80vw)'
    // 循環：到達右側後立刻回到左側重新出發
    this._trainTimer = setInterval(() => {
      const t = document.getElementById('game-train')
      if (!t) { clearInterval(this._trainTimer); return }
      t.style.transition = 'none'
      t.style.transform  = 'translateX(-10vw)'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          t.style.transition = `transform ${this._trainSpeed}ms linear`
          t.style.transform  = 'translateX(80vw)'
        })
      })
    }, this._trainSpeed + 100)
  }

  /** 停止火車動畫（換題時呼叫） */
  _stopTrain () {
    if (this._trainTimer) {
      clearInterval(this._trainTimer)
      this._trainTimer = null
    }
  }

  /** 播放答對/答錯的火車動畫效果 */
  _animateTrain (type) {
    const train = document.getElementById('game-train')
    if (!train) return
    train.classList.remove('train-correct', 'train-wrong')
    void train.offsetWidth  // 強制 reflow
    train.classList.add(`train-${type}`)
    setTimeout(() => train.classList.remove(`train-${type}`), 600)
  }

  /** 全部答對：播放火車進站特效 */
  async _playArriveAnimation () {
    this._stopTrain()
    const train = document.getElementById('game-train')
    if (train) {
      train.style.transition = `transform ${600}ms ease-out`
      train.style.transform  = 'translateX(40vw)'
      train.classList.add('train-arrive')
    }
    // 等待進站動畫完成
    await new Promise(r => setTimeout(r, ARRIVE_PAUSE))
  }

  // ───────────────────────────────────────────────────
  //  干擾選項建立
  // ───────────────────────────────────────────────────

  /**
   * 為模式二建立3個錯誤選項
   * 策略：替換其中一個字為形近字（若有資料）或隨機替換
   */
  _buildDistractors (entry, pool) {
    const distractors = []
    const usedIdioms  = new Set([entry.idiom])

    // 策略一：從其他成語借字替換
    for (const other of pool) {
      if (distractors.length >= 3) break
      if (usedIdioms.has(other.idiom)) continue
      // 替換第一個字
      const variant = other.idiom[0] + entry.idiom.slice(1)
      if (!usedIdioms.has(variant) && variant !== entry.idiom) {
        distractors.push(variant)
        usedIdioms.add(variant)
      }
    }

    // 策略二：若不足3個，替換不同位置的字
    const fallbackChars = ['大', '小', '上', '下', '好', '多', '少', '高', '長', '新']
    for (let pos = 0; pos < 4 && distractors.length < 3; pos++) {
      for (const ch of fallbackChars) {
        if (ch === entry.idiom[pos]) continue
        const variant = entry.idiom.split('')
        variant[pos]  = ch
        const vStr    = variant.join('')
        if (!usedIdioms.has(vStr)) {
          distractors.push(vStr)
          usedIdioms.add(vStr)
          break
        }
      }
    }

    // 確保剛好3個（防萬一）
    while (distractors.length < 3) {
      distractors.push(entry.idiom.slice(0, 3) + '？')
    }

    return distractors.slice(0, 3)
  }

  // ───────────────────────────────────────────────────
  //  通用輔助 HTML
  // ───────────────────────────────────────────────────

  /** 渲染提示按鈕 */
  _renderHintButton () {
    return `
      <div class="hint-area">
        <button class="btn-hint" id="btn-hint" onclick="window._idiomGame?.useHint(1)">
          💡 提示
        </button>
      </div>
    `
  }

  /** 渲染進度條 */
  _renderProgressBar () {
    const current = (this.questionIndex ?? 0) + 1
    const total   = this.questions?.length ?? 1
    const pct     = Math.round((current / total) * 100)
    return `
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width:${pct}%"></div>
        <span class="progress-text">${current} / ${total}</span>
      </div>
    `
  }

  // ───────────────────────────────────────────────────
  //  工具：Fisher-Yates 打亂
  // ───────────────────────────────────────────────────

  _shuffle (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  // ───────────────────────────────────────────────────
  //  生命週期：覆寫 destroy
  // ───────────────────────────────────────────────────

  destroy () {
    // 停止火車計時器，避免 memory leak
    this._stopTrain()
    // 清除全域參考
    if (window._idiomGame === this) delete window._idiomGame
    // 呼叫父類 destroy（處理 wrongPool 中斷等）
    super.destroy()
  }

  // ───────────────────────────────────────────────────
  //  init 覆寫：注册全域參考供 HTML onclick 使用
  // ───────────────────────────────────────────────────

  async init (config) {
    // 注冊全域參考（提示按鈕的 onclick 需要）
    window._idiomGame = this
    return super.init(config)
  }
}

// ═══════════════════════════════════════════════════════
//  匯出（供 GamePage / random.js 使用）
// ═══════════════════════════════════════════════════════

export default IdiomGame
