/**
 * wrong_queue.js — WrongQueue 錯題優先池
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）、firebase.js（FirestoreAPI）
 * 位置：/js/wrong_queue.js
 *
 * v4 規格：
 *   - add()：上限20筆，超過時比較 weight，替換最輕者
 *   - dailyDecay()：每日 weight-=1，weight≤0 刪除，同天只執行一次（UTC）
 *
 * 修正（Bug fix）：
 *   1. add() 改用 FirestoreAPI.write（set + merge），確保文件欄位完整寫入
 *   2. getPriorityList() 相容欄位取值（character 欄位 + id fallback）
 *   3. dailyDecay() 更新主文件日期改用 type:'set'（merge），
 *      避免 "No document to update" 錯誤（主文件不存在時仍可寫入）
 *
 * Firestore 路徑：users/{uid}/wrong_queue/{encodeURIComponent(char)}
 * 文件欄位：{ character: string, weight: number, last_added: number }
 */

import { AppState }     from './state.js'
import { FirestoreAPI } from './firebase.js'

// ── 常數 ──
const MAX_QUEUE_SIZE = 20   // 最多20筆
const INITIAL_WEIGHT = 3    // 每次答錯加的初始 weight
const DAILY_DECAY    = 1    // 每日衰減量

export const WrongQueue = {

  /**
   * add(character) — 新增錯題到優先池
   *
   * 規則（v4）：
   *   - 字已存在 → 累加 weight+3
   *   - 未滿20筆 → 直接寫入（weight=3）
   *   - 已滿20筆：
   *     - 新字 weight(3) > 最小 weight → batchWrite 替換（刪最輕者 + 加新字）
   *     - 新字 weight ≤ 最小 weight → 不加入
   */
  async add(character) {
    if (!AppState.uid) {
      console.error('WrongQueue.add：AppState.uid 為 null')
      return
    }

    const uid      = AppState.uid
    const charKey  = encodeURIComponent(character)
    const charPath = `users/${uid}/wrong_queue/${charKey}`

    try {
      // ── 讀取目前整個 wrong_queue 集合 ──
      const allItems = await FirestoreAPI.readCollection(`users/${uid}/wrong_queue`)

      // ── 字已存在 → 累加 weight ──
      const existing = allItems.find(item => item.id === charKey)
      if (existing) {
        // 修正：改用 write（set+merge），確保即使欄位有缺也能完整更新
        await FirestoreAPI.write(charPath, {
          character,
          weight:     (existing.weight || 0) + INITIAL_WEIGHT,
          last_added: Date.now(),
        }, true)
        return
      }

      const currentCount = allItems.length

      if (currentCount >= MAX_QUEUE_SIZE) {
        // ── 已滿20筆：找最輕的字 ──
        const minItem = allItems.reduce(
          (min, item) => ((item.weight ?? 0) < (min.weight ?? 0) ? item : min),
          allItems[0]
        )

        if (INITIAL_WEIGHT <= (minItem.weight ?? 0)) {
          // 新字不夠重，不加入
          console.log(
            `WrongQueue.add: 新字「${character}」weight(${INITIAL_WEIGHT}) ≤ 最小(${minItem.weight})，不替換`
          )
          return
        }

        // ── 替換：刪除最輕者 + 加入新字 ──
        await FirestoreAPI.batchWrite([
          {
            type: 'delete',
            path: `users/${uid}/wrong_queue/${minItem.id}`,
          },
          {
            // 修正：用 'set' 確保新文件一定被建立（不依賴文件預先存在）
            type: 'set',
            path: charPath,
            data: {
              character,
              weight:     INITIAL_WEIGHT,
              last_added: Date.now(),
            },
          },
        ])
        console.log(
          `WrongQueue.add: 替換「${decodeURIComponent(minItem.id)}」→「${character}」`
        )
      } else {
        // ── 未滿20筆：直接寫入 ──
        // 修正：改用 write（set+merge），確保欄位完整
        await FirestoreAPI.write(charPath, {
          character,
          weight:     INITIAL_WEIGHT,
          last_added: Date.now(),
        }, true)
      }
    } catch (e) {
      console.error('WrongQueue.add 失敗:', character, e)
    }
  },

  /**
   * getPriorityList() — 依 weight 降序排列
   *
   * 修正：取 character 欄位，若無則 fallback 到 decodeURIComponent(id)
   * 確保新舊資料都能正確顯示
   *
   * @returns {Promise<Array<{ char: string, weight: number, last_added: number }>>}
   */
  async getPriorityList() {
    if (!AppState.uid) return []

    try {
      const items = await FirestoreAPI.readCollection(
        `users/${AppState.uid}/wrong_queue`
      )
      return items
        .map(item => ({
          // 修正：優先取 character 欄位，否則從 document id 解碼
          char:       item.character || decodeURIComponent(item.id || ''),
          weight:     item.weight    ?? 0,
          last_added: item.last_added ?? 0,
        }))
        .filter(item => item.char)               // 過濾空白 char
        .sort((a, b) => b.weight - a.weight)     // weight 降序
    } catch (e) {
      console.error('WrongQueue.getPriorityList 失敗:', e)
      return []
    }
  },

  /**
   * clear(character) — 清除單一字的錯題記錄
   */
  async clear(character) {
    if (!AppState.uid) return

    const charKey = encodeURIComponent(character)
    const path    = `users/${AppState.uid}/wrong_queue/${charKey}`

    try {
      await FirestoreAPI.delete(path)
    } catch (e) {
      console.error('WrongQueue.clear 失敗:', character, e)
    }
  },

  /**
   * dailyDecay() — 每日 weight 衰減
   *
   * v4 規格：
   *   - 讀取 users/{uid}.wrong_queue_last_decay
   *   - 今日 UTC 日期已執行 → 直接 return
   *   - 否則 batch 更新全部 wrong_queue：weight-=1，weight≤0 刪除
   *   - 寫入 wrong_queue_last_decay = today（UTC）
   *
   * 修正：更新主文件日期改用 type:'set'（merge=true）
   *   原因：若主文件 users/{uid} 不存在（如測試帳號），
   *         updateDoc 會拋出 "No document to update"
   *   修正後：setDoc + merge:true 文件不存在時自動建立，存在時合併
   */
  async dailyDecay() {
    if (!AppState.uid) return

    const uid      = AppState.uid
    const today    = new Date().toISOString().slice(0, 10)  // UTC YYYY-MM-DD
    const userPath = `users/${uid}`

    try {
      // ── 讀取上次執行日期 ──
      const userData  = await FirestoreAPI.read(userPath)
      const lastDecay = userData?.wrong_queue_last_decay

      // ── 今天已執行過 → 跳過 ──
      if (lastDecay === today) {
        console.log(`WrongQueue.dailyDecay: 今日(${today})已執行，跳過`)
        return
      }

      // ── 讀取全部 wrong_queue ──
      const allItems = await FirestoreAPI.readCollection(`${userPath}/wrong_queue`)

      if (allItems.length === 0) {
        // 無資料，只更新日期（修正：用 write 取代 update，支援文件不存在的情況）
        await FirestoreAPI.write(userPath, { wrong_queue_last_decay: today }, true)
        console.log(`WrongQueue.dailyDecay: 無錯題，更新日期 ${today}`)
        return
      }

      // ── 建立 batch 操作清單 ──
      const operations = []

      for (const item of allItems) {
        const newWeight = (item.weight ?? 1) - DAILY_DECAY
        const itemPath  = `${userPath}/wrong_queue/${item.id}`

        if (newWeight <= 0) {
          // 衰減到0 → 刪除
          operations.push({ type: 'delete', path: itemPath })
        } else {
          // 更新新 weight
          operations.push({
            type: 'update',
            path: itemPath,
            data: { weight: newWeight },
          })
        }
      }

      // ── 主文件日期更新：改用 'set' + merge（修正重點）──
      // 原本 type:'update' 在文件不存在時拋出 "No document to update"
      // 改為 type:'set'，FirestoreAPI.batchWrite 會用 batch.set(..., {merge:true})
      operations.push({
        type: 'set',    // ← 修正：原為 'update'，改為 'set'（merge:true）
        path: userPath,
        data: { wrong_queue_last_decay: today },
      })

      // ── 批次執行 ──
      await FirestoreAPI.batchWrite(operations)

      const deleted = operations.filter(op => op.type === 'delete').length
      const updated = operations.filter(op => op.type === 'update').length
      console.log(
        `WrongQueue.dailyDecay 完成 (${today})：更新 ${updated} 筆，刪除 ${deleted} 筆`
      )
    } catch (e) {
      console.error('WrongQueue.dailyDecay 失敗:', e)
    }
  },
}
