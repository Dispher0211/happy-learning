/**
 * stars.js — 星星系統（StarsManager）
 * 快樂學習 Happy Learning — Task 10
 *
 * 功能：
 *   - add(amount)：increment 寫入 Firestore，樂觀更新本地，飛星動畫
 *   - spend(amount)：transaction 防負數
 *   - canAfford(amount)：檢查本地 AppState
 *   - merge(type)：合成動畫，'yellow_to_blue'（300→1）或 'blue_to_red'（100→1）
 *   - getDisplay(stars)：{ yellowFull, yellowHalf, blue, red }
 *   - _flyStarsAnimation(amount)：星星飛向右上角動畫
 *
 * 規則：
 *   - add 用 increment（非覆蓋）
 *   - spend / merge 用 transaction（防負數）
 *   - 半星：yellowHalf = (yellow_total % 1) >= 0.5
 *   - add 同步 star_pokedex_count（圖鑑獨立計數器）
 *   - add 後呼叫 PokedexManager.onStarsAdded（可選鏈）
 *
 * 依賴：
 *   - state.js（Task 02）
 *   - firebase.js（Task 05）
 */

import { AppState } from './state.js'
import { FirestoreAPI } from './firebase.js'

// ─────────────────────────────────────────────────
// 常數定義
// ─────────────────────────────────────────────────

/** 黃星合成藍星所需數量 */
const YELLOW_TO_BLUE_COST = 300

/** 藍星合成紅星所需數量 */
const BLUE_TO_RED_COST = 100

// ─────────────────────────────────────────────────
// 私有工具函數
// ─────────────────────────────────────────────────

/**
 * 取得目前使用者的 Firestore 路徑
 * @returns {string}
 */
function _userPath() {
  return `users/${AppState.uid}`
}

/**
 * 產生唯一動畫 ID（防重複）
 * @returns {string}
 */
function _animId() {
  return `star_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 星星飛向右上角動畫
 * 在頁面上產生若干顆黃星，用 CSS animation 飛到右上角星星顯示區
 *
 * @param {number} amount - 星星數量（小數取 ceil，最多顯示 8 顆）
 */
function _flyStarsAnimation(amount) {
  // 只在有 DOM 的環境執行
  if (typeof document === 'undefined') return

  // 顯示顆數：1~8 顆（避免大量星星塞滿畫面）
  const count = Math.min(Math.ceil(amount), 8)
  if (count <= 0) return

  const container = document.getElementById('app') || document.body

  for (let i = 0; i < count; i++) {
    // 延遲錯開，讓星星不要同時出現
    setTimeout(() => {
      const star = document.createElement('div')
      const id = _animId()
      star.id = id
      star.textContent = '★'
      star.style.cssText = `
        position: fixed;
        font-size: 24px;
        color: #FFD700;
        text-shadow: 0 0 6px #FFA500;
        pointer-events: none;
        z-index: 9999;
        left: ${30 + Math.random() * 40}%;
        top: ${40 + Math.random() * 20}%;
        transition: all 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        opacity: 1;
      `
      document.body.appendChild(star)

      // 觸發飛行動畫（飛向右上角星星顯示區）
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          star.style.left = 'calc(100% - 120px)'
          star.style.top = '8px'
          star.style.opacity = '0'
          star.style.fontSize = '12px'
        })
      })

      // 動畫結束後移除 DOM
      setTimeout(() => {
        star.remove()
      }, 1000)
    }, i * 80) // 每顆星間隔 80ms
  }
}

// ─────────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────────

export const StarsManager = {

  /**
   * 增加黃星
   * 使用 Firestore increment（非覆蓋），確保多裝置同時加星不衝突
   * 同步更新 star_pokedex_count（圖鑑專用計數器，與 yellow_total 獨立）
   *
   * @param {number} amount - 增加數量（支援小數，如 0.5）
   * @returns {Promise<void>}
   */
  async add(amount) {
    // 參數驗證
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      console.error('[StarsManager] add：無效的 amount', amount)
      return
    }

    const uid = AppState.uid
    if (!uid) {
      console.error('[StarsManager] add：AppState.uid 未設定')
      return
    }

    try {
      // ① Firestore increment（原子操作，不覆蓋）
      await FirestoreAPI.incrementField(_userPath(), 'stars.yellow_total', amount)
      await FirestoreAPI.incrementField(_userPath(), 'stars.star_pokedex_count', amount)

      // ② 樂觀更新本地 AppState（不等 Firestore 確認）
      const current = AppState.stars || { yellow_total: 0, blue_total: 0, red_total: 0, star_pokedex_count: 0 }
      AppState.stars = {
        ...current,
        yellow_total:       Math.round((current.yellow_total + amount) * 10) / 10,
        star_pokedex_count: Math.round((current.star_pokedex_count + amount) * 10) / 10,
      }

      // ③ UIManager 更新星星顯示（Proxy 自動觸發）
      // AppState.stars 的 setter 會呼叫 UIManager?.updateStarsDisplay

      // ④ 飛星動畫
      _flyStarsAnimation(amount)

      // ⑤ 檢查合成按鈕狀態
      this._checkMergeButton()

      // ⑥ 通知 PokedexManager（可選鏈，模組尚未載入時不崩潰）
      try {
        const { PokedexManager } = await import('./pokedex.js')
        await PokedexManager?.onStarsAdded?.(amount)
      } catch {
        // PokedexManager 尚未實作，略過
      }

    } catch (err) {
      console.error('[StarsManager] add 失敗', err)
    }
  },

  /**
   * 消耗黃星（用於未來擴充，目前遊戲不消耗）
   * 使用 transaction 防止負數
   *
   * @param {number} amount - 消耗數量
   * @returns {Promise<boolean>} 是否成功（餘額不足回傳 false）
   */
  async spend(amount) {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      console.error('[StarsManager] spend：無效的 amount', amount)
      return false
    }

    const uid = AppState.uid
    if (!uid) return false

    // 先用本地快速檢查（省去不必要的 transaction）
    if (!this.canAfford(amount)) {
      console.warn('[StarsManager] spend：餘額不足', { current: AppState.stars?.yellow_total, need: amount })
      return false
    }

    try {
      let success = false

      await FirestoreAPI.transaction(_userPath(), (current) => {
        const currentTotal = current?.stars?.yellow_total ?? 0
        if (currentTotal < amount) {
          // Transaction 內判定不足，拋出特定錯誤讓外層捕捉
          throw new Error('INSUFFICIENT_STARS')
        }
        success = true
        return {
          ...current,
          stars: {
            ...current.stars,
            yellow_total: Math.round((currentTotal - amount) * 10) / 10,
          },
        }
      })

      if (success) {
        // 更新本地 AppState
        const current = AppState.stars || {}
        AppState.stars = {
          ...current,
          yellow_total: Math.round(((current.yellow_total || 0) - amount) * 10) / 10,
        }
        this._checkMergeButton()
      }

      return success

    } catch (err) {
      if (err.message === 'INSUFFICIENT_STARS') {
        console.warn('[StarsManager] spend：transaction 確認餘額不足')
        return false
      }
      console.error('[StarsManager] spend 失敗', err)
      return false
    }
  },

  /**
   * 快速檢查本地 AppState 餘額是否足夠（不查 Firestore）
   * @param {number} amount
   * @returns {boolean}
   */
  canAfford(amount) {
    const total = AppState.stars?.yellow_total ?? 0
    return total >= amount
  },

  /**
   * 星星合成
   * 'yellow_to_blue'：300 顆黃星 → 1 顆藍星
   * 'blue_to_red'：100 顆藍星 → 1 顆紅星
   * 使用 transaction 防止並發問題
   *
   * @param {'yellow_to_blue'|'blue_to_red'} type
   * @returns {Promise<void>}
   * @throws {Error} 'INSUFFICIENT_STARS' 餘額不足
   */
  async merge(type) {
    const uid = AppState.uid
    if (!uid) return

    // 確認合成類型有效
    if (type !== 'yellow_to_blue' && type !== 'blue_to_red') {
      console.error('[StarsManager] merge：無效的合成類型', type)
      return
    }

    const cost   = type === 'yellow_to_blue' ? YELLOW_TO_BLUE_COST : BLUE_TO_RED_COST
    const fromKey = type === 'yellow_to_blue' ? 'yellow_total' : 'blue_total'
    const toKey   = type === 'yellow_to_blue' ? 'blue_total'   : 'red_total'

    // 本地快速檢查
    const currentFrom = AppState.stars?.[fromKey] ?? 0
    if (currentFrom < cost) {
      throw new Error('INSUFFICIENT_STARS')
    }

    try {
      await FirestoreAPI.transaction(_userPath(), (current) => {
        const fromVal = current?.stars?.[fromKey] ?? 0
        if (fromVal < cost) {
          throw new Error('INSUFFICIENT_STARS')
        }
        return {
          ...current,
          stars: {
            ...current.stars,
            [fromKey]: Math.round((fromVal - cost) * 10) / 10,
            [toKey]:   (current?.stars?.[toKey] ?? 0) + 1,
          },
        }
      })

      // 更新本地 AppState
      const current = AppState.stars || {}
      AppState.stars = {
        ...current,
        [fromKey]: Math.round(((current[fromKey] || 0) - cost) * 10) / 10,
        [toKey]:   (current[toKey] || 0) + 1,
      }

      // 播放合成動畫
      this._playMergeAnimation(type)

      this._checkMergeButton()

    } catch (err) {
      if (err.message === 'INSUFFICIENT_STARS') throw err
      console.error('[StarsManager] merge 失敗', err)
      throw err
    }
  },

  /**
   * 取得星星顯示資料（含半星計算）
   *
   * @param {Object} stars - { yellow_total, blue_total, red_total, star_pokedex_count }
   * @returns {{ yellowFull: number, yellowHalf: boolean, blue: number, red: number }}
   */
  getDisplay(stars) {
    const yellow = stars?.yellow_total ?? 0
    const blue   = stars?.blue_total   ?? 0
    const red    = stars?.red_total    ?? 0

    return {
      yellowFull: Math.floor(yellow),
      yellowHalf: (yellow % 1) >= 0.5,
      blue:       Math.floor(blue),
      red:        Math.floor(red),
    }
  },

  /**
   * 合成動畫（300顆聚集旋轉→💥→1顆新星誕生→飛向右上角）
   * @param {'yellow_to_blue'|'blue_to_red'} type
   * @private
   */
  _playMergeAnimation(type) {
    if (typeof document === 'undefined') return

    const fromEmoji = type === 'yellow_to_blue' ? '★' : '💙'
    const toEmoji   = type === 'yellow_to_blue' ? '💙' : '❤️'
    const fromColor = type === 'yellow_to_blue' ? '#FFD700' : '#4169E1'

    // 建立合成動畫容器（覆蓋整個畫面）
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 10000;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
    `

    // 中央爆炸文字
    const burst = document.createElement('div')
    burst.textContent = '💥'
    burst.style.cssText = `
      font-size: 80px;
      opacity: 0;
      transition: opacity 0.2s, transform 0.4s;
      transform: scale(0.5);
    `
    overlay.appendChild(burst)

    // 新星誕生
    const newStar = document.createElement('div')
    newStar.textContent = toEmoji
    newStar.style.cssText = `
      position: absolute;
      font-size: 48px;
      opacity: 0;
      transition: all 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%) scale(0);
    `
    overlay.appendChild(newStar)

    document.body.appendChild(overlay)

    // 動畫序列
    // t=0：爆炸出現
    requestAnimationFrame(() => {
      burst.style.opacity = '1'
      burst.style.transform = 'scale(1.5)'
    })

    // t=400ms：爆炸消失，新星誕生
    setTimeout(() => {
      burst.style.opacity = '0'
      newStar.style.opacity = '1'
      newStar.style.transform = 'translate(-50%, -50%) scale(1.3)'
    }, 400)

    // t=700ms：新星飛向右上角
    setTimeout(() => {
      newStar.style.left = 'calc(100% - 100px)'
      newStar.style.top = '10px'
      newStar.style.opacity = '0'
      newStar.style.transform = 'translate(-50%, -50%) scale(0.5)'
    }, 700)

    // t=1500ms：清除動畫容器
    setTimeout(() => {
      overlay.remove()
    }, 1500)
  },

  /**
   * 檢查並更新合成按鈕狀態
   * 達 300 顆黃星或 100 顆藍星時，合成按鈕發光
   * @private
   */
  _checkMergeButton() {
    if (typeof document === 'undefined') return

    const yellow = AppState.stars?.yellow_total ?? 0
    const blue   = AppState.stars?.blue_total   ?? 0

    const mergeBtn = document.querySelector('[data-merge-btn]') ||
                     document.getElementById('merge-btn')
    if (!mergeBtn) return

    const canMerge = yellow >= YELLOW_TO_BLUE_COST || blue >= BLUE_TO_RED_COST

    if (canMerge) {
      mergeBtn.classList.add('merge-ready')
      mergeBtn.style.animation = 'pulse 1s infinite'
    } else {
      mergeBtn.classList.remove('merge-ready')
      mergeBtn.style.animation = ''
    }
  },

  /**
   * 從 Firestore 同步最新星星資料到 AppState
   * 頁面初始化時呼叫，確保本地與遠端一致
   * @returns {Promise<void>}
   */
  async syncFromFirestore() {
    const uid = AppState.uid
    if (!uid) return

    try {
      const userData = await FirestoreAPI.read(_userPath())
      if (userData?.stars) {
        AppState.stars = {
          yellow_total:       userData.stars.yellow_total       ?? 0,
          blue_total:         userData.stars.blue_total         ?? 0,
          red_total:          userData.stars.red_total          ?? 0,
          star_pokedex_count: userData.stars.star_pokedex_count ?? 0,
        }
      }
    } catch (err) {
      console.error('[StarsManager] syncFromFirestore 失敗', err)
    }
  },
}
