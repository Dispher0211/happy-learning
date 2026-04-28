/**
 * ParentHomePage.js ??家長首�?
 * 位置：js/pages/ParentHomePage.js
 * Task 41 ??快�?學�? Happy Learning v4.1
 *
 * 依賴：firebase.js（T05）、ui_manager.js（T28�? * ?�能：顯示�?審核?��??��??�設定入?? *       v4 ?��?：�?語簿（PARENT_WORDS）、�?語簿（PARENT_IDIOMS）入?? */

import { FirestoreAPI } from '../firebase.js'
import { UIManager } from '../ui/ui_manager.js'
import { PAGES } from '../ui/pages.js'
import { AppState } from '../state.js'

export class ParentHomePage {
  constructor () {
    // ?��?事件??��?��??��?�?destroy() 移除
    this._listeners = []
  }

  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  // init：渲?��??�並綁�??�?��??��?�?  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  async init (params = {}) {
    // ?��??�?��?審核?��?（優?��? AppState，�??��?讀 Firestore�?    let pendingCount = AppState.pendingReviewCount ?? 0

    try {
      // ?�試�?Firestore ?��??�?�數??      const userData = await FirestoreAPI.read(`users/${AppState.uid}`)
      pendingCount = userData?.pendingReviewCount ?? pendingCount
      // ?�步??AppState
      AppState.pendingReviewCount = pendingCount
    } catch (e) {
      // ?��??�錯誤�?使用 AppState ?��??��?不崩�?      console.warn('[ParentHomePage] ?��?讀??pendingReviewCount，使?�快?��?, e)
    }

    // 渲�??�面 HTML
    this._render(pendingCount)

    // 綁�??�?��???    this._bindEvents()
  }

  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  // _render：輸?�家?��???innerHTML
  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  _render (pendingCount) {
    const app = document.getElementById('app')

    // 待審?�徽章�??��?審核?�顯示�??�數�?    const badgeHTML = pendingCount > 0
      ? `<span class="parent-home__badge">${pendingCount}</span>`
      : ''

    app.innerHTML = `
      <div class="parent-home">

        <!-- ?��? -->
        <div class="parent-home__header">
          <button class="parent-home__back-btn" id="parentHomeBack">??返�?</button>
          <h1 class="parent-home__title">?��?��?�‍�??家長設�?</h1>
        </div>

        <!-- 待審?��?�?-->
        <section class="parent-home__section">
          <h2 class="parent-home__section-title">?? 作業審核</h2>
          <button class="parent-home__btn parent-home__btn--review" id="btnReview">
            ?��?待審??            ${badgeHTML}
          </button>
        </section>

        <!-- 學�??�容管�? -->
        <section class="parent-home__section">
          <h2 class="parent-home__section-title">?? 學�??�容</h2>
          <div class="parent-home__btn-grid">

            <!-- ?��?�?-->
            <button class="parent-home__btn" id="btnChars">
              ?�� ?��?�?            </button>

            <!-- 詞�?簿�?v4 ?��?�?-->
            <button class="parent-home__btn" id="btnWords">
              ?? 詞�?�?            </button>

            <!-- ?��?簿�?v4 ?��?�?-->
            <button class="parent-home__btn" id="btnIdioms">
              ?�??��?�?            </button>

          </div>
        </section>

        <!-- ?��???API 設�? -->
        <section class="parent-home__section">
          <h2 class="parent-home__section-title">?��? ?��?設�?</h2>
          <div class="parent-home__btn-grid">

            <button class="parent-home__btn" id="btnPokedex">
              ?�� ?��?設�?
            </button>

            <button class="parent-home__btn" id="btnApi">
              ?? API ?�鑰
            </button>

          </div>
        </section>

      </div>
    `
  }

  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  // _bindEvents：�?定�??��??��?並�??��? destroy 移除
  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  _bindEvents () {
    // 返�??��?
    this._addListener('parentHomeBack', 'click', () => {
      UIManager.back()
    })

    // 待審??    this._addListener('btnReview', 'click', () => {
      UIManager.navigate(PAGES.PARENT_REVIEW)
    })

    // ?��?�?    this._addListener('btnChars', 'click', () => {
      UIManager.navigate(PAGES.PARENT_CHARS)
    })

    // 詞�?簿�?v4 ?��?�?    this._addListener('btnWords', 'click', () => {
      UIManager.navigate(PAGES.PARENT_WORDS)
    })

    // ?��?簿�?v4 ?��?�?    this._addListener('btnIdioms', 'click', () => {
      UIManager.navigate(PAGES.PARENT_IDIOMS)
    })

    // ?��?設�?
    this._addListener('btnPokedex', 'click', () => {
      UIManager.navigate(PAGES.PARENT_POKEDEX)
    })

    // API ?�鑰設�?
    this._addListener('btnApi', 'click', () => {
      UIManager.navigate(PAGES.PARENT_API)
    })
  }

  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  // _addListener：�?�?addEventListener�?  //               ?��?記�?以便 destroy() 清除
  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  _addListener (id, event, handler) {
    const el = document.getElementById(id)
    if (!el) return
    el.addEventListener(event, handler)
    // 記�?：{ ?��?, 事件?? ?��??�數 }
    this._listeners.push({ el, event, handler })
  }

  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  // destroy：移?��??��?件監?��??�放資�?
  // ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  destroy () {
    for (const { el, event, handler } of this._listeners) {
      el.removeEventListener(event, handler)
    }
    this._listeners = []
  }
}
