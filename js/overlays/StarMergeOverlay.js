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
 *   merge() → InputGuard 防連點 + StarsManager.merge('yellow_to_blue' | 'blue_to_red')
 *             合成後播放動畫，更新數字，star_pokedex_count 不變
 *   hide()  → 清空 #overlay-root
 *
 * 驗收標準：
 *   yellow_total < 1000  → 黃→藍按鈕 disable，顯示進度條
 *   yellow_total ≥ 1000  → 黃→藍按鈕發光，可點擊
 *   blue_total < 1000    → 藍→紅按鈕 disable，顯示進度條
 *   blue_total ≥ 1000    → 藍→紅按鈕發光，可點擊
 *   合成後 → 1000顆聚集旋轉→💥→1顆新星誕生，數字更新，star_pokedex_count 不受影響
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
      width: min(360px, 92vw);
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

    /* 合成區塊（每個合成一個區塊） */
    .smo-merge-section {
      background: rgba(255,255,255,0.05);
      border-radius: 14px;
      padding: 16px 14px 14px;
      margin-bottom: 16px;
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
      font-size: 28px;
      transition: transform 0.3s;
    }
    .smo-star-count {
      font-size: 30px;
      font-weight: bold;
      color: #ffd700;
      min-width: 60px;
      text-align: center;
      transition: all 0.3s;
    }
    .smo-star-count.blue  { color: #5bc8f5; }
    .smo-star-count.red   { color: #ff6b6b; }
    .smo-arrow {
      font-size: 20px;
      color: #aaa;
    }
    .smo-result-count {
      font-size: 30px;
      font-weight: bold;
      min-width: 40px;
      text-align: center;
      transition: all 0.3s;
    }
    .smo-result-count.blue { color: #5bc8f5; }
    .smo-result-count.red  { color: #ff6b6b; }

    /* 進度條區域 */
    .smo-progress-wrap {
      margin: 6px 0 12px;
    }
    .smo-progress-label {
      font-size: 12px;
      color: #ccc;
      margin-bottom: 4px;
      text-align: center;
    }
    .smo-progress-bar-bg {
      background: rgba(255,255,255,0.12);
      border-radius: 20px;
      height: 10px;
      overflow: hidden;
    }
    .smo-progress-bar-fill {
      height: 100%;
      border-radius: 20px;
      background: linear-gradient(90deg, #ffc107, #ffd700);
      transition: width 0.5s ease;
    }
    .smo-progress-bar-fill.blue-fill {
      background: linear-gradient(90deg, #5bc8f5, #1a9fd4);
    }

    /* 合成公式說明 */
    .smo-formula {
      text-align: center;
      font-size: 13px;
      color: #bbb;
      margin-bottom: 12px;
    }
    .smo-formula span { color: #ffd700; font-weight: bold; }
    .smo-formula span.blue { color: #5bc8f5; }

    /* 合成按鈕：不可用 */
    .smo-btn-merge {
      width: 100%;
      padding: 12px;
      border-radius: 14px;
      border: none;
      font-size: 16px;
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
    /* 合成按鈕：可用（發光效果） - 黃→藍 */
    .smo-btn-merge.ready-yellow {
      background: linear-gradient(135deg, #f7b733, #fc4a1a);
      color: #fff;
      box-shadow:
        0 0 12px rgba(247, 183, 51, 0.6),
        0 0 30px rgba(247, 183, 51, 0.3);
      animation: smo-btn-glow-yellow 1.5s ease-in-out infinite alternate;
    }
    @keyframes smo-btn-glow-yellow {
      from { box-shadow: 0 0 12px rgba(247,183,51,0.5), 0 0 20px rgba(247,183,51,0.2); }
      to   { box-shadow: 0 0 20px rgba(247,183,51,0.9), 0 0 40px rgba(247,183,51,0.5); }
    }
    /* 合成按鈕：可用（發光效果） - 藍→紅 */
    .smo-btn-merge.ready-blue {
      background: linear-gradient(135deg, #5bc8f5, #c850c0);
      color: #fff;
      box-shadow:
        0 0 12px rgba(91, 200, 245, 0.6),
        0 0 30px rgba(200, 80, 192, 0.3);
      animation: smo-btn-glow-blue 1.5s ease-in-out infinite alternate;
    }
    @keyframes smo-btn-glow-blue {
      from { box-shadow: 0 0 12px rgba(91,200,245,0.5), 0 0 20px rgba(200,80,192,0.2); }
      to   { box-shadow: 0 0 20px rgba(91,200,245,0.9), 0 0 40px rgba(200,80,192,0.5); }
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
   * mergeYellowToBlue() — 黃星合成藍星
   *   InputGuard 防連點 + StarsManager.merge('yellow_to_blue')
   */
  async mergeYellowToBlue () {
    const stars  = AppState.stars || {}
    const yellow = stars.yellow_total || 0

    // 不足 1000 顆：不動作
    if (yellow < 1000) return

    await InputGuard.guard('star_merge_ytb', async () => {
      const animLayer = this._el?.querySelector('#smo-anim-ytb')
      if (animLayer) {
        animLayer.classList.add('visible')
        const resultEl = animLayer.querySelector('.smo-anim-result')
        if (resultEl) {
          await this._delay(900)
          resultEl.style.display = 'block'
        }
      }

      // transaction: yellow_total -= 1000, blue_total += 1, star_pokedex_count 不受影響
      await StarsManager.merge('yellow_to_blue')

      await this._delay(600)

      if (animLayer) animLayer.classList.remove('visible')
      this._refresh()
    })
  },

  /**
   * mergeBlueToRed() — 藍星合成紅星
   *   InputGuard 防連點 + StarsManager.merge('blue_to_red')
   */
  async mergeBlueToRed () {
    const stars = AppState.stars || {}
    const blue  = stars.blue_total || 0

    // 不足 1000 顆：不動作
    if (blue < 1000) return

    await InputGuard.guard('star_merge_btr', async () => {
      const animLayer = this._el?.querySelector('#smo-anim-btr')
      if (animLayer) {
        animLayer.classList.add('visible')
        const resultEl = animLayer.querySelector('.smo-anim-result')
        if (resultEl) {
          await this._delay(900)
          resultEl.style.display = 'block'
        }
      }

      // transaction: blue_total -= 1000, red_total += 1, star_pokedex_count 不受影響
      await StarsManager.merge('blue_to_red')

      await this._delay(600)

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

        <!-- ===== 黃星 → 藍星 合成區塊 ===== -->
        <div class="smo-merge-section" style="position:relative;">
          <div class="smo-stars-row">
            <span class="smo-star-icon">⭐</span>
            <span class="smo-star-count" id="smo-yellow">0</span>
            <span style="font-size:13px;color:#ccc;">/ 1000</span>
            <span class="smo-arrow">→</span>
            <span class="smo-star-icon">💙</span>
            <span class="smo-result-count blue" id="smo-blue">0</span>
          </div>

          <!-- 進度條 -->
          <div class="smo-progress-wrap">
            <div class="smo-progress-label" id="smo-progress-label-ytb">收集中...</div>
            <div class="smo-progress-bar-bg">
              <div class="smo-progress-bar-fill" id="smo-progress-fill-ytb" style="width:0%"></div>
            </div>
          </div>

          <!-- 合成公式說明 -->
          <div class="smo-formula">
            <span>1000</span> 顆黃★ → <span>1</span> 顆藍★
          </div>

          <!-- 合成按鈕 -->
          <button class="smo-btn-merge disabled" id="smo-btn-ytb" disabled>
            收集 1000 顆才能合成
          </button>

          <!-- 合成動畫層 -->
          <div class="smo-anim-layer" id="smo-anim-ytb" aria-hidden="true">
            <div class="smo-anim-stars">⭐⭐⭐</div>
            <div class="smo-anim-text">合成中...</div>
            <div class="smo-anim-result" style="display:none">💙</div>
          </div>
        </div>

        <!-- ===== 藍星 → 紅星 合成區塊 ===== -->
        <div class="smo-merge-section" style="position:relative;">
          <div class="smo-stars-row">
            <span class="smo-star-icon">💙</span>
            <span class="smo-star-count blue" id="smo-blue2">0</span>
            <span style="font-size:13px;color:#ccc;">/ 1000</span>
            <span class="smo-arrow">→</span>
            <span class="smo-star-icon">❤️</span>
            <span class="smo-result-count red" id="smo-red">0</span>
          </div>

          <!-- 進度條 -->
          <div class="smo-progress-wrap">
            <div class="smo-progress-label" id="smo-progress-label-btr">收集中...</div>
            <div class="smo-progress-bar-bg">
              <div class="smo-progress-bar-fill blue-fill" id="smo-progress-fill-btr" style="width:0%"></div>
            </div>
          </div>

          <!-- 合成公式說明 -->
          <div class="smo-formula">
            <span class="blue">1000</span> 顆藍★ → <span>1</span> 顆紅★
          </div>

          <!-- 合成按鈕 -->
          <button class="smo-btn-merge disabled" id="smo-btn-btr" disabled>
            收集 1000 顆藍星才能合成
          </button>

          <!-- 合成動畫層 -->
          <div class="smo-anim-layer" id="smo-anim-btr" aria-hidden="true">
            <div class="smo-anim-stars">💙💙💙</div>
            <div class="smo-anim-text">合成中...</div>
            <div class="smo-anim-result" style="display:none">❤️</div>
          </div>
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

    // 黃→藍 合成按鈕
    backdrop.querySelector('#smo-btn-ytb').addEventListener('click', () => {
      this.mergeYellowToBlue()
    })

    // 藍→紅 合成按鈕
    backdrop.querySelector('#smo-btn-btr').addEventListener('click', () => {
      this.mergeBlueToRed()
    })

    return backdrop
  },

  /**
   * _refresh() — 讀取最新星星數，更新面板顯示
   */
  _refresh () {
    if (!this._el) return

    const stars  = AppState.stars || {}
    const yellow = Math.floor(stars.yellow_total || 0)
    const blue   = stars.blue_total || 0
    const red    = stars.red_total  || 0

    const pctY = Math.min((yellow / 1000) * 100, 100)
    const pctB = Math.min((blue   / 1000) * 100, 100)
    const readyY = yellow >= 1000
    const readyB = blue   >= 1000

    // ── 黃→藍 區塊 ──
    const yellowEl  = this._el.querySelector('#smo-yellow')
    const blueEl    = this._el.querySelector('#smo-blue')
    const fillYEl   = this._el.querySelector('#smo-progress-fill-ytb')
    const labelYEl  = this._el.querySelector('#smo-progress-label-ytb')
    const btnYEl    = this._el.querySelector('#smo-btn-ytb')

    if (yellowEl) yellowEl.textContent = yellow
    if (blueEl)   blueEl.textContent   = blue
    if (fillYEl)  fillYEl.style.width  = `${pctY.toFixed(1)}%`
    if (labelYEl) {
      labelYEl.textContent = readyY
        ? `已達 1000 顆，可以合成！`
        : `${yellow} / 1000 顆（還差 ${1000 - yellow} 顆）`
    }
    if (btnYEl) {
      if (readyY) {
        btnYEl.disabled   = false
        btnYEl.className  = 'smo-btn-merge ready-yellow'
        btnYEl.textContent = '✨ 立刻合成！1000⭐ → 1💙'
      } else {
        btnYEl.disabled   = true
        btnYEl.className  = 'smo-btn-merge disabled'
        btnYEl.textContent = `收集 1000 顆才能合成（${yellow}/1000）`
      }
    }

    // ── 藍→紅 區塊 ──
    const blue2El   = this._el.querySelector('#smo-blue2')
    const redEl     = this._el.querySelector('#smo-red')
    const fillBEl   = this._el.querySelector('#smo-progress-fill-btr')
    const labelBEl  = this._el.querySelector('#smo-progress-label-btr')
    const btnBEl    = this._el.querySelector('#smo-btn-btr')

    if (blue2El) blue2El.textContent  = blue
    if (redEl)   redEl.textContent    = red
    if (fillBEl) fillBEl.style.width  = `${pctB.toFixed(1)}%`
    if (labelBEl) {
      labelBEl.textContent = readyB
        ? `已達 1000 顆，可以合成！`
        : `${blue} / 1000 顆（還差 ${1000 - blue} 顆）`
    }
    if (btnBEl) {
      if (readyB) {
        btnBEl.disabled   = false
        btnBEl.className  = 'smo-btn-merge ready-blue'
        btnBEl.textContent = '✨ 立刻合成！1000💙 → 1❤️'
      } else {
        btnBEl.disabled   = true
        btnBEl.className  = 'smo-btn-merge disabled'
        btnBEl.textContent = `收集 1000 顆藍星才能合成（${blue}/1000）`
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
