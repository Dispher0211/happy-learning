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
   * 達標 → 呼叫 SyncManager.revealPokedex（含 Transaction 防重複）
   *
   * @param {'sentence'|'star'} triggerType
   */
  async checkAndReveal(triggerType) {
    if (!AppState.uid) return

    const seriesId   = AppState.pokedex?.active_series || 'pokemon'
    const seriesData = AppState.pokedex?.[seriesId]    || {}
    const config     = this.getSeriesConfig(seriesId)

    // ── 取門檻值 ──
    const threshold =
      triggerType === 'sentence'
        ? (config?.reveal_by_sentence ?? seriesData.reveal_by_sentence ?? 10)
        : (config?.reveal_by_star     ?? seriesData.reveal_by_star     ?? 100)

    const countKey =
      triggerType === 'sentence' ? 'sentence_count' : 'star_count'
    const current  = seriesData[countKey] || 0

    // ── client 預判未達標 → 直接 return，不呼叫 Firestore ──
    if (current < threshold) return

    // ── 達標 → 呼叫 SyncManager.revealPokedex ──
    const expectedNextIndex = seriesData.next_index || 1

    try {
      const { result, revealed } = await SyncManager.revealPokedex(
        seriesId,
        triggerType,
        expectedNextIndex
      )

      if (result === 'success' && revealed != null) {
        // 更新記憶體端 AppState
        if (!AppState.pokedex[seriesId]) AppState.pokedex[seriesId] = {}
        AppState.pokedex[seriesId].next_index = expectedNextIndex + 1

        const newCount = Math.max(0, current - threshold)
        AppState.pokedex[seriesId][countKey] = newCount

        // 加入揭曉佇列
        await RevealQueue.add(revealed, seriesId)
      }

    } catch (e) {
      if (e.message === 'REVEAL_CONFLICT') {
        // 其他裝置先揭曉了，顯示提示
        globalThis.UIManager?.showToast?.('已在其他裝置解鎖', 'info', 2500)
      } else {
        console.error('PokedexManager.checkAndReveal 失敗:', e)
      }
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
      // Firestore star_count increment
      await FirestoreAPI.incrementField(
        `users/${AppState.uid}`,
        `pokedex.${seriesId}.star_count`,
        amount
      )

      // 樂觀更新 AppState
      if (!AppState.pokedex[seriesId]) AppState.pokedex[seriesId] = {}
      AppState.pokedex[seriesId].star_count =
        (AppState.pokedex[seriesId].star_count || 0) + amount

      // 判斷是否達到揭曉門檻
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
   * getNextRevealIndex(seriesId?) — 下一個揭曉編號
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
      const data    = JSONLoader.get('pokedex_series')
      const series  = Array.isArray(data)
        ? data
        : (data?.series || [])
      return series.find(s => s.id === sid) || null
    } catch (_e) {
      return null
    }
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

    // ── 快取命中（含 null 快取，避免重複 fetch 失敗資源）──
    if (this._imageCache.has(cacheKey)) {
      return this._imageCache.get(cacheKey)
    }

    const config = this.getSeriesConfig(sid)

    // ── 目前只支援 pokeapi ──
    if (!config || config.source !== 'api' || config.api?.provider !== 'pokeapi') {
      this._imageCache.set(cacheKey, null)
      return null
    }

    try {
      const baseUrl = config.api.base_url || 'https://pokeapi.co/api/v2/pokemon/'
      const res     = await fetch(`${baseUrl}${index}`)
      if (!res.ok) throw new Error(`PokéAPI HTTP ${res.status}`)

      const data  = await res.json()

      // 依 image_field 路徑取圖片 URL（如 'sprites.other.official-artwork.front_default'）
      const imageUrl = this._getNestedField(data, config.api.image_field)
        || data?.sprites?.front_default
        || null

      this._imageCache.set(cacheKey, imageUrl)
      return imageUrl

    } catch (e) {
      console.warn(`PokedexManager.fetchImage 失敗 (${sid}:${index}):`, e.message)
      // 失敗也快取 null，避免重複嘗試同一個失敗資源
      this._imageCache.set(cacheKey, null)
      return null
    }
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
