/**
 * idiom.js — 成語配對 × 🚂 火車遊戲
 * Task 22
 *
 * 遊戲規則：
 * 模式一（30%）：火車從右邊進入，定位後，小朋友將字卡拖到4個車廂排列成成語
 * 模式二（70%）：火車叉路選正確路線
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
  //  模式一：精準滑動與事件綁定
  // ───────────────────────────────────────────────────

  _renderMode1WithTrainAnimation (q, app) {
    // 1. 渲染畫面骨架（此時火車帶有 stage-initial 藏在右側 100vw 外）
    app.innerHTML = this._buildMode1Shell(q)
    this._bindHintButton()

    const trainStage = document.getElementById('train-stage')
    const slotRow    = document.getElementById('slot-row')
    const wagonArea  = document.getElementById('wagon-interactive')

    const _showInteractive = () => {
      if (slotRow) slotRow.style.opacity = '1'
      if (wagonArea) {
        wagonArea.style.transition = 'opacity 0.4s ease, transform 0.4s ease'
        wagonArea.style.opacity    = '1'
        wagonArea.style.transform  = 'translateY(0)'
      }
      this._bindMode1Events(q)
    }

    if (!trainStage) { _showInteractive(); return }

    // 2. 利用雙重 rAF 確保初始位置渲染完成，隨即灌入進場 Class 發動平滑滑動
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._playTrainSound()
        trainStage.classList.remove('stage-initial')
        trainStage.classList.add('stage-enter')
        
        // 火車滑動到位後，再優雅淡入字卡與車廂框
        setTimeout(_showInteractive, TRAIN_ENTER_MS)
      })
    })
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
      `.wagon-slot{width:16%;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;}` +
      `.wagon-slot-inner{width:92%;height:85%;border-radius:8px;border:2px dashed rgba(255,255,255,0.85);` +
      `background:rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;` +
      `font-size:1.6rem;font-weight:900;color:#fff;transition:all .2s;` +
      `text-shadow:0 2px 4px rgba(0,0,0,0.6);box-shadow:inset 0 0 6px rgba(0,0,0,0.