/**
 * StarMergeOverlay.js — 星星合成面板
 * Task 39 / 放置路徑：js/overlays/StarMergeOverlay.js
 *
 * 依賴：
 *   stars.js      (T10) → StarsManager
 *   input_guard.js (T04) → InputGuard
 *
 * render 目標：#overlay-root
 *
 * 功能（規格 UI SECTION 2.15 + 流程 SECTION 7.7）：
 *   show()  → 顯示合成面板，讀取目前星星數
 *   merge() → InputGuard 防連點 + StarsManager.merge('yellow_to_blue')
 *             合成後播放動畫，更新數字，star_pokedex_count 不變
 *   hide()  → 清空 #overlay-root
 *
 * 驗收標準：
 *   yellow_total < 300  → 按鈕 disable，顯示進度條
 *   yellow_total ≥ 300  → 按鈕發光，可點擊
 *   合成後 → 300顆聚集旋轉→💥→1顆藍★，數字更新，star_pokedex_count 不受影響
 */

import { StarsManager } from '../stars.js'
import { InputGuard }   from '../input_guard.js'
import { AppState }     from '../state.js'

// ─── CSS 注入（僅注入一次）───────────────────────────────────────────────────
const _CSS_ID = 'star-merge-overlay-style'
if (!document.getElementById(_CSS_ID)) {
  const style = document.createElement('style')
  style.id = _CSS_ID
  style.textContent = `
    /* 背景遮罩 */
    .smo-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 900;
      animation: smo-fade-in 0.2s ease;
    }
    @keyframes smo-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* 面板主體 */
    .smo-panel {
      background: linear-gradient(145deg, #1a1a2e, #16213e);
      border: 2px solid #ffd700;
      border-radius: 20px;
      padding: 28px 24px 24px;
      width: min(340px, 90vw);
      color: #fff;
      position: relative;
      box-shadow: 0 0 40px rgba(255, 215, 0, 0.25);
    }

    /* 關閉按鈕 */
    .smo-close {
      position: absolute;
      top: 12px;
      right: 14px;
      background: none;
      border: none;
      color: #aaa;
      font-size: 22px;
      cursor: pointer;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 50%;
      transition: color 0.2s, background 0.2s;
    }
    .smo-close:hover { color: #fff; background: rgba(255,255,255,0.1); }

    /* 標題 */
    .smo-title {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      margin-bottom: 20px;
      letter-spacing: 2px;
    }

    /* 星星顯示區 */
    .smo-stars-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 10px;
      font-size: 15px;
    }
    .smo-star-icon {
      font-size: 30px;
      transition: transform 0.3s;
    }
    .smo-star-count {
      font-size: 32px;
      font-weight: bold;
      color: #ffd700;
      min-width: 60px;
      text-align: center;
      transition: all 0.3s;
    }
    .smo-arrow {
      font-size: 22px;
      color: #aaa;
    }
    .smo-blue-count {
      font-size: 32px;
      font-weight: bold;
      color: #5bc8f5;
      min-width: 40px;
      text-align: center;
      transition: all 0.3s;
    }

    /* 進度條區域 */
    .smo-progress-wrap {
      margin: 8px 0 16px;
    }
    .smo-progress-label {
      font-size: 13px;
      color: #ccc;
      margin-bottom: 5px;
      text-align: center;
    }
    .smo-progress-bar-bg {
      background: rgba(255,255,255,0.12);
      border-radius: 20px;
      height: 12px;
      overflow: hidden;
    }
    .smo-progress-bar-fill {
      height: 100%;
      border-radius: 20px;
      background: linear-gradient(90deg, #ffc107, #ffd700);
      transition: width 0.5s ease;
    }

    /* 合成說明文字 */
    .smo-formula {
      text-align: center;
      font-size: 14px;
      color: #bbb;
      margin-bottom: 18px;
    }
    .smo-formula span { color: #ffd700; font-weight: bold; }

    /* 合成按鈕：不可用 */
    .smo-btn-merge {
      width: 100%;
      padding: 14px;
      border-radius: 14px;
      border: none;
      font-size: 17px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.3s;
      letter-spacing: 1px;
    }
    .smo-btn-merge.disabled {
      background: #333;
      color: #666;
      cursor: not-allowed;
    }
    /* 合成按鈕：可用（發光效果） */
    .smo-btn-merge.ready {
      background: linear-gradient(135deg, #f7b733, #fc4a1a);
      color: #fff;
      box-shadow:
        0 0 12px rgba(247, 183, 51, 0.6),
        0 0 30px rgba(247, 183, 51, 0.3);
      animation: smo-btn-glow 1.5s ease-in-out infinite alternate;
    }
    @keyframes smo-btn-glow {
      from { box-shadow: 0 0 12px rgba(247,183,51,0.5), 0 0 20px rgba(247,183,51,0.2); }
      to   { box-shadow: 0 0 20px rgba(247,183,51,0.9), 0 0 40px rgba(247,183,51,0.5); }
    }

    /* 合成動畫覆蓋層 */
    .smo-anim-layer {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 18px;
      background: rgba(10, 10, 30, 0.85);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s;
      z-index: 10;
    }
    .smo-anim-layer.visible { opacity: 1; pointer-events: auto; }
    .smo-anim-stars {
      font-size: 36px;
      animation: smo-spin 0.8s linear infinite;
    }
    @keyframes smo-spin {
      from { transform: rotate(0deg) scale(1); }
      to   { transform: rotate(360deg) scale(1.3); }
    }
    .smo-anim-text {
      font-size: 18px;
      color: #ffd700;
      margin-top: 12px;
      font-weight: bold;
      text-align: center;
    }
    .smo-anim-result {
      font-size: 52px;
      margin-top: 10px;
      animation: smo-pop 0.5s cubic-bezier(0.17,0.89,0.32,1.49) forwards;
    }
    @keyframes smo-pop {
      0%   { transform: scale(0); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
  `
  document.head.appendChild(style)
}

// ─── StarMergeOverlay 單例 ────────────────────────────────────────────────────
export const StarMergeOverlay = {
  /** @type {HTMLElement|null} 面板根元素 */
  _el: null,

  /** @type {HTMLElement|null} overlay-root 的參考 */
  _root: null,

  // ── 公開 API ────────────────────────────────────────────────────────────────

  /**
   * show() — 顯示合成面板
   *   讀取 AppState.stars，渲染面板與進度條
   */
  show () {
    this._root = document.getElementById('overlay-root')
    if (!this._root) {
      console.error('StarMergeOverlay: #overlay-root 不存在')
      return
    }

    // 清除舊內容
    this._root.innerHTML = ''

    // 建立 DOM
    this._el = this._buildPanel()
    this._root.appendChild(this._el)

    // 更新顯示
    this._refresh()
  },

  /**
   * merge() — 執行合成
   *   InputGuard 防連點 + StarsManager.merge('yellow_to_blue')
   *   合成後播放動畫，再更新數字
   */
  async merge () {
    const stars = AppState.stars || {}
    const yellow = stars.yellow_total || 0

    // 不足 300 顆：不動作
    if (yellow < 300) return

    await InputGuard.guard('star_merge', async () => {
      // 播放合成動畫
      const animLayer = this._el?.querySelector('.smo-anim-layer')
      if (animLayer) {
        animLayer.classList.add('visible')
        const resultEl = animLayer.querySelector('.smo-anim-result')
        if (resultEl) {
          // 先顯示旋轉，再爆炸出藍星
          await this._delay(900)
          resultEl.style.display = 'block'
        }
      }

      // 呼叫 StarsManager 執行 transaction
      // yellow_total -= 300, blue_total += 1, star_pokedex_count 不受影響
      await StarsManager.merge('yellow_to_blue')

      // 等動畫再久一點
      await this._delay(600)

      // 隱藏動畫層，更新顯示數字
      if (animLayer) animLayer.classList.remove('visible')
      this._refresh()
    })
  },

  /**
   * hide() — 清空 overlay-root
   */
  hide () {
    if (this._root) {
      this._root.innerHTML = ''
    }
    this._el = null
  },

  // ── 私有方法 ─────────────────────────────────────────────────────────────────

  /**
   * _buildPanel() — 建立面板 HTML
   * @returns {HTMLElement}
   */
  _buildPanel () {
    const backdrop = document.createElement('div')
    backdrop.className = 'smo-backdrop'

    backdrop.innerHTML = `
      <div class="smo-panel" role="dialog" aria-modal="true" aria-label="星星合成">

        <!-- 關閉按鈕 -->
        <button class="smo-close" aria-label="關閉">✕</button>

        <!-- 標題 -->
        <div class="smo-title">⭐ 星星合成 ⭐</div>

        <!-- 星星數量顯示 -->
        <div class="smo-stars-row">
          <span class="smo-star-icon">⭐</span>
          <span class="smo-star-count" id="smo-yellow">0</span>
          <span class="smo-arrow">→</span>
          <span class="smo-star-icon">💙</span>
          <span class="smo-blue-count" id="smo-blue">0</span>
        </div>

        <!-- 進度條 -->
        <div class="smo-progress-wrap">
          <div class="smo-progress-label" id="smo-progress-label">收集中...</div>
          <div class="smo-progress-bar-bg">
            <div class="smo-progress-bar-fill" id="smo-progress-fill" style="width:0%"></div>
          </div>
        </div>

        <!-- 合成公式說明 -->
        <div class="smo-formula">
          <span>300</span> 顆黃★ → <span>1</span> 顆藍★
        </div>

        <!-- 合成按鈕 -->
        <button class="smo-btn-merge disabled" id="smo-btn-merge" disabled>
          收集 300 顆才能合成
        </button>

        <!-- 合成動畫層（絕對定位覆蓋面板） -->
        <div class="smo-anim-layer" aria-hidden="true">
          <div class="smo-anim-stars">⭐⭐⭐</div>
          <div class="smo-anim-text">合成中...</div>
          <div class="smo-anim-result" style="display:none">💙</div>
        </div>

      </div>
    `

    // 點背景關閉
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.hide()
    })

    // 關閉按鈕
    backdrop.querySelector('.smo-close').addEventListener('click', () => {
      this.hide()
    })

    // 合成按鈕
    backdrop.querySelector('#smo-btn-merge').addEventListener('click', () => {
      this.merge()
    })

    return backdrop
  },

  /**
   * _refresh() — 讀取最新星星數，更新面板顯示
   */
  _refresh () {
    if (!this._el) return

    const stars  = AppState.stars || {}
    const yellow = Math.floor(stars.yellow_total || 0)  // 顯示整數部分
    const blue   = stars.blue_total || 0
    const pct    = Math.min((yellow / 300) * 100, 100)
    const ready  = yellow >= 300

    // 數字
    const yellowEl = this._el.querySelector('#smo-yellow')
    const blueEl   = this._el.querySelector('#smo-blue')
    if (yellowEl) yellowEl.textContent = yellow
    if (blueEl)   blueEl.textContent   = blue

    // 進度條
    const fillEl  = this._el.querySelector('#smo-progress-fill')
    const labelEl = this._el.querySelector('#smo-progress-label')
    if (fillEl)  fillEl.style.width = `${pct.toFixed(1)}%`
    if (labelEl) {
      labelEl.textContent = ready
        ? `已達 300 顆，可以合成！`
        : `${yellow} / 300 顆（還差 ${300 - yellow} 顆）`
    }

    // 合成按鈕狀態
    const btn = this._el.querySelector('#smo-btn-merge')
    if (btn) {
      if (ready) {
        btn.disabled = false
        btn.className = 'smo-btn-merge ready'
        btn.textContent = '✨ 立刻合成！300⭐ → 1💙'
      } else {
        btn.disabled = true
        btn.className = 'smo-btn-merge disabled'
        btn.textContent = `收集 300 顆才能合成（${yellow}/300）`
      }
    }
  },

  /**
   * _delay(ms) — 簡易 sleep
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _delay (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
