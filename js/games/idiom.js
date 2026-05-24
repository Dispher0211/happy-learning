/**
 * idiom.js — 成語配對 × 🚂 火車遊戲
 * Task 22
 *
 * 遊戲規則：
 * 模式一（30%）：火車從右邊進入，定位後，小朋友將字卡拖到4個車廂排列成成語
 * 模式二（70%）：火車叉路選正確路線
 *
 * 修正：
 * 1. 解決火車「突然出現、沒有滑動」的問題：
 * 預設給予 .stage-initial（人在右側畫面外且透明），透過雙重 requestAnimationFrame 與 setTimeout 
 * 非同步加上 .stage-enter，迫使瀏覽器重新計算樣式，完美觸發從右到左的滑進動畫。
 * 2. 保持車廂格子 (#slot-row) 與火車大舞台主體完美絕對定位結合。
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
  //  模式一：精準滑動核心（修復突然出現問題）
  // ───────────────────────────────────────────────────

  _renderMode1WithTrainAnimation (q, app) {
    // 1. 先行渲染大殼子，此時火車擁有 .stage-initial 類別，隱藏且在畫面最右側 (100vw)
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

    // 2. 使用雙重 requestAnimationFrame：確保瀏覽器已經完成初始位置（右側外）的渲染後，再追加進入動畫類別！
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._playTrainSound()
        
        // 移除初始靜止狀態，加入滑行 CSS 動畫
        trainStage.classList.remove('stage-initial')
        trainStage.classList.add('stage-enter')

        // 當滑動完成時 (2.5秒)，顯示下方拖拽字卡區與虛線框
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
      `text-shadow:0 2px 4px rgba(0,0,0,0.6);box-shadow:inset 0 0 6px rgba(0,0,0,0.2);}` +
      `.wagon-slot.drag-over .wagon-slot-inner{background:rgba(255,255,255,.45);border-color:#fff;border-style:solid;}` +
      `.wagon-slot.filled .wagon-slot-inner{background:rgba(99,102,241,.9);border-color:#fff;border-style:solid;box-shadow:0 4px 8px rgba(0,0,0,0.3);}` +
      `.flash-correct{animation:fG .6s ease;}` +
      `.shake-wrong{animation:sR .6s ease;}` +
      
      /* 強大且滑順的火車專用 CSS 動畫定義 */
      `.stage-initial { transform: translateX(100vw); opacity: 0; }` +
      `.stage-enter { animation: trainMoveIn ${TRAIN_ENTER_MS}ms cubic-bezier(0.25, 1, 0.5, 1) forwards; }` +
      `.stage-exit { animation: trainMoveOut ${TRAIN_EXIT_MS}ms cubic-bezier(0.55, 0, 1, 0.45) forwards; }` +
      `@keyframes trainMoveIn { 0% { transform: translateX(100vw); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }` +
      `@keyframes trainMoveOut { 0% { transform: translateX(0); opacity: 1; } 100% { transform: translateX(-120vw); opacity: 0; } }` +
      
      `@keyframes fG{0%,100%{background:transparent;}50%{background:rgba(134,239,172,.25);}}` +
      `@keyframes sR{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-8px);}40%,80%{transform:translateX(8px);}}` +
      `#wagon-interactive{opacity:0;transform:translateY(12px);width:100%;display:flex;flex-direction:column;align-items:center;gap:12px;}` +
      `</style>` +

      `<div style="background:#f0f4ff;border:1.5px solid #c7d2fe;border-radius:12px;padding:10px 14px;text-align:center;width:100%;max-width:380px;z-index:5;">` +
      `<div style="font-size:.72rem;color:#818cf8;font-weight:700;margin-bottom:3px;">💡 成語意思</div>` +
      `<div style="font-size:.92rem;font-weight:700;color:#3730a3;line-height:1.4;">${q.meaning || q.example || '請依提示排列四個字'}</div></div>` +

      // 核心架構：預設套用 stage-initial 藏