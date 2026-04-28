/**
 * PokedexRevealOverlay.js — 圖鑑揭曉動畫 Overlay
 * Task 40 | v4：for...of loop 逐一播放，等用戶點[繼續]才播下一張
 *
 * 依賴：
 *   sync.js     (T12)  — SyncManager
 *   state.js    (T02)  — AppState
 *   pokedex.js  (T12.5)— PokedexManager
 *
 * 位置：js/overlays/PokedexRevealOverlay.js
 * render 到 #overlay-root
 */

import { AppState }       from '../state.js'
import { PokedexManager } from '../pokedex.js'

// ─────────────────────────────────────────────
// CSS 樣式注入（重複執行不重複插入）
// ─────────────────────────────────────────────
const STYLE_ID = '__pokedex_reveal_overlay_style__'

function _injectStyles () {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* ── 背景遮罩 ── */
    .pdx-reveal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.82);
      z-index: 9000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pdxFadeIn 0.25s ease;
    }
    @keyframes pdxFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ── 主卡片容器 ── */
    .pdx-reveal-card {
      background: linear-gradient(145deg, #1a1a2e, #16213e);
      border: 2px solid #e2b96a;
      border-radius: 20px;
      padding: 32px 28px 24px;
      width: min(340px, 90vw);
      text-align: center;
      position: relative;
      box-shadow: 0 8px 40px rgba(226, 185, 106, 0.3);
    }

    /* ── 系列標題 ── */
    .pdx-reveal-series {
      font-size: 13px;
      color: #e2b96a;
      letter-spacing: 1px;
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    /* ── 計數器 ── */
    .pdx-reveal-counter {
      font-size: 12px;
      color: #8899aa;
      margin-bottom: 20px;
    }

    /* ── 精靈球容器 ── */
    .pdx-reveal-ball-wrap {
      position: relative;
      width: 120px;
      height: 120px;
      margin: 0 auto 20px;
    }

    /* ── 精靈球 SVG ── */
    .pdx-reveal-ball {
      width: 100%;
      height: 100%;
      cursor: default;
    }
    .pdx-reveal-ball.shaking {
      animation: pdxShake 0.12s ease-in-out 6;
    }
    @keyframes pdxShake {
      0%,100% { transform: rotate(0deg); }
      25%      { transform: rotate(-12deg); }
      75%      { transform: rotate(12deg); }
    }

    /* ── 爆炸效果 ── */
    .pdx-reveal-burst {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 60px;
      opacity: 0;
    }
    .pdx-reveal-burst.active {
      animation: pdxBurst 0.45s ease forwards;
    }
    @keyframes pdxBurst {
      0%   { opacity: 1; transform: scale(0.5); }
      60%  { opacity: 1; transform: scale(1.4); }
      100% { opacity: 0; transform: scale(1.8); }
    }

    /* ── 圖片區域 ── */
    .pdx-reveal-img-wrap {
      width: 160px;
      height: 160px;
      margin: 0 auto 16px;
      display: none;           /* 預設隱藏，揭曉後顯示 */
      align-items: center;
      justify-content: center;
    }
    .pdx-reveal-img-wrap.visible {
      display: flex;
      animation: pdxFadeIn 0.4s ease;
    }
    .pdx-reveal-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      image-rendering: pixelated; /* 像素風格更清晰 */
    }
    .pdx-reveal-img-placeholder {
      font-size: 64px;
      opacity: 0.5;
    }

    /* ── 名稱標籤 ── */
    .pdx-reveal-name {
      font-size: 22px;
      font-weight: bold;
      color: #ffffff;
      margin-bottom: 4px;
      display: none;
    }
    .pdx-reveal-name.visible {
      display: block;
      animation: pdxFadeIn 0.4s ease 0.15s both;
    }

    /* ── 編號標籤 ── */
    .pdx-reveal-index {
      font-size: 13px;
      color: #8899aa;
      margin-bottom: 20px;
      display: none;
    }
    .pdx-reveal-index.visible {
      display: block;
    }

    /* ── 按鈕區 ── */
    .pdx-reveal-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .pdx-reveal-btn {
      padding: 12px 28px;
      border-radius: 30px;
      font-size: 15px;
      font-weight: bold;
      border: none;
      cursor: pointer;
      transition: transform 0.12s, box-shadow 0.12s;
    }
    .pdx-reveal-btn:active {
      transform: scale(0.95);
    }

    /* 加入圖鑑（主要行動） */
    .pdx-reveal-btn-collect {
      background: linear-gradient(135deg, #f6d365, #fda085);
      color: #1a1a2e;
      box-shadow: 0 4px 16px rgba(253, 160, 133, 0.4);
      display: none;
    }
    .pdx-reveal-btn-collect.visible {
      display: inline-block;
    }

    /* 繼續遊戲（次要） */
    .pdx-reveal-btn-continue {
      background: transparent;
      color: #8899aa;
      border: 1px solid #445566;
      display: none;
    }
    .pdx-reveal-btn-continue.visible {
      display: inline-block;
    }

    /* ── 載入狀態文字 ── */
    .pdx-reveal-loading {
      font-size: 14px;
      color: #8899aa;
      margin-bottom: 20px;
    }
  `
  document.head.appendChild(style)
}

// ─────────────────────────────────────────────
// PokedexRevealOverlay
// ─────────────────────────────────────────────
export const PokedexRevealOverlay = {

  /** 是否正在顯示 */
  _isVisible: false,

  /** resolve 函式，用來 await 單張揭曉完成 */
  _resolveOne: null,

  /**
   * show()
   *   1. 呼叫 PokedexManager.consumeRevealQueue() 取得待播放清單
   *   2. for...of loop 逐一顯示，每張等用戶點[繼續]
   *   3. 全部播完後自動隱藏
   */
  async show () {
    // 注入 CSS
    _injectStyles()

    // 取得待播放佇列（同時清空 Firestore reveal_queue）
    let queue
    try {
      queue = await PokedexManager.consumeRevealQueue()
    } catch (err) {
      console.error('[PokedexRevealOverlay] consumeRevealQueue 失敗:', err)
      return
    }

    if (!queue || queue.length === 0) {
      // 佇列為空，不顯示
      return
    }

    this._isVisible = true
    const total = queue.length

    // ── for...of：逐一播放，等用戶點[繼續]才播下一張 ──
    let current = 0
    for (const item of queue) {
      current++
      await this.showOne(item, current, total)
    }

    // 全部播完後關閉
    this.hide()
  },

  /**
   * showOne({ index, seriesId }, currentNum, total)
   *   精靈球搖晃 → 💥 → 圖片逐步顯示
   *   回傳 Promise，等用戶點[加入圖鑑]或[繼續遊戲]後 resolve
   *
   * @param {{ index: number, seriesId: string }} item
   * @param {number} currentNum  目前第幾張（1-based）
   * @param {number} total       總共幾張
   * @returns {Promise<void>}
   */
  showOne (item, currentNum = 1, total = 1) {
    return new Promise(async (resolve) => {
      this._resolveOne = resolve

      const { index, seriesId } = item
      const overlayRoot = document.getElementById('overlay-root')
      if (!overlayRoot) {
        console.error('[PokedexRevealOverlay] 找不到 #overlay-root')
        resolve()
        return
      }

      // ── 取得系列設定 ──
      const seriesConfig = PokedexManager.getSeriesConfig(seriesId) || {}
      const seriesName   = seriesConfig.name || '圖鑑'

      // ── 渲染初始 DOM（精靈球狀態）──
      overlayRoot.innerHTML = `
        <div class="pdx-reveal-backdrop" id="pdx-backdrop">
          <div class="pdx-reveal-card" id="pdx-card">

            <div class="pdx-reveal-series">${seriesName}</div>
            <div class="pdx-reveal-counter">
              ${total > 1 ? `${currentNum} / ${total}` : ''}
            </div>

            <!-- 精靈球 -->
            <div class="pdx-reveal-ball-wrap" id="pdx-ball-wrap">
              <svg class="pdx-reveal-ball" id="pdx-ball"
                   viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <!-- 上半（紅色） -->
                <path d="M 10 50 A 40 40 0 0 1 90 50 Z" fill="#e63946"/>
                <!-- 下半（白色） -->
                <path d="M 10 50 A 40 40 0 0 0 90 50 Z" fill="#f1faee"/>
                <!-- 中線 -->
                <line x1="10" y1="50" x2="90" y2="50" stroke="#1d3557" stroke-width="3"/>
                <!-- 中心鈕（外圈） -->
                <circle cx="50" cy="50" r="10" fill="#1d3557"/>
                <!-- 中心鈕（內圈） -->
                <circle cx="50" cy="50" r="6" fill="#f1faee"/>
              </svg>
              <!-- 爆炸特效 -->
              <div class="pdx-reveal-burst" id="pdx-burst">💥</div>
            </div>

            <!-- 圖片區（揭曉後顯示） -->
            <div class="pdx-reveal-img-wrap" id="pdx-img-wrap">
              <div class="pdx-reveal-img-placeholder" id="pdx-img-placeholder">✨</div>
              <img class="pdx-reveal-img" id="pdx-img"
                   alt="圖鑑圖片" style="display:none"/>
            </div>

            <!-- 名稱 -->
            <div class="pdx-reveal-name"  id="pdx-name"></div>
            <div class="pdx-reveal-index" id="pdx-index">No.${index}</div>

            <!-- 載入提示 -->
            <div class="pdx-reveal-loading" id="pdx-loading" style="display:none">
              圖片載入中…
            </div>

            <!-- 按鈕（揭曉後才顯示） -->
            <div class="pdx-reveal-actions">
              <button class="pdx-reveal-btn pdx-reveal-btn-collect"
                      id="pdx-btn-collect">🌟 加入圖鑑</button>
              <button class="pdx-reveal-btn pdx-reveal-btn-continue"
                      id="pdx-btn-continue">
                ${currentNum < total ? '繼續 ▶' : '繼續遊戲'}
              </button>
            </div>

          </div>
        </div>
      `

      // ── 取得 DOM 參考 ──
      const ball       = document.getElementById('pdx-ball')
      const burst      = document.getElementById('pdx-burst')
      const imgWrap    = document.getElementById('pdx-img-wrap')
      const imgEl      = document.getElementById('pdx-img')
      const placeholder= document.getElementById('pdx-img-placeholder')
      const nameEl     = document.getElementById('pdx-name')
      const indexEl    = document.getElementById('pdx-index')
      const loadingEl  = document.getElementById('pdx-loading')
      const btnCollect = document.getElementById('pdx-btn-collect')
      const btnContinue= document.getElementById('pdx-btn-continue')

      // ── 工具函式：等待毫秒 ──
      const wait = ms => new Promise(r => setTimeout(r, ms))

      // ── Phase 1：精靈球搖晃動畫（720ms = 6次 × 120ms）──
      ball.classList.add('shaking')
      await wait(750)
      ball.classList.remove('shaking')
      await wait(100)

      // ── Phase 2：爆炸特效 ──
      burst.classList.add('active')
      // 精靈球淡出（縮小）
      ball.style.transition = 'transform 0.2s, opacity 0.2s'
      ball.style.transform  = 'scale(0.2)'
      ball.style.opacity    = '0'
      await wait(450)

      // ── Phase 3：顯示圖片區 ──
      document.getElementById('pdx-ball-wrap').style.display = 'none'
      imgWrap.classList.add('visible')
      loadingEl.style.display = 'block'

      // 非同步載入圖片
      let imgUrl = null
      try {
        imgUrl = await PokedexManager.fetchImage(index, seriesId)
      } catch (err) {
        console.warn('[PokedexRevealOverlay] fetchImage 失敗:', err)
        imgUrl = null
      }

      loadingEl.style.display = 'none'

      if (imgUrl) {
        // 圖片載入成功
        imgEl.src = imgUrl
        imgEl.style.display = 'block'
        placeholder.style.display = 'none'
        // 等圖片實際載入完成
        if (!imgEl.complete) {
          await new Promise(r => {
            imgEl.onload  = r
            imgEl.onerror = r   // 失敗也繼續
          })
        }
      } else {
        // 圖片載入失敗 → 保留預設圖示
        placeholder.textContent = '🎴'
        placeholder.style.display = 'block'
        imgEl.style.display = 'none'
      }

      // ── Phase 4：顯示名稱與編號 ──
      // 嘗試從 seriesConfig 取得名稱對照
      const names = seriesConfig.names || {}
      const charName = names[String(index)] || `No.${index}`
      nameEl.textContent = charName
      nameEl.classList.add('visible')
      indexEl.classList.add('visible')

      await wait(200)

      // ── Phase 5：顯示操作按鈕 ──
      btnCollect.classList.add('visible')
      btnContinue.classList.add('visible')

      // ── 綁定按鈕事件（使用 once 旗標，只觸發一次）──

      // [加入圖鑑] 與 [繼續遊戲] 都執行 resolve，差異只是動作語意
      // 規格中兩個按鈕都結束本張揭曉
      const handleContinue = () => {
        // 解綁防止重複觸發
        btnCollect .removeEventListener('click', handleContinue)
        btnContinue.removeEventListener('click', handleContinue)
        resolve()
      }

      btnCollect .addEventListener('click', handleContinue, { once: true })
      btnContinue.addEventListener('click', handleContinue, { once: true })
    })
  },

  /**
   * hide()
   *   清空 #overlay-root
   */
  hide () {
    const overlayRoot = document.getElementById('overlay-root')
    if (overlayRoot) overlayRoot.innerHTML = ''
    this._isVisible   = false
    this._resolveOne  = null
  },
}

// ── 掛到 globalThis，讓其他模組透過可選鏈呼叫 ──
globalThis.PokedexRevealOverlay = PokedexRevealOverlay
