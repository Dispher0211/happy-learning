/**
 * pokedex.js — PokedexManager 圖鑑管理
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）、firebase.js（FirestoreAPI, arrayUnion）、sync.js（SyncManager）
 * 位置：/js/pokedex.js
 * 層級：第四層核心系統（sync.js 之後，ui_manager.js 之前）
 *
 * ⚠️ 重要：stars.js 只能透過 globalThis.PokedexManager?.onStarsAdded 呼叫本模組
 *          不可在 stars.js 中靜態 import pokedex.js（避免循環依賴）
 *
 * ⚠️ 本模組不可 import 任何 Page 或 Overlay
 *    UIManager 透過 globalThis.UIManager?.showToast 可選鏈呼叫
 *
 * v1.2.11：checkAndReveal 改為傳 total 給 SyncManager.revealPokedex（隨機解鎖）
 */

import { AppState }             from './state.js'
import { FirestoreAPI, arrayUnion } from './firebase.js'
import { SyncManager }          from './sync.js'
import { JSONLoader }           from './json_loader.js'

// ─────────────────────────────────────────────
// 內部 RevealQueue（記憶體 + Firestore）
// ─────────────────────────────────────────────
const RevealQueue = {
  // 記憶體佇列：{ seriesId: number[] }
  _queues: {},

  /**
   * add(index, seriesId) — 加入揭曉佇列
   * 同時寫入記憶體 + Firestore arrayUnion
   */
  async add(index, seriesId) {
    if (!this._queues[seriesId]) this._queues[seriesId] = []
    if (!this._queues[seriesId].includes(index)) {
      this._queues[seriesId].push(index)
    }
    // Firestore 已在 SyncManager.revealPokedex 的 Transaction 內寫入 arrayUnion
    // 此處只補記憶體端（Firestore 端已完成）
  },

  /**
   * consume(seriesId) — 取出並清空佇列（記憶體 + Firestore）
   * @returns {number[]} 取出的索引陣列
   */
  async consume(seriesId) {
    const items = [...(this._queues[seriesId] || [])]
    this._queues[seriesId] = []

    if (!AppState.uid || items.length === 0) return items

    // 清空 Firestore 的 reveal_queue
    try {
      await FirestoreAPI.update(
        `users/${AppState.uid}`,
        { [`pokedex.${seriesId}.reveal_queue`]: [] }
      )
    } catch (e) {
      console.error('RevealQueue.consume Firestore 清空失敗:', e)
    }

    return items
  },

  /** peek(seriesId) — 查看佇列（不取出） */
  peek(seriesId) {
    return [...(this._queues[seriesId] || [])]
  },

  /** length(seriesId) — 佇列長度 */
  length(seriesId) {
    return (this._queues[seriesId] || []).length
  },
}

// ─────────────────────────────────────────────
// PokedexManager
// ─────────────────────────────────────────────
export const PokedexManager = {

  // 圖片記憶體快取：Map<'seriesId:index', url|null>
  _imageCache: new Map(),

  // 名稱記憶體快取：Map<'seriesId:index', string|null>
  _nameCache: new Map(),

  // 揭曉防並發鎖（同一時間只允許一次 revealPokedex Transaction）
  _isRevealing: false,

  // 自訂系列快取（從 Firestore 讀入，避免重複讀取）
  _customSeriesCache: null,
  _customSeriesCacheUid: null,

  // ─────────────────────────────────────────────
  // init — 從 Firestore 讀取圖鑑狀態
  // ─────────────────────────────────────────────

  /**
   * init()
   * 讀取 users/{uid}.pokedex 同步到 AppState.pokedex
   * active_series 預設 'pokemon'
   * ⚠️ 必須在 onAuthStateChanged callback 內、AppState.uid 設定後才呼叫
   */
  async init() {
    if (!AppState.uid) {
      console.error('PokedexManager.init：AppState.uid 為 null')
      return
    }

    try {
      const userData = await FirestoreAPI.read(`users/${AppState.uid}`)
      const pokedex  = userData?.pokedex || {}

      // active_series 預設 'pokemon'
      if (!pokedex.active_series) pokedex.active_series = 'pokemon'

      AppState.pokedex = pokedex

      // ── 從 Firestore 的 reveal_queue 恢復記憶體佇列（跨頁面重整後續播）──
      const seriesId = pokedex.active_series
      const queue    = pokedex?.[seriesId]?.reveal_queue || []
      if (queue.length > 0) {
        RevealQueue._queues[seriesId] = [...queue]
      }

      // ── 載入自訂系列（快取）──
      this._customSeriesCache = userData?.custom_series || []
      this._customSeriesCacheUid = AppState.uid

    } catch (e) {
      console.error('PokedexManager.init 失敗:', e)
    }
  },

  // ─────────────────────────────────────────────
  // checkAndReveal — 預判是否達到揭曉門檻
  // ─────────────────────────────────────────────

  /**
   * checkAndReveal(triggerType)
   * client 端預判：未達標 → 直接 return（節省 Firestore 讀取）
   * 達標 → 呼叫 SyncManager.revealPokedex（隨機抽取未收集寶可夢）
   *
   * @param {'sentence'|'star'} triggerType
   */
  async checkAndReveal(triggerType) {
    if (!AppState.uid) return

    // ── 防並發鎖：同一時間只允許一次揭曉 Transaction ──
    if (this._isRevealing) {
      console.log('[PokedexManager] checkAndReveal: 揭曉進行中，跳過重複呼叫')
      return
    }

    const seriesId   = AppState.pokedex?.active_series || 'pokemon'
    const seriesData = AppState.pokedex?.[seriesId]    || {}
    const config     = this.getSeriesConfig(seriesId)

    // ── 取系列總數（隨機抽取需要） ──
    const total = config?.api?.total || 898

    // ── 取門檻值（sentence=15題, star=100顆）──
    const threshold =
      triggerType === 'sentence'
        ? (config?.reveal_by_sentence ?? 15)
        : (config?.reveal_by_star     ?? 100)

    const countKey =
      triggerType === 'sentence' ? 'sentence_count' : 'star_count'
    const current  = seriesData[countKey] || 0

    // ── client 預判未達標 → 直接 return，不呼叫 Firestore ──
    if (current < threshold) return

    // ── 已全部收集 → 不再呼叫 ──
    const collectedCount = (seriesData.collected_ids || []).length
    if (collectedCount >= total) {
      globalThis.UIManager?.showToast?.('🎉 所有寶可夢已全數收集！', 'success', 3000)
      return
    }

    this._isRevealing = true
    try {
      // 傳入 total，讓 SyncManager 在 Transaction 內隨機抽取
      const { result, revealed } = await SyncManager.revealPokedex(
        seriesId,
        triggerType,
        total
      )

      if (result === 'success' && revealed != null) {
        // 更新記憶體端 AppState
        if (!AppState.pokedex[seriesId]) AppState.pokedex[seriesId] = {}

        // next_index 遞增（語意：已解鎖數量）
        const currentNextIdx = seriesData.next_index ?? 0
        AppState.pokedex[seriesId].next_index = currentNextIdx + 1

        // 更新 collected_ids（本機樂觀更新）
        const ids = AppState.pokedex[seriesId].collected_ids || []
        if (!ids.includes(revealed)) {
          AppState.pokedex[seriesId].collected_ids = [...ids, revealed]
        }

        // 更新 collected（本機樂觀更新）
        if (!AppState.pokedex[seriesId].collected) {
          AppState.pokedex[seriesId].collected = {}
        }
        AppState.pokedex[seriesId].collected[String(revealed)] = {
          source: triggerType,
          date:   new Date().toISOString().slice(0, 10),
        }

        // 計數器扣掉門檻（餘數保留）
        const newCount = Math.max(0, current - threshold)
        AppState.pokedex[seriesId][countKey] = newCount

        // 同步寫回 Firestore 計數（扣掉門檻後的餘數）
        try {
          await FirestoreAPI.update(
            `users/${AppState.uid}`,
            { [`pokedex.${seriesId}.${countKey}`]: newCount }
          )
        } catch (e) {
          console.warn('[PokedexManager] 計數餘數寫回 Firestore 失敗:', e)
        }

        // 加入揭曉佇列並顯示 Overlay
        await RevealQueue.add(revealed, seriesId)
        globalThis.UIManager?.showOverlay?.('pokedex_reveal')

      } else if (result === 'all_collected') {
        globalThis.UIManager?.showToast?.('🎉 所有寶可夢已全數收集！', 'success', 3000)
      }

    } catch (e) {
      console.error('PokedexManager.checkAndReveal 失敗:', e)
    } finally {
      this._isRevealing = false
    }
  },

  // ─────────────────────────────────────────────
  // onStarsAdded — 由 stars.js 透過可選鏈呼叫
  // ─────────────────────────────────────────────

  /**
   * onStarsAdded(amount)
   * 更新 Firestore star_count，然後判斷是否揭曉
   *
   * ⚠️ 由 stars.js 透過 globalThis.PokedexManager?.onStarsAdded 呼叫
   *    不可讓 stars.js 靜態 import 本模組（避免循環依賴）
   */
  async onStarsAdded(amount) {
    if (!AppState.uid || !amount) return

    const seriesId = AppState.pokedex?.active_series || 'pokemon'

    try {
      // Firestore star_count increment（只累加，不觸發揭曉）
      // 揭曉由各遊戲模組在答對後呼叫 checkAndReveal('star') 統一觸發
      await FirestoreAPI.incrementField(
        `users/${AppState.uid}`,
        `pokedex.${seriesId}.star_count`,
        amount
      )

      // 樂觀更新 AppState
      if (!AppState.pokedex[seriesId]) AppState.pokedex[seriesId] = {}
      AppState.pokedex[seriesId].star_count =
        (AppState.pokedex[seriesId].star_count || 0) + amount

      // 觸發星星揭曉檢查（_isRevealing 鎖確保不與 sentence 路徑並發）
      await this.checkAndReveal('star')

    } catch (e) {
      console.error('PokedexManager.onStarsAdded 失敗:', e)
    }
  },

  // ─────────────────────────────────────────────
  // 查詢方法
  // ─────────────────────────────────────────────

  /**
   * getCollected(seriesId?) — 取得已收集物件
   * @returns {{ [index: string]: { source: string, date: string } }}
   */
  getCollected(seriesId) {
    const sid  = seriesId || AppState.pokedex?.active_series || 'pokemon'
    return AppState.pokedex?.[sid]?.collected || {}
  },

  /**
   * getNextRevealIndex(seriesId?) — 下一個揭曉編號（已解鎖數量，向後相容）
   */
  getNextRevealIndex(seriesId) {
    const sid = seriesId || AppState.pokedex?.active_series || 'pokemon'
    return AppState.pokedex?.[sid]?.next_index || 1
  },

  /**
   * isCollected(index, seriesId?) — 是否已收集
   */
  isCollected(index, seriesId) {
    const sid      = seriesId || AppState.pokedex?.active_series || 'pokemon'
    const ids      = AppState.pokedex?.[sid]?.collected_ids || []
    return ids.includes(index)
  },

  /**
   * getRevealQueue(seriesId?) — 取得等待播放的揭曉佇列
   */
  getRevealQueue(seriesId) {
    const sid = seriesId || AppState.pokedex?.active_series || 'pokemon'
    return RevealQueue.peek(sid)
  },

  /**
   * consumeRevealQueue(seriesId?) — 取出並清空揭曉佇列
   * 回傳取出的陣列（供 PokedexRevealOverlay 播放用）
   */
  async consumeRevealQueue(seriesId) {
    const sid = seriesId || AppState.pokedex?.active_series || 'pokemon'
    return RevealQueue.consume(sid)
  },

  /**
   * getSeriesConfig(seriesId?) — 從 JSON 取得系列設定
   * 找不到回傳 null，不崩潰
   */
  getSeriesConfig(seriesId) {
    const sid = seriesId || AppState.pokedex?.active_series || 'pokemon'
    try {
      // ① 先查靜態 JSON（pokemon 等內建系列）
      const data    = JSONLoader.get('pokedex_series')
      const series  = Array.isArray(data) ? data : (data?.series || [])
      const found   = series.find(s => s.id === sid)
      if (found) return found

      // ② 查自訂系列快取（家長在 Firestore 建立的系列）
      const custom = this._customSeriesCache || []
      return custom.find(s => s.id === sid) || null
    } catch (_e) {
      return null
    }
  },

  /**
   * loadCustomSeries() — 從 Firestore 載入自訂系列並快取
   * 僅在 uid 變更或強制重載時重新讀取
   */
  async loadCustomSeries(force = false) {
    if (!AppState.uid) return
    if (!force && this._customSeriesCacheUid === AppState.uid && this._customSeriesCache) return
    try {
      const userData = await FirestoreAPI.read(`users/${AppState.uid}`)
      this._customSeriesCache = userData?.custom_series || []
      this._customSeriesCacheUid = AppState.uid
    } catch (e) {
      console.warn('[PokedexManager] loadCustomSeries 失敗', e)
      this._customSeriesCache = []
    }
  },

  /**
   * getAllSeries() — 取得所有系列（內建 + 自訂）
   */
  getAllSeries() {
    const data    = JSONLoader.get('pokedex_series')
    const builtin = Array.isArray(data) ? data : (data?.series || [])
    const custom  = (this._customSeriesCache || []).map(s => ({ ...s, isCustom: true }))
    return [...builtin, ...custom]
  },

  /**
   * saveCustomSeries(seriesList) — 儲存自訂系列到 Firestore
   */
  async saveCustomSeries(seriesList) {
    if (!AppState.uid) return
    await FirestoreAPI.update(`users/${AppState.uid}`, {
      custom_series: seriesList,
    })
    this._customSeriesCache = seriesList
  },

  // ─────────────────────────────────────────────
  // fetchImage — 取得圖片 URL（含記憶體快取）
  // ─────────────────────────────────────────────

  /**
   * fetchImage(index, seriesId?) — 取得圖鑑圖片 URL
   * 同一張圖不重複 fetch（_imageCache Map 快取）
   * 失敗時回傳 null，不拋出
   *
   * @param {number} index
   * @param {string} [seriesId]
   * @returns {Promise<string|null>}
   */
  async fetchImage(index, seriesId) {
    const sid      = seriesId || AppState.pokedex?.active_series || 'pokemon'
    const cacheKey = `${sid}:${index}`

    const config = this.getSeriesConfig(sid)

    // ── pokeapi：fetch + blob URL，完全繞過 raw.githubusercontent.com sandbox CSP ──
    if (config?.source === 'api' && config?.api?.provider === 'pokeapi') {
      // 快取命中（blob URL）
      if (this._imageCache.has(cacheKey)) {
        return this._imageCache.get(cacheKey)
      }

      // 防止同一張圖重複 fetch
      this._imageFetchPromises = this._imageFetchPromises || new Map()
      if (this._imageFetchPromises.has(cacheKey)) {
        return this._imageFetchPromises.get(cacheKey)
      }

      const rawUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${index}.png`

      // 同時非同步取名稱
      if (!this._nameCache.has(cacheKey)) {
        this._fetchPokeNameAsync(index, sid, cacheKey)
      }

      // fetch 圖片轉 blob URL（繞過 sandbox）
      const fetchPromise = fetch(rawUrl)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.blob()
        })
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob)
          this._imageCache.set(cacheKey, blobUrl)
          this._imageFetchPromises.delete(cacheKey)
          // 更新所有已顯示此 index 的 <img>
          document.querySelectorAll(`img[data-pokedex-index="${index}"]`).forEach(img => {
            img.src = blobUrl
          })
          return blobUrl
        })
        .catch(e => {
          console.warn(`[PokedexManager] fetchImage blob 失敗 (${index}):`, e.message)
          this._imageFetchPromises.delete(cacheKey)
          this._imageCache.set(cacheKey, rawUrl)
          return rawUrl
        })

      this._imageFetchPromises.set(cacheKey, fetchPromise)
      return fetchPromise
    }

    // ── 快取命中（非 pokeapi 系列才使用快取）──
    if (this._imageCache.has(cacheKey)) {
      return this._imageCache.get(cacheKey)
    }

    // ── 自訂系列：url_pattern（家長設定的批次 URL 規則）──
    // config.url_pattern 範例："https://example.com/img/{index}.jpg"
    // {index} 會被替換成 1, 2, 3...
    if (config?.source === 'url_pattern' && config?.url_pattern) {
      if (this._imageCache.has(cacheKey)) return this._imageCache.get(cacheKey)
      const url = config.url_pattern.replace('{index}', String(index))
      this._imageCache.set(cacheKey, url)
      return url
    }

    // ── 非 pokeapi：無已知快捷路徑 ──
    if (!config || config.source !== 'api') {
      this._imageCache.set(cacheKey, null)
      return null
    }

    // ── 非 pokeapi：用 API fetch 方式 ──
    try {
      const baseUrl = config.api?.base_url || ''
      const res     = await fetch(`${baseUrl}${index}`)
      if (!res.ok) throw new Error(`API HTTP ${res.status}`)
      const data    = await res.json()
      const imageUrl = this._getNestedField(data, config.api.image_field) || null
      this._imageCache.set(cacheKey, imageUrl)
      return imageUrl
    } catch (e) {
      console.warn(`PokedexManager.fetchImage 失敗 (${sid}:${index}):`, e.message)
      this._imageCache.set(cacheKey, null)
      return null
    }
  },

  // ─────────────────────────────────────────────
  // _fetchPokeNameAsync — 背景非同步取得寶可夢名稱
  // ─────────────────────────────────────────────

  /**
   * 非阻塞方式取得名稱並存入 _nameCache
   * 由 fetchImage 在背景呼叫，不影響圖片顯示速度
   */
  async _fetchPokeNameAsync(index, sid, cacheKey) {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${index}`)
      if (!res.ok) return
      const data = await res.json()
      if (data?.name) {
        const formatted = data.name.charAt(0).toUpperCase() + data.name.slice(1).toLowerCase()
        this._nameCache.set(cacheKey, formatted)
      }
    } catch (_) { /* 名稱取得失敗，靜默忽略 */ }
  },

  // ─────────────────────────────────────────────
  // fetchName — 取得圖鑑項目名稱（含記憶體快取）
  // ─────────────────────────────────────────────

  /**
   * fetchName(index, seriesId?) — 取得圖鑑項目名稱
   * 若 fetchImage 已呼叫過，直接從 _nameCache 取得（不重複 fetch）
   * 若尚未 fetch，先呼叫 fetchImage 讓快取建立
   * 失敗時回傳 null，不拋出
   *
   * @param {number} index
   * @param {string} [seriesId]
   * @returns {Promise<string|null>}
   */
  async fetchName(index, seriesId) {
    const sid      = seriesId || AppState.pokedex?.active_series || 'pokemon'
    const cacheKey = `${sid}:${index}`

    // 名稱快取命中
    if (this._nameCache.has(cacheKey)) {
      return this._nameCache.get(cacheKey)
    }

    // 尚未快取：直接向 PokéAPI 取得名稱
    await this._fetchPokeNameAsync(index, sid, cacheKey)
    return this._nameCache.get(cacheKey) ?? null
  },

  // ─────────────────────────────────────────────
  // 私有工具
  // ─────────────────────────────────────────────

  /**
   * _getNestedField(obj, path)
   * 依點記路徑取得巢狀欄位，如 'sprites.other.official-artwork.front_default'
   */
  _getNestedField(obj, path) {
    if (!obj || !path) return null
    return path.split('.').reduce((cur, key) => cur?.[key] ?? null, obj)
  },
}

// 掛到 globalThis 供 stars.js 可選鏈呼叫
globalThis.PokedexManager = PokedexManager

// ── 開發測試用：Console 直接貼 await globalThis.PokedexManager.debugReveal() ──
globalThis.PokedexManager.debugReveal = async function() {
  const seriesId = globalThis.AppState?.pokedex?.active_series || 'pokemon'
  if (!globalThis.AppState?.pokedex?.[seriesId]) {
    if (!globalThis.AppState.pokedex) globalThis.AppState.pokedex = {}
    globalThis.AppState.pokedex[seriesId] = {}
  }
  // 強制把 star_count 設為門檻值，直接觸發揭曉
  globalThis.AppState.pokedex[seriesId].star_count = 100
  console.log('[debugReveal] star_count 設為 100，呼叫 checkAndReveal...')
  await PokedexManager.checkAndReveal('star')
  const queue = PokedexManager.getRevealQueue(seriesId)
  console.log('[debugReveal] reveal_queue:', queue)
  if (queue && queue.length > 0) {
    globalThis.UIManager?.showOverlay?.('pokedex_reveal')
  } else {
    console.warn('[debugReveal] 佇列為空，可能 SyncManager 尚未回應')
  }
}
