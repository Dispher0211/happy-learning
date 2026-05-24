/**
 * idiom.js — 成語配對 × 🚂 火車遊戲
 * Task 22
 *
 * 遊戲規則：
 * 模式一（30%）：火車從右邊進入，定位後消失，小朋友將字卡拖到4個車廂排列成成語
 * 模式二（70%）：火車叉路選正確路線
 *
 * 修正：
 * 1. 解決火車硬生生突然出現、沒有滑進動畫的問題（改用 class 觸發與強制重繪機制）。
 * 2. 完美保留格子與車廂 100% 精準對齊的結構。
 */

import { GameEngine }   from './GameEngine.js'
import { GameConfig }   from './GameConfig.js'
import { AppState }     from '../state.js'
import { AudioManager } from '../audio.js'

// ═══════════════════════════════════════════════════════
//  常數
// ═══════════════════════════════════════════════════════

const _pathPrefix = location.pathname.startsWith('/happy-learning')
  ? '/happy-learning'
  : ''

const MODE1_RATIO = 0.30
const TRAIN_ENTER_MS = 2500
const TRAIN_EXIT_MS = 1200

// ═══════════════════════════════════════════════════════
//  IdiomGame class
// ═══════════════════════════════════════════════════════

export class IdiomGame extends GameEngine {

  constructor () {
    super('idiom')
    this._idiomPool = []
    this._touchDragEl   = null
    this._touchClone    = null
    this._touchOffsetX  = 0
    this._touchOffsetY  = 0
    this._allCorrect = true
    this._currentMode = 2
    this._trainAnimating = false
  }

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

  async judgeAnswer (answer) {
    const q       = this.currentQuestion
    const correct = answer?.idiom?.trim() === q.idiom.trim()
    return { correct, correctAnswer: q.idiom }
  }

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

  async playWrongAnimation () {
    AudioManager.playEffect('wrong')
    const container = document.getElementById('idiom-game-wrap')
    if (container) {
      container.classList.add('shake-wrong')
      setTimeout(() => container.classList.remove('shake-wrong'), 600)
    }
    return Promise.resolve()
  }

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
  //  模式一：全新修正火車動畫（確保平移流暢度）
  // ───────────────────────────────────────────────────

  _renderMode1WithTrainAnimation (q, app) {
    app.innerHTML = this._buildMode1Shell(q)
    this._bindHintButton()

    const _showInteractive = () => {
      const wagonArea = document.getElementById('wagon-interactive')
      if (wagonArea) {
        wagonArea.style.transition = 'opacity 0.4s ease, transform 0.4s ease'
        wagonArea.style.opacity    = '1'
        wagonArea.style.transform  = 'translateY(0)'
      }
      this._bindMode1Events(q)
    }

    // 注入全 transform 控制的進出場 CSS 動作
    if (!document.getElementById('train-kf')) {
      const kf = document.createElement('style')
      kf.id = 'train-kf'
      kf.textContent =
        '.stage-initial { transform: translateX(100vw); opacity: 0; }' +
        '.stage-enter { animation: stageEnterKF ' + TRAIN_ENTER_MS + 'ms cubic-bezier(0.25, 1, 0.5, 1) forwards; }' +
        '.stage-exit { animation: stageExitKF ' + TRAIN_EXIT_MS + 'ms cubic-bezier(0.55, 0, 1, 0.45) forwards; }' +
        '@keyframes stageEnterKF {' +
          '0% { transform: translateX(100vw); opacity: 0; }' +
          '100% { transform: translateX(0); opacity: 1; }' +
        '}' +
        '@keyframes stageExitKF {' +
          '0% { transform: translateX(0); opacity: 1; }' +
          '100% { transform: translateX(-100vw); opacity: 0; }' +
        '}'
      document.head.appendChild(kf)
    }

    const trainStage = document.getElementById('train-stage')
    if (!trainStage) { _showInteractive(); return }

    // 關鍵解法：利用非同步延遲與讀取 DOM 屬性強迫瀏覽器重繪（Reflow），確保 0% 狀態生效
    setTimeout(() => {
      this._playTrainSound()
      trainStage.classList.remove('stage-initial')
      trainStage.classList.add('stage-enter')
      
      setTimeout(_showInteractive, TRAIN_ENTER_MS + 200)
    }, 50)
  }

  async _animateTrainOut () {
    const trainStage = document.getElementById('train-stage')
    if (!trainStage) return
    this._playTrainSound()
    await new Promise(resolve => {
      trainStage.classList.remove('stage-enter')
      trainStage.classList.add('stage-exit')
      setTimeout(resolve, TRAIN_EXIT_MS)
    })
  }

  async _trainExitAnimation () {
    return this._animateTrainOut()
  }

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
      `<div id="idiom-game-wrap" style="display:flex;flex-direction:column;align-items:center;padding:12px 6px;gap:16px;width:100%;overflow:hidden;position:relative;">` +

      `<style>` +
      `.idiom-card{width:60px;height:60px;border-radius:14px;background:#6366f1;color:white;` +
      `font-size:1.8rem;font-weight:900;display:flex;align-items:center;justify-content:center;` +
      `cursor:grab;user-select:none;touch-action:none;border:3px solid #4338ca;transition:transform .12s;}` +
      `.idiom-card:active{transform:scale(1.15);}` +
      `.idiom-card.dragging{opacity:.35;}` +
      
      `.wagon-slot{width:16%;height:72px;display:flex;align-items:center;justify-content:center;cursor:pointer;}` +
      `.wagon-slot-inner{width:90%;height:90%;border-radius:8px;border:2px dashed rgba(255,255,255,0.85);` +
      `background:rgba(255,255,255,0.22);display:flex;align-items:center;justify-content:center;` +
      `font-size:1.7rem;font-weight:900;color:#fff;transition:all .2s;` +
      `text-shadow:0 2px 5px rgba(0,0,0,0.6);box-shadow:inset 0 0 8px rgba(0,0,0,0.15);}` +
      
      `.wagon-slot.drag-over .wagon-slot-inner{background:rgba(255,255,255,.55);border-color:#fff;border-style:solid;}` +
      `.wagon-slot.filled .wagon-slot-inner{background:rgba(99,102,241,.85);border-color:#fff;border-style:solid;box-shadow:0 4px 10px rgba(0,0,0,0.2);}` +
      `.flash-correct{animation:fG .6s ease;}` +
      `.shake-wrong{animation:sR .6s ease;}` +
      `@keyframes fG{0%,100%{background:transparent;}50%{background:rgba(134,239,172,.25);}}` +
      `@keyframes sR{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-8px);}40%,80%{transform:translateX(8px);}}` +
      
      `#wagon-interactive{opacity:0;transform:translateY(12px);width:100%;display:flex;flex-direction:column;align-items:center;gap:12px;}` +
      `</style>` +

      `<div style="background:#f0f4ff;border:1.5px solid #c7d2fe;border-radius:12px;padding:10px 14px;text-align:center;width:100%;max-width:380px;z-index:5;">` +
      `<div style="font-size:.72rem;color:#818cf8;font-weight:700;margin-bottom:3px;">💡 成語意思</div>` +
      `<div style="font-size:.92rem;font-weight:700;color:#3730a3;line-height:1.4;">${q.meaning || q.example || '請依提示排列四個字'}</div></div>` +

      // 預設加上 stage-initial 讓它停在螢幕最右側外面開不進來，等 JS 拿掉 class 觸發滑進
      `<div id="train-stage" class="stage-initial" style="position:relative; width:100%; max-width:540px; will-change:transform, opacity; transition: none;">` +
        `<img id="train-img" src="${_pathPrefix}/images/train.png" alt="火車" style="display:block; width:100%; height:auto;" onerror="this.style.display='none'">` +
        `<div id="slot-row" style="position:absolute; bottom:14%; left:22.5%; width:75.5%; height:55%; display:flex; gap:3.5%; align-items:center; justify-content:flex-start; z-index:3;">` +
          `${slotHtml}` +
        `</div>` +
      `</div>` +

      `<div id="wagon-interactive">` +
      `<div style="font-size:.8rem;color:#64748b;font-weight:600;">⬆ 將國字拖曳到上方車廂</div>` +
      `<div id="idiom-cards-area" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;width:100%;max-width:400px;">${cardHtml}</div>` +
      `<div id="idiom-hint" style="min-height:22px;font-size:.85rem;color:#7c3aed;font-weight:700;text-align:center;"></div>` +
      `<button id="btn-hint-idiom" style="padding:8px 24px;border-radius:20px;background:#fef3c7;border:2px solid #f59e0b;font-size:.88rem;font-weight:700;cursor:pointer;color:#92400e;box-shadow:0 2px 6px rgba(0,0,0,0.08);">💡 提示</button>` +
      `</div>` +
      `</div>`
    )
  }

  _bindMode1Events (q) {
    const cards = document.querySelectorAll('.idiom-card')
    const slots = document.querySelectorAll('.wagon-slot')
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
        e.