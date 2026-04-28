/**
 * page_history.js — 快樂學習 Happy Learning
 * APP 型頁面歷史堆疊管理
 *
 * 職責：
 *   - 模擬原生 App 的頁面導航堆疊（非瀏覽器 history API）
 *   - 支援 push / pop / peek / clear 操作
 *   - 防止連續重複推入相同頁面（page 相同則不推入）
 *   - pop() 至少保留 1 頁，不會清空堆疊
 *
 * entry 格式：
 *   { page: String, params: Object }
 *
 * 使用方式：
 *   import { PageHistory } from './page_history.js'
 *   PageHistory.push({ page: 'card', params: {} })
 *   PageHistory.pop()
 *   PageHistory.peek()
 *   PageHistory.length
 *
 * 注意：
 *   - 此模組無任何外部依賴，可最先載入
 *   - params 使用淺拷貝儲存，避免外部修改影響堆疊內容
 */

// ─────────────────────────────────────────────
// 內部堆疊儲存
// ─────────────────────────────────────────────

/** @type {Array<{page: string, params: object}>} 頁面歷史堆疊 */
const _stack = []

// ─────────────────────────────────────────────
// PageHistory 物件
// ─────────────────────────────────────────────

const PageHistory = {

  /**
   * 取得目前堆疊長度
   * @returns {number}
   */
  get length() {
    return _stack.length
  },

  /**
   * 推入一個新頁面到堆疊頂端
   * 防止連續重複：若頂端頁面的 page 與要推入的 page 相同，則不推入
   *
   * @param {{ page: string, params?: object }} entry - 要推入的頁面記錄
   * @returns {boolean} true = 成功推入；false = 因重複被忽略
   */
  push(entry) {
    if (!entry || typeof entry.page !== 'string' || !entry.page) {
      console.warn('[PageHistory] push() 收到無效的 entry:', entry)
      return false
    }

    // 防止連續重複推入相同頁面
    const top = this.peek()
    if (top && top.page === entry.page) {
      // 相同頁面，不推入（但 params 不同也不推，維持規格）
      return false
    }

    // 淺拷貝 params，避免外部修改影響堆疊
    _stack.push({
      page:   entry.page,
      params: entry.params ? { ...entry.params } : {},
    })

    return true
  },

  /**
   * 取出堆疊頂端的頁面記錄並回傳
   * 至少保留 1 頁：若只剩 1 頁，回傳該頁但不移除
   *
   * @returns {{ page: string, params: object } | null}
   *   - 有記錄 → 回傳該記錄（只剩 1 頁時回傳但不移除）
   *   - 堆疊為空 → 回傳 null
   */
  pop() {
    if (_stack.length === 0) {
      return null
    }

    // 至少保留 1 頁，不可完全清空堆疊
    if (_stack.length === 1) {
      // 回傳唯一的頁面，但不從堆疊移除
      return { ..._stack[0], params: { ..._stack[0].params } }
    }

    // 正常彈出頂端
    const entry = _stack.pop()
    return { ...entry, params: { ...entry.params } }
  },

  /**
   * 查看堆疊頂端的頁面記錄，不移除
   *
   * @returns {{ page: string, params: object } | null}
   *   - 有記錄 → 回傳頂端記錄（淺拷貝）
   *   - 堆疊為空 → 回傳 null
   */
  peek() {
    if (_stack.length === 0) {
      return null
    }
    const top = _stack[_stack.length - 1]
    // 回傳淺拷貝，防止外部修改堆疊內部狀態
    return { ...top, params: { ...top.params } }
  },

  /**
   * 清空整個堆疊
   * 通常在登出或重置 App 狀態時呼叫
   */
  clear() {
    _stack.length = 0
  },

  /**
   * 取得整個堆疊的淺拷貝陣列（供除錯用）
   * @returns {Array<{page: string, params: object}>}
   */
  getAll() {
    return _stack.map(entry => ({ ...entry, params: { ...entry.params } }))
  },
}

// ─────────────────────────────────────────────
// 匯出
// ─────────────────────────────────────────────
export { PageHistory }
