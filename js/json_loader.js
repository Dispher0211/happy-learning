/**
 * json_loader.js — JSONLoader（JSON 載入管理）
 * Task 06 最終版 — 快樂學習 Happy Learning v4.1.0
 *
 * 依賴：version.js（APP_VERSION）
 * 規格：SECTION 4.8（三波載入策略）
 *
 * ══ 三波載入策略 ═══════════════════════════════════════════════
 *   第一波（啟動時阻塞）：characters, radicals
 *   第二波（背景不阻塞）：polyphones, idioms, pokedex_series
 *   第三波（遊戲懶載入）：confusables, sentences 索引, audio_cache
 *
 * ══ sentences 分冊架構 ═════════════════════════════════════════
 *
 *   sentences.json          → 輕量索引（~11 KB）
 *                              記錄每個字屬於哪一冊（char_book）
 *                              + 各分冊檔案清單（_meta.fill_books 等）
 *
 *   sentences_fill_b1~b4    → 各冊 fill 資料（array）
 *   sentences_compose_b1~b4 → 各冊 compose 資料（array）
 *   sentences_pattern        → 句型庫（array），與 character 無關，獨立一份
 *
 *   ⚠️  pattern 不分冊，整份載入，因句型數量少（<100筆），全局共用
 *
 * ══ 對外 API（不隨分冊結構改變）══════════════════════════════
 *   loadSentencesForChar(char)    → 載入該字所屬冊的 fill + compose
 *   loadPattern()                 → 載入句型庫（獨立，只需載入一次）
 *   getSentenceData(char)         → 同步取 { fill, pattern, compose }
 *
 * ══ v4 修改：失敗回空值，不向上拋出 ══════════════════════════
 *   sentences 索引失敗 → { _meta:{}, char_book:{} }
 *   array 型失敗       → []
 *   dict 型失敗        → {}（audio_cache）
 */

import { APP_VERSION } from '../version.js'

// ─────────────────────────────────────────────────────────────
// 結構為物件（dict）的 JSON 名稱（非陣列）
// ─────────────────────────────────────────────────────────────
const DICT_TYPE_JSONS = new Set(['audio_cache'])

// sentences 索引的固定名稱
const SENTENCES_INDEX = 'sentences'

// sentences_pattern 的固定名稱（不分冊）
const SENTENCES_PATTERN = 'sentences_pattern'

const JSONLoader = {
  /** 記憶體快取 { name: data } */
  _cache: {},

  /** 快取版本（跨版本清除用） */
  _cacheVersion: null,

  /** 進行中的 Promise { name: Promise }（防重複請求） */
  _pending: {},

  /**
   * 分冊 sentences 快取
   * { bookNum: { [char]: { fill:[], compose:[] } } }
   */
  _sentenceBookCache: {},

  /** pattern 是否已載入 */
  _patternLoaded: false,

  // ─────────────────────────────────────────────────────────────
  // load(name) — 通用載入方法
  // ─────────────────────────────────────────────────────────────
  async load(name) {
    // 版本比對
    if (this._cacheVersion !== null && this._cacheVersion !== APP_VERSION) {
      console.log(`[JSONLoader] 版本更新 ${this._cacheVersion}→${APP_VERSION}，清除快取`)
      this._cache             = {}
      this._pending           = {}
      this._sentenceBookCache = {}
      this._patternLoaded     = false
    }
    this._cacheVersion = APP_VERSION

    if (this._cache[name] !== undefined) return this._cache[name]
    if (this._pending[name]) return this._pending[name]

    this._pending[name] = (async () => {
      try {
        const data = await this._fetchWithRetry(`/data/${name}.json?v=${APP_VERSION}`)

        // sentences 索引 → 物件
        if (name === SENTENCES_INDEX) {
          if (typeof data !== 'object' || Array.isArray(data))
            throw new TypeError(`${name}.json 預期是物件（索引格式）`)
          this._cache[name] = data
          return data
        }

        // dict 型（audio_cache）
        if (DICT_TYPE_JSONS.has(name)) {
          if (typeof data !== 'object' || Array.isArray(data))
            throw new TypeError(`${name}.json 預期是物件`)
          this._cache[name] = data
          return data
        }

        // 陣列型（所有 fill / compose / pattern / characters 等）
        if (!Array.isArray(data))
          throw new TypeError(`${name}.json 預期是陣列，得到 ${typeof data}`)
        this._cache[name] = data
        return data

      } catch (err) {
        console.error(`[JSONLoader] ${name} 載入失敗`, err)
        // 依類型回傳對應空值
        if (name === SENTENCES_INDEX)       this._cache[name] = { _meta: {}, char_book: {} }
        else if (DICT_TYPE_JSONS.has(name)) this._cache[name] = {}
        else                                this._cache[name] = []
        return this._cache[name]
      } finally {
        delete this._pending[name]
      }
    })()

    return this._pending[name]
  },

  // ─────────────────────────────────────────────────────────────
  // loadMultiple(names) — 批次並行載入
  // ─────────────────────────────────────────────────────────────
  async loadMultiple(names) {
    const results = await Promise.all(names.map(n => this.load(n)))
    return Object.fromEntries(names.map((n, i) => [n, results[i]]))
  },

  // ─────────────────────────────────────────────────────────────
  // get(name) — 同步取得已快取資料
  // ─────────────────────────────────────────────────────────────
  get(name) {
    if (this._cache[name] !== undefined) return this._cache[name]
    if (name === SENTENCES_INDEX) return { _meta: {}, char_book: {} }
    return DICT_TYPE_JSONS.has(name) ? {} : []
  },

  // ─────────────────────────────────────────────────────────────
  // clear(name?) — 清除快取
  // ─────────────────────────────────────────────────────────────
  clear(name) {
    if (name) {
      delete this._cache[name]
      delete this._pending[name]
      if (name === SENTENCES_INDEX) {
        this._sentenceBookCache = {}
        this._patternLoaded = false
      }
      console.log(`[JSONLoader] 清除快取：${name}`)
    } else {
      this._cache             = {}
      this._pending           = {}
      this._sentenceBookCache = {}
      this._patternLoaded     = false
      console.log('[JSONLoader] 清除全部快取')
    }
  },

  // ─────────────────────────────────────────────────────────────
  // _fetchWithRetry — 重試機制（重試2次，間隔500ms）
  // ─────────────────────────────────────────────────────────────
  async _fetchWithRetry(url, retries = 2, delay = 500) {
    let lastErr
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
        return await res.json()
      } catch (err) {
        lastErr = err
        if (attempt < retries) {
          console.warn(`[JSONLoader] 重試 ${attempt + 1}/${retries}：${url}`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    throw lastErr
  },

  // ══════════════════════════════════════════════════════════════
  // 三波載入策略（供 app.js 呼叫）
  // ══════════════════════════════════════════════════════════════

  /** wave1 — 第一波：啟動時阻塞載入 */
  async wave1() {
    console.log('[JSONLoader] ▶ 第一波（characters, radicals）')
    await this.loadMultiple(['characters', 'radicals'])
    console.log('[JSONLoader] ✓ 第一波完成')
  },

  /** wave2 — 第二波：背景不阻塞 */
  wave2() {
    console.log('[JSONLoader] ▶ 第二波（polyphones, idioms, pokedex_series）')
    this.loadMultiple(['polyphones', 'idioms', 'pokedex_series'])
      .then(() => console.log('[JSONLoader] ✓ 第二波完成'))
      .catch(err => console.error('[JSONLoader] 第二波異常', err))
  },

  /**
   * wave3(name) — 第三波：懶載入
   *   'sentences'   → 只載入輕量索引（不含實際句子資料）
   *   'confusables' → 直接載入
   *   'audio_cache' → 直接載入
   */
  async wave3(name) {
    const allowed = new Set(['confusables', 'sentences', 'audio_cache'])
    if (!allowed.has(name)) console.warn(`[JSONLoader] wave3 不支援 "${name}"`)
    console.log(`[JSONLoader] ▶ 第三波懶載入：${name}`)
    return this.load(name)
  },

  // ══════════════════════════════════════════════════════════════
  // sentences 專用方法
  // ══════════════════════════════════════════════════════════════

  /**
   * loadSentencesForChar(char)
   *   載入指定字所屬冊的 fill + compose 資料
   *   同冊字共用快取，只載入一次
   *
   * 使用方式（sentence.js 遊戲內）：
   *   await JSONLoader.loadSentencesForChar(currentChar)
   *   const { fill, compose } = JSONLoader.getSentenceData(currentChar)
   *
   * @param {string} char 目標漢字
   */
  async loadSentencesForChar(char) {
    const index   = await this.load(SENTENCES_INDEX)
    const bookNum = (index.char_book || {})[char] || 1

    // 已快取 → 直接回傳
    if (this._sentenceBookCache[bookNum]) return

    // 並行載入該冊 fill + compose
    const [fillArr, composeArr] = await Promise.all([
      this.load(`sentences_fill_b${bookNum}`),
      this.load(`sentences_compose_b${bookNum}`),
    ])

    // 建立以 character 為 key 的字典
    const bookCache = {}
    for (const r of (Array.isArray(fillArr)    ? fillArr    : [])) {
      if (!bookCache[r.character]) bookCache[r.character] = { fill: [], compose: [] }
      bookCache[r.character].fill.push(r)
    }
    for (const r of (Array.isArray(composeArr) ? composeArr : [])) {
      if (!bookCache[r.character]) bookCache[r.character] = { fill: [], compose: [] }
      bookCache[r.character].compose.push(r)
    }

    this._sentenceBookCache[bookNum] = bookCache
    console.log(`[JSONLoader] ✓ sentences 第${bookNum}冊載入（${Object.keys(bookCache).length}字）`)
  },

  /**
   * loadPattern()
   *   載入句型庫（sentences_pattern.json）
   *   句型與 character 無關，整份載入，只需呼叫一次
   *   家長設定的 my_sentences 由 Firestore 提供，優先於此
   */
  async loadPattern() {
    if (this._patternLoaded) return this.get(SENTENCES_PATTERN)
    const data = await this.load(SENTENCES_PATTERN)
    this._patternLoaded = true
    console.log(`[JSONLoader] ✓ sentences_pattern 載入（${data.length} 個句型）`)
    return data
  },

  /**
   * getSentenceData(char)
   *   同步取得指定字的 sentences 資料
   *   ⚠️ 必須先呼叫 await loadSentencesForChar(char)
   *
   * @param  {string} char 目標漢字
   * @returns {{ fill: Array, compose: Array, pattern: Array }}
   *   pattern 為句型庫（全局共用），需先呼叫 await loadPattern()
   */
  getSentenceData(char) {
    // 在各冊快取中搜尋
    for (const bookCache of Object.values(this._sentenceBookCache)) {
      if (bookCache[char]) {
        return {
          fill:    bookCache[char].fill    || [],
          compose: bookCache[char].compose || [],
          pattern: this.get(SENTENCES_PATTERN),   // 全局句型庫
        }
      }
    }
    return { fill: [], compose: [], pattern: this.get(SENTENCES_PATTERN) }
  },

  /**
   * preloadSentencesForBook(bookNum)
   *   預載整冊（學生開始學某冊時提前快取）
   *   @param {number} bookNum 1~4
   */
  async preloadSentencesForBook(bookNum) {
    if (this._sentenceBookCache[bookNum]) return
    const index = await this.load(SENTENCES_INDEX)
    const char  = Object.keys(index.char_book || {})
                    .find(c => index.char_book[c] === bookNum)
    if (char) await this.loadSentencesForChar(char)
  },
}

export { JSONLoader }
