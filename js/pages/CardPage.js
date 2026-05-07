/**
 * CardPage.js — 學習卡片主頁面（Task 30）
 * 依賴：state.js（T02）、audio.js（T08）、forgetting.js（T09）、
 *       hanzi_writer_manager.js（T13）、ui_manager.js（T28）
 * 功能：生字卡、詞語卡、成語卡三種卡片模式，含多音字切換、遺忘程度標籤、筆順入口
 */

import { AppState }             from '../state.js'
import { AudioManager }         from '../audio.js'
import { ForgettingCurve }      from '../forgetting.js'
import { HanziWriterManager }   from '../hanzi_writer_manager.js'
import { UIManager }            from '../ui/ui_manager.js'
import { PAGES }                from '../ui/pages.js'
import { JSONLoader }           from '../json_loader.js'

// ─────────────────────────────────────────
// 常數定義
// ─────────────────────────────────────────

/** 遺忘等級對應中文標籤 */
const LEVEL_LABELS = {
  easy_plus: '極簡單',
  easy:      '簡單',
  medium:    '中等',
  hard:      '困難',
}

/** 遺忘等級排序（由簡至難）*/
const LEVEL_ORDER = ['easy_plus', 'easy', 'medium', 'hard']

/** 卡片類型 */
const CARD_TYPES = {
  CHARACTER: 'character',
  WORD:      'word',
  IDIOM:     'idiom',
}

/** HanziWriter 容器 ID */
const WRITER_CONTAINER_ID = 'card-hanzi-preview'

// ─────────────────────────────────────────
// CardPage 類別
// ─────────────────────────────────────────

export class CardPage {
  constructor() {
    /** 當前顯示的索引（在 AppState.characters / words / idioms 中）*/
    this._index = 0
    /** 卡片類型：'character' | 'word' | 'idiom' */
    this._cardType = CARD_TYPES.CHARACTER
    /** 當前生字的資料物件（來自 AppState.characters 或 characters.json）*/
    this._currentChar = null
    /** 多音字目前選取的讀音索引 */
    this._pronIdx = 0
    /** 防競態旗標：防止快速切換造成亂跳 */
    this._isTransitioning = false
    /** 遺忘等級快取（進入頁面時一次讀取，避免每次重繪都呼叫 Firestore）*/
    this._levelCache = {}
    /** 手動覆蓋快取 { char: level|null } */
    this._manualCache = {}
    /** 已綁定的事件處理器（destroy 時移除用）*/
    this._listeners = []
    /** 觸控滑動起始 X */
    this._touchStartX = 0
    /** 目前卡片的注音列表（多音字）*/
    this._pronunciations = []
    /** 是否已初始化 HanziWriter */
    this._writerReady = false
  }

  // ═══════════════════════════════════════
  // 1. 初始化
  // ═══════════════════════════════════════

  /**
   * init(params) — 頁面進入點
   * @param {Object} params
   * @param {string} [params.cardType]  'character'|'word'|'idiom'（預設 character）
   * @param {number} [params.index]    初始索引
   * @param {string} [params.char]     直接跳到指定字
   */
  async init(params = {}) {
    // 決定卡片類型
    this._cardType = params.cardType || AppState.cardType || CARD_TYPES.CHARACTER
    AppState.cardType = this._cardType

    // 決定初始索引
    if (params.char) {
      this._index = this._findCharIndex(params.char)
    } else if (params.index !== undefined) {
      this._index = params.index
    } else {
      this._index = AppState.cardIndex || 0
    }

    // 確保索引合法
    const list = this._getList()
    if (list.length === 0) {
      this._renderEmpty()
      return
    }
    this._index = Math.max(0, Math.min(this._index, list.length - 1))

    // 渲染骨架 HTML（包含容器，讓 HanziWriter 有地方掛載）
    this._renderSkeleton()

    // 綁定全域手勢事件
    this._bindGlobalEvents()

    // 預讀第一張卡片的遺忘等級
    await this._preloadLevels()

    // 渲染第一張卡片
    await this._renderCurrent()
  }

  // ═══════════════════════════════════════
  // 2. 骨架 HTML
  // ═══════════════════════════════════════

  /** 渲染頁面外框（header + 卡片容器），一次性操作 */
  _renderSkeleton() {
    const app = document.getElementById('app')
    app.innerHTML = `
      <div class="card-page" id="card-page-root">
        <!-- 頂部導覽列 -->
        <div class="card-page__topbar">
          <button class="card-page__back-btn" id="card-back-btn" aria-label="返回">
            &#8592;
          </button>
          <div class="card-page__type-tabs">
            <button class="card-page__type-tab ${this._cardType === CARD_TYPES.CHARACTER ? 'active' : ''}"
                    data-type="${CARD_TYPES.CHARACTER}">📖 生字</button>
            <button class="card-page__type-tab ${this._cardType === CARD_TYPES.WORD ? 'active' : ''}"
                    data-type="${CARD_TYPES.WORD}">📋 詞語</button>
            <button class="card-page__type-tab ${this._cardType === CARD_TYPES.IDIOM ? 'active' : ''}"
                    data-type="${CARD_TYPES.IDIOM}">🀄 成語</button>
          </div>
          <!-- 注音開關 -->
          <button class="card-page__zhuyin-toggle" id="card-zhuyin-toggle"
                  aria-label="注音開關"
                  title="${AppState.zhuyinOn ? '關閉注音' : '開啟注音'}">
            注音：${AppState.zhuyinOn ? '<span class="zhuyin-on">開🔵</span>' : '<span class="zhuyin-off">關</span>'}
          </button>
        </div>

        <!-- 卡片主體容器（左右滑動區域）-->
        <div class="card-page__swiper" id="card-swiper">
          <button class="card-page__nav card-page__nav--prev" id="card-prev-btn" aria-label="上一張">◀</button>
          <div class="card-page__card-wrap" id="card-wrap">
            <!-- 卡片內容由 _renderCard 填入 -->
            <div class="card-page__loading">載入中…</div>
          </div>
          <button class="card-page__nav card-page__nav--next" id="card-next-btn" aria-label="下一張">▶</button>
        </div>

        <!-- 底部計數器 -->
        <div class="card-page__counter" id="card-counter"></div>
      </div>
    `

    // 綁定靜態按鈕
    this._addListener('card-back-btn', 'click', () => UIManager.back())
    this._addListener('card-prev-btn', 'click', () => this.goPrev())
    this._addListener('card-next-btn', 'click', () => this.goNext())
    this._addListener('card-zhuyin-toggle', 'click', () => this._toggleZhuyin())

    // 類型分頁切換
    const tabs = document.querySelectorAll('.card-page__type-tab')
    tabs.forEach(tab => {
      const handler = () => this._switchCardType(tab.dataset.type)
      tab.addEventListener('click', handler)
      this._listeners.push({ el: tab, type: 'click', handler })
    })
  }

  // ═══════════════════════════════════════
  // 3. 主渲染邏輯
  // ═══════════════════════════════════════

  /** 渲染當前索引的卡片 */
  async _renderCurrent() {
    const list = this._getList()
    if (list.length === 0) { this._renderEmpty(); return }

    // 更新計數器
    const counter = document.getElementById('card-counter')
    if (counter) counter.textContent = `${this._index + 1} / ${list.length}`

    // 更新上下頁按鈕狀態
    const prevBtn = document.getElementById('card-prev-btn')
    const nextBtn = document.getElementById('card-next-btn')
    if (prevBtn) prevBtn.disabled = (this._index === 0)
    if (nextBtn) nextBtn.disabled = (this._index === list.length - 1)

    // 根據卡片類型渲染
    switch (this._cardType) {
      case CARD_TYPES.CHARACTER:
        await this.renderCharCard(list[this._index])
        break
      case CARD_TYPES.WORD:
        this.renderWordCard(list[this._index])
        break
      case CARD_TYPES.IDIOM:
        this.renderIdiomCard(list[this._index])
        break
    }

    // 同步 AppState 索引
    AppState.cardIndex = this._index
  }

  // ─────────────────────────────────────────
  // 3a. 生字卡
  // ─────────────────────────────────────────

  /**
   * renderCharCard(charObj) — 渲染生字卡
   * @param {Object} charObj  AppState.characters 中的一個元素
   *   期望欄位：字、注音(string|string[])、部首、部首筆畫、總筆畫、詞語(string[])、解釋
   */
  async renderCharCard(charObj) {
    if (!charObj) return
    this._currentChar = charObj

    const char = charObj['字'] || charObj.char || ''

    // ── 從 characters.json 全字典補全資料 ──────────────────────────
    // AppState.characters（my_characters）只有 {字, zhuyin}，
    // 部首、筆畫、詞語、解釋等需從 JSONLoader 快取的全字典查詢
    const allCharsDict = JSONLoader.get('characters') || []
    const dictEntry = allCharsDict.find(c => c['字'] === char || c.char === char)

    // ── 從 polyphones.json 取多音字讀音順序（優先級最高）───────────
    // polyphones.json 的讀音順序與詞語是人工校訂版本，
    // characters.json 的讀音順序來自 MoE 字典，排序不一定符合教學需求
    const allPolyphones = JSONLoader.get('polyphones') || []
    const polyEntry = allPolyphones.find(p => p['字'] === char || p.char === char)

    // 將 polyphones.json 的讀音與 characters.json 的 meaning 合併
    const normZ = z => { const s = z.replace(/\u2027/g,'˙'); return s.endsWith('˙') ? '˙'+s.slice(0,-1) : s }
    let mergedPronunciations = null
    if (polyEntry?.pronunciations?.length > 0) {
      const charProns = dictEntry?.pronunciations || []
      mergedPronunciations = polyEntry.pronunciations.map(pp => {
        const charPron = charProns.find(cp => cp.zhuyin === pp.zhuyin || normZ(cp.zhuyin) === normZ(pp.zhuyin))
        return {
          zhuyin:      pp.zhuyin,
          label:       pp.label       || charPron?.label   || '',
          meaning:     charPron?.meaning || pp.label       || '',
          words:       pp.words       || charPron?.words   || [],
          definitions: charPron?.definitions || [],
        }
      })
    }

    // 合併：優先用 charObj 本身的值，缺少的從字典補
    const enriched = dictEntry ? {
      ...charObj,
      // 部首（characters.json 用 radical）
      '部首': charObj['部首'] || dictEntry.radical || '',
      // 總筆畫（characters.json 用 total_strokes）
      '總筆畫數': charObj['總筆畫數'] || dictEntry.total_strokes || '',
      // 部首外筆畫（characters.json 用 radical_strokes）
      '部首外筆畫': charObj['部首外筆畫'] || dictEntry.radical_strokes || '',
      // 注音：優先 polyphones.json 第一音，再 my_characters，再 characters.json
      '注音': charObj['注音'] || charObj.zhuyin ||
        (mergedPronunciations?.[0]?.zhuyin) ||
        (dictEntry.pronunciations?.[0]?.zhuyin) || '',
      // 詞語：依整合後的 pronunciations 建立 map
      '詞語': charObj['詞語'] ||
        (() => {
          const src = mergedPronunciations || dictEntry.pronunciations || []
          if (!src.length) return []
          const obj = {}
          src.forEach(p => { obj[p.zhuyin] = p.words || [] })
          return obj
        })(),
      // 解釋：從整合後的第一讀音取
      '解釋': charObj['解釋'] ||
        (mergedPronunciations?.[0]?.meaning) ||
        dictEntry.pronunciations?.[0]?.meaning || '',
      // 各讀音完整資料：polyphones.json 優先（順序正確），fallback characters.json
      'pronunciations': charObj['pronunciations'] ||
        mergedPronunciations ||
        dictEntry.pronunciations || [],
    } : charObj

    this._currentChar = enriched
    // ──────────────────────────────────────────────────────────────

    // 解析注音（優先從 pronunciations 陣列取所有讀音，支援多音字）
    const pronArr = enriched['pronunciations'] || []
    if (pronArr.length > 0) {
      this._pronunciations = pronArr.map(p => p.zhuyin).filter(Boolean)
    } else {
      const rawPron = enriched['注音'] || enriched.pronunciation || enriched.zhuyin || ''
      this._pronunciations = Array.isArray(rawPron)
        ? rawPron
        : rawPron.split('/').map(p => p.trim()).filter(Boolean)
    }
    if (this._pronunciations.length === 0) this._pronunciations = ['']

    // 確保 pronIdx 合法
    this._pronIdx = Math.max(0, Math.min(this._pronIdx, this._pronunciations.length - 1))

    // 讀取遺忘等級
    const levelInfo = await this._getLevelInfo(char)

    // 取當前音的詞語
    const words = this._getWordsForPron(enriched, this._pronIdx)

    // 取當前音的字義說明
    const meaning = this._getMeaningForPron(enriched, this._pronIdx)

    // 部首
    const radical     = enriched['部首'] || enriched.radical || ''
    const radicalPron = this._getRadicalPron(radical)
    const strokesAll  = enriched['總筆畫數'] || enriched.totalStrokes || ''
    const strokesRad  = enriched['部首外筆畫'] || enriched.radicalStrokes || ''
    const isPolyphonic = this._pronunciations.length > 1

    const wrap = document.getElementById('card-wrap')
    if (!wrap) return

    wrap.innerHTML = `
      <div class="char-card" data-char="${this._escapeHtml(char)}">

        <!-- 遺忘程度標籤列 -->
        <div class="char-card__level-bar" id="level-bar">
          ${this._renderLevelBar(levelInfo)}
        </div>

        <!-- 卡片主體：漢字 + 注音直式 -->
        <div class="char-card__main">
          <div class="char-card__char-box">
            <!-- HanziWriter 容器 -->
            <div id="${WRITER_CONTAINER_ID}" class="char-card__writer"></div>
            <!-- 大字顯示（HanziWriter CDN 失敗時的 fallback，預設隱藏）-->
            <div class="char-card__char-fallback" id="char-fallback" style="display:none">${this._escapeHtml(char)}</div>
          </div>

          <!-- 注音直式（右側）-->
          <div class="char-card__zhuyin-side bpmf-font" aria-label="注音">
            ${this._renderZhuyinVertical(this._pronunciations[this._pronIdx])}
            ${isPolyphonic ? '<div class="char-card__poly-badge">ⓜ</div>' : ''}
          </div>
        </div>

        <!-- 多音字切換列（有多音才顯示）-->
        ${isPolyphonic ? this._renderPolyphonicBar() : ''}

        <!-- 發音 + 筆順按鈕 -->
        <div class="char-card__action-row">
          <button class="char-card__sound-btn" id="card-sound-btn" aria-label="播放發音">
            ${AppState.settings?.soundOn !== false ? '🔊' : '🔇'}
          </button>
          <button class="char-card__stroke-btn" id="card-stroke-btn" aria-label="觀看筆順">
            ▶ 筆順
          </button>
        </div>

        <!-- 資訊四格（仿圖二：部首／總筆劃／部首筆劃／剩餘筆劃） -->
        <div class="char-card__info-grid">
          <div class="char-card__info-cell">
            <span class="char-card__info-label">部首</span>
            <span class="char-card__info-value">
              <span class="radical-ann-unit">
                <span class="radical-han">${this._escapeHtml(radical)}</span>
                ${radicalPron ? this._renderZhuyinVerticalInline(radicalPron) : ''}
              </span>
            </span>
          </div>
          <div class="char-card__info-cell">
            <span class="char-card__info-label">總筆劃</span>
            <span class="char-card__info-value">${this._escapeHtml(String(strokesAll))}</span>
          </div>
          <div class="char-card__info-cell">
            <span class="char-card__info-label">部首筆劃</span>
            <span class="char-card__info-value">${this._escapeHtml(String(strokesRad))}</span>
          </div>
          <div class="char-card__info-cell">
            <span class="char-card__info-label">剩餘筆劃</span>
            <span class="char-card__info-value">${strokesAll && strokesRad ? this._escapeHtml(String(Number(strokesAll) - Number(strokesRad))) : '—'}</span>
          </div>
        </div>

        <!-- 字義解釋與詞語區（仿圖二：字義說明 + 詞語 chips） -->
        <div class="char-card__words-section">
          <div class="char-card__words-title">💡 字義解釋與應用</div>
          <div id="card-words-section">
            ${this._renderMeaningAndWords(meaning, words, char)}
          </div>
        </div>

        <!-- 挑戰按鈕 -->
        <button class="char-card__game-btn" id="card-game-btn">🎮 翻面挑戰</button>
      </div>
    `

    // 初始化 HanziWriter
    this._initHanziWriter(char)

    // 綁定動態按鈕
    this._addListener('card-sound-btn',   'click', () => this._playSound())
    this._addListener('card-stroke-btn',  'click', () => this.showStrokeOrder())
    this._addListener('card-game-btn',    'click', () => this._goToGame())
    this._addListener('level-bar',        'click', (e) => this._onLevelBarClick(e, char))

    // 詞語點擊播音（事件委派）— 整詞 TTS，自然流暢
    this._addListener('card-words-section', 'click', (e) => {
      const wordEl = e.target.closest('.char-card__word')
      if (!wordEl) return
      // 使用 data-word 取純漢字（避免 innerText 含注音符號造成 TTS 念注音）
      const word = wordEl.dataset.word || wordEl.innerText.replace(/[ㄅ-ㄩˊˇˋ˙🔊]/g, '').trim()
      if (word && AppState.settings?.soundOn !== false) {
        AudioManager.playWord?.(word)
      }
    })

    // 多音字切換按鈕
    if (isPolyphonic) {
      const polyBar = document.getElementById('poly-bar')
      if (polyBar) {
        const polyHandler = (e) => {
          const btn = e.target.closest('[data-pron-idx]')
          if (btn) this.switchPronunciation(Number(btn.dataset.pronIdx))
        }
        polyBar.addEventListener('click', polyHandler)
        this._listeners.push({ el: polyBar, type: 'click', handler: polyHandler })
      }
    }

    // 預載下一個字的 HanziWriter 資料（偷跑）
    this._preloadNextChar()
  }

  // ─────────────────────────────────────────
  // 3b. 詞語卡
  // ─────────────────────────────────────────

  /** renderWordCard(wordObj) — 渲染詞語卡
   * wordObj 可能是純字串（my_words）或物件（含解釋）
   * 純字串時從 characters.json 反查詞義
   */
  renderWordCard(wordObj) {
    if (!wordObj) return

    let word, definition, example
    if (typeof wordObj === 'string') {
      word = wordObj
      // 從 characters.json 反查：找哪個字的 pronunciations.words 包含此詞語
      const allChars = JSONLoader.get('characters') || []
      let found = null
      for (const c of allChars) {
        for (const p of (c.pronunciations || [])) {
          if ((p.words || []).includes(word)) {
            found = p
            break
          }
        }
        if (found) break
      }
      definition = found?.meaning || ''
      example    = ''
    } else {
      word       = wordObj['詞語'] || wordObj.word || ''
      definition = wordObj['解釋'] || wordObj.definition || ''
      example    = wordObj['例句'] || wordObj.example || ''
    }

    // 找出詞語中的破音字及其所有讀音（供 poly-bar 使用）
    // 只取詞語第一個破音字作為切換主體（與生字卡邏輯一致）
    const allPolyphones = JSONLoader.get('polyphones') || []
    let polyChar = null
    let polyCharProns = []
    for (const c of [...String(word)]) {
      const entry = allPolyphones.find(p => p['字'] === c || p.char === c)
      if (entry?.pronunciations?.length > 1) {
        polyChar = c
        polyCharProns = entry.pronunciations
        break
      }
    }
    const hasPolyChar = polyChar && polyCharProns.length > 1

    // 預設選中與詞語上下文匹配的讀音
    if (hasPolyChar) {
      const matchedIdx = polyCharProns.findIndex(
        p => (p.words || []).includes(word)
      )
      this._wordPolyIdx = matchedIdx >= 0 ? matchedIdx : 0
    } else {
      this._wordPolyIdx = 0
    }

    const wrap = document.getElementById('card-wrap')
    if (!wrap) return

    const renderWordTitle = () => this._renderWordWithPolyIdx(word, polyChar, polyCharProns, this._wordPolyIdx)

    wrap.innerHTML = `
      <div class="word-card">
        <div class="word-card__main">
          <div class="word-card__word" id="word-card-title">${renderWordTitle()}</div>
          <button class="word-card__sound-btn" id="word-sound-btn" aria-label="播放詞語">
            ${AppState.settings?.soundOn !== false ? '🔊' : '🔇'}
          </button>
        </div>
        ${hasPolyChar ? `
          <div class="char-card__poly-bar" id="word-poly-bar">
            ${polyCharProns.map((p, i) => `
              <button class="poly-btn ${i === this._wordPolyIdx ? 'active' : ''}"
                      data-word-pron-idx="${i}"
                      aria-label="切換到${p.zhuyin}">
                <span class="poly-btn__indicator">${i === this._wordPolyIdx ? '●' : '○'}</span>
                <span class="poly-btn__zhuyin">${this._renderZhuyinVerticalInline(p.zhuyin)}</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
        ${definition ? `<div class="word-card__def">【意思】${this._escapeHtml(definition)}</div>` : ''}
        ${example    ? `<div class="word-card__ex">【例句】${this._escapeHtml(example)}</div>` : ''}
        <button class="char-card__game-btn" id="card-game-btn">🎮 翻面挑戰</button>
      </div>
    `

    this._addListener('card-game-btn',  'click', () => this._goToGame())
    this._addListener('word-sound-btn', 'click', () => {
      if (AppState.settings?.soundOn !== false) AudioManager.playWord?.(word)
    })

    // 詞語破音字切換
    if (hasPolyChar) {
      const polyBar = document.getElementById('word-poly-bar')
      if (polyBar) {
        const handler = (e) => {
          const btn = e.target.closest('[data-word-pron-idx]')
          if (!btn) return
          const idx = Number(btn.dataset.wordPronIdx)
          if (idx === this._wordPolyIdx) return
          this._wordPolyIdx = idx
          // 更新詞語標題注音
          const titleEl = document.getElementById('word-card-title')
          if (titleEl) titleEl.innerHTML = this._renderWordWithPolyIdx(word, polyChar, polyCharProns, idx)
          // 更新按鈕狀態
          polyBar.querySelectorAll('[data-word-pron-idx]').forEach(b => {
            const i = Number(b.dataset.wordPronIdx)
            b.classList.toggle('active', i === idx)
            b.querySelector('.poly-btn__indicator').textContent = i === idx ? '●' : '○'
          })
        }
        polyBar.addEventListener('click', handler)
        this._listeners.push({ el: polyBar, type: 'click', handler })
      }
    }
  }

  /**
   * _renderWordWithPolyIdx(word, polyChar, polyCharProns, idx)
   * 渲染詞語標題，破音字依選定讀音索引顯示正確注音
   */
  _renderWordWithPolyIdx(word, polyChar, polyCharProns, idx) {
    if (!AppState.zhuyinOn) return this._escapeHtml(word)

    return [...String(word)].map(c => {
      let zhuyin

      if (polyChar && c === polyChar && polyCharProns.length > 0) {
        zhuyin = polyCharProns[idx]?.zhuyin || polyCharProns[0]?.zhuyin || ''
      } else {
        zhuyin = this._findWordCharPron(c, word)
      }

      if (!zhuyin) return this._escapeHtml(c)

      const isCustom = polyChar && c === polyChar

      if (isCustom) {
        return `<span class="multi-tone-char">
          <span class="multi-tone-base">${this._escapeHtml(c)}</span>
          <span class="multi-tone-bpmf bpmf-font">${this._renderZhuyinVerticalInline(zhuyin)}</span>
        </span>`
      }

      return `<span class="word-title-char-unit">
        <span class="word-title-han">${this._escapeHtml(c)}</span>
        <span class="word-title-pron">${this._renderZhuyinVerticalInline(zhuyin)}</span>
      </span>`
    }).join('')
  }

  // ─────────────────────────────────────────
  // 3c. 成語卡
  // ─────────────────────────────────────────

  /** renderIdiomCard(idiomObj) — 渲染成語卡
   * idiomObj 可能是純字串（my_idioms）或物件（含意思）
   * 純字串時從 idioms.json 查詢完整資料
   */
  renderIdiomCard(idiomObj) {
    if (!idiomObj) return

    // 查 idioms.json（優先）或 idiom_dict.json（fallback）
    const lookup = (name) => {
      const idiomsDict = JSONLoader.get('idioms') || []
      let found = idiomsDict.find(e => e.idiom === name || e['成語'] === name)
      if (!found) {
        const dictData = JSONLoader.get('idiom_dict') || []
        found = dictData.find(e => e.idiom === name)
      }
      return found || null
    }

    let idiom, meaning, story, example, zhuyinList
    if (typeof idiomObj === 'string') {
      idiom = idiomObj
      const found = lookup(idiom)
      meaning    = found?.meaning || ''
      story      = found?.story   || ''
      example    = found?.example || ''
      zhuyinList = Array.isArray(found?.zhuyin) ? found.zhuyin : []
    } else {
      idiom      = idiomObj['成語'] || idiomObj.idiom || ''
      meaning    = idiomObj['意思'] || idiomObj.meaning || ''
      story      = idiomObj.story   || ''
      example    = idiomObj['例句'] || idiomObj.example || ''
      zhuyinList = Array.isArray(idiomObj.zhuyin) ? idiomObj.zhuyin : []
      // fallback lookup
      if (!meaning || !zhuyinList.length) {
        const found = lookup(idiom)
        if (found) {
          if (!meaning)        meaning    = found.meaning || ''
          if (!story)          story      = found.story   || ''
          if (!zhuyinList.length) zhuyinList = found.zhuyin || []
        }
      }
    }

    // 成語標題：逐字用方格注音格式
    const idiomChars = [...String(idiom)]
    const idiomHtml = (AppState.zhuyinOn && zhuyinList.length === idiomChars.length)
      ? idiomChars.map((c, i) => {
          const z = zhuyinList[i] || ''
          return `<span class="idiom-char-unit">
            <span class="idiom-han">${this._escapeHtml(c)}</span>
            ${z ? `<span class="idiom-pron">${this._renderZhuyinVerticalInline(z)}</span>` : ''}
          </span>`
        }).join('')
      : `<span class="idiom-han-plain">${this._escapeHtml(idiom)}</span>`

    const wrap = document.getElementById('card-wrap')
    if (!wrap) return

    wrap.innerHTML = `
      <div class="idiom-card">
        <div class="idiom-card__main">
          <div class="idiom-card__idiom">${idiomHtml}</div>
        </div>
        ${meaning ? `<div class="idiom-card__meaning">💡 ${this._escapeHtml(meaning)}</div>` : ''}
        ${story   ? `<div class="idiom-card__story">📖 ${this._escapeHtml(story)}</div>`   : ''}
        ${example ? `<div class="idiom-card__example">✏️ ${this._escapeHtml(example)}</div>` : ''}
        <button class="char-card__game-btn" id="card-game-btn">🎮 翻面挑戰</button>
      </div>
    `

    this._addListener('card-game-btn', 'click', () => this._goToGame())
  }

  // ═══════════════════════════════════════
  // 4. 卡片切換（防競態）
  // ═══════════════════════════════════════

  /**
   * goNext() — 切換到下一張卡片
   * 防競態：_isTransitioning 為 true 時直接 return
   */
  async goNext() {
    if (this._isTransitioning) return
    const list = this._getList()
    if (this._index >= list.length - 1) return

    this._isTransitioning = true
    try {
      // 停止當前音效
      AudioManager.stopAll?.({ voice: true, effect: false })
      this._pronIdx = 0
      this._index++
      await this._renderCurrent()
    } finally {
      this._isTransitioning = false
    }
  }

  /**
   * goPrev() — 切換到上一張卡片
   */
  async goPrev() {
    if (this._isTransitioning) return
    if (this._index <= 0) return

    this._isTransitioning = true
    try {
      AudioManager.stopAll?.({ voice: true, effect: false })
      this._pronIdx = 0
      this._index--
      await this._renderCurrent()
    } finally {
      this._isTransitioning = false
    }
  }

  // ═══════════════════════════════════════
  // 5. 多音字切換
  // ═══════════════════════════════════════

  /**
   * switchPronunciation(idx) — 切換多音字讀音
   * 停音 + 更新詞語列表 + 更新注音顯示（不自動播放）
   */
  switchPronunciation(idx) {
    if (idx === this._pronIdx) return
    if (idx < 0 || idx >= this._pronunciations.length) return

    // 停音
    AudioManager.stopAll?.({ voice: true, effect: false })

    this._pronIdx = idx

    // 更新注音顯示
    const zhuyinSide = document.querySelector('.char-card__zhuyin-side')
    if (zhuyinSide) {
      zhuyinSide.innerHTML =
        this._renderZhuyinVertical(this._pronunciations[idx]) +
        '<div class="char-card__poly-badge">ⓜ</div>'
    }

    // 更新詞語 + 字義
    if (this._currentChar) {
      const words = this._getWordsForPron(this._currentChar, idx)
      const meaning = this._getMeaningForPron(this._currentChar, idx)
      const sectionEl = document.getElementById('card-words-section')
      if (sectionEl) {
        const char = this._currentChar['字'] || ''
        sectionEl.innerHTML = this._renderMeaningAndWords(meaning, words, char)
      }
    }

    // 更新多音列按鈕狀態
    document.querySelectorAll('[data-pron-idx]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.pronIdx) === idx)
    })
  }

  // ═══════════════════════════════════════
  // 6. 遺忘程度標籤
  // ═══════════════════════════════════════

  /**
   * setManualLevel(char, level) — 點選難度標籤
   * 規則：再點同一個 → 恢復系統標記（clearManualOverride）
   */
  async setManualLevel(char, level) {
    const current = this._manualCache[char]

    if (current === level) {
      // 再點同一個 → 清除手動覆蓋
      try {
        await ForgettingCurve.clearManualOverride?.(char)
        this._manualCache[char] = null
      } catch (e) {
        console.warn('clearManualOverride 失敗', e)
      }
    } else {
      // 設定新的手動等級
      try {
        await ForgettingCurve.setManualLevel?.(char, level)
        this._manualCache[char] = level
      } catch (e) {
        console.warn('setManualLevel 失敗', e)
      }
    }

    // 重新讀取並更新等級列（先清快取）
    delete this._levelCache[char]
    const levelInfo = await this._getLevelInfo(char)
    const levelBar = document.getElementById('level-bar')
    if (levelBar) {
      levelBar.innerHTML = this._renderLevelBar(levelInfo)
    }
  }

  // ═══════════════════════════════════════
  // 7. 筆順 Overlay
  // ═══════════════════════════════════════

  /** showStrokeOrder() — 開啟筆順全螢幕覆蓋層 */
  showStrokeOrder() {
    if (!this._currentChar) return
    const char = this._currentChar['字'] || this._currentChar.char || ''
    UIManager.showOverlay(PAGES.STROKE_ORDER, { char })
  }

  // ═══════════════════════════════════════
  // 8. 銷毀
  // ═══════════════════════════════════════

  /** destroy() — 移除事件監聽、停止音效、清理 HanziWriter */
  destroy() {
    // 停止音效
    try { AudioManager.stopAll?.({ voice: true, effect: true }) } catch (e) { /* 忽略 */ }

    // 移除所有事件監聽
    this._listeners.forEach(({ el, type, handler }) => {
      try { el?.removeEventListener(type, handler) } catch (e) { /* 忽略 */ }
    })
    this._listeners = []

    // 銷毀 HanziWriter（釋放記憶體）
    try { HanziWriterManager.destroy?.() } catch (e) { /* 忽略 */ }

    this._currentChar = null
    this._writerReady = false
  }

  // ═══════════════════════════════════════
  // 9. 輔助：事件綁定
  // ═══════════════════════════════════════

  /**
   * _addListener(idOrEl, type, handler) — 綁定事件並記錄，destroy 時自動移除
   * @param {string|Element} idOrEl
   */
  _addListener(idOrEl, type, handler) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl
    if (!el) return
    el.addEventListener(type, handler)
    this._listeners.push({ el, type, handler })
  }

  /** 綁定全域觸控/鍵盤滑動事件（綁到 #card-swiper）*/
  _bindGlobalEvents() {
    const swiper = document.getElementById('card-swiper')
    if (!swiper) return

    // 觸控滑動
    const onTouchStart = (e) => { this._touchStartX = e.touches[0].clientX }
    const onTouchEnd   = (e) => {
      const diff = e.changedTouches[0].clientX - this._touchStartX
      if (Math.abs(diff) < 40) return  // 小於 40px 不觸發
      diff < 0 ? this.goNext() : this.goPrev()
    }

    swiper.addEventListener('touchstart', onTouchStart, { passive: true })
    swiper.addEventListener('touchend',   onTouchEnd,   { passive: true })
    this._listeners.push({ el: swiper, type: 'touchstart', handler: onTouchStart })
    this._listeners.push({ el: swiper, type: 'touchend',   handler: onTouchEnd   })

    // 鍵盤左右鍵
    const onKeyDown = (e) => {
      if (e.key === 'ArrowRight') this.goNext()
      if (e.key === 'ArrowLeft')  this.goPrev()
    }
    document.addEventListener('keydown', onKeyDown)
    this._listeners.push({ el: document, type: 'keydown', handler: onKeyDown })
  }

  // ═══════════════════════════════════════
  // 10. 輔助：資料存取
  // ═══════════════════════════════════════

  /** 取得當前卡片類型對應的清單 */
  _getList() {
    switch (this._cardType) {
      case CARD_TYPES.WORD:  return AppState.words  || []
      case CARD_TYPES.IDIOM: return AppState.idioms || []
      default:               return AppState.characters || []
    }
  }

  /** 根據字串找到 AppState.characters 中的索引 */
  _findCharIndex(char) {
    const chars = AppState.characters || []
    const idx = chars.findIndex(c => (c['字'] || c.char) === char)
    return idx >= 0 ? idx : 0
  }

  /**
   * _getWordsForPron(charObj, pronIdx) — 取得指定讀音的詞語陣列
   * 支援 charObj.詞語 = string[] 或 charObj.詞語 = { ㄉㄚˋ: ['大小','大人'], ... }
   */
  _getWordsForPron(charObj, pronIdx) {
    const raw = charObj['詞語'] || charObj.words || []
    if (Array.isArray(raw)) return raw.slice(0, 5)

    // Object 格式（多音字分別列詞語）
    const pron = this._pronunciations[pronIdx] || ''
    const byPron = raw[pron] || []
    if (byPron.length > 0) return byPron.slice(0, 5)

    // fallback：取第一個讀音的詞語
    const firstKey = Object.keys(raw)[0]
    return firstKey ? (raw[firstKey] || []).slice(0, 5) : []
  }

  /**
   * _getMeaningForPron(charObj, pronIdx) — 取得指定讀音的字義說明
   * 優先從 pronunciations[pronIdx].meaning 取，fallback 到 '解釋' 字串
   */

  /**
   * _renderAnn(ann, cls) — 渲染 ann 陣列為帶直式注音的行內文字
   * ann = [{c:'圓',z:'ㄩㄢˊ'} | {p:'、'}]
   * cls = 'ann' (字義說明) or 'chip-ann' (詞語chip)
   */
  _renderAnn(ann, cls = 'ann') {
    if (!ann || !ann.length) return ''
    if (!AppState.zhuyinOn) {
      return ann.map(t => this._escapeHtml(t.c || t.p || '')).join('')
    }
    return ann.map(t => {
      if (t.p !== undefined) {
        return `<span class="${cls}-punct">${this._escapeHtml(t.p)}</span>`
      }
      const pronHtml = t.z ? this._renderZhuyinVerticalInline(t.z) : ''
      return `<span class="${cls}-unit"><span class="${cls}-han">${this._escapeHtml(t.c)}</span>${pronHtml}</span>`
    }).join('')
  }

  _getMeaningForPron(charObj, pronIdx) {
    const prons = charObj['pronunciations'] || charObj.pronunciations || []
    if (prons.length > 0 && prons[pronIdx]) {
      return prons[pronIdx].meaning || ''
    }
    // fallback：使用 '解釋' 字串
    return charObj['解釋'] || charObj.definition || ''
  }

  /**
   * _renderMeaningAndWords(meaning, words, char) — 渲染字義說明 + 詞語 chips
   * 破音字時在詞語下方顯示文字注音（從字典查每個字的注音）
   */
  _renderMeaningAndWords(meaning, words, char) {
    // helper：渲染一組詞語 chips（使用 ex 的 chars 陣列帶注音）
    const renderChips = (exList) => {
      if (!exList.length) return ''
      return `<div class="char-card__words">${exList.map(e => {
        const w = typeof e === 'string' ? e : e.w
        // 用 ann 陣列或 chars 陣列渲染帶注音的詞語
        const chars = typeof e === 'object' ? (e.chars || []) : []
        let inner
        if (chars.length > 0 && AppState.zhuyinOn) {
          inner = chars.map(({c, z}) => {
            const pronHtml = z ? this._renderZhuyinVerticalInline(z) : ''
            return `<span class="chip-ann-unit"><span class="chip-ann-han">${this._escapeHtml(c)}</span>${pronHtml}</span>`
          }).join('')
        } else {
          inner = this._escapeHtml(w)
        }
        return `<span class="char-card__word" data-word="${this._escapeHtml(w)}">
          <span class="word-text chip-ann">${inner}</span>
          <span class="word-sound-icon">🔊</span>
        </span>`
      }).join('')}</div>`
    }

    // 優先使用 definitions 陣列（多義分組，含 ann 完整注音）
    const pron = (this._currentChar?.pronunciations || [])[this._pronIdx]
    const defs = pron?.definitions
    if (defs && defs.length > 0) {
      return defs.map((d, i) => {
        // 字義說明：用 ann 陣列渲染帶注音的說明文字
        const annHtml = d.ann?.length
          ? `<p class="char-card__meaning-text ann-text">${this._renderAnn(d.ann, 'ann')}</p>`
          : (d.sense ? `<p class="char-card__meaning-text">${this._escapeHtml(d.sense)}</p>` : '')
        return `<div class="char-card__meaning-row">
          <span class="char-card__meaning-num">${i + 1}</span>
          ${annHtml}${renderChips(d.ex || [])}
        </div>`
      }).join('')
    }

    // fallback
    const cleanMeaning = (meaning || '').trim()
    const fallbackChips = words.map(w => ({w, chars:[]}))
    return `${cleanMeaning ? `<div class="char-card__meaning-row"><span class="char-card__meaning-num">1</span><p class="char-card__meaning-text">${this._escapeHtml(cleanMeaning)}</p></div>` : ''}${fallbackChips.length ? renderChips(fallbackChips) : ''}`
  }

  /** 查單一字的第一個讀音注音（用於破音字詞語顯示） */
  _getCharPron(char) {
    const allChars = JSONLoader.get('characters') || []
    const entry = allChars.find(x => x['字'] === char || x.char === char)
    return entry?.pronunciations?.[0]?.zhuyin || entry?.['注音'] || entry?.zhuyin || ''
  }

  /** 取得部首的注音（優先查 radicals.json）*/
  _getRadicalPron(radical) {
    const radicals = JSONLoader.get('radicals') || []
    const found = radicals.find(r => r.radical === radical || r['字'] === radical)
    if (found?.zhuyin) return found.zhuyin
    // fallback: characters.json
    const chars = JSONLoader.get('characters') || []
    const charEntry = chars.find(c => (c['字'] || c.char) === radical)
    return charEntry?.pronunciations?.[0]?.zhuyin || ''
  }

  // ═══════════════════════════════════════
  // 11. 輔助：遺忘等級
  // ═══════════════════════════════════════

  /** 預讀前 5 張卡片的遺忘等級，放入 _levelCache */
  async _preloadLevels() {
    if (this._cardType !== CARD_TYPES.CHARACTER) return
    const chars = AppState.characters || []
    const start = Math.max(0, this._index - 1)
    const end   = Math.min(chars.length, this._index + 4)

    for (let i = start; i < end; i++) {
      const char = chars[i]?.['字'] || chars[i]?.char
      if (char && !this._levelCache[char]) {
        try {
          // 使用 getLevelInfo() 取得完整物件，而非 getLevel()（只回傳字串）
          const info = await ForgettingCurve.getLevelInfo?.(char)
          this._levelCache[char] = info
        } catch (e) {
          this._levelCache[char] = { systemLevel: 'medium', manualOverride: null, gapWarning: false }
        }
      }
    }
  }

  /** 取得一個字的遺忘等級資訊（先查快取）*/
  async _getLevelInfo(char) {
    if (this._levelCache[char]) return this._levelCache[char]
    try {
      // getLevelInfo() 回傳 { systemLevel, manualOverride, gapWarning }
      // 注意：getLevel() 只回傳字串，不可在此使用
      const info = await ForgettingCurve.getLevelInfo?.(char) || {
        systemLevel: 'medium', manualOverride: null, gapWarning: false
      }
      this._levelCache[char] = info
      return info
    } catch {
      return { systemLevel: 'medium', manualOverride: null, gapWarning: false }
    }
  }

  /** 點擊遺忘等級列的事件處理 */
  async _onLevelBarClick(e, char) {
    const btn = e.target.closest('[data-level]')
    if (!btn) return
    await this.setManualLevel(char, btn.dataset.level)
  }

  // ═══════════════════════════════════════
  // 12. 輔助：HanziWriter
  // ═══════════════════════════════════════

  /** 初始化 HanziWriter（容器已在 DOM 中）*/
  _initHanziWriter(char) {
    const container = document.getElementById(WRITER_CONTAINER_ID)
    if (!container) return

    // renderCharCard 每次重建 innerHTML → container 是新 DOM 節點
    // 強制清除舊快取，確保 HanziWriter 綁定到新節點
    if (HanziWriterManager._instances?.[WRITER_CONTAINER_ID]) {
      delete HanziWriterManager._instances[WRITER_CONTAINER_ID]
      delete HanziWriterManager._requestIds?.[WRITER_CONTAINER_ID]
    }

    HanziWriterManager.switchChar?.(char, WRITER_CONTAINER_ID, {
      width:  140,
      height: 140,
      padding: 5,
      showOutline: true,
      strokeColor: '#3d5a80',
      outlineColor: '#e8eaf0',
    }).then(() => {
      // HanziWriter 載入成功：fallback 保持隱藏
      this._writerReady = true
    }).catch(() => {
      // CDN 失敗：顯示 fallback 大字
      const fallback = document.getElementById('char-fallback')
      if (fallback) fallback.style.display = ''
      this._writerReady = false
    })
  }

  /** 預載下一個字的 HanziWriter 資料 */
  _preloadNextChar() {
    const chars = AppState.characters || []
    const next  = chars[this._index + 1]
    if (next) {
      const nextChar = next['字'] || next.char
      if (nextChar) {
        HanziWriterManager.preload?.([nextChar], WRITER_CONTAINER_ID)
      }
    }
  }

  // ═══════════════════════════════════════
  // 13. 輔助：音效
  // ═══════════════════════════════════════

  /** 播放當前字的注音音效
   * 優先：OGG 注音音檔；OGG 缺失時以詞語 TTS（自然流暢）
   * 詞語優先選不含其他生字簿字的詞語，讓 TTS 語境最準確
   */
  _playSound() {
    if (AppState.settings?.soundOn === false) return
    if (!this._currentChar) return

    const pron = this._pronunciations[this._pronIdx] || ''
    if (!pron) return

    // 取代表性詞語作為 TTS fallback（OGG 存在時不使用）
    const words   = this._getWordsForPron(this._currentChar, this._pronIdx)
    const char    = this._currentChar['字'] || this._currentChar.char || ''
    const fallbackWord = words.find(w => ![...String(w)].some(c => c !== char && this._isMyChar(c)))
                      || words[0]
                      || undefined

    try {
      AudioManager.play?.(pron, fallbackWord)
    } catch (e) {
      console.warn('播放注音失敗', e)
    }
  }

  /** @deprecated — 已整合進 _playSound，保留供外部可能呼叫用 */
  _playSoundFallback(pron) {
    const words = this._getWordsForPron(this._currentChar, this._pronIdx)
    const char  = this._currentChar['字'] || this._currentChar.char || ''
    const speakWord = words.find(w => ![...String(w)].some(c => c !== char && this._isMyChar(c)))
                   || words[0] || pron
    AudioManager.playWord?.(speakWord)
  }

  // ═══════════════════════════════════════
  // 14. 輔助：注音開關
  // ═══════════════════════════════════════

  /** 切換注音開關 */
  async _toggleZhuyin() {
    AppState.zhuyinOn = !AppState.zhuyinOn
    AppState.save?.()
    // 更新按鈕文字
    const btn = document.getElementById('card-zhuyin-toggle')
    if (btn) {
      btn.innerHTML = AppState.zhuyinOn
        ? '注音：<span class="zhuyin-on">開🔵</span>'
        : '注音：<span class="zhuyin-off">關</span>'
    }
    // 重新渲染當前卡片
    await this._renderCurrent()
  }

  // ═══════════════════════════════════════
  // 15. 輔助：卡片類型切換
  // ═══════════════════════════════════════

  /** 切換卡片類型（生字 / 詞語 / 成語）*/
  async _switchCardType(type) {
    if (type === this._cardType) return
    this._cardType = type
    AppState.cardType = type
    this._index = 0
    this._pronIdx = 0
    this._levelCache = {}

    // 更新 tab 按鈕狀態
    document.querySelectorAll('.card-page__type-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.type === type)
    })

    await this._renderCurrent()
  }

  // ═══════════════════════════════════════
  // 16. 輔助：遊戲跳轉
  // ═══════════════════════════════════════

  /** 跳轉到遊戲選單 */
  _goToGame() {
    const char = this._currentChar?.['字'] || this._currentChar?.char || ''
    UIManager.navigate(PAGES.GAME_LIST, { char })
  }

  // ═══════════════════════════════════════
  // 17. 輔助：HTML 渲染
  // ═══════════════════════════════════════

  /** 渲染遺忘等級列 */
  _renderLevelBar(levelInfo) {
    const { systemLevel = 'medium', manualOverride = null, gapWarning = false } = levelInfo || {}
    const activeLevel = manualOverride || systemLevel

    return LEVEL_ORDER.map(lv => {
      const label       = LEVEL_LABELS[lv]
      const isActive    = lv === activeLevel
      const isManual    = isActive && !!manualOverride
      const showWarning = isActive && gapWarning

      return `<button
        class="level-tag ${isActive ? 'active' : ''} level-tag--${lv}"
        data-level="${lv}"
        aria-pressed="${isActive}"
        title="${isManual ? '手動覆蓋中' : '系統判定'}"
      >${label}${isManual ? '✏️' : isActive ? '●' : ''}${showWarning ? '⚠️' : ''}</button>`
    }).join('')
  }

  /** 渲染多音字切換列 */
  _renderPolyphonicBar() {
    return `
      <div class="char-card__poly-bar" id="poly-bar">
        ${this._pronunciations.map((p, i) => `
          <button class="poly-btn ${i === this._pronIdx ? 'active' : ''}"
                  data-pron-idx="${i}"
                  aria-label="切換到${p}">
            <span class="poly-btn__indicator">${i === this._pronIdx ? '●' : '○'}</span>
            <span class="poly-btn__zhuyin">${this._renderZhuyinVerticalInline(p)}</span>
          </button>
        `).join('')}
      </div>
    `
  }

  /** 直式注音 HTML — pv2 系統
   * A: 單符號（只有韻母或介音）→ 3格，符號在中格，聲調在中格旁
   * B: 雙符號（聲母+介音 / 聲母+韻母 / 介音+韻母）→ 2格，上下各一，聲調在中間旁
   * C: 三符號（聲母+介音+韻母）→ 3格，上中下，聲調在中格旁
   * 輕聲：浮在頂部（A/C在上格1/3處，B同）
   */
  _renderZhuyinVerticalInline(pron) {
    if (!pron) return ''

    const INITIALS = new Set('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ')
    const MEDIALS  = new Set('ㄧㄨㄩ')
    const TONES    = new Set(['ˊ','ˇ','ˋ','˙'])

    // 拆解聲調
    let src = pron, tone = ''
    if (src.startsWith('˙')) { tone = '˙'; src = src.slice(1) }
    else if (src.length > 0 && TONES.has(src[src.length - 1])) {
      tone = src[src.length - 1]; src = src.slice(0, -1)
    }

    // 拆解聲母/介音/韻母
    let initial = '', medial = '', final = ''
    for (const c of src) {
      if (INITIALS.has(c))     initial = c
      else if (MEDIALS.has(c)) medial  = c
      else                     final  += c
    }

    const count = [initial, medial, final].filter(Boolean).length

    // 方格系統：3列注音格 + 聲調格
    // 聲調格 row1=˙位置, row2=ˊˇˋ位置, row3=空
    const dotHtml  = tone === '˙'
      ? `<span class="pv2-dot">${this._escapeHtml(tone)}</span>` : '<span class="pv2-dot pv2-empty"></span>'
    const toneHtml = (tone && tone !== '˙')
      ? `<span class="pv2-tone">${this._escapeHtml(tone)}</span>` : '<span class="pv2-tone pv2-empty"></span>'

    // A: 1個符號 → 列1空, 列2放符號, 列3空
    if (count === 1) {
      const sym = initial || medial || final
      return `<span class="pv2 pv2-a">` +
        `<span class="pv2-col">` +
        `<span class="pv2-r1 pv2-empty"></span>` +
        `<span class="pv2-r2">${this._escapeHtml(sym)}</span>` +
        `<span class="pv2-r3 pv2-empty"></span>` +
        `</span>` +
        `<span class="pv2-tone-col">${dotHtml}${toneHtml}<span class="pv2-empty"></span></span>` +
        `</span>`
    }

    // B: 2個符號 → 列1+列3，聲調在列2右側
    if (count === 2) {
      const slots = [initial, medial, final].filter(Boolean)
      return `<span class="pv2 pv2-b">` +
        `<span class="pv2-col">` +
        `<span class="pv2-r1">${this._escapeHtml(slots[0])}</span>` +
        `<span class="pv2-r2 pv2-empty"></span>` +
        `<span class="pv2-r3">${this._escapeHtml(slots[1])}</span>` +
        `</span>` +
        `<span class="pv2-tone-col">${dotHtml}${toneHtml}<span class="pv2-empty"></span></span>` +
        `</span>`
    }

    // C: 3個符號 → 列1=聲母, 列2=介音, 列3=韻母，聲調在列2右側
    return `<span class="pv2 pv2-c">` +
      `<span class="pv2-col">` +
      `<span class="pv2-r1">${this._escapeHtml(initial)}</span>` +
      `<span class="pv2-r2">${this._escapeHtml(medial)}</span>` +
      `<span class="pv2-r3">${this._escapeHtml(final)}</span>` +
      `</span>` +
      `<span class="pv2-tone-col">${dotHtml}${toneHtml}<span class="pv2-empty"></span></span>` +
      `</span>`
  }

  /**
   * 渲染注音直式（右側）
   * 將注音符號縱向排列
   */
  _renderZhuyinVertical(pron) {
    if (!pron) return ''
    // 拆分聲調符號（˙ˊˇˋ）與注音符號
    const chars = [...pron]
    return `<div class="zhuyin-vertical bpmf-font">${chars.map(c =>
      `<span class="zhuyin-char">${this._escapeHtml(c)}</span>`
    ).join('')}</div>`
  }

  /**
   * 渲染部首（永遠帶注音體，不受注音開關影響）
   */
  _renderRadicalWithZhuyin(radical, pron) {
    if (!radical) return ''
    if (!pron) return `<span class="bpmf-font">${this._escapeHtml(radical)}</span>`
    return `<span class="char-with-zhuyin">
      <span class="bpmf-font">${this._escapeHtml(radical)}</span>
      <span class="char-zhuyin bpmf-font">${this._escapeHtml(pron)}</span>
    </span>`
  }


  /**
   * 渲染混合注音：
   * - 多音字：粉紅色直式注音
   * - 一般字：BpmfIVS/ruby 樣式
   */
  _renderMixedWord(word) {
    if (!word) return ''
    const str = String(word)

    return [...str].map(c => {
      const zhuyin = this._findWordCharPron(c, str)
      if (!zhuyin) return this._escapeHtml(c)

      const allPolyphones = JSONLoader.get('polyphones') || []
      const polyEntry = allPolyphones.find(
        p => (p['字'] || p.char) === c &&
             (p.pronunciations || []).some(x => (x.words || []).includes(str))
      )

      // 多音字 → 粉紅色直式
      if (polyEntry) {
        return `<span class="multi-tone-char">
          <span class="multi-tone-base">${this._escapeHtml(c)}</span>
          <span class="multi-tone-bpmf bpmf-font">${this._renderZhuyinVerticalInline(zhuyin)}</span>
        </span>`
      }

      // 一般字 → ruby/BpmfIVS
      return `<span class="char-with-zhuyin">
        ${this._escapeHtml(c)}
        <span class="char-zhuyin bpmf-font">${this._escapeHtml(zhuyin)}</span>
      </span>`
    }).join('')
  }

  /**
   * _renderWord(word, targetChar) — 渲染詞語（含上下文正確注音）
   * 注音規則：生字簿的字純文字；非生字簿的字依 zhuyinOn 決定
   * 破音字以詞語為上下文查正確讀音（如「著涼」中「著」讀 ㄓㄠ）
   */
  _renderWord(word, targetChar) {
    if (!word) return ''
    const str = String(word)
    if (!AppState.zhuyinOn) return this._escapeHtml(str)

    return this._renderMixedWord(str)
  }

  /** 判斷是否為生字簿字 */
  _isMyChar(char) {
    return (AppState.characters || []).some(c => (c['字'] || c.char) === char)
  }

  /**
   * _findWordCharPron(char, word) — 依詞語上下文取字的正確注音
   * 優先從 polyphones.json 找包含此詞語的讀音（破音字上下文正確讀音）
   * fallback：characters.json 第一讀音
   */
  _findWordCharPron(char, word) {
    // 1. 先查 polyphones.json 是否為破音字
    const allPolyphones = JSONLoader.get('polyphones') || []
    const polyEntry = allPolyphones.find(p => p['字'] === char || p.char === char)
    if (polyEntry?.pronunciations?.length > 0) {
      const matched = polyEntry.pronunciations.find(p => (p.words || []).includes(word))
      if (matched) return matched.zhuyin
      return polyEntry.pronunciations[0]?.zhuyin || ''
    }
    // 2. 查 characters.json 的 definitions.ex 陣列
    //    找包含此詞語(word)的 ex，取對應字的注音（詞語上下文正確讀音）
    const allChars = JSONLoader.get('characters') || []
    const entry = allChars.find(c => c['字'] === char || c.char === char)
    if (entry) {
      for (const pron of (entry.pronunciations || [])) {
        for (const def of (pron.definitions || [])) {
          const ex = (def.ex || []).find(e => e.w === word)
          if (ex) {
            // 從 ex.chars 找此字的注音
            const charData = ex.chars?.find(ch => ch.c === char)
            if (charData?.z) return charData.z
            return pron.zhuyin  // fallback to this pronunciation's zhuyin
          }
        }
      }
      // 3. 找不到詞語上下文，取第一讀音
      return entry.pronunciations?.[0]?.zhuyin || entry['注音'] || ''
    }
    return ''
  }

  /** 從 AppState.characters 快查某字的注音（單音字用）*/
  _findCharZhuyin(char) {
    const found = (AppState.characters || []).find(c => (c['字'] || c.char) === char)
    const raw = found?.['注音'] || found?.pronunciation || ''
    return Array.isArray(raw) ? raw[0] : raw.split('/')[0]
  }

  /** 渲染空清單提示 */
  _renderEmpty() {
    const app = document.getElementById('app')
    app.innerHTML = `
      <div class="card-page card-page--empty">
        <button class="card-page__back-btn" id="card-back-btn">← 返回</button>
        <div class="card-page__empty-msg">
          <div class="empty-icon">📚</div>
          <div>還沒有${this._cardType === CARD_TYPES.IDIOM ? '成語' : this._cardType === CARD_TYPES.WORD ? '詞語' : '生字'}喔！</div>
          <div class="empty-hint">請家長先到家長模式新增資料</div>
        </div>
      </div>
    `
    this._addListener('card-back-btn', 'click', () => {
      // 若目前是詞語或成語空頁，返回生字卡；否則正常回上頁
      if (this._cardType !== CARD_TYPES.CHARACTER) {
        this._switchCardType(CARD_TYPES.CHARACTER)
      } else {
        UIManager.back()
      }
    })
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}

// ─────────────────────────────────────────
// 單例匯出（UIManager 用 new CardPage() 建立，此處不強制單例）
// UIManager._initPage 中使用 new CardPage() 建立實例
// ─────────────────────────────────────────
