/**
 * ui/ui_manager.js — 快樂學習 UIManager
 * Task 28 ｜ v4.1.0
 *
 * 功能：
 *   - 頁面切換（navigate / back）
 *   - Overlay 管理（showOverlay / hideOverlay）
 *   - Toast 通知（showToast）
 *   - 頂部 UI 狀態更新（星星 / 網路 / 待審核）
 *
 * 依賴：
 *   - state.js       → AppState（T02）
 *   - page_history.js→ PageHistory（T03）
 *   - input_guard.js → InputGuard（T04）
 *   - ui/pages.js    → PAGES（T29）
 *
 * v4 修改：
 *   - _initPage 加 try/catch（init 拋出 → 顯示錯誤畫面，不白屏）
 *   - switch 分發加入 PAGES.PARENT_WORDS / PAGES.PARENT_IDIOMS
 *
 * 所有 Page/Overlay 類別透過 globalThis 延遲讀取，
 * 避免 ES Module 循環依賴問題。
 */

import { AppState }    from '../state.js'
import { PageHistory } from '../page_history.js'
import { InputGuard }  from '../input_guard.js'
import { PAGES }       from './pages.js'

// ─────────────────────────────────────────────
// UIManager 單例
// ─────────────────────────────────────────────
const UIManager = {

  // DOM 容器（init 後快取）
  _appEl:        null,
  _overlayRoot:  null,
  _toastRoot:    null,

  // 目前顯示的頁面實例與覆蓋層實例
  _currentPage:    null,
  _currentPageId:  null,
  _currentOverlay: null,
  _currentOverlayId: null,

  // Toast 計時器（允許 queue 清除）
  _toastTimers: [],

  // ────────────────────────────────────────
  // init()：快取 DOM 根節點
  // ────────────────────────────────────────
  init() {
    this._appEl       = document.getElementById('app')
    this._overlayRoot = document.getElementById('overlay-root')
    this._toastRoot   = document.getElementById('toast-root')

    if (!this._appEl)       console.error('[UIManager] 找不到 #app')
    if (!this._overlayRoot) console.error('[UIManager] 找不到 #overlay-root')
    if (!this._toastRoot)   console.error('[UIManager] 找不到 #toast-root')

    // 把自己掛到 globalThis，讓 AppState Proxy 可呼叫
    globalThis.UIManager = this
  },

  // ────────────────────────────────────────
  // navigate(pageId, params, options)
  //   animation: 'slide' | 'slide_back' | 'fade' | 'none'
  //   addToHistory: Boolean（預設 true）
  // ────────────────────────────────────────
  async navigate(pageId, params = {}, options = {}) {
    // 導覽中鎖（防動畫期間重複觸發）
    if (AppState.locks.navigation) {
      console.warn('[UIManager] navigate 被 navigation lock 擋住，忽略：', pageId)
      return
    }

    const {
      animation   = 'slide',
      addToHistory = true,
    } = options

    AppState.locks.navigation = true

    try {
      // 1. 銷毀目前頁面
      await this._destroyPage()

      // 2. 更新歷史（覆蓋層類頁面不加入歷史）
      const OVERLAY_PAGES = [
        PAGES.STROKE_ORDER,
        PAGES.STAR_MERGE,
        PAGES.POKEDEX_REVEAL,
      ]
      if (addToHistory && !OVERLAY_PAGES.includes(pageId)) {
        PageHistory.push({ page: pageId, params })
      }

      // 3. 動畫前處理
      if (animation === 'slide') {
        await this._slideTransition('in')
      } else if (animation === 'slide_back') {
        await this._slideBackTransition('in')
      } else if (animation === 'fade') {
        await this._fadeTransition('in')
      }
      // 'none'：直接切換

      // 4. 初始化新頁面
      await this._initPage(pageId, params)
      this._currentPageId = pageId

    } finally {
      // 確保鎖一定解除
      AppState.locks.navigation = false
    }
  },

  // ────────────────────────────────────────
  // back()：回上一頁
  // ────────────────────────────────────────
  async back() {
    // 先彈出目前頁
    PageHistory.pop()
    const prev = PageHistory.peek()
    if (!prev) {
      // 歷史只剩根頁，回卡片頁
      await this.navigate(PAGES.CARD, {}, { animation: 'slide_back', addToHistory: false })
      return
    }
    await this.navigate(prev.page, prev.params || {}, {
      animation: 'slide_back',
      addToHistory: false,
    })
  },

  // ────────────────────────────────────────
  // _initPage(pageId, params)
  //   switch 分發所有19個頁面，含 PARENT_WORDS / PARENT_IDIOMS
  //   v4：try/catch，init 拋出 → 顯示錯誤畫面，不白屏
  // ────────────────────────────────────────
  async _initPage(pageId, params) {
    let page = null

    try {
      // ── 透過 globalThis 延遲讀取各 Page 類別（避免循環依賴）──
      switch (pageId) {

        case PAGES.LOADING: {
          // 載入畫面：直接寫 HTML，不需要獨立 Page 類別
          this._appEl.innerHTML = `
            <div class="loading-screen">
              <div class="loading-meteor-shower" aria-hidden="true"></div>
              <div class="loading-logo">快樂學習</div>
              <div class="loading-spinner"></div>
            </div>`
          return
        }

        case PAGES.LOGIN: {
          const { LoginPage } = await import('../pages/LoginPage.js')
          page = new LoginPage()
          break
        }

        case PAGES.SELECT_CHILD: {
          const { SelectChildPage } = await import('../pages/SelectChildPage.js')
          page = new SelectChildPage()
          break
        }

        case PAGES.TUTORIAL: {
          const { TutorialPage } = await import('../pages/TutorialPage.js')
          page = new TutorialPage()
          break
        }

        case PAGES.CARD: {
          const { CardPage } = await import('../pages/CardPage.js')
          page = new CardPage()
          break
        }

        case PAGES.GAME_LIST: {
          const { GameListPage } = await import('../pages/GameListPage.js')
          page = new GameListPage()
          break
        }

        case PAGES.GAME: {
          const { GamePage } = await import('../pages/GamePage.js')
          page = new GamePage()
          break
        }

        case PAGES.POKEDEX: {
          const { PokedexPage } = await import('../pages/PokedexPage.js')
          page = new PokedexPage()
          break
        }

        case PAGES.FORGET_RANK: {
          const { ForgetRankPage } = await import('../pages/ForgetRankPage.js')
          page = new ForgetRankPage()
          break
        }

        case PAGES.PARENT_HOME: {
          const { ParentHomePage } = await import('../pages/ParentHomePage.js')
          page = new ParentHomePage()
          break
        }

        case PAGES.PARENT_CHARS: {
          const { ParentCharsPage } = await import('../pages/ParentCharsPage.js')
          page = new ParentCharsPage()
          break
        }

        case PAGES.PARENT_WORDS: {
          // v4 新增
          const { ParentWordsPage } = await import('../pages/ParentWordsPage.js')
          page = new ParentWordsPage()
          break
        }

        case PAGES.PARENT_IDIOMS: {
          // v4 新增
          const { ParentIdiomsPage } = await import('../pages/ParentIdiomsPage.js')
          page = new ParentIdiomsPage()
          break
        }

        case PAGES.PARENT_REVIEW: {
          const { ParentReviewPage } = await import('../pages/ParentReviewPage.js')
          page = new ParentReviewPage()
          break
        }

        case PAGES.PARENT_POKEDEX: {
          const { ParentPokedexPage } = await import('../pages/ParentPokedexPage.js')
          page = new ParentPokedexPage()
          break
        }

        case PAGES.PARENT_API: {
          const { ParentAPIPage } = await import('../pages/ParentAPIPage.js')
          page = new ParentAPIPage()
          break
        }

        // Overlay 類頁面 → 轉交 showOverlay 處理
        case PAGES.STROKE_ORDER:
        case PAGES.STAR_MERGE:
        case PAGES.POKEDEX_REVEAL: {
          await this.showOverlay(pageId, params)
          return
        }

        default:
          throw new Error(`未定義的頁面：${pageId}`)
      }

      // 保存實例並呼叫 init
      this._currentPage = page
      // 將 app 容器清空（避免殘留）
      this._appEl.innerHTML = ''
      await page.init(params)

    } catch (err) {
      // v4：init 拋出 → 顯示錯誤提示，不白屏崩潰
      console.error('[UIManager] _initPage 失敗：', pageId, err)
      this._currentPage = null
      this._appEl.innerHTML = `
        <div style="
          padding: 24px 20px;
          color: #e74c3c;
          font-size: 15px;
          font-family: sans-serif;
          line-height: 1.6;
          text-align: center;
        ">
          <div style="font-size: 40px; margin-bottom: 12px;">⚠️</div>
          <div style="font-weight: bold; font-size: 17px; margin-bottom: 8px;">
            頁面載入失敗
          </div>
          <div style="color: #666; font-size: 13px; margin-bottom: 16px;">
            ${pageId} — ${err.message || '未知錯誤'}
          </div>
          <button
            onclick="globalThis.UIManager?.back()"
            style="
              padding: 10px 24px;
              background: #3498db;
              color: white;
              border: none;
              border-radius: 20px;
              font-size: 14px;
              cursor: pointer;
            "
          >← 返回</button>
        </div>`
    }
  },

  // ────────────────────────────────────────
  // _destroyPage()：銷毀目前頁面實例
  // ────────────────────────────────────────
  async _destroyPage() {
    if (!this._currentPage) return
    try {
      if (typeof this._currentPage.destroy === 'function') {
        await this._currentPage.destroy()
      }
    } catch (err) {
      console.warn('[UIManager] _destroyPage 發生錯誤（忽略）', err)
    }
    this._currentPage   = null
    this._currentPageId = null
  },

  // ────────────────────────────────────────
  // showOverlay(overlayId, params)
  //   一次只能一個，開新自動關舊
  // ────────────────────────────────────────
  async showOverlay(overlayId, params = {}) {
    // 若已有舊覆蓋層，先關閉
    if (this._currentOverlay) {
      await this.hideOverlay()
    }

    let overlay = null

    try {
      switch (overlayId) {

        case PAGES.STROKE_ORDER: {
          const { StrokeOrderOverlay } = await import('../overlays/StrokeOrderOverlay.js')
          overlay = new StrokeOrderOverlay()
          break
        }

        case PAGES.STAR_MERGE: {
          const { StarMergeOverlay } = await import('../overlays/StarMergeOverlay.js')
          overlay = new StarMergeOverlay()
          break
        }

        case PAGES.POKEDEX_REVEAL: {
          const { PokedexRevealOverlay } = await import('../overlays/PokedexRevealOverlay.js')
          overlay = new PokedexRevealOverlay()
          break
        }

        default:
          throw new Error(`未定義的 Overlay：${overlayId}`)
      }

      this._currentOverlay   = overlay
      this._currentOverlayId = overlayId

      // 清空容器，render 新覆蓋層
      this._overlayRoot.innerHTML = ''
      await overlay.show(params)

    } catch (err) {
      console.error('[UIManager] showOverlay 失敗：', overlayId, err)
      this._currentOverlay   = null
      this._currentOverlayId = null
    }
  },

  // ────────────────────────────────────────
  // hideOverlay(overlayId?)
  //   不傳 overlayId → 關閉目前覆蓋層
  //   傳 overlayId → 只有吻合時才關閉
  // ────────────────────────────────────────
  async hideOverlay(overlayId) {
    if (!this._currentOverlay) return
    if (overlayId && overlayId !== this._currentOverlayId) return

    try {
      if (typeof this._currentOverlay.hide === 'function') {
        await this._currentOverlay.hide()
      }
    } catch (err) {
      console.warn('[UIManager] hideOverlay 發生錯誤（忽略）', err)
    }

    this._overlayRoot.innerHTML = ''
    this._currentOverlay   = null
    this._currentOverlayId = null
  },

  // ────────────────────────────────────────
  // showToast(message, type, duration)
  //   type: 'success' | 'error' | 'warning' | 'info'
  //   duration: ms（預設 2500）
  //   render 到 #toast-root，duration 後自動消失
  // ────────────────────────────────────────
  showToast(message, type = 'info', duration = 2500) {
    if (!this._toastRoot) return

    // 顏色對應
    const colorMap = {
      success: '#27ae60',
      error:   '#e74c3c',
      warning: '#f39c12',
      info:    '#3498db',
    }
    const iconMap = {
      success: '✅',
      error:   '❌',
      warning: '⚠️',
      info:    'ℹ️',
    }
    const bg    = colorMap[type] || colorMap.info
    const icon  = iconMap[type]  || iconMap.info

    // 建立 Toast 元素
    const toast = document.createElement('div')
    toast.className = 'toast-item'
    toast.setAttribute('role', 'alert')
    toast.setAttribute('aria-live', 'polite')
    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${icon}</span>
      <span class="toast-msg">${this._escapeHtml(message)}</span>`

    // 套用樣式
    Object.assign(toast.style, {
      display:       'flex',
      alignItems:    'center',
      gap:           '8px',
      padding:       '12px 18px',
      borderRadius:  '12px',
      background:    bg,
      color:         '#fff',
      fontSize:      '14px',
      fontFamily:    'sans-serif',
      boxShadow:     '0 4px 16px rgba(0,0,0,0.18)',
      marginBottom:  '8px',
      opacity:       '0',
      transform:     'translateY(-10px)',
      transition:    'opacity 0.25s ease, transform 0.25s ease',
      pointerEvents: 'none',
      maxWidth:      '85vw',
      wordBreak:     'break-word',
    })

    this._toastRoot.appendChild(toast)

    // 進場動畫（非同步觸發）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity   = '1'
        toast.style.transform = 'translateY(0)'
      })
    })

    // 自動消失
    const timer = setTimeout(() => {
      toast.style.opacity   = '0'
      toast.style.transform = 'translateY(-10px)'
      setTimeout(() => {
        toast.remove()
      }, 300)
    }, duration)

    this._toastTimers.push(timer)
  },

  // ────────────────────────────────────────
  // updateStarsDisplay(stars)
  //   stars: AppState.stars 物件
  //   含半星：yellow_total 小數 ≥ 0.5 → 顯示「½」
  // ────────────────────────────────────────
  updateStarsDisplay(stars) {
    if (!stars) return

    const { yellow_total = 0, blue_total = 0, red_total = 0 } = stars

    // 計算全星與半星
    const yellowFull = Math.floor(yellow_total)
    const yellowHalf = (yellow_total % 1) >= 0.5

    // 組合顯示文字：全星數 + 可選「½」
    const yellowText = yellowHalf ? `${yellowFull}½` : `${yellowFull}`

    // 更新 DOM（若元素存在）
    const elYellow = document.getElementById('stars-yellow')
    const elBlue   = document.getElementById('stars-blue')
    const elRed    = document.getElementById('stars-red')

    if (elYellow) elYellow.textContent = `★ ${yellowText}`
    if (elBlue)   elBlue.textContent   = `💙 ${blue_total}`
    if (elRed)    elRed.textContent    = `❤️ ${red_total}`
  },

  // ────────────────────────────────────────
  // updateOnlineStatus(isOnline)
  // ────────────────────────────────────────
  updateOnlineStatus(isOnline) {
    const el = document.getElementById('online-status')
    if (!el) return
    el.textContent   = isOnline ? '🟢' : '🔴'
    el.title         = isOnline ? '網路正常' : '離線中'
    el.dataset.online = String(isOnline)
  },

  // ────────────────────────────────────────
  // updatePendingReviews(count)
  //   count > 0 → 顯示紅色數字徽章
  // ────────────────────────────────────────
  updatePendingReviews(count) {
    const el = document.getElementById('pending-review-badge')
    if (!el) return
    el.textContent      = count > 0 ? String(count) : ''
    el.style.display    = count > 0 ? 'inline-flex' : 'none'
    el.setAttribute('aria-label', `待審核 ${count} 則`)
  },

  // ────────────────────────────────────────
  // _slideTransition(direction)
  //   新頁從右側滑入
  // ────────────────────────────────────────
  async _slideTransition(direction) {
    if (!this._appEl) return
    this._appEl.classList.add('page-slide-enter')
    await this._wait(20) // 給瀏覽器一幀
    this._appEl.classList.remove('page-slide-enter')
  },

  // ────────────────────────────────────────
  // _slideBackTransition(direction)
  //   新頁從左側滑入（回退動畫）
  // ────────────────────────────────────────
  async _slideBackTransition(direction) {
    if (!this._appEl) return
    this._appEl.classList.add('page-slide-back-enter')
    await this._wait(20)
    this._appEl.classList.remove('page-slide-back-enter')
  },

  // ────────────────────────────────────────
  // _fadeTransition(direction)
  //   淡入淡出
  // ────────────────────────────────────────
  async _fadeTransition(direction) {
    if (!this._appEl) return
    this._appEl.style.opacity    = '0'
    this._appEl.style.transition = 'opacity 0.2s ease'
    await this._wait(200)
    this._appEl.style.opacity    = '1'
    // 移除 transition（避免影響後續樣式）
    setTimeout(() => {
      if (this._appEl) this._appEl.style.transition = ''
    }, 250)
  },

  // ────────────────────────────────────────
  // _wait(ms)：Promise 延遲輔助
  // ────────────────────────────────────────
  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  // ────────────────────────────────────────
  // _escapeHtml(str)：防 XSS
  // ────────────────────────────────────────
  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  },
}

export { UIManager }
