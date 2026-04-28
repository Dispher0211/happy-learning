/**
 * input_guard.js — 快樂學習 Happy Learning
 * 防連點防護（InputGuard）
 *
 * 職責：
 *   - 防止使用者快速重複點擊同一個按鈕觸發多次非同步操作
 *   - 支援兩種模式：
 *       drop  （預設）：執行中的重複呼叫被靜默丟棄
 *       queue         ：執行中的重複呼叫排隊，依序執行
 *   - 透過 AppState.locks 細粒度鎖管理（7 種鎖）
 *   - 自動 disable / enable DOM 元素
 *   - timeout 防卡死（預設 10000ms），到期後自動解鎖
 *   - finally 保證：無論 fn 成功、失敗、timeout，鎖一定被釋放
 *
 * 使用方式：
 *   import { InputGuard } from './input_guard.js'
 *
 *   await InputGuard.guard('submit_answer', async () => {
 *     await gameEngine.submitAnswer(answer)
 *   }, {
 *     lockType:  'submit_answer',  // AppState.locks 中的鎖名稱
 *     disableEl: confirmBtn,       // 執行中 disable 的 DOM 元素
 *     timeout:   10000,            // 防卡死自動解鎖（ms）
 *     mode:      'drop',           // 'drop' 或 'queue'
 *   })
 *
 * 注意：
 *   - lockType 對應 AppState.locks 中定義的 7 種細粒度鎖
 *   - disableEl 為 null 時不崩潰，直接忽略
 *   - timeout=0 不代表立即解鎖，fn 仍會執行完畢
 */

import { AppState } from './state.js'

// ─────────────────────────────────────────────
// 內部狀態
// ─────────────────────────────────────────────

/**
 * 各 key 的執行佇列（queue 模式用）
 * key → Array<{ fn, options, resolve, reject }>
 * @type {Map<string, Array>}
 */
const _queues = new Map()

/**
 * 各 key 目前是否正在執行
 * key → boolean
 * @type {Map<string, boolean>}
 */
const _running = new Map()

// ─────────────────────────────────────────────
// 內部工具函式
// ─────────────────────────────────────────────

/**
 * 設定 AppState.locks 中指定的鎖
 * @param {string|undefined} lockType - 鎖名稱（對應 AppState.locks 的 key）
 * @param {boolean} value - true = 鎖定；false = 解鎖
 */
function _setLock(lockType, value) {
  if (!lockType) return
  if (!(lockType in AppState.locks)) {
    console.warn(`[InputGuard] 未知的 lockType: "${lockType}"，已忽略`)
    return
  }
  AppState.locks[lockType] = value
}

/**
 * 設定 DOM 元素的 disabled 狀態
 * @param {HTMLElement|null|undefined} el - 目標元素
 * @param {boolean} disabled
 */
function _setDisabled(el, disabled) {
  if (!el || typeof el.disabled === 'undefined') return
  el.disabled = disabled
}

/**
 * 執行一個被 guard 保護的非同步函式
 * 包含：鎖定 → 執行 fn → 解鎖（finally 保證）
 *
 * @param {string} key - guard key（通常與 lockType 相同）
 * @param {Function} fn - 要執行的非同步函式
 * @param {object} options - 選項
 * @param {string}  [options.lockType]   - AppState.locks 鎖名稱
 * @param {HTMLElement} [options.disableEl] - 執行中 disable 的元素
 * @param {number}  [options.timeout=10000] - 防卡死 timeout（ms）
 * @param {string}  [options.mode='drop']   - 'drop' | 'queue'
 * @returns {Promise<void>}
 */
async function _execute(key, fn, options) {
  const {
    lockType  = undefined,
    disableEl = null,
    timeout   = 10000,
    mode      = 'drop',
  } = options || {}

  // 標記此 key 正在執行
  _running.set(key, true)

  // 鎖定 AppState.locks
  _setLock(lockType, true)

  // Disable DOM 元素
  _setDisabled(disableEl, true)

  // timeout 計時器（防卡死）
  let timeoutId = null
  let timedOut  = false

  try {
    // 建立 timeout Promise（若 timeout > 0 才啟用）
    const timeoutPromise = timeout > 0
      ? new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true
            reject(new Error(`[InputGuard] "${key}" 執行逾時（${timeout}ms），已自動解鎖`))
          }, timeout)
        })
      : null

    // 執行 fn，同時競賽 timeout
    if (timeoutPromise) {
      await Promise.race([fn(), timeoutPromise])
    } else {
      await fn()
    }

  } catch (e) {
    if (timedOut) {
      // timeout 造成的錯誤：印出警告，不向上拋出（避免未捕捉的 Promise rejection）
      console.warn(e.message)
    } else {
      // fn 本身拋出的錯誤：向上拋出，讓呼叫端處理
      throw e
    }
  } finally {
    // ── finally 保證：無論如何都要解鎖 ──

    // 清除 timeout 計時器
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    // 解鎖 AppState.locks
    _setLock(lockType, false)

    // 恢復 DOM 元素
    _setDisabled(disableEl, false)

    // 標記此 key 執行完畢
    _running.set(key, false)

    // queue 模式：若佇列中還有待執行的項目，取出下一個執行
    if (mode === 'queue') {
      const queue = _queues.get(key)
      if (queue && queue.length > 0) {
        const next = queue.shift()
        // 非同步執行下一個（不 await，讓 finally 先結束）
        Promise.resolve().then(() =>
          _execute(key, next.fn, next.options)
            .then(next.resolve)
            .catch(next.reject)
        )
      }
    }
  }
}

// ─────────────────────────────────────────────
// InputGuard 主物件
// ─────────────────────────────────────────────

const InputGuard = {

  /**
   * 以防連點保護執行非同步函式
   *
   * @param {string} key - 識別此 guard 的唯一 key（建議與 lockType 相同）
   * @param {Function} fn - 要保護的非同步函式（async function）
   * @param {object} [options] - 選項
   * @param {string}      [options.lockType]      - AppState.locks 中的鎖名稱
   * @param {HTMLElement} [options.disableEl]     - 執行中 disable 的 DOM 元素
   * @param {number}      [options.timeout=10000] - 防卡死 timeout（ms），0 = 不設
   * @param {string}      [options.mode='drop']   - 'drop'（丟棄）或 'queue'（排隊）
   * @returns {Promise<void>}
   */
  async guard(key, fn, options = {}) {
    const mode = options.mode || 'drop'

    // ── 判斷此 key 是否正在執行 ──
    const isRunning = _running.get(key) === true

    if (isRunning) {
      if (mode === 'drop') {
        // drop 模式：靜默丟棄，不執行 fn
        return
      } else if (mode === 'queue') {
        // queue 模式：加入排隊，等前者完成後依序執行
        return new Promise((resolve, reject) => {
          if (!_queues.has(key)) {
            _queues.set(key, [])
          }
          _queues.get(key).push({ fn, options, resolve, reject })
        })
      }
    }

    // 尚未執行或前者已完成 → 直接執行
    return _execute(key, fn, options)
  },

  /**
   * 強制釋放指定 key 的鎖（緊急用途，一般不應呼叫）
   * 例如：頁面切換時強制清除所有鎖
   *
   * @param {string} [key] - 指定 key；省略時釋放所有鎖
   */
  forceRelease(key) {
    if (key) {
      _running.set(key, false)
      _queues.set(key, [])
    } else {
      // 釋放所有 key
      _running.clear()
      _queues.clear()
      // 同時重置 AppState.locks 所有鎖
      for (const lockKey of Object.keys(AppState.locks)) {
        AppState.locks[lockKey] = false
      }
    }
  },

  /**
   * 查詢指定 key 是否正在執行（供外部判斷用）
   * @param {string} key
   * @returns {boolean}
   */
  isRunning(key) {
    return _running.get(key) === true
  },
}

// ─────────────────────────────────────────────
// 匯出
// ─────────────────────────────────────────────
export { InputGuard }
