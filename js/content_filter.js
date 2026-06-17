/**
 * content_filter.js — 生字／詞語／成語／句型 啟用與優先 共用工具
 * 快樂學習 Happy Learning v4.3 新增
 *
 * 背景：
 *   家長可在「生字簿管理 / 詞語簿設定 / 成語簿設定 / 句型設定」頁面，
 *   將任一項目設定為：
 *     - enabled = false（暫停）→ 完全不出現在卡片、遊戲、考題中
 *     - priority = true（優先）→ 優先出現在卡片、遊戲、考題中
 *   讓家長可依照孩子學校的學習進度，分批次專心學習目前課程內容。
 *
 * 向下相容：
 *   - 舊資料為純字串（words/idioms 早期格式）或物件缺少 enabled/priority
 *     欄位時，視為 enabled=true（預設啟用）、priority=false（預設一般）。
 *
 * 使用方式：
 *   import {
 *     filterEnabled, sortPriorityFirst, getActiveItems,
 *     toTextArray, getPriorityKeySet,
 *     shuffleArray, partitionByPriority, shuffleWithPriorityFirst,
 *   } from '../content_filter.js'
 */

// ─────────────────────────────────────────
// 基本判斷
// ─────────────────────────────────────────

/** 項目是否啟用（預設 true，向下相容純字串／缺欄位的舊資料） */
export function isItemEnabled(item) {
  if (item && typeof item === 'object') return item.enabled !== false
  return true
}

/** 項目是否為「優先」（預設 false） */
export function isItemPriority(item) {
  if (item && typeof item === 'object') return item.priority === true
  return false
}

/**
 * 從項目取出文字鍵值（字／word／idiom 等）
 * 純字串項目直接回傳；物件項目依 fields 依序嘗試取值
 */
export function getItemText(item, fields = ['字', 'char', 'word', 'idiom']) {
  if (item && typeof item === 'object') {
    for (const f of fields) {
      if (item[f]) return item[f]
    }
    return ''
  }
  return String(item ?? '')
}

// ─────────────────────────────────────────
// 過濾／排序
// ─────────────────────────────────────────

/** 過濾出已啟用的項目（保留原始格式，物件或字串皆可） */
export function filterEnabled(list) {
  return (Array.isArray(list) ? list : []).filter(isItemEnabled)
}

/** 將 priority 項目移到最前面（穩定排序，組內原順序不變） */
export function sortPriorityFirst(list) {
  const arr = Array.isArray(list) ? list : []
  const priorityItems = arr.filter(isItemPriority)
  const normalItems   = arr.filter(item => !isItemPriority(item))
  return [...priorityItems, ...normalItems]
}

/** 啟用 + 優先排序 一次到位（回傳仍為原始項目格式） */
export function getActiveItems(list) {
  return sortPriorityFirst(filterEnabled(list))
}

/** 啟用 + 優先排序後，轉為純文字陣列（供只需要字串清單的遊戲使用） */
export function toTextArray(list, fields) {
  return getActiveItems(list).map(item => getItemText(item, fields))
}

/** 取得已啟用項目中標記為「優先」的文字鍵值 Set（供加權出題使用） */
export function getPriorityKeySet(list, fields) {
  const enabled      = filterEnabled(list)
  const priorityOnly = enabled.filter(isItemPriority)
  return new Set(priorityOnly.map(item => getItemText(item, fields)))
}

// ─────────────────────────────────────────
// 洗牌／加權出題
// ─────────────────────────────────────────

/** Fisher-Yates 洗牌（回傳新陣列，不修改原陣列） */
export function shuffleArray(list) {
  const arr = [...(Array.isArray(list) ? list : [])]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * 將陣列依「是否為優先項目」切成 [優先項目, 一般項目]
 * @param {Array} list
 * @param {Set}   prioritySet  優先鍵值 Set（由 getPriorityKeySet 取得）
 * @param {Function} keyFn     從陣列元素取出要比對 prioritySet 的鍵值，預設直接使用元素本身
 */
export function partitionByPriority(list, prioritySet, keyFn = (x) => x) {
  const arr = Array.isArray(list) ? list : []
  if (!prioritySet || prioritySet.size === 0) return [[], [...arr]]
  const priorityItems = []
  const normalItems   = []
  for (const item of arr) {
    if (prioritySet.has(keyFn(item))) priorityItems.push(item)
    else normalItems.push(item)
  }
  return [priorityItems, normalItems]
}

/**
 * 洗牌但讓「優先」項目（各自洗牌後）排在最前面
 * 用於出題池在隨機洗牌/截斷前，讓優先項目更容易被選中、更早出現
 */
export function shuffleWithPriorityFirst(list, prioritySet, keyFn = (x) => x) {
  const [priorityItems, normalItems] = partitionByPriority(list, prioritySet, keyFn)
  return [...shuffleArray(priorityItems), ...shuffleArray(normalItems)]
}
