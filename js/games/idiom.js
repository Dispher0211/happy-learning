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

  constructor () {
    // ✅ 修正：傳入 'idiom' 讓 GameEngine 能正確取得遊戲名稱
    super('idiom')

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
    const count = config?.count ?? 5

    const myIdioms    = AppState.idioms ?? []
    const allIdioms   = AppState.jsonData?.idioms ?? []
    const charSet     = new Set(AppState.characters?.map(c => c.char || c['字']) ?? [])

    const relatedIdioms = allIdioms.filter(entry =>
      entry.related_characters?.some(ch => charSet.has(ch))
    )

    const myIdiomEntries = myIdioms.map(idiomStr => {
      const found = allIdioms.find(e => e.idiom === idiomStr)
      if (found) return found
      return { idiom: idiomStr, zhuyin: '', meaning: '', example: '', related_characters: [] }
    })

    const seen   = new Set()
    const merged = []
    for (const entry of [...myIdiomEntries, ...relatedIdioms]) {
      if (!seen.has(entry.idiom)) {
        seen.add(entry.idiom)
        merged.push(entry)
      }
    }

    if (merged.length === 0) return []

    const shuffled  = this._shuffle([...merged])
    const questions = []
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      const entry      = shuffled[i]
      const mode       = i < Math.round(count * MODE1_RATIO) ? 1 : 2
      const distractors = this._buildDistractors(entry, shuffled)
      questions.push({
        char:        entry.related_characters?.[0] ?? entry.idiom[0],
        idiom:       entry.idiom,
        zhuyin:      entry.zhuyin,
        meaning:     entry.meaning,
        example:     entry.example,
        mode,
        distractors
      })
    }

    this._idiomPool  = questions
    this.questions   = questions
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
        slot.dataset.char = chars[i]
        slot.classList.add('filled')
        const inner = slot.querySelector('.wagon-slot-inner')
        if (inner) {
          inner.textContent       = chars[i]
          inner.style.background  = 'rgba(134,239,172,.65)'
          inner.style.borderColor = '#16a34a'
          inner.style.borderStyle = 'solid'
        }
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
      const slotRow = document.getElementById('slot-row')
      if (slotRow) slotRow.style.opacity = '1'
      const wagonArea = document.getElementById('wagon-interactive')
      if (wagonArea) {
        wagonArea.style.transition = 'opacity 0.5s ease, transform 0.5s ease'
        wagonArea.style.opacity    = '1'
        wagonArea.style.transform  = 'translateY(0)'
      }
      this._bindMode1Events(q)
    }

    // ── 純 CSS animation 入場，不依賴 JS transform ──
    // 直接操作頁面內的 #train-img，加上 CSS animation class
    const trainImg = document.getElementById('train-img')
    if (!trainImg) { _showInteractive(); return }

    const _startCSSAnim = () => {
      // 注入 @keyframes（若尚未存在）
      if (!document.getElementById('train-keyframes-style')) {
        const style = document.createElement('style')
        style.id = 'train-keyframes-style'
        style.textContent = `
          @keyframes trainEnter {
            from { transform: translateX(110%); }
            to   { transform: translateX(0); }
          }
          @keyframes trainExit {
            from { transform: translateX(0) scale(1); opacity: 1; }
            to   { transform: translateX(-120%) scale(0.92); opacity: 0; }
          }
        `
        document.head.appendChild(style)
      }

      // 播音效
      this._playTrainSound()

      // 顯示圖片並套用入場動畫
      trainImg.style.visibility = 'visible'
      trainImg.style.animation  = `trainEnter ${TRAIN_ENTER_MS}ms cubic-bezier(0.25,0.46,0.45,0.94) forwards`

      // 動畫結束後顯示互動區
      setTimeout(_showInteractive, TRAIN_ENTER_MS + TRAIN_STAY_MS)
    }

    // 圖片已顯示（complete）或等待載入
    if (trainImg.complete && trainImg.naturalWidth > 0) {
      requestAnimationFrame(() => requestAnimationFrame(_startCSSAnim))
    } else {
      trainImg.onload  = () => requestAnimationFrame(() => requestAnimationFrame(_startCSSAnim))
      trainImg.onerror = () => { trainImg.style.display = 'none'; _showInteractive() }
    }
  }

  async _animateTrainOut () {
    const train = document.getElementById('train-img')
    if (!train || train.style.display === 'none') return

    this._playTrainSound()

    await new Promise(resolve => {
      train.style.animation = `trainExit ${TRAIN_EXIT_MS}ms cubic-bezier(0.55,0,1,0.45) forwards`
      setTimeout(resolve, TRAIN_EXIT_MS)
    })
  }

    async _animateTrainOut () {
    const train = document.getElementById('train-img')
    if (!train || train.style.display === 'none') return

    void train.offsetWidth

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this._playTrainSound()
          train.style.transition =
            `transform ${TRAIN_EXIT_MS}ms cubic-bezier(0.55,0,1,0.45), ` +
            `opacity ${TRAIN_EXIT_MS}ms ease`
          train.style.transform = 'translateX(-140vw) scale(0.92)'
          train.style.opacity   = '0'
          setTimeout(resolve, TRAIN_EXIT_MS)
        })
      })
    })
  }

  // 保留舊名稱別名，避免其他地方呼叫報錯
  async _trainExitAnimation () {
    return this._animateTrainOut()
  }

  /** 建立模式一的完整 HTML 骨架（重新設計：火車圖放大+車廂格子疊加） */
  _buildMode1Shell (q) {
    const chars    = q.idiom.split('')
    const shuffled = this._shuffle([...chars])

    const cardHtml = shuffled.map((ch, i) =>
      `<div class="idiom-card" draggable="true" data-char="${ch}" data-idx="${i}">${ch}</div>`
    ).join('')

    const slotHtml = chars.map((_, i) =>
      `<div class="wagon-slot" data-pos="${i}" aria-label="車廂${i + 1}">` +
      `<div class="wagon-slot-inner"></div></div>`
    ).join('')

    return (
      `<div id="idiom-game-wrap" style="` +
      `display:flex;flex-direction:column;align-items:center;padding:8px 4px;gap:10px;width:100%;">` +

      `<style>` +
      `.idiom-card{width:64px;height:64px;border-radius:14px;background:#6366f1;color:white;` +
      `font-size:1.8rem;font-weight:900;display:flex;align-items:center;justify-content:center;` +
      `cursor:grab;user-select:none;touch-action:none;border:3px solid #4338ca;transition:transform .12s;}` +
      `.idiom-card:active{transform:scale(1.15);}` +
      `.idiom-card.dragging{opacity:.35;}` +
      `.wagon-slot{width:72px;height:76px;display:flex;align-items:center;justify-content:center;cursor:pointer;}` +
      `.wagon-slot-inner{width:62px;height:66px;border-radius:8px;border:3px dashed rgba(255,255,255,.9);` +
      `background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;` +
      `font-size:1.9rem;font-weight:900;color:#fff;transition:background .2s;` +
      `text-shadow:0 2px 6px rgba(0,0,0,.7);}` +
      `.wagon-slot.drag-over .wagon-slot-inner{background:rgba(255,255,255,.45);border-color:#fff;border-style:solid;}` +
      `.wagon-slot.filled .wagon-slot-inner{background:rgba(99,102,241,.7);border-color:#a5b4fc;border-style:solid;}` +
      `.flash-correct{animation:fG .6s ease;}` +
      `.shake-wrong{animation:sR .6s ease;}` +
      `@keyframes fG{0%,100%{background:transparent;}50%{background:rgba(134,239,172,.25);}}` +
      `@keyframes sR{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-8px);}40%,80%{transform:translateX(8px);}}` +
      `#train-img{width:80vw;max-width:480px;height:auto;display:block;visibility:hidden;will-change:transform;filter:drop-shadow(0 4px 12px rgba(0,0,0,.3));}` +
      `#slot-row{display:flex;gap:2px;justify-content:flex-end;width:100%;max-width:480px;` +
      `margin-top:-80px;padding-right:4px;position:relative;z-index:2;opacity:0;transition:opacity 0.4s ease;}` +
      `#wagon-interactive{opacity:0;transform:translateY(14px);width:100%;}` +
      `</style>` +

      `<div style="background:#f0f4ff;border:1.5px solid #c7d2fe;border-radius:12px;` +
      `padding:8px 14px;text-align:center;width:100%;max-width:380px;">` +
      `<div style="font-size:.7rem;color:#818cf8;font-weight:700;margin-bottom:3px;">💡 成語意思</div>` +
      `<div style="font-size:.9rem;font-weight:700;color:#3730a3;line-height:1.4;">` +
      `${q.meaning || q.example || '請依提示排列四個字'}</div></div>` +

      `<img id="train-img" src="${_pathPrefix}/images/train.png" alt="火車" ` +
      `onerror="this.style.display='none'">` +

      `<div id="slot-row">${slotHtml}</div>` +

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
    const inner = slot.querySelector('.wagon-slot-inner')
    if (inner) inner.textContent = ch
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
    const inner = slot.querySelector('.wagon-slot-inner')
    if (inner) inner.textContent = ''
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

    const optionsHtml = options.map((opt, i) => {
      const label = ['左線', '右線', '直行', '迴轉'][i] ?? `路線${i + 1}`
      return `
        <button class="fork-option" data-idiom="${opt.idiom}"
          style="
            width:100%; padding:14px 16px; border-radius:16px;
            background:linear-gradient(135deg,#f1f5f9,#e2e8f0);
            border:2px solid #cbd5e1; font-size:1.1rem; font-weight:800;
            cursor:pointer; display:flex; align-items:center; gap:10px;
            transition:all 0.15s; color:#1e293b;
          ">
          <span style="font-size:0.75rem;color:#64748b;font-weight:600;">${label}</span>
          <span>${opt.idiom}</span>
        </button>
      `
    }).join('')

    return `
      <div id="idiom-game-wrap" style="
        display:flex; flex-direction:column; align-items:center;
        padding:12px 16px; gap:14px;
      ">
        <style>
          .flash-correct { animation: flashGreen2 0.6s ease; }
          .shake-wrong   { animation: shakeRed2 0.6s ease; }
          @keyframes flashGreen2 {
            0%,100%{background:transparent;}50%{background:rgba(134,239,172,0.3);}
          }
          @keyframes shakeRed2 {
            0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-8px);}40%,80%{transform:translateX(8px);}
          }
          .fork-option:active { transform:scale(0.97); }
        </style>

        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;padding:0 8px;">
          <div style="font-size:0.85rem;font-weight:700;color:#64748b;text-align:center;">
            🚂 選對叉路，讓火車通過！
          </div>
          <div style="background:#f0f4ff;border:1.5px solid #c7d2fe;border-radius:12px;padding:10px 16px;text-align:center;width:100%;max-width:340px;">
            <div style="font-size:0.72rem;color:#818cf8;font-weight:700;margin-bottom:4px;">💡 成語意思</div>
            <div style="font-size:0.92rem;font-weight:700;color:#3730a3;line-height:1.5;">${q.meaning || q.example || '選出正確的成語路線'}</div>
          </div>
        </div>

        <!-- 裝飾用小火車（emoji） -->
        <div style="font-size:2.5rem; animation:trainMove 2s linear infinite;">🚂</div>
        <style>
          @keyframes trainMove {
            0%   { transform: translateX(-20px); }
            50%  { transform: translateX(20px); }
            100% { transform: translateX(-20px); }
          }
        </style>

        <div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:340px;">
          ${optionsHtml}
        </div>

        <div id="idiom-hint" style="
          min-height:24px; font-size:0.85rem; color:#7c3aed;
          font-weight:700; text-align:center;
        "></div>

        <button id="btn-hint-idiom" style="
          padding:8px 20px; border-radius:20px;
          background:linear-gradient(135deg,#fef3c7,#fde68a);
          border:2px solid #f59e0b; font-size:0.85rem;
          font-weight:700; cursor:pointer; color:#92400e;
        ">💡 提示</button>
      </div>
    `
  }

  _bindMode2Events (q) {
    document.querySelectorAll('.fork-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.isAnswering) return
        this.submitAnswer({ idiom: btn.dataset.idiom })
      })
    })
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
      const audio = new Audio(`${_pathPrefix}/audio/effects/train.mp3`)
      audio.volume = 0.6
      audio.play().catch(() => {})
    } catch (_) {}
  }

  // ───────────────────────────────────────────────────
  //  干擾選項建立
  // ───────────────────────────────────────────────────

  _buildDistractors (entry, pool) {
    const distractors = []
    const usedIdioms  = new Set([entry.idiom])

    for (const other of pool) {
      if (distractors.length >= 3) break
      if (usedIdioms.has(other.idiom)) continue
      const variant = other.idiom[0] + entry.idiom.slice(1)
      if (!usedIdioms.has(variant) && variant !== entry.idiom) {
        distractors.push(variant)
        usedIdioms.add(variant)
      }
    }

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

    while (distractors.length < 3) {
      distractors.push(entry.idiom.slice(0, 3) + '？')
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
    if (this._touchClone) {
      this._touchClone.remove()
      this._touchClone = null
    }
    if (this._trainOverlay && this._trainOverlay.parentNode) {
      this._trainOverlay.parentNode.removeChild(this._trainOverlay)
      this._trainOverlay = null
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
