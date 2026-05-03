/**
 * forgetting.js — ForgettingCurve 遺忘曲線系統
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）、firebase.js（FirestoreAPI）、wrong_queue.js（WrongQueue）
 * v4 修改：
 *   - seeded shuffle 的日期 seed 改為 new Date().toISOString().slice(0,10)（UTC）
 *   - 確保跨時區一致（台灣 UTC+8 與其他時區用戶同日 seed 相同）
 *
 * 功能：
 *   - recordResult：記錄答題結果，更新 system_level
 *   - getSortedQueue：依遺忘曲線排序題目
 *   - setManualLevel：手動覆蓋難度
 *   - 多音字各讀音獨立計算
 */

import { AppState }    from './state.js'
import { FirestoreAPI } from './firebase.js'

// ── 難度等級順序（數字越大越難）──
const LEVELS   = ['easy_plus', 'easy', 'medium', 'hard']
const LEVEL_IDX = { easy_plus: 0, easy: 1, medium: 2, hard: 3 }

export const ForgettingCurve = {

  /**
   * recordResult(character, isCorrect, pronunciation)
   * 記錄答題結果，用 Transaction 確保原子性
   *
   * @param {string}  character     生字（中文字）
   * @param {boolean} isCorrect     是否答對
   * @param {string|null} pronunciation 多音字的注音（null = 整字）
   */
  async recordResult(character, isCorrect, pronunciation = null) {
    if (!AppState.uid) {
      console.error('ForgettingCurve.recordResult：AppState.uid 為 null')
      return
    }

    // 路徑中文字需 encodeURIComponent
    const charKey  = encodeURIComponent(character)
    const path     = `users/${AppState.uid}/progress/${charKey}`
    const now      = Date.now()

    try {
      await FirestoreAPI.transaction(path, (current) => {
        const data = current || {}

        // ── 初始化預設值 ──
        if (!data.character)       data.character       = character
        if (!data.system_level)    data.system_level    = 'medium'
        if (!data.history)         data.history         = []
        if (!data.consecutive_pass) data.consecutive_pass = 0
        if (!data.consecutive_fail) data.consecutive_fail = 0
        if (data.manual_override === undefined) data.manual_override = false
        if (!data.pronunciations)  data.pronunciations  = {}

        // ── 更新歷史記錄（最多保留10筆，FIFO）──
        const historyEntry = { result: isCorrect ? 1 : 0, time: now }
        data.history = [...data.history, historyEntry].slice(-10)

        // ── 更新連續計數 ──
        if (isCorrect) {
          data.consecutive_pass++
          data.consecutive_fail = 0
        } else {
          data.consecutive_fail++
          data.consecutive_pass = 0
        }

        // ── 更新 system_level ──
        const currentIdx = LEVEL_IDX[data.system_level] ?? 2
        if (isCorrect && data.consecutive_pass >= 3) {
          // 連續答對3次 → 降一級（更容易）
          data.system_level    = LEVELS[Math.max(0, currentIdx - 1)]
          data.consecutive_pass = 0
        } else if (!isCorrect && data.consecutive_fail >= 2) {
          // 連續答錯2次 → 升一級（更難）
          data.system_level    = LEVELS[Math.min(3, currentIdx + 1)]
          data.consecutive_fail = 0
        }

        // ── 手動覆蓋後連錯3次自動恢復 ──
        if (data.manual_override && !isCorrect) {
          data.consecutive_fail_after_manual = (data.consecutive_fail_after_manual || 0) + 1
          if (data.consecutive_fail_after_manual >= 3) {
            data.manual_override                = false
            data.manual_level                   = null
            data.consecutive_fail_after_manual  = 0
            console.log(`ForgettingCurve: 手動覆蓋已自動恢復（${character}）`)
          }
        } else if (data.manual_override && isCorrect) {
          data.consecutive_fail_after_manual = 0
        }

        // ── 更新失敗率（近期加權）──
        data.fail_rate = this._weightedFailRate(data.history)

        // ── 多音字：獨立計算各讀音 ──
        if (pronunciation) {
          const pron = data.pronunciations[pronunciation] || {
            fail_rate: 0, level: 'medium',
            consecutive_pass: 0, consecutive_fail: 0, history: [],
          }
          const pronEntry = { result: isCorrect ? 1 : 0, time: now }
          pron.history = [...(pron.history || []), pronEntry].slice(-10)

          if (isCorrect) {
            pron.consecutive_pass = (pron.consecutive_pass || 0) + 1
            pron.consecutive_fail = 0
          } else {
            pron.consecutive_fail = (pron.consecutive_fail || 0) + 1
            pron.consecutive_pass = 0
          }

          const pronLvlIdx = LEVEL_IDX[pron.level] ?? 2
          if (isCorrect && pron.consecutive_pass >= 3) {
            pron.level = LEVELS[Math.max(0, pronLvlIdx - 1)]
            pron.consecutive_pass = 0
          } else if (!isCorrect && pron.consecutive_fail >= 2) {
            pron.level = LEVELS[Math.min(3, pronLvlIdx + 1)]
            pron.consecutive_fail = 0
          }

          pron.fail_rate = this._weightedFailRate(pron.history)
          data.pronunciations[pronunciation] = pron
        }

        data.version = (data.version || 0) + 1
        return data
      })
    } catch (e) {
      console.error('ForgettingCurve.recordResult 失敗:', character, e)
    }
  },

  /**
   * getSortedQueue(characters, count)
   * 依遺忘曲線排序字列，整合 WrongQueue 優先插隊
   *
   * v4：seed = AppState.uid + new Date().toISOString().slice(0,10)（UTC）
   *
   * @param {string[]} characters  所有候選生字
   * @param {number}   count       需要幾題
   * @returns {Promise<string[]>}  排序後的字陣列
   */
  async getSortedQueue(characters, count) {
    if (!AppState.uid || !characters.length) return []

    try {
      // ── 批次讀取 progress（避免 N+1）──
      const progressMap = await FirestoreAPI.readProgressAll(AppState.uid)

      // ── 取 WrongQueue 優先字 ──
      let wrongPriorityChars = []
      try {
        const { WrongQueue } = await import('./wrong_queue.js')
        const wrongList = await WrongQueue.getPriorityList()
        // 只取在 characters 清單內的字
        wrongPriorityChars = wrongList
          .map(e => e.char)
          .filter(c => characters.includes(c))
      } catch (_e) {
        // WrongQueue 存根或尚未初始化，略過
      }

      // ── 為每個字建立排序資訊 ──
      const charInfos = characters.map(char => {
        const key  = encodeURIComponent(char)
        const prog = progressMap.get(key)
        return {
          char,
          level:     prog?.system_level    ?? 'medium',
          fail_rate: prog?.fail_rate        ?? 0,
          untried:   !prog,                             // 未挑戰過優先
          inWrong:   wrongPriorityChars.includes(char), // 錯題優先
        }
      })

      // ── 建立頻率佇列（加權複製：hard=4份, medium=2份, easy=1份, easy_plus=1份）──
      const WEIGHT_MAP = { hard: 4, medium: 2, easy: 1, easy_plus: 1 }
      const pool = []
      for (const info of charInfos) {
        const weight = WEIGHT_MAP[info.level] || 2
        for (let i = 0; i < weight; i++) pool.push(info)
      }

      // ── 套用 maxHardRatio=0.4（hard 比例上限）──
      const hardItems   = pool.filter(i => i.level === 'hard')
      const otherItems  = pool.filter(i => i.level !== 'hard')
      const maxHard     = Math.floor(count * 0.4)
      const limitedPool = [
        ...hardItems.slice(0, maxHard),
        ...otherItems,
      ]

      // ── seeded shuffle（v4：seed 使用 UTC 日期）──
      // 同天同用戶 → 順序固定；不同天 → 不同順序
      const utcDate = new Date().toISOString().slice(0, 10)  // 如 '2026-04-12'
      const seedStr = AppState.uid + utcDate
      const shuffled = this._seededShuffle(limitedPool, seedStr)

      // ── 去重（同一字只取第一次）──
      const seen    = new Set()
      const deduped = []
      for (const info of shuffled) {
        if (!seen.has(info.char)) {
          seen.add(info.char)
          deduped.push(info)
        }
      }

      // ── WrongQueue 的字移到最前面 ──
      const wrongFirst  = deduped.filter(i => i.inWrong)
      const wrongOthers = deduped.filter(i => !i.inWrong)

      // ── 未挑戰過的字（untried）次優先 ──
      const untriedOthers = wrongOthers.filter(i => i.untried)
      const triedOthers   = wrongOthers.filter(i => !i.untried)
      const finalOrder    = [...wrongFirst, ...untriedOthers, ...triedOthers]

      return finalOrder.slice(0, count).map(i => i.char)
    } catch (e) {
      console.error('ForgettingCurve.getSortedQueue 失敗:', e)
      // 降級：直接回傳打亂的原始清單
      return characters.slice(0, count)
    }
  },

  /**
   * getLevel(character, pronunciation)
   * 取得字的有效等級（考慮手動覆蓋）
   */
  async getLevel(character, pronunciation = null) {
    if (!AppState.uid) return 'medium'
    const charKey = encodeURIComponent(character)
    const path    = `users/${AppState.uid}/progress/${charKey}`

    try {
      const data = await FirestoreAPI.read(path)
      if (!data) return 'medium'

      // 手動覆蓋優先
      if (data.manual_override && data.manual_level) {
        return data.manual_level
      }

      // 多音字讀音等級
      if (pronunciation && data.pronunciations?.[pronunciation]?.level) {
        return data.pronunciations[pronunciation].level
      }

      return data.system_level || 'medium'
    } catch (e) {
      return 'medium'
    }
  },

  /**
   * setManualLevel(character, level)
   * 手動覆蓋難度等級
   * 與 system_level 差距 ≥ 2 級時加警示
   */
  async setManualLevel(character, level) {
    if (!LEVELS.includes(level)) {
      console.error('ForgettingCurve.setManualLevel：無效等級', level)
      return
    }

    const charKey = encodeURIComponent(character)
    const path    = `users/${AppState.uid}/progress/${charKey}`

    try {
      const current = await FirestoreAPI.read(path) || {}
      const sysIdx  = LEVEL_IDX[current.system_level ?? 'medium']
      const manIdx  = LEVEL_IDX[level]
      const gap     = Math.abs(sysIdx - manIdx)

      await FirestoreAPI.write(path, {
        manual_override:                true,
        manual_level:                   level,
        show_gap_warning:               gap >= 2,
        consecutive_fail_after_manual:  0,
      })
    } catch (e) {
      console.error('ForgettingCurve.setManualLevel 失敗:', character, e)
    }
  },

  /**
   * clearManualOverride(character)
   * 清除手動覆蓋，恢復系統判定
   */
  async clearManualOverride(character) {
    const charKey = encodeURIComponent(character)
    const path    = `users/${AppState.uid}/progress/${charKey}`
    try {
      await FirestoreAPI.write(path, {
        manual_override:               false,
        manual_level:                  null,
        show_gap_warning:              false,
        consecutive_fail_after_manual: 0,
      })
    } catch (e) {
      console.error('ForgettingCurve.clearManualOverride 失敗:', character, e)
    }
  },

  // ════════════════════════════════════════════
  // 私有方法
  // ════════════════════════════════════════════

  /**
   * _weightedFailRate(history)
   * 近期加權失敗率
   * weights = [1,1,2,2,3,3,4,4,5,5]（最舊→最新）
   * fail_rate = sum(weight * fail) / sum(weight)
   */
  _weightedFailRate(history) {
    if (!history || history.length === 0) return 0

    const weights = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    // 只取最後10筆
    const recent  = history.slice(-10)
    // 對齊 weights 尾部
    const offset  = weights.length - recent.length

    let sumW    = 0
    let sumFail = 0

    recent.forEach((entry, i) => {
      const w = weights[offset + i] ?? 1
      sumW    += w
      sumFail += w * (entry.result === 0 ? 1 : 0)
    })

    return sumW > 0 ? Math.round((sumFail / sumW) * 100) / 100 : 0
  },

  /**
   * _seededShuffle(array, seedStr)
   * 確定性洗牌（mulberry32 PRNG）
   * 相同 seed → 相同順序；不同 seed → 不同順序
   *
   * v4：seedStr = uid + UTC日期（YYYY-MM-DD）
   */
  _seededShuffle(array, seedStr) {
    const arr = [...array]
    let s = this._hashSeed(seedStr)

    // mulberry32 PRNG
    const rand = () => {
      s |= 0
      s  = s + 0x6D2B79F5 | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    // Fisher-Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }

    return arr
  },

  /**
   * _hashSeed(str)
   * 將字串 seed 轉換為 32-bit integer
   */
  _hashSeed(str) {
    let h = 0
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0
    }
    return h
  },
}
