/**
 * hanzi_writer_manager.js — HanziWriterManager Instance Pool
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：無（HanziWriter 從 CDN 動態載入）
 * 位置：/js/hanzi_writer_manager.js
 *
 * HanziWriter JS CDN：
 *   https://cdn.jsdelivr.net/npm/hanzi-writer@3.5/dist/hanzi-writer.min.js
 *
 * 字元資料 CDN（每個字獨立 JSON）：
 *   https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/{字}.json
 *
 * 修正（Bug fix）：
 *   _loadHanziWriter() 改為：
 *     1. 先檢查全域 HanziWriter 是否已存在
 *     2. 若不存在 → 動態插入 <script> tag 並等待 onload
 *     3. 不再只是輪詢等待（原版在 index.html 未加 script 時會超時）
 *   好處：即使 index.html 未預先加入 script，也能正常運作
 *         index.html 預先加入時則直接使用，無重複載入
 */

// HanziWriter CDN URL（集中管理，方便日後升版）
const HANZI_WRITER_CDN = 'https://cdn.jsdelivr.net/npm/hanzi-writer@3.5/dist/hanzi-writer.min.js'
const HANZI_DATA_CDN   = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest'

export const HanziWriterManager = {

  // ── Instance Pool：以 containerId 為 key ──
  _instances: {},

  // ── 競態防護：每個 container 獨立的 requestId ──
  _requestIds: {},

  // ── 最後一次 quiz callbacks（供 restartQuiz 使用）──
  _lastQuizCallbacks: {},

  // ── HanziWriter 載入 Promise（確保只載入一次）──
  _loadPromise: null,

  // ─────────────────────────────────────────────
  // getWriter — 取得或建立 HanziWriter instance
  // ─────────────────────────────────────────────

  /**
   * getWriter(containerId, options)
   * 同一 containerId 只建立一次 instance，後續回傳快取
   */
  async getWriter(containerId, options = {}) {
    // 快取命中
    if (this._instances[containerId]) {
      return this._instances[containerId]
    }

    // 確認 DOM 元素存在
    const el = document.getElementById(containerId)
    if (!el) {
      console.error(`HanziWriterManager: #${containerId} 不存在於 DOM`)
      return null
    }

    // 確保 HanziWriter 已載入（自動動態注入 script）
    const HanziWriter = await this._loadHanziWriter()
    if (!HanziWriter) return null

    // 預設選項
    const defaultOptions = {
      width:                 200,
      height:                200,
      padding:               5,
      showOutline:           true,
      strokeColor:           '#333',
      outlineColor:          '#ddd',
      drawingColor:          '#333',
      strokeAnimationSpeed:  1,
      delayBetweenStrokes:   300,
      // 自訂 charDataLoader：加入有效性防護，避免空字元產生 404
      charDataLoader: (char, onComplete, onError) => {
        if (!char || typeof char !== 'string' || char.trim() === '') {
          console.error('HanziWriterManager: charDataLoader 收到無效字元:', char)
          onError && onError(new Error('無效字元'))
          return
        }
        const url = `${HANZI_DATA_CDN}/${encodeURIComponent(char)}.json`
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return res.json()
          })
          .then(data => onComplete(data))
          .catch(err => {
            console.warn(`HanziWriterManager: 字元資料載入失敗 (${char}):`, err.message)
            onError && onError(err)
          })
      },
    }

    try {
      // 用 '一' 作為初始佔位字元，避免空字串造成 404
      const writer = HanziWriter.create(containerId, '一', {
        ...defaultOptions,
        ...options,
      })

      this._instances[containerId]  = writer
      this._requestIds[containerId] = 0
      console.log(`[HanziWriterManager] 建立 instance：#${containerId}`)
      return writer
    } catch (e) {
      console.error(`HanziWriterManager: 建立 instance 失敗 (#${containerId}):`, e)
      return null
    }
  },

  // ─────────────────────────────────────────────
  // switchChar — 切換字元（requestId 防競態）
  // ─────────────────────────────────────────────

  /**
   * switchChar(char, containerId, options)
   * 快速連續呼叫時，舊的切換被新的 requestId 取消
   */
  async switchChar(char, containerId, options = {}) {
    // 驗證字元（防止空字元 404）
    if (!char || typeof char !== 'string' || char.trim() === '') {
      console.error('HanziWriterManager.switchChar: 無效字元', char)
      return false
    }

    const writer = await this.getWriter(containerId, options)
    if (!writer) return false

    // requestId 遞增
    const reqId = ++this._requestIds[containerId]

    return new Promise((resolve) => {
      try {
        // 停止動畫 → 隱藏 → 切換字元 → 顯示
        this._safeStop(writer)
        writer.hideCharacter({ duration: 0 })
        writer.hideOutline({ duration: 0 })
        writer.setCharacter(char)

        // 確認 requestId 仍有效
        if (reqId !== this._requestIds[containerId]) {
          resolve(false)
          return
        }

        writer.showCharacter({
          duration:   300,
          onComplete: () => resolve(reqId === this._requestIds[containerId]),
        })
        writer.showOutline({ duration: 200 })

      } catch (e) {
        console.error(`HanziWriterManager.switchChar 失敗 (${char}):`, e)
        resolve(false)
      }
    })
  },

  // ─────────────────────────────────────────────
  // animateStrokes / animateOneStroke
  // ─────────────────────────────────────────────

  async animateStrokes(char, containerId, options = {}) {
    const switched = await this.switchChar(char, containerId)
    if (!switched) return false

    const writer = this._instances[containerId]
    if (!writer) return false

    return new Promise((resolve) => {
      try {
        writer.animateCharacter({
          strokeAnimationSpeed: options.strokeAnimationSpeed || 1,
          delayBetweenStrokes:  options.delayBetweenStrokes  || 300,
          onComplete: () => { options.onComplete?.(); resolve(true) },
        })
      } catch (e) {
        console.error('HanziWriterManager.animateStrokes 失敗:', e)
        resolve(false)
      }
    })
  },

  async animateOneStroke(char, containerId, strokeNum) {
    await this.switchChar(char, containerId)
    const writer = this._instances[containerId]
    if (!writer) return false
    try { writer.animateStroke(strokeNum); return true }
    catch (e) { console.error('HanziWriterManager.animateOneStroke 失敗:', e); return false }
  },

  // ─────────────────────────────────────────────
  // startQuiz / restartQuiz
  // ─────────────────────────────────────────────

  async startQuiz(char, containerId, callbacks = {}) {
    await this.switchChar(char, containerId)
    const writer = this._instances[containerId]
    if (!writer) return false

    this._lastQuizCallbacks[containerId] = callbacks
    try {
      writer.quiz({
        onCorrectStroke: sd => callbacks.onCorrectStroke?.(sd),
        onMistake:       sd => callbacks.onMistake?.(sd),
        onComplete:      sd => callbacks.onComplete?.(sd),
      })
      return true
    } catch (e) {
      console.error('HanziWriterManager.startQuiz 失敗:', e)
      return false
    }
  },

  /**
   * restartQuiz(containerId, callbacks?)
   * 不重建 instance（規格明確要求）
   */
  restartQuiz(containerId, callbacks) {
    const writer = this._instances[containerId]
    if (!writer) {
      console.error(`HanziWriterManager.restartQuiz: #${containerId} instance 不存在`)
      return false
    }
    const cb = callbacks || this._lastQuizCallbacks[containerId] || {}
    if (callbacks) this._lastQuizCallbacks[containerId] = callbacks
    try {
      writer.quiz({
        onCorrectStroke: sd => cb.onCorrectStroke?.(sd),
        onMistake:       sd => cb.onMistake?.(sd),
        onComplete:      sd => cb.onComplete?.(sd),
      })
      return true
    } catch (e) {
      console.error('HanziWriterManager.restartQuiz 失敗:', e)
      return false
    }
  },

  // ─────────────────────────────────────────────
  // preload — 背景預載字元資料
  // ─────────────────────────────────────────────

  async preload(chars, containerId) {
    if (!Array.isArray(chars) || chars.length === 0) return
    const writer = this._instances[containerId]
    if (!writer) return
    // 背景偷跑，不阻塞 UI
    for (const char of chars) {
      if (!char || typeof char !== 'string') continue
      setTimeout(() => {
        try { writer.setCharacter(char) } catch (_e) {}
      }, 0)
    }
  },

  // ─────────────────────────────────────────────
  // pause / destroy
  // ─────────────────────────────────────────────

  pause() {
    for (const writer of Object.values(this._instances)) {
      this._safeStop(writer)
    }
  },

  destroy() {
    for (const writer of Object.values(this._instances)) {
      try { this._safeStop(writer) } catch (_e) {}
    }
    this._instances          = {}
    this._requestIds         = {}
    this._lastQuizCallbacks  = {}
    console.log('[HanziWriterManager] destroy：所有 instance 已清除')
  },

  // ─────────────────────────────────────────────
  // 私有工具
  // ─────────────────────────────────────────────

  _safeStop(writer) {
    if (!writer) return
    try { writer.cancelAnimation() } catch (_e) {}
  },

  /**
   * _loadHanziWriter()
   * 修正核心：
   *   原版：只輪詢等待 typeof HanziWriter，index.html 沒有 script 時永遠超時
   *   修正：
   *     1. 已存在 → 直接回傳（index.html 有預先載入的情況）
   *     2. 不存在 → 動態插入 <script> tag，等待 onload 後回傳
   *     3. 使用 _loadPromise 確保多次呼叫只注入一次 script
   */
  _loadHanziWriter() {
    // 已載入，直接回傳
    if (typeof HanziWriter !== 'undefined') {
      return Promise.resolve(HanziWriter)
    }

    // 已有進行中的載入 Promise，共用（防重複注入）
    if (this._loadPromise) {
      return this._loadPromise
    }

    // 動態注入 <script> tag
    this._loadPromise = new Promise((resolve) => {
      // 檢查是否已有相同 src 的 script（防重複）
      const existing = document.querySelector(`script[src="${HANZI_WRITER_CDN}"]`)
      if (existing) {
        // script 已存在但可能尚未執行完，輪詢等待
        const poll = setInterval(() => {
          if (typeof HanziWriter !== 'undefined') {
            clearInterval(poll)
            resolve(HanziWriter)
          }
        }, 50)
        // 10 秒超時保護
        setTimeout(() => {
          clearInterval(poll)
          console.error('HanziWriterManager: HanziWriter 載入超時')
          resolve(null)
        }, 10000)
        return
      }

      // 注入新的 <script> tag
      const script  = document.createElement('script')
      script.src    = HANZI_WRITER_CDN
      script.async  = true

      script.onload = () => {
        if (typeof HanziWriter !== 'undefined') {
          console.log('[HanziWriterManager] HanziWriter 動態載入成功')
          resolve(HanziWriter)
        } else {
          console.error('[HanziWriterManager] HanziWriter script 已載入但全域變數不存在')
          resolve(null)
        }
      }

      script.onerror = () => {
        console.error('[HanziWriterManager] HanziWriter CDN 載入失敗，遊戲降級繼續')
        resolve(null)  // 不拋出，讓遊戲降級繼續
      }

      document.head.appendChild(script)
    })

    return this._loadPromise
  },
}
