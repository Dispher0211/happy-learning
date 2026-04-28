/**
 * sync.js — SyncManager 多裝置同步管理
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）、firebase.js（db, arrayUnion）
 * 位置：/js/sync.js
 *
 * 修正（Bug fix）：
 *   revealPokedex 的 Transaction 寫入從 txn.set(..., {merge:true}) 改為：
 *   ① 文件不存在 → txn.set(ref, 巢狀物件, {merge:true})  建立文件
 *   ② 文件已存在 → txn.update(ref, 點記法物件)           展開欄位路徑
 *
 *   原因：Firestore SDK 的 txn.set() 不展開點記法 key（如 'pokedex.p.next_index'），
 *   會把它當字面量 key 存入，導致下次 txn.get() 讀到的 data.pokedex 永遠是 undefined，
 *   REVEAL_CONFLICT 衝突檢查永遠通過（第二次呼叫仍回傳 success）。
 *   txn.update() 才支援點記法展開為巢狀欄位更新。
 */

import { AppState }          from './state.js'
import { FirestoreAPI, db, arrayUnion } from './firebase.js'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  arrayUnion as fsArrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'

// ── localStorage key ──
const OFFLINE_QUEUE_KEY = 'offline_queue'

export const SyncManager = {

  // ─────────────────────────────────────────────
  // revealPokedex — 圖鑑揭曉（Transaction 防重複）
  // ─────────────────────────────────────────────

  /**
   * revealPokedex(seriesId, triggerType, expectedNextIndex)
   *
   * Transaction 讀取 users/{uid}.pokedex.{seriesId}.next_index
   *   - next_index !== expectedNextIndex → throw Error('REVEAL_CONFLICT')
   *   - 成功 → update next_index+1, collected_ids, collected, 餘數, reveal_queue
   *
   * @returns {{ result: 'success'|'conflict', revealed: number|null }}
   * @throws {Error} message='REVEAL_CONFLICT' 時向上拋出（呼叫端顯示 toast）
   */
  async revealPokedex(seriesId, triggerType, expectedNextIndex) {
    if (!AppState.uid) {
      console.error('SyncManager.revealPokedex：AppState.uid 為 null')
      return { result: 'conflict', revealed: null }
    }

    const uid     = AppState.uid
    const userRef = doc(db, 'users', uid)

    try {
      let revealedIndex = null

      await runTransaction(db, async (txn) => {
        const snap       = await txn.get(userRef)
        const docExists  = snap.exists()
        const data       = docExists ? snap.data() : {}

        // ── 讀取 next_index（巢狀欄位安全讀取）──
        const currentIdx = data?.pokedex?.[seriesId]?.next_index ?? 1
        const seriesData = data?.pokedex?.[seriesId] ?? {}

        // ── REVEAL_CONFLICT 檢查 ──
        if (currentIdx !== expectedNextIndex) {
          throw new Error('REVEAL_CONFLICT')
        }

        revealedIndex   = currentIdx
        const today     = new Date().toISOString().slice(0, 10)

        // ── 揭曉門檻與餘數計算 ──
        const threshold =
          triggerType === 'sentence'
            ? (seriesData.reveal_by_sentence ?? 10)
            : (seriesData.reveal_by_star     ?? 100)

        const countKey = triggerType === 'sentence' ? 'sentence_count' : 'star_count'
        const newCount = Math.max(0, (seriesData[countKey] ?? 0) - threshold)

        // ─────────────────────────────────────────
        // 修正核心：
        //   txn.set() 不展開點記法 key → 改為 txn.update()
        //   txn.update() 才支援 'pokedex.series.next_index' 展開為巢狀欄位
        //
        //   若文件不存在（首次）→ 先用 txn.set(巢狀物件) 建立，
        //   再用 txn.update(點記法) 是不行的（update 要求文件已存在）。
        //   所以：不存在 → set 巢狀物件；已存在 → update 點記法。
        // ─────────────────────────────────────────

        if (!docExists) {
          // ── 文件不存在：用巢狀物件 set（建立文件）──
          const nestedData = {
            pokedex: {
              [seriesId]: {
                next_index:    currentIdx + 1,
                collected_ids: [currentIdx],
                collected: {
                  [currentIdx]: { source: triggerType, date: today },
                },
                [countKey]:    newCount,
                reveal_queue:  [currentIdx],
              },
            },
            last_updated: serverTimestamp(),
          }
          txn.set(userRef, nestedData, { merge: true })

        } else {
          // ── 文件已存在：用點記法 update（展開欄位路徑）──
          const updateData = {
            [`pokedex.${seriesId}.next_index`]:              currentIdx + 1,
            [`pokedex.${seriesId}.collected_ids`]:           fsArrayUnion(currentIdx),
            [`pokedex.${seriesId}.collected.${currentIdx}`]: {
              source: triggerType,
              date:   today,
            },
            [`pokedex.${seriesId}.${countKey}`]:             newCount,
            [`pokedex.${seriesId}.reveal_queue`]:            fsArrayUnion(currentIdx),
            last_updated: serverTimestamp(),
          }
          txn.update(userRef, updateData)
        }
      })

      return { result: 'success', revealed: revealedIndex }

    } catch (e) {
      if (e.message === 'REVEAL_CONFLICT') {
        // 規格：REVEAL_CONFLICT 必須 throw，不可靜默
        // 呼叫端（PokedexManager.checkAndReveal）捕捉後顯示 toast
        throw e
      }
      console.error('SyncManager.revealPokedex 失敗:', e)
      return { result: 'conflict', revealed: null }
    }
  },

  // ─────────────────────────────────────────────
  // 離線操作管理
  // ─────────────────────────────────────────────

  /**
   * saveOfflineAction(action)
   * 將離線操作存入 localStorage（含唯一 actionId）
   */
  saveOfflineAction(action) {
    try {
      const queue = this._loadQueue()
      const enriched = {
        ...action,
        actionId:  action.actionId  || this._genActionId(),
        timestamp: action.timestamp || Date.now(),
        uid:       AppState.uid,
      }
      queue.push(enriched)
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue))
    } catch (e) {
      console.error('SyncManager.saveOfflineAction 失敗:', e)
    }
  },

  /**
   * syncOfflineQueue()
   * 上線後執行：timestamp 排序 → 逐一冪等執行 → 失敗的保留
   */
  async syncOfflineQueue() {
    if (!AppState.uid) return

    let queue = this._loadQueue()
    if (queue.length === 0) return

    queue.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

    const failed = []
    for (const action of queue) {
      try {
        await this._applyOfflineAction(action)
      } catch (e) {
        console.warn('SyncManager: action 失敗，保留重試:', action.actionId, e.message)
        failed.push(action)
      }
    }

    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failed))
    } catch (e) {
      console.error('SyncManager: 更新 offline_queue 失敗:', e)
    }

    const succeeded = queue.length - failed.length
    if (succeeded > 0 && failed.length === 0) {
      globalThis.UIManager?.showToast?.('✅ 同步完成！', 'success', 2000)
    } else if (failed.length > 0) {
      globalThis.UIManager?.showToast?.(
        `⚠️ ${failed.length} 筆失敗，稍後重試`, 'warning', 3000
      )
    }
  },

  /**
   * _applyOfflineAction(action)
   * 冪等執行單一離線操作
   * applied_actions/{actionId} 已存在 → 跳過
   */
  async _applyOfflineAction(action) {
    const uid = action.uid || AppState.uid
    if (!uid) throw new Error('uid 不存在')

    const { actionId, type } = action
    const appliedRef = doc(db, 'users', uid, 'applied_actions', actionId)
    const userRef    = doc(db, 'users', uid)

    await runTransaction(db, async (txn) => {
      const snap = await txn.get(appliedRef)
      if (snap.exists()) return  // 冪等：已執行過，跳過

      const userSnap  = await txn.get(userRef)
      const docExists = userSnap.exists()

      if (type === 'add_stars') {
        // ── increment 需要文件存在，不存在則先 set ──
        if (docExists) {
          const { increment: fsIncrement } = await import(
            'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
          )
          txn.update(userRef, {
            'stars.yellow_total':       fsIncrement(action.amount),
            'stars.star_pokedex_count': fsIncrement(action.amount),
            last_updated: serverTimestamp(),
          })
        } else {
          txn.set(userRef, {
            stars: {
              yellow_total:       action.amount,
              star_pokedex_count: action.amount,
              blue_total:         0,
              red_total:          0,
            },
            last_updated: serverTimestamp(),
          }, { merge: true })
        }
      }
      // 其他 action type 可依需求擴充

      // 標記已執行
      txn.set(appliedRef, {
        type,
        ts:       serverTimestamp(),
        actionId,
      })
    })
  },

  /**
   * initNetworkListener()
   * 監聽 online/offline 事件，上線時自動同步
   */
  initNetworkListener() {
    window.addEventListener('online', async () => {
      AppState.isOnline = true
      globalThis.UIManager?.showToast?.('網路已連線，同步中...', 'info', 1500)
      await this.syncOfflineQueue()
    })

    window.addEventListener('offline', () => {
      AppState.isOnline = false
      globalThis.UIManager?.showToast?.('目前離線，操作將在上線後同步', 'warning', 3000)
    })

    // 初始化時同步目前網路狀態
    AppState.isOnline = navigator.onLine
    console.log('SyncManager 網路監聽已啟動')
  },

  // ─────────────────────────────────────────────
  // 私有工具
  // ─────────────────────────────────────────────

  _loadQueue() {
    try {
      const raw    = localStorage.getItem(OFFLINE_QUEUE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (_e) {
      return []
    }
  },

  _genActionId() {
    return `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  },
}
