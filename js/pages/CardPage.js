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

    // 合併：優先用 charObj 本身的值，缺少的從字典補
    const enriched = dictEntry ? {
      ...charObj,
      // 部首（characters.json 用 radical）
      '部首': charObj['部首'] || dictEntry.radical || '',
      // 總筆畫（characters.json 用 total_strokes）
      '總筆畫數': charObj['總筆畫數'] || dictEntry.total_strokes || '',
      // 部首外筆畫（characters.json 用 radical_strokes）
      '部首外筆畫': charObj['部首外筆畫'] || dictEntry.radical_strokes || '',
      // 注音：my_characters 存 zhuyin 字串，字典存 pronunciations 陣列
      '注音': charObj['注音'] || charObj.zhuyin ||
        (dictEntry.pronunciations?.[0]?.zhuyin) || '',
      // 詞語：字典中每個 pronunciation 條目有 words 陣列
      '詞語': charObj['詞語'] ||
        (dictEntry.pronunciations ? (() => {
          const obj = {}
          dictEntry.pronunciations.forEach(p => { obj[p.zhuyin] = p.words || [] })
          return obj
        })() : []),
      // 解釋
      '解釋': charObj['解釋'] || dictEntry.pronunciations?.[0]?.meaning || '',
    } : charObj

    this._currentChar = enriched
    // ──────────────────────────────────────────────────────────────

    // 解析注音（支援多音字 array 或 string）
    const rawPron = enriched['注音'] || enriched.pronunciation || enriched.zhuyin || ''
    this._pronunciations = Array.isArray(rawPron)
      ? rawPron
      : rawPron.split('/').map(p => p.trim()).filter(Boolean)
    if (this._pronunciations.length === 0) this._pronunciations = ['']

    // 確保 pronIdx 合法
    this._pronIdx = Math.max(0, Math.min(this._pronIdx, this._pronunciations.length - 1))

    // 讀取遺忘等級
    const levelInfo = await this._getLevelInfo(char)

    // 取當前音的詞語
    const words = this._getWordsForPron(enriched, this._pronIdx)

    // 部首
    const radical     = enriched['部首'] || enriched.radical || ''
    const radicalPron = this._getRadicalPron(radical)
    const strokesAll  = enriched['總筆畫數'] || enriched.totalStrokes || ''
    const strokesRad  = enriched['部首外筆畫'] || enriched.radicalStrokes || ''
    const definition  = enriched['解釋'] || enriched.definition || ''
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
              ${this._escapeHtml(radical)}
              <span class="bpmf-font">${this._escapeHtml(radicalPron)}</span>
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

        <!-- 詞語區（仿圖二字義解釋區） -->
        <div class="char-card__words-section">
          <div class="char-card__words-title">詞語應用</div>
          <div class="char-card__words" id="card-words">
            ${words.map(w => `<span class="char-card__word">${this._renderWord(w, char)} <span class="word-sound-icon">🔊</span></span>`).join('')}
          </div>
        </div>

        <!-- 字義 -->
        ${definition ? `<div class="char-card__definition" id="card-def">${this._escapeHtml(definition)}</div>` : ''}

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

    // 詞語點擊播音（事件委派）
    this._addListener('card-words', 'click', (e) => {
      const wordEl = e.target.closest('.char-card__word')
      if (!wordEl) return
      // 取詞語純文字（去除音標 span）
      const word = wordEl.innerText.replace('🔊', '').trim()
      if (word && AppState.settings?.soundOn !== false) {
        AudioManager.playQueue?.(word.split(''))
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

    let word, definition, example, pron
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
      pron       = found?.zhuyin || ''
    } else {
      word       = wordObj['詞語'] || wordObj.word || ''
      definition = wordObj['解釋'] || wordObj.definition || ''
      example    = wordObj['例句'] || wordObj.example || ''
      pron       = wordObj['注音'] || wordObj.pronunciation || ''
    }

    const wrap = document.getElementById('card-wrap')
    if (!wrap) return

    wrap.innerHTML = `
      <div class="word-card">
        <div class="word-card__main">
          <div class="word-card__word bpmf-font">${this._escapeHtml(word)}</div>
          ${pron && AppState.zhuyinOn
            ? `<div class="word-card__pron bpmf-font">${this._escapeHtml(pron)}</div>`
            : ''}
        </div>
        ${definition ? `<div class="word-card__def">【意思】${this._escapeHtml(definition)}</div>` : ''}
        ${example    ? `<div class="word-card__ex">【例句】${this._escapeHtml(example)}</div>` : ''}
        <button class="char-card__game-btn" id="card-game-btn">🎮 翻面挑戰</button>
      </div>
    `

    this._addListener('card-game-btn', 'click', () => this._goToGame())
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

    // 相容純字串格式（my_idioms 存的是字串）
    let idiom, meaning, example, origin, pron
    if (typeof idiomObj === 'string') {
      idiom = idiomObj
      const idiomsDict = JSONLoader.get('idioms') || []
      const found = idiomsDict.find(e => e.idiom === idiom || e['成語'] === idiom)
      meaning = found?.meaning || found?.['意思'] || ''
      example = found?.example || found?.['例句'] || ''
      origin  = found?.origin  || found?.['出處'] || ''
      pron    = found?.zhuyin  || found?.['注音'] || ''
    } else {
      idiom   = idiomObj['成語'] || idiomObj.idiom || ''
      meaning = idiomObj['意思'] || idiomObj.meaning || ''
      example = idiomObj['例句'] || idiomObj.example || ''
      origin  = idiomObj['出處'] || idiomObj.origin || ''
      pron    = idiomObj['注音'] || idiomObj.pronunciation || ''
    }

    const wrap = document.getElementById('card-wrap')
    if (!wrap) return

    wrap.innerHTML = `
      <div class="idiom-card">
        <div class="idiom-card__main">
          <div class="idiom-card__idiom bpmf-font">
            ${this._escapeHtml(idiom)}
          </div>
        </div>
        ${meaning ? `<div class="idiom-card__meaning">【意思】${this._escapeHtml(meaning)}</div>` : ''}
        ${example ? `<div class="idiom-card__example">【例句】${this._escapeHtml(example)}</div>`  : ''}
        ${origin  ? `<div class="idiom-card__origin">【出處】${this._escapeHtml(origin)}</div>`   : ''}
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

    // 更新詞語
    if (this._currentChar) {
      const words = this._getWordsForPron(this._currentChar, idx)
      const wordsEl = document.getElementById('card-words')
      if (wordsEl) {
        const char = this._currentChar['字'] || ''
        wordsEl.innerHTML = words.map(w =>
          `<span class="char-card__word">${this._renderWord(w, char)} <span class="word-sound-icon">🔊</span></span>`
        ).join('')
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

    // 重新讀取並更新等級列
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

  /** 取得部首的注音 */
  _getRadicalPron(radical) {
    // 嘗試從 characters.json 快取查找部首注音
    const chars = AppState.characters || []
    const found = chars.find(c => (c['字'] || c.char) === radical)
    return found ? (found['注音'] || found.pronunciation || '') : ''
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
          const info = await ForgettingCurve.getLevel?.(char)
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
      const info = await ForgettingCurve.getLevel?.(char) || {
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

  /** 播放當前字的注音音效 */
  _playSound() {
    // 靜音時不拋出，靜默返回
    if (AppState.settings?.soundOn === false) return
    if (!this._currentChar) return

    const pron = this._pronunciations[this._pronIdx] || ''
    try {
      AudioManager.play?.(pron)
    } catch (e) {
      console.warn('播放注音失敗', e)
    }
  }

  // ═══════════════════════════════════════
  // 14. 輔助：注音開關
  // ═══════════════════════════════════════

  /** 切換注音開關 */
  async _toggleZhuyin() {
    AppState.zhuyinOn = !AppState.zhuyinOn
    AppState.save?.()
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
            ${i === this._pronIdx ? '●' : '○'} <span class="bpmf-font">${this._escapeHtml(p)}</span>
          </button>
        `).join('')}
      </div>
    `
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
   * renderWord(word, targetChar) — 渲染詞語
   * 注音規則：生字簿的字純文字；非生字簿的字依 zhuyinOn 決定
   */
  _renderWord(word, targetChar) {
    if (!word) return ''
    const str = String(word)
    if (!AppState.zhuyinOn) return this._escapeHtml(str)

    // 每個字分別判斷是否為生字簿字
    return [...str].map(c => {
      if (this._isMyChar(c)) return this._escapeHtml(c)
      const zhuyin = this._findCharZhuyin(c)
      if (!zhuyin) return this._escapeHtml(c)
      return `<span class="char-with-zhuyin">
        ${this._escapeHtml(c)}<span class="char-zhuyin bpmf-font">${this._escapeHtml(zhuyin)}</span>
      </span>`
    }).join('')
  }

  /** 判斷是否為生字簿字 */
  _isMyChar(char) {
    return (AppState.characters || []).some(c => (c['字'] || c.char) === char)
  }

  /** 從 AppState.characters 快查某字的注音 */
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
