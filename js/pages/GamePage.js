/**
 * GamePage.js — 遊戲頁面容器
 * Task 35：根據 gameId 動態初始化對應遊戲實例，管理遊戲生命週期
 *
 * 依賴模組：
 *   state.js（T02）、ui_manager.js（T28）、所有遊戲模組（T16-T27）
 *
 * 功能：
 *   init(params)：params.gameId、params.config
 *   初始化對應遊戲實例，render 到 #app
 *   遊戲完成回調：navigate 回上一頁，顯示結算 Toast
 *   destroy()：呼叫遊戲的 destroy()，釋放所有資源
 */

import { AppState } from '../state.js'
import { UIManager } from '../ui/ui_manager.js'
import { PAGES } from '../ui/pages.js'

// ──────────────────────────────────────────────
// 遊戲模組對應表（gameId → 模組路徑 + 類別名稱）
// ──────────────────────────────────────────────
const GAME_MODULE_MAP = {
  writing:      { path: '../games/writing.js',       className: 'WritingGame'      },
  stroke:       { path: '../games/stroke.js',        className: 'StrokeGame'       },
  zhuyin:       { path: '../games/zhuyin.js',        className: 'ZhuyinGame'       },
  polyphone:    { path: '../games/polyphone.js',     className: 'PolyphoneGame'    },
  radical:      { path: '../games/radical.js',       className: 'RadicalGame'      },
  strokes_count:{ path: '../games/strokes_count.js', className: 'StrokesCountGame' },
  typo:         { path: '../games/typo.js',          className: 'TypoGame'         },
  idiom:        { path: '../games/idiom.js',         className: 'IdiomGame'        },
  words:        { path: '../games/words.js',         className: 'WordsGame'        },
  listen:       { path: '../games/listen.js',        className: 'ListenGame'       },
  sentence:     { path: '../games/sentence.js',      className: 'SentenceGame'     },
  random:       { path: '../games/random.js',        className: 'RandomGame'       },
}

export class GamePage {
  constructor () {
    // 目前執行中的遊戲實例
    this._gameInstance = null
    // 遊戲參數
    this._gameId = null
    this._config = null
    // 記錄本次遊戲獲得的星星數（由 onGameComplete 回調設定）
    this._earnedStars = 0
    // 防止重複 destroy
    this._destroyed = false
  }

  /**
   * init(params)
   * 初始化遊戲頁面：
   *   1. 從 params 取得 gameId / config
   *   2. 動態 import 對應遊戲模組
   *   3. 建立遊戲實例，傳入 onComplete 回調
   *   4. 呼叫 game.init()，render 到 #app
   */
  async init (params = {}) {
    this._destroyed = false
    this._gameId = params.gameId || 'random'
    this._config = params.config || null

    const moduleInfo = GAME_MODULE_MAP[this._gameId]

    // 若 gameId 不在對應表中，顯示錯誤提示並返回
    if (!moduleInfo) {
      console.error(`[GamePage] 未知的 gameId：${this._gameId}`)
      UIManager.showToast(`找不到遊戲：${this._gameId}`, 'error', 3000)
      UIManager.back()
      return
    }

    try {
      // 動態 import 遊戲模組（懶加載，減少首次啟動負擔）
      const module = await import(moduleInfo.path)
      const GameClass = module[moduleInfo.className]

      if (typeof GameClass !== 'function') {
        throw new Error(`模組 ${moduleInfo.path} 未匯出 ${moduleInfo.className}`)
      }

      // 建立遊戲實例，注入 onComplete 回調
      this._gameInstance = new GameClass({
        config: this._config,
        onComplete: (result) => this._onGameComplete(result),
      })

      // 呼叫遊戲的 init()，遊戲自行 render 到 #app
      await this._gameInstance.init()

    } catch (err) {
      console.error(`[GamePage] 遊戲初始化失敗（${this._gameId}）：`, err)
      UIManager.showToast('遊戲載入失敗，請重試', 'error', 3000)
      UIManager.back()
    }
  }

  /**
   * _onGameComplete(result)
   * 遊戲正常完成後的回調：
   *   - result.starsEarned：本局獲得星星數
   *   - 顯示「太棒了！獲得 ★N」Toast
   *   - navigate 回上一頁
   */
  _onGameComplete (result = {}) {
    if (this._destroyed) return

    const stars = result.starsEarned ?? 0
    this._earnedStars = stars

    // 顯示結算 Toast（規格：「太棒了！獲得 ★N」）
    const starsDisplay = _formatStars(stars)
    UIManager.showToast(`太棒了！獲得 ${starsDisplay}`, 'success', 3000)

    // navigate 回上一頁（使用 back() 保持歷史）
    UIManager.back()
  }

  /**
   * destroy()
   * 頁面離開時釋放資源：
   *   - 呼叫遊戲實例的 destroy()
   *   - 清除參考，避免記憶體洩漏
   *
   * 規格（Task 35 驗收標準）：
   *   destroy() → 遊戲的 destroy() 也被呼叫（資源釋放）
   *
   * 規格（Section 3.10 遊戲中斷規則 v4）：
   *   遊戲未完成中途離開 → GameEngine.destroy() 會呼叫 _handleInterrupt()
   *   → wrongPool 加入 WrongQueue，不結算星星
   */
  destroy () {
    if (this._destroyed) return
    this._destroyed = true

    if (this._gameInstance) {
      try {
        // 呼叫遊戲的 destroy()，觸發 GameEngine._handleInterrupt()（若未完成）
        this._gameInstance.destroy()
      } catch (err) {
        console.error('[GamePage] 遊戲 destroy() 發生錯誤：', err)
      }
      this._gameInstance = null
    }
  }
}

// ──────────────────────────────────────────────
// 輔助函式：格式化星星顯示（如「★4」「★2.5」）
// ──────────────────────────────────────────────
function _formatStars (value) {
  if (value === 0) return '★0'
  // 整數直接顯示
  if (value % 1 === 0) return `★${value}`
  // 有小數位時顯示一位小數
  return `★${value.toFixed(1)}`
}
