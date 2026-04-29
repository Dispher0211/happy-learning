/**
 * StrokeOrderOverlay.js — 筆順全螢幕覆蓋層（Task 38）
 * 位置：js/overlays/StrokeOrderOverlay.js
 * render 到 #overlay-root
 * 依賴：hanzi_writer_manager.js（T13）、audio.js（T08）
 */

import { HanziWriterManager } from '../hanzi_writer_manager.js'
import { AudioManager } from '../audio.js'

// ─── CSS 樣式（僅注入一次）────────────────────────────────────────────────────
const STYLE_ID = '__stroke_order_overlay_style__'

function _injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* 全螢幕背景遮罩 */
    .so-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.78);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: soFadeIn 0.2s ease;
    }
    @keyframes soFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* 主面板 */
    .so-panel {
      background: #fff;
      border-radius: 20px;
      padding: 24px 20px 20px;
      width: min(92vw, 420px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      position: relative;
    }

    /* 關閉按鈕 */
    .so-close-btn {
      position: absolute;
      top: 12px;
      right: 14px;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #666;
      line-height: 1;
      padding: 4px 8px;
      border-radius: 8px;
      transition: background 0.15s;
    }
    .so-close-btn:hover { background: #f0f0f0; }

    /* 字標題 */
    .so-char-title {
      font-size: 28px;
      font-weight: 700;
      color: #2c3e50;
      letter-spacing: 2px;
    }

    /* HanziWriter 容器：響應式，最大 260px
       min(72vw, 260px) 確保 320px 螢幕也不 overflow */
    .so-writer-wrap {
      width: min(72vw, 260px);
      height: min(72vw, 260px);
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    /* 模式切換按鈕列 */
    .so-mode-btns {
      display: flex;
      gap: 10px;
    }
    .so-mode-btn {
      flex: 1;
      min-width: 90px;
      padding: 10px 0;
      border: 2px solid #3498db;
      background: #fff;
      color: #3498db;
      font-size: 16px;
      font-weight: 600;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .so-mode-btn.active {
      background: #3498db;
      color: #fff;
    }
    .so-mode-btn:hover:not(.active) { background: #ebf5fb; }

    /* 速度滑桿區 */
    .so-speed-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: #555;
      width: 100%;
      justify-content: center;
    }
    .so-speed-label {
      min-width: 40px;
      text-align: center;
      font-weight: 600;
      color: #2c3e50;
    }
    #so-speed-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 160px;
      height: 6px;
      border-radius: 3px;
      background: #bde0ff;
      outline: none;
      cursor: pointer;
    }
    #so-speed-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #3498db;
      cursor: pointer;
    }

    /* 操作提示文字 */
    .so-hint-text {
      font-size: 13px;
      color: #888;
      text-align: center;
    }
  `
  document.head.appendChild(style)
}

// ─── 速度對照表（slider value → HanziWriter strokeAnimationSpeed）─────────────
// slider: 0=0.5x, 1=1x, 2=2x
const SPEED_MAP = [
  { label: '0.5x', animSpeed: 0.5, delayBetween: 700 },
  { label: '1x',   animSpeed: 1,   delayBetween: 500 },
  { label: '2x',   animSpeed: 2,   delayBetween: 300 },
]

// ─── StrokeOrderOverlay 類別 ──────────────────────────────────────────────────
class _StrokeOrderOverlay {

  constructor() {
    /** 目前顯示的漢字 */
    this._char = null
    /** HanziWriter 實例 */
    this._writer = null
    /** 目前模式：'demo'（示範）| 'quiz'（練習） */
    this._mode = 'demo'
    /** 速度索引（0/1/2） */
    this._speedIdx = 1
    /** 事件移除清單 */
    this._listeners = []
    /** 是否正在動畫中（防重複觸發） */
    this._animating = false
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  /**
   * show({ char }) — 全螢幕顯示筆順 overlay
   * @param {Object} param0
   * @param {string} param0.char 要顯示的漢字
   */
  async show({ char } = {}) {
    if (!char) {
      console.warn('[StrokeOrderOverlay] show() 缺少 char 參數')
      return
    }

    // 注入樣式
    _injectStyle()

    this._char = char
    this._mode = 'demo'
    this._speedIdx = 1
    this._animating = false

    // 取得 overlay-root
    const root = document.getElementById('overlay-root')
    if (!root) {
      console.error('[StrokeOrderOverlay] 找不到 #overlay-root')
      return
    }

    // 清空舊內容
    root.innerHTML = ''

    // 建立 DOM
    root.innerHTML = this._buildHTML(char)

    // 初始化 HanziWriter
    await this._initWriter()

    // 綁定事件
    this._bindEvents(root)

    // 自動播放示範動畫
    this._playDemo()
  }

  /**
   * hide() — 關閉 overlay，清空 #overlay-root
   */
  hide() {
    // 移除所有事件監聽
    this._listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn))
    this._listeners = []

    // 停止 HanziWriter 動畫
    if (this._writer) {
      try { this._writer.cancelAnimation() } catch (_) {}
      this._writer = null
    }

    // 清空 overlay-root
    const root = document.getElementById('overlay-root')
    if (root) root.innerHTML = ''

    this._char = null
    this._animating = false
  }

  // ─── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * 建立覆蓋層 HTML 字串
   */
  _buildHTML(char) {
    return `
      <div class="so-backdrop" id="so-backdrop">
        <div class="so-panel" id="so-panel">

          <!-- 關閉按鈕 -->
          <button class="so-close-btn" id="so-close-btn" aria-label="關閉">✕</button>

          <!-- 字標題 -->
          <div class="so-char-title">${char} 筆順</div>

          <!-- HanziWriter 繪製區域 -->
          <div class="so-writer-wrap">
            <svg id="so-writer-svg"
                 xmlns="http://www.w3.org/2000/svg"
                 width="100%"
                 height="100%"
                 viewBox="0 0 260 260"
                 style="display:block">
            </svg>
          </div>

          <!-- 模式切換按鈕 -->
          <div class="so-mode-btns">
            <button class="so-mode-btn active" id="so-btn-demo">🎬 示範</button>
            <button class="so-mode-btn"        id="so-btn-quiz">✏️ 練習</button>
          </div>

          <!-- 速度滑桿 -->
          <div class="so-speed-row">
            <span>速度</span>
            <input type="range"
                   id="so-speed-slider"
                   min="0" max="2" step="1"
                   value="1"
                   aria-label="速度調整">
            <span class="so-speed-label" id="so-speed-label">1x</span>
          </div>

          <!-- 操作提示 -->
          <div class="so-hint-text" id="so-hint-text">
            依照筆劃順序，依序顯示動畫
          </div>

        </div>
      </div>
    `
  }

  /**
   * 初始化 HanziWriter 實例
   */
  async _initWriter() {
    try {
      // 確保 HanziWriter CDN 已載入
      await HanziWriterManager.ensureLoaded()

      const svgEl = document.getElementById('so-writer-svg')
      if (!svgEl) return

      // 建立 HanziWriter 實例（掛載到 svg element）
      this._writer = HanziWriter.create(svgEl, this._char, {
        width: 260,
        height: 260,
        padding: 20,
        showOutline: true,
        strokeColor:     '#2c3e50',
        outlineColor:    '#d5d8dc',
        highlightColor:  '#e74c3c',
        drawingColor:    '#3498db',
        drawingFadePeriod: 0.3,
        // 速度參數（後續可動態更新）
        strokeAnimationSpeed: SPEED_MAP[this._speedIdx].animSpeed,
        delayBetweenStrokes:  SPEED_MAP[this._speedIdx].delayBetween,
      })

    } catch (err) {
      console.error('[StrokeOrderOverlay] HanziWriter 初始化失敗:', err)
    }
  }

  /**
   * 綁定所有 UI 事件
   */
  _bindEvents(root) {
    // 輔助：快捷綁定並記錄
    const on = (el, type, fn) => {
      if (!el) return
      el.addEventListener(type, fn)
      this._listeners.push({ el, type, fn })
    }

    // ✕ 關閉按鈕
    on(document.getElementById('so-close-btn'), 'click', () => this.hide())

    // 點背景遮罩關閉（點到面板本身不觸發）
    const backdrop = document.getElementById('so-backdrop')
    on(backdrop, 'click', (e) => {
      if (e.target === backdrop) this.hide()
    })

    // [示範] 按鈕
    on(document.getElementById('so-btn-demo'), 'click', () => this._switchMode('demo'))

    // [練習] 按鈕
    on(document.getElementById('so-btn-quiz'), 'click', () => this._switchMode('quiz'))

    // 速度滑桿
    const slider = document.getElementById('so-speed-slider')
    on(slider, 'input', (e) => {
      this._speedIdx = Number(e.target.value)
      // 更新速度標籤
      const label = document.getElementById('so-speed-label')
      if (label) label.textContent = SPEED_MAP[this._speedIdx].label
      // 如果在示範模式中正在動畫，重新播放
      if (this._mode === 'demo') {
        this._playDemo()
      }
    })
  }

  /**
   * 切換模式：'demo'（示範）或 'quiz'（練習）
   */
  _switchMode(mode) {
    if (!this._writer) return
    this._mode = mode

    // 更新按鈕樣式
    const btnDemo = document.getElementById('so-btn-demo')
    const btnQuiz = document.getElementById('so-btn-quiz')
    if (btnDemo) btnDemo.classList.toggle('active', mode === 'demo')
    if (btnQuiz) btnQuiz.classList.toggle('active', mode === 'quiz')

    // 更新提示文字
    const hint = document.getElementById('so-hint-text')

    if (mode === 'demo') {
      if (hint) hint.textContent = '依照筆劃順序，依序顯示動畫'
      this._playDemo()
    } else {
      // 練習模式：啟動 quiz
      if (hint) hint.textContent = '依照筆順在方格內描字，完成後自動播放回放'
      this._playQuiz()
    }
  }

  /**
   * 示範模式：播放完整筆順動畫（可重複播放）
   */
  _playDemo() {
    if (!this._writer) return

    // 取消前一個動畫
    try { this._writer.cancelAnimation() } catch (_) {}

    this._animating = true

    // 更新速度設定
    const { animSpeed, delayBetween } = SPEED_MAP[this._speedIdx]

    this._writer.animateCharacter({
      strokeAnimationSpeed: animSpeed,
      delayBetweenStrokes:  delayBetween,
      onComplete: () => {
        this._animating = false
      },
    })
  }

  /**
   * 練習模式：啟動 quiz，完成後播放回放
   */
  _playQuiz() {
    if (!this._writer) return

    // 取消示範動畫
    try { this._writer.cancelAnimation() } catch (_) {}

    // 顯示輪廓，隱藏已完成的筆劃
    this._writer.hideCharacter()

    // 啟動手寫 quiz
    this._writer.quiz({
      onMistake: (strokeData) => {
        // 答錯筆劃：播放音效（可選）
        console.debug('[StrokeOrderOverlay] 筆劃錯誤:', strokeData)
      },
      onCorrectStroke: (strokeData) => {
        // 答對一筆：播放輕微音效
        console.debug('[StrokeOrderOverlay] 筆劃正確:', strokeData)
      },
      onComplete: (summaryData) => {
        // 全部完成 → 播放完整筆順回放
        const hint = document.getElementById('so-hint-text')
        if (hint) hint.textContent = '✅ 完成！回放筆順動畫…'

        const { animSpeed, delayBetween } = SPEED_MAP[this._speedIdx]
        this._writer.animateCharacter({
          strokeAnimationSpeed: animSpeed,
          delayBetweenStrokes:  delayBetween,
          onComplete: () => {
            // 回放結束後再次啟動 quiz，讓用戶可繼續練習
            if (this._mode === 'quiz') {
              if (hint) hint.textContent = '依照筆順在方格內描字，完成後自動播放回放'
              this._playQuiz()
            }
          },
        })
      },
    })
  }
}

// ─── 單例匯出 ─────────────────────────────────────────────────────────────────
export const StrokeOrderOverlay = new _StrokeOrderOverlay()

// 掛到全域，方便 UIManager 透過 overlayId 呼叫
window.__StrokeOrderOverlay = StrokeOrderOverlay
