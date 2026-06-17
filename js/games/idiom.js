/**
 * idiom.js — 成語配對 × 🚂 火車遊戲
 * Task 22
 *
 * 遊戲規則：
 *   模式一（30%）：火車從右邊進入，定位後消失，小朋友將字卡拖到4個車廂排列成成語
 *   模式二（70%）：火車叉路選正確路線
 *
 * 修正：
 *   1. super('idiom') 修正標題 undefined 問題
 *   2. 模式一加入 touch 拖曳支援
 *   3. 使用 train.png 圖片做 CSS 動畫（從右入場→停下→消失）搭配 train.mp3
 *   4. 車廂格子支援拖放與 touch 放置
 */

import { GameEngine }   from './GameEngine.js'
import { GameConfig }   from './GameConfig.js'
import { AppState }     from '../state.js'
import { AudioManager } from '../audio.js'
import { JSONLoader }   from '../json_loader.js'
import { toTextArray, getPriorityKeySet, shuffleWithPriorityFirst } from '../content_filter.js'

// ═══════════════════════════════════════════════════════
//  常數
// ═══════════════════════════════════════════════════════

/** 模式一（拖曳排列車廂）佔全部題目的比例 */
// GitHub Pages 路徑前綴（與 audio.js 同邏輯）
const _pathPrefix = location.pathname.startsWith('/happy-learning')
  ? '/happy-learning'
  : ''

/** 模式一（拖曳排列車廂）佔全部題目的比例 */
const MODE1_RATIO = 0.30

/** 火車入場動畫時間（毫秒） */
const TRAIN_ENTER_MS = 2500

/** 火車出場動畫時間（毫秒） */
const TRAIN_EXIT_MS = 1200

/** 火車停留等待互動時間（定位後顯示車廂） */
const TRAIN_STAY_MS = 2000

// ═══════════════════════════════════════════════════════
//  IdiomGame class
// ═══════════════════════════════════════════════════════

export class IdiomGame extends GameEngine {

  constructor (options = {}) {
    // ✅ 修正：傳入 'idiom' 讓 GameEngine 能正確取得遊戲名稱
    super('idiom', options)

    // 本局成語題庫
    this._idiomPool = []

    // touch 拖曳狀態
    this._touchDragEl   = null   // 正在被拖曳的 DOM 元素
    this._touchClone    = null   // touch 拖曳時的視覺複製元素
    this._touchOffsetX  = 0
    this._touchOffsetY  = 0

    // 全部答對計數，用於判斷進站特效
    this._allCorrect = true

    // 目前模式：1 = 拖曳排列；2 = 叉路選擇
    this._currentMode = 2

    // 火車動畫狀態
    this._trainAnimating = false
  }

  // ───────────────────────────────────────────────────
  //  GameEngine 抽象方法實作
  // ───────────────────────────────────────────────────

  /**
   * loadQuestions(config)
   */
  async loadQuestions (config) {
    const count     = config?.count ?? 5
    const allIdioms = JSONLoader.get('idioms') ?? []

    // ── 1. 從成語簿（家長設定）取得完整資料 ──
    // v4.3：過濾「暫停」成語；「優先」成語加權，更容易被選中
    const myIdioms        = toTextArray(AppState.idioms ?? [], ['idiom'])
    const priorityIdioms  = getPriorityKeySet(AppState.idioms ?? [], ['idiom'])
    const myIdiomEntries = myIdioms
      .map(str => allIdioms.find(e => e.idiom === str))
      .filter(Boolean)

    // ── 2. 補充：從全庫隨機取，填滿至 count 題 ──
    const mySet   = new Set(myIdioms)
    const extra   = this._shuffle(
      allIdioms.filter(e => !mySet.has(e.idiom) && e.meaning)
    )

    // 合併：成語簿優先（其中「優先」成語排最前），不足再補全庫
    const pool = [
      ...shuffleWithPriorityFirst(myIdiomEntries, priorityIdioms, e => e.idiom),
      ...extra,
    ]

    const seen      = new Set()
    const candidate = []
    for (const entry of pool) {
      if (!seen.has(entry.idiom)) {
        seen.add(entry.idiom)
        candidate.push(entry)
      }
      if (candidate.length >= count) break
    }

    if (candidate.length === 0) return []

    const questions = candidate.map((entry) => ({
      char:        entry.related_characters?.[0] ?? entry.idiom[0],
      idiom:       entry.idiom,
      zhuyin:      entry.zhuyin,
      meaning:     entry.meaning,
      example:     entry.example,
      mode:        Math.random() < MODE1_RATIO ? 1 : 2,
      distractors: this._buildDistractors(entry, candidate),
    }))

    this._idiomPool = questions
    this.questions  = questions
    return this.questions
  }

  /**
   * renderQuestion(question)
   */
  renderQuestion (question) {
    const app = this._getContainer()
    if (!app) return

    this._currentMode = question.mode
    this._allCorrect  = true

    if (question.mode === 1) {
      this._renderMode1WithTrainAnimation(question, app)
    } else {
      app.innerHTML = this._renderMode2(question)
      this._bindMode2Events(question)
    }
  }

  /**
   * judgeAnswer(answer)
   */
  async judgeAnswer (answer) {
    const q       = this.currentQuestion
    const correct = answer?.idiom?.trim() === q.idiom.trim()
    return { correct, correctAnswer: q.idiom }
  }

  /**
   * playCorrectAnimation()
   */
  async playCorrectAnimation () {
    AudioManager.playEffect('correct')
    const container = document.getElementById('idiom-game-wrap')
    if (container) {
      container.classList.add('flash-correct')
      setTimeout(() => container.classList.remove('flash-correct'), 600)
    }
    if (this._currentMode === 1) {
      await this._animateTrainOut()
    }
  }

  /**
   * playWrongAnimation()
   */
  async playWrongAnimation () {
    AudioManager.playEffect('wrong')
    const container = document.getElementById('idiom-game-wrap')
    if (container) {
      container.classList.add('shake-wrong')
      setTimeout(() => container.classList.remove('shake-wrong'), 600)
    }
    return Promise.resolve()
  }

  /**
   * showCorrectAnswer(question)
   */
  showCorrectAnswer (question) {
    if (question.mode === 1) {
      const slots = document.querySelectorAll('.wagon-slot')
      const chars = question.idiom.split('')
      slots.forEach((slot, i) => {
        slot.dataset.char       = chars[i]
        slot.textContent        = chars[i]
        slot.classList.add('filled')
        slot.style.background   = 'rgba(134,239,172,.65)'
        slot.style.borderColor  = '#16a34a'
        slot.style.borderStyle  = 'solid'
      })
    } else {
      document.querySelectorAll('.fork-option').forEach(btn => {
        if (btn.dataset.idiom === question.idiom) {
          btn.style.background = '#bbf7d0'
          btn.style.border     = '2px solid #16a34a'
        } else {
          btn.style.opacity = '0.4'
        }
      })
    }
  }

  /**
   * getHint(level)
   */
  getHint (level) {
    const q = this.currentQuestion
    if (level === 1) {
      return q.mode === 1
        ? `第二個字是「${q.idiom[1]}」`
        : `成語中包含「${q.idiom[1]}」這個字`
    }
    if (level === 2) {
      return q.example || q.meaning || '（無例句）'
    }
    return null
  }

  // ───────────────────────────────────────────────────
  //  模式一：火車入場 + 車廂拖放
  // ───────────────────────────────────────────────────

  /**
   * 模式一主流程：
   *   1. 播放 train.mp3
   *   2. CSS 火車圖片從右邊進入 → 停在中央
   *   3. 短暫停留後，顯示車廂互動區
   *   4. 答題後，fire train.mp3 + 火車向左開走消失
   */
  _renderMode1WithTrainAnimation (q, app) {
    app.innerHTML = this._buildMode1Shell(q)
    this._bindHintButton()

    const _showInteractive = () => {
      const wagonArea = document.getElementById('wagon-interactive')
      if (wagonArea) {
        wagonArea.style.transition = 'opacity 0.5s ease, transform 0.5s ease'
        wagonArea.style.opacity    = '1'
        wagonArea.style.transform  = 'translateY(0)'
      }
      this._bindMode1Events(q)
    }

    const unit  = document.getElementById('train-unit')
    const stage = document.getElementById('train-stage')
    if (!unit || !stage) { _showInteractive(); return }

    // 計算目標 left：讓 train-unit 水平置中於 stage
    // train-unit 寬度 = 5 個單元 × 90px = 450px
    // stage 寬度動態取得
    const unitW  = 5 * 140  // px（5個單元：頭+4車廂）
    const stageW = stage.offsetWidth || 600
    const targetLeft = Math.max(0, (stageW - unitW) / 2)  // px

    // 初始位置：在 stage 右側外
    let currentLeft = stageW + 20  // px，從右側外開始
    unit.style.left = currentLeft + 'px'

    const DURATION = TRAIN_ENTER_MS  // 2500ms
    const startTime = performance.now()

    // easeOutCubic（煞車效果）
    const ease = t => 1 - Math.pow(1 - t, 3)

    const _animate = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / DURATION, 1)
      const eased = ease(progress)

      currentLeft = (stageW + 20) + (targetLeft - (stageW + 20)) * eased
      unit.style.left = currentLeft + 'px'

      if (progress < 1) {
        this._rafId = requestAnimationFrame(_animate)
      } else {
        unit.style.left = targetLeft + 'px'
        // 入場完成：播音效 + 等待後顯示互動區
        this._playTrainSound()
        setTimeout(_showInteractive, TRAIN_STAY_MS)
      }
    }

    this._playTrainSound()
    this._rafId = requestAnimationFrame(_animate)
  }

  async _animateTrainOut () {
    const unit  = document.getElementById('train-unit')
    const stage = document.getElementById('train-stage')
    if (!unit) return

    const stageW = stage ? (stage.offsetWidth || 600) : 600
    const startLeft = parseFloat(unit.style.left) || 0
    const targetLeft = -(stageW + 50)
    const DURATION = TRAIN_EXIT_MS

    this._playTrainSound()
    const startTime = performance.now()
    const easeIn = t => t * t  // 加速離開

    await new Promise(resolve => {
      const _animate = (now) => {
        const progress = Math.min((now - startTime) / DURATION, 1)
        unit.style.left = (startLeft + (targetLeft - startLeft) * easeIn(progress)) + 'px'
        if (progress < 1) {
          requestAnimationFrame(_animate)
        } else {
          resolve()
        }
      }
      requestAnimationFrame(_animate)
    })
  }

  
  /** 建立模式一的完整 HTML 骨架 */
  _buildMode1Shell (q) {
    const chars    = q.idiom.split('')
    const shuffled = this._shuffle([...chars])

    const cardHtml = shuffled.map((ch, i) =>
      `<div class="idiom-card" draggable="true" data-char="${ch}" data-idx="${i}">${ch}</div>`
    ).join('')

    // 4個車廂單元（每個包含 trainbox 圖 + 上方 drop zone）
    const wagonUnits = chars.map((_, i) => (
      `<div class="train-unit" style="position:relative;display:inline-flex;flex-direction:column;align-items:center;width:140px;">` +
        `<div class="wagon-slot" data-pos="${i}" style="` +
          `width:110px;height:110px;border-radius:14px;` +
          `border:3px dashed rgba(255,255,255,.9);` +
          `background:rgba(255,255,255,.15);` +
          `display:flex;align-items:center;justify-content:center;` +
          `font-size:2.6rem;font-weight:900;color:#fff;` +
          `text-shadow:0 2px 6px rgba(0,0,0,.7);` +
          `margin-bottom:4px;cursor:pointer;` +
          `transition:background .2s,border-color .2s;` +
        `">` +
        `</div>` +
        `<img src="${_pathPrefix}/images/trainbox.png" ` +
          `style="width:140px;height:auto;display:block;" alt="車廂" onerror="this.style.opacity='.3'">` +
      `</div>`
    )).join('')

    return (
      `<div id="idiom-game-wrap" style="` +
        `display:flex;flex-direction:column;align-items:center;` +
        `padding:8px 8px;gap:12px;width:100%;max-width:100%;` +
      `">` +

      `<style>` +
      `.idiom-card{` +
        `width:76px;height:76px;border-radius:16px;` +
        `background:#6366f1;color:white;` +
        `font-size:2.1rem;font-weight:900;` +
        `display:flex;align-items:center;justify-content:center;` +
        `cursor:grab;user-select:none;touch-action:none;` +
        `border:3px solid #4338ca;` +
      `}` +
      `.idiom-card.dragging{opacity:.35;}` +
      `.wagon-slot.drag-over{` +
        `background:rgba(255,255,255,.5)!important;` +
        `border-color:#fff!important;border-style:solid!important;` +
      `}` +
      `.wagon-slot.filled{` +
        `background:rgba(99,102,241,.75)!important;` +
        `border-color:#a5b4fc!important;border-style:solid!important;` +
      `}` +
      `.flash-correct{animation:fG .6s ease;}` +
      `.shake-wrong{animation:sR .6s ease;}` +
      `@keyframes fG{0%,100%{background:transparent;}50%{background:rgba(134,239,172,.25);}}` +
      `@keyframes sR{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-8px);}40%,80%{transform:translateX(8px);}}` +
      `#train-stage{` +
        `position:relative;` +
        `width:100%;` +
        `max-width:100%;` +
        `height:300px;` +
        `overflow:hidden;` +
      `}` +
      `#train-unit{` +
        `position:absolute;` +
        `top:0;` +
        `display:flex;` +
        `flex-direction:row;` +
        `align-items:flex-end;` +
        `gap:0;` +
        `white-space:nowrap;` +
      `}` +
      `#wagon-interactive{opacity:0;transform:translateY(14px);width:100%;}` +
      `</style>` +

      // 意思提示
      `<div style="background:#f0f4ff;border:1.5px solid #c7d2fe;border-radius:12px;` +
      `padding:8px 14px;text-align:center;width:100%;max-width:380px;">` +
      `<div style="font-size:.7rem;color:#818cf8;font-weight:700;margin-bottom:3px;">💡 成語意思</div>` +
      `<div style="font-size:.9rem;font-weight:700;color:#3730a3;line-height:1.4;">` +
      `${q.meaning || q.example || '請依提示排列四個字'}</div></div>` +

      // 火車舞台
      `<div id="train-stage">` +
        `<div id="train-unit">` +
          // 火車頭（第一個單元）
          `<div class="train-unit" style="display:inline-flex;flex-direction:column;align-items:flex-end;width:140px;">` +
            `<div style="width:110px;height:110px;"></div>` +
            `<img src="${_pathPrefix}/images/trainhead.png" ` +
              `style="width:140px;height:auto;display:block;margin-top:8px;" alt="火車頭" onerror="this.style.opacity='.3'">` +
          `</div>` +
          // 四個車廂
          wagonUnits +
        `</div>` +
      `</div>` +

      // 互動區：字卡
      `<div id="wagon-interactive" style="display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;">` +
      `<div style="font-size:.78rem;color:#64748b;font-weight:600;">⬆ 將國字拖曳到上方車廂</div>` +
      `<div id="idiom-cards-area" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">${cardHtml}</div>` +
      `<div id="idiom-hint" style="min-height:22px;font-size:.85rem;color:#7c3aed;font-weight:700;text-align:center;"></div>` +
      `<button id="btn-hint-idiom" style="padding:7px 20px;border-radius:20px;background:#fef3c7;` +
      `border:2px solid #f59e0b;font-size:.85rem;font-weight:700;cursor:pointer;color:#92400e;">💡 提示</button>` +
      `</div>` +

      `</div>`
    )
  }


  /** 綁定模式一的拖曳事件（含 touch 支援） */
  _bindMode1Events (q) {
    const cards = document.querySelectorAll('.idiom-card')
    const slots = document.querySelectorAll('.wagon-slot')

    // ── 滑鼠拖曳（desktop） ───────────────────────────
    let dragSrcChar = null

    cards.forEach(card => {
      card.addEventListener('dragstart', e => {
        dragSrcChar = card.dataset.char
        card.classList.add('dragging')
        e.dataTransfer.effectAllowed = 'move'
      })
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging')
      })
    })

    slots.forEach(slot => {
      slot.addEventListener('dragover', e => {
        e.preventDefault()
        slot.classList.add('drag-over')
      })
      slot.addEventListener('dragleave', () => {
        slot.classList.remove('drag-over')
      })
      slot.addEventListener('drop', e => {
        e.preventDefault()
        slot.classList.remove('drag-over')
        if (!dragSrcChar) return
        this._placeCharInSlot(slot, dragSrcChar, q)
        dragSrcChar = null
      })
    })

    // ── Touch 拖曳（mobile） ──────────────────────────
    cards.forEach(card => {
      card.addEventListener('touchstart', e => {
        e.preventDefault()
        const touch = e.touches[0]
        const rect  = card.getBoundingClientRect()
        this._touchDragEl   = card
        this._touchOffsetX  = touch.clientX - rect.left
        this._touchOffsetY  = touch.clientY - rect.top

        // 建立視覺複製元素
        this._touchClone             = card.cloneNode(true)
        this._touchClone.style.cssText = `
          position:fixed; pointer-events:none; z-index:9999;
          width:${rect.width}px; height:${rect.height}px;
          font-size:1.5rem; font-weight:900;
          display:flex; align-items:center; justify-content:center;
          background:linear-gradient(135deg,#6366f1,#8b5cf6);
          color:white; border-radius:12px; opacity:0.85;
          box-shadow:0 8px 20px rgba(99,102,241,0.6);
          left:${touch.clientX - this._touchOffsetX}px;
          top:${touch.clientY  - this._touchOffsetY}px;
        `
        document.body.appendChild(this._touchClone)
        card.style.opacity = '0.3'
      }, { passive: false })

      card.addEventListener('touchmove', e => {
        e.preventDefault()
        if (!this._touchClone) return
        const touch = e.touches[0]
        this._touchClone.style.left = `${touch.clientX - this._touchOffsetX}px`
        this._touchClone.style.top  = `${touch.clientY - this._touchOffsetY}px`

        // 高亮最近的車廂格子
        slots.forEach(slot => slot.classList.remove('drag-over'))
        const target = this._getSlotUnderTouch(touch, slots)
        if (target) target.classList.add('drag-over')
      }, { passive: false })

      card.addEventListener('touchend', e => {
        e.preventDefault()
        if (!this._touchClone) return
        const touch = e.changedTouches[0]

        // 清除複製元素
        this._touchClone.remove()
        this._touchClone  = null
        if (this._touchDragEl) this._touchDragEl.style.opacity = '1'

        // 找到放置目標
        slots.forEach(slot => slot.classList.remove('drag-over'))
        const target = this._getSlotUnderTouch(touch, slots)
        if (target && this._touchDragEl) {
          this._placeCharInSlot(target, this._touchDragEl.dataset.char, q)
        }
        this._touchDragEl = null
      }, { passive: false })
    })

    // 點擊格子可取回字卡
    slots.forEach(slot => {
      slot.addEventListener('click', () => {
        if (!slot.dataset.char) return
        this._returnCard(slot.dataset.char)
        this._clearSlot(slot)
      })
    })
  }

  /** 取得 touch 點下方的車廂格子 */
  _getSlotUnderTouch (touch, slots) {
    for (const slot of slots) {
      const r = slot.getBoundingClientRect()
      if (touch.clientX >= r.left && touch.clientX <= r.right &&
          touch.clientY >= r.top  && touch.clientY <= r.bottom) {
        return slot
      }
    }
    return null
  }

  /** 將字放入車廂格子 */
  _placeCharInSlot (slot, ch, q) {
    if (slot.dataset.char) this._returnCard(slot.dataset.char)
    slot.dataset.char = ch
    slot.classList.add('filled')
    slot.textContent = ch
    const card = [...document.querySelectorAll('.idiom-card')]
      .find(c => c.dataset.char === ch && c.style.visibility !== 'hidden')
    if (card) card.style.visibility = 'hidden'
    this._checkMode1Complete(q)
  }

  /** 將字放回字卡區 */
  _returnCard (ch) {
    const card = [...document.querySelectorAll('.idiom-card')]
      .find(c => c.dataset.char === ch && c.style.visibility === 'hidden')
    if (card) card.style.visibility = 'visible'
  }

  _clearSlot (slot) {
    slot.textContent  = ''
    slot.dataset.char = ''
    slot.classList.remove('filled')
  }

  /** 檢查模式一是否全部填完並自動送出 */
  _checkMode1Complete (q) {
    const slots    = [...document.querySelectorAll('.wagon-slot')]
    const allFilled = slots.every(s => s.dataset.char)
    if (!allFilled) return
    const answer = slots.map(s => s.dataset.char).join('')
    this.submitAnswer({ idiom: answer })
  }

  // ───────────────────────────────────────────────────
  //  模式二：叉路選正確成語
  // ───────────────────────────────────────────────────

  _renderMode2 (q) {
    const options = this._shuffle([
      { idiom: q.idiom, correct: true },
      ...q.distractors.map(d => ({ idiom: d, correct: false }))
    ])

    // 火車容器 HTML（頭+1節車廂）
    const trainHTML = (
      `<div id="m2-train" style="` +
        `display:flex;flex-direction:row;align-items:flex-end;` +
        `position:absolute;right:0;` +
        `transition:none;` +
      `">` +
        `<img src="${_pathPrefix}/images/trainhead.png" ` +
          `style="width:80px;height:auto;display:block;" alt="火車頭">` +
        `<img src="${_pathPrefix}/images/trainbox.png" ` +
          `style="width:80px;height:auto;display:block;" alt="車廂">` +
      `</div>`
    )

    // 4個火車站 HTML（左側固定，每站顯示成語選項）
    const STATION_H = 150  // px，每個車站高度
    const stationsHTML = options.map((opt, i) => (
      `<div class="m2-station" data-idiom="${opt.idiom}" data-idx="${i}" style="` +
        `position:absolute;left:0;top:${i * STATION_H}px;` +
        `width:180px;height:${STATION_H - 12}px;` +
        `display:flex;flex-direction:column;align-items:center;justify-content:flex-end;` +
        `cursor:pointer;` +
      `">` +
        `<div style="` +
          `font-size:1.2rem;font-weight:900;color:#3730a3;` +
          `background:rgba(255,255,255,.85);border-radius:8px;` +
          `padding:3px 10px;margin-bottom:2px;letter-spacing:2px;` +
          `text-align:center;` +
        `">${opt.idiom}</div>` +
        `<img src="${_pathPrefix}/images/TRAINSTATION.png" ` +
          `style="width:150px;height:auto;display:block;" alt="車站" onerror="this.style.opacity='.3'">` +
      `</div>`
    )).join('')

    const CANVAS_H = 4 * STATION_H + 40

    return (
      `<div id="idiom-game-wrap" style="` +
        `display:flex;flex-direction:column;align-items:center;` +
        `padding:8px 8px;gap:12px;width:100%;max-width:100%;` +
      `">` +

      `<style>` +
      `.m2-station{transition:filter .2s;}` +
      `.m2-station.active{filter:drop-shadow(0 0 10px #6366f1);}` +
      `.m2-station:hover{filter:brightness(1.1);}` +
      `#m2-canvas{position:relative;width:100%;height:${CANVAS_H}px;overflow:visible;}` +
      `#m2-track{position:absolute;right:100px;top:0;width:6px;height:100%;` +
        `background:repeating-linear-gradient(180deg,#8B7355 0,#8B7355 20px,#C8A87A 20px,#C8A87A 30px);` +
        `border-radius:3px;` +
      `}` +
      `#m2-controls{display:flex;gap:12px;justify-content:center;margin-top:8px;}` +
      `.m2-btn{width:56px;height:56px;border-radius:50%;font-size:1.6rem;` +
        `background:#6366f1;color:#fff;border:none;cursor:pointer;` +
        `box-shadow:0 4px 12px rgba(99,102,241,.4);` +
        `transition:transform .1s;` +
      `}` +
      `.m2-btn:active{transform:scale(.92);}` +
      `#m2-confirm{padding:10px 28px;border-radius:24px;` +
        `background:#22c55e;color:#fff;border:none;cursor:pointer;` +
        `font-size:1rem;font-weight:700;` +
        `box-shadow:0 4px 12px rgba(34,197,94,.4);` +
      `}` +
      `</style>` +

      // 成語意思提示
      `<div style="background:#f0f4ff;border:1.5px solid #c7d2fe;border-radius:12px;` +
      `padding:8px 14px;text-align:center;width:100%;max-width:420px;">` +
      `<div style="font-size:.7rem;color:#818cf8;font-weight:700;margin-bottom:3px;">💡 成語意思</div>` +
      `<div style="font-size:.9rem;font-weight:700;color:#3730a3;line-height:1.4;">` +
      `${q.meaning || q.example || '選出正確的成語'}</div></div>` +

      // 畫布：左側車站 + 右側軌道+火車
      `<div id="m2-canvas">` +
        `<div id="m2-stations">${stationsHTML}</div>` +
        `<div id="m2-track"></div>` +
        `<div id="m2-train-wrap" style="` +
          `position:absolute;right:0;top:0;` +
          `transition:top 0.3s cubic-bezier(0.25,0.46,0.45,0.94);` +
        `">` +
          trainHTML +
        `</div>` +
      `</div>` +

      // 操作按鈕
      `<div id="m2-controls">` +
        `<button class="m2-btn" id="m2-up">⬆</button>` +
        `<button id="m2-confirm">✔ 確認</button>` +
        `<button class="m2-btn" id="m2-down">⬇</button>` +
      `</div>` +

      // 提示
      `<div id="idiom-hint" style="min-height:22px;font-size:.85rem;color:#7c3aed;font-weight:700;text-align:center;"></div>` +
      `<button id="btn-hint-idiom" style="padding:7px 20px;border-radius:20px;background:#fef3c7;` +
      `border:2px solid #f59e0b;font-size:.85rem;font-weight:700;cursor:pointer;color:#92400e;">💡 提示</button>` +

      `</div>`
    )
  }

  _bindMode2Events (q) {
    const options = this._shuffle([
      { idiom: q.idiom, correct: true },
      ...q.distractors.map(d => ({ idiom: d, correct: false }))
    ])

    const STATION_H = 150
    const STATION_COUNT = 4
    let currentIdx = 0  // 目前選中的車站 index

    const trainWrap = document.getElementById('m2-train-wrap')
    const stations  = document.querySelectorAll('.m2-station')

    // 讓火車對齊指定 index 的車站（垂直中央）
    const _alignTrain = (idx) => {
      currentIdx = Math.max(0, Math.min(STATION_COUNT - 1, idx))
      const targetTop = currentIdx * STATION_H + (STATION_H / 2) - 40
      if (trainWrap) trainWrap.style.top = targetTop + 'px'
      stations.forEach((s, i) => {
        s.classList.toggle('active', i === currentIdx)
      })
    }

    // 初始對齊第0個
    _alignTrain(0)

    // 上下按鈕
    document.getElementById('m2-up')?.addEventListener('click', () => {
      _alignTrain(currentIdx - 1)
    })
    document.getElementById('m2-down')?.addEventListener('click', () => {
      _alignTrain(currentIdx + 1)
    })

    // 點擊車站直接選擇
    stations.forEach((station, i) => {
      station.addEventListener('click', () => _alignTrain(i))
    })

    // 鍵盤支援
    document.addEventListener('keydown', this._m2KeyHandler = (e) => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); _alignTrain(currentIdx - 1) }
      if (e.key === 'ArrowDown') { e.preventDefault(); _alignTrain(currentIdx + 1) }
      if (e.key === 'Enter')     { _confirm() }
    })

    // 觸控滑動支援
    let touchStartY = 0
    document.getElementById('m2-canvas')?.addEventListener('touchstart', e => {
      touchStartY = e.touches[0].clientY
    }, { passive: true })
    document.getElementById('m2-canvas')?.addEventListener('touchend', e => {
      const dy = touchStartY - e.changedTouches[0].clientY
      if (Math.abs(dy) > 30) {
        _alignTrain(currentIdx + (dy > 0 ? 1 : -1))
      }
    }, { passive: true })

    // 確認送出：火車 rAF 從右移到選中車站，再送出答案
    const _confirm = () => {
      if (this.isAnswering) return

      const canvas  = document.getElementById('m2-canvas')
      const wrap    = document.getElementById('m2-train-wrap')
      if (!canvas || !wrap) return

      // 禁用按鈕防重複點擊
      document.getElementById('m2-confirm').disabled = true
      document.getElementById('m2-up').disabled      = true
      document.getElementById('m2-down').disabled    = true

      const canvasW    = canvas.offsetWidth  || 700
      const trainW     = 160  // 頭+廂約160px
      const startRight = 0    // 初始在最右
      // 目標：移到車站旁（left 約 200px = 車站 180px + gap）
      const targetRight = canvasW - 200 - trainW

      const MOVE_MS   = 800
      const startTime = performance.now()
      const easeOut   = t => 1 - Math.pow(1 - t, 3)

      this._playTrainSound()

      const _anim = (now) => {
        const p = Math.min((now - startTime) / MOVE_MS, 1)
        const e = easeOut(p)
        // 用 right 從0 移到 targetRight
        const right = startRight + (targetRight - startRight) * e
        wrap.style.right = right + 'px'
        if (p < 1) {
          requestAnimationFrame(_anim)
        } else {
          // 動畫結束後送出答案
          const all = [...document.querySelectorAll('.m2-station')]
          const chosen = all[currentIdx]?.dataset.idiom
          if (chosen) this.submitAnswer({ idiom: chosen })
        }
      }
      requestAnimationFrame(_anim)
    }

    document.getElementById('m2-confirm')?.addEventListener('click', _confirm)
    this._bindHintButton()
  }


  // ───────────────────────────────────────────────────
  //  提示系統
  // ───────────────────────────────────────────────────

  _bindHintButton () {
    const btn = document.getElementById('btn-hint-idiom')
    if (btn) {
      btn.addEventListener('click', () => this.useHint(1))
    }
  }

  useHint (level) {
    const hintText = this.getHint(level)
    if (hintText) {
      const el = document.getElementById('idiom-hint')
      if (el) el.textContent = `💡 ${hintText}`
    }
    super.useHint(level)
  }

  // ───────────────────────────────────────────────────
  //  火車音效
  // ───────────────────────────────────────────────────

  _playTrainSound () {
    try {
      // 停止所有正在播放的火車音效
      this._stopAllTrainAudio()
      const audio = new Audio(`${_pathPrefix}/audio/effects/train.mp3`)
      audio.volume = 0.6
      audio.play().catch(() => {})
      // 播完後自動從陣列移除
      audio.addEventListener('ended', () => {
        this._trainAudioList = (this._trainAudioList || []).filter(a => a !== audio)
      })
      this._trainAudioList = this._trainAudioList || []
      this._trainAudioList.push(audio)
    } catch (_) {}
  }

  _stopAllTrainAudio () {
    if (!this._trainAudioList) return
    for (const a of this._trainAudioList) {
      try { a.pause(); a.currentTime = 0 } catch (_) {}
    }
    this._trainAudioList = []
  }

  // ───────────────────────────────────────────────────
  //  干擾選項建立
  // ───────────────────────────────────────────────────

  _buildDistractors (entry, pool) {
    // 優先從題目池取其他真實成語作干擾
    const usedIdioms = new Set([entry.idiom])
    const distractors = []

    // 1. 從題目池取其他成語
    const poolOthers = this._shuffle(
      pool.filter(e => e.idiom !== entry.idiom && e.idiom?.length === 4)
    )
    for (const other of poolOthers) {
      if (distractors.length >= 3) break
      if (!usedIdioms.has(other.idiom)) {
        distractors.push(other.idiom)
        usedIdioms.add(other.idiom)
      }
    }

    // 2. 若不足，從全庫隨機補充真實成語
    if (distractors.length < 3) {
      const allIdioms = JSONLoader.get('idioms') ?? []
      const extras = this._shuffle(
        allIdioms.filter(e => e.idiom !== entry.idiom && !usedIdioms.has(e.idiom) && e.idiom?.length === 4)
      )
      for (const e of extras) {
        if (distractors.length >= 3) break
        distractors.push(e.idiom)
        usedIdioms.add(e.idiom)
      }
    }

    return distractors.slice(0, 3)
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
  //  生命週期
  // ───────────────────────────────────────────────────

  destroy () {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null }
    this._stopAllTrainAudio()
    if (this._touchClone) { this._touchClone.remove(); this._touchClone = null }
    if (this._trainOverlay && this._trainOverlay.parentNode) {
      this._trainOverlay.parentNode.removeChild(this._trainOverlay)
      this._trainOverlay = null
    }
    if (this._m2KeyHandler) {
      document.removeEventListener('keydown', this._m2KeyHandler)
      this._m2KeyHandler = null
    }
    if (window._idiomGame === this) delete window._idiomGame
    super.destroy()
  }

  async init (config) {
    window._idiomGame = this
    return super.init(config)
  }
}

// ═══════════════════════════════════════════════════════
//  匯出
// ═══════════════════════════════════════════════════════

export default IdiomGame
