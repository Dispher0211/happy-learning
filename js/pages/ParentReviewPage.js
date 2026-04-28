/**
 * ParentReviewPage.js — 家長審核頁面（Task 43）
 * 位置：js/pages/ParentReviewPage.js
 * 層級：第八層頁面
 * 依賴：firebase.js（T05）、stars.js（T10）、forgetting.js（T09）、wrong_queue.js（T11）、
 *       state.js（T02）、ui_manager.js（T28）
 *
 * 功能：
 *   - 顯示所有 status='pending' 的短句造詞審核題目
 *   - 家長可執行：✅通過、❌不通過、✏️修改後通過
 *   - 審核後同步 AppState.pendingReviewCount
 */

import { AppState } from '../state.js'
import { FirestoreAPI } from '../firebase.js'
import { StarsManager } from '../stars.js'
import { ForgettingCurve } from '../forgetting.js'
import { WrongQueue } from '../wrong_queue.js'
import { UIManager } from '../ui/ui_manager.js'

export class ParentReviewPage {
  constructor() {
    // 儲存事件監聽器供 destroy() 移除
    this._listeners = []
    // 審核題目清單
    this._reviews = []
  }

  /**
   * 初始化頁面：讀取所有 pending 審核題目並渲染
   */
  async init(params = {}) {
    // 注入頁面樣式（防重複注入）
    this._injectStyles()

    // 先渲染載入中骨架
    const app = document.getElementById('app')
    app.innerHTML = `
      <div class="pr-page">
        <div class="pr-header">
          <button class="pr-back-btn" id="prBackBtn">← 返回</button>
          <h1 class="pr-title">📝 審核作文</h1>
        </div>
        <div class="pr-list" id="prList">
          <div class="pr-loading">載入中…</div>
        </div>
      </div>
    `

    // 綁定返回按鈕
    const backBtn = document.getElementById('prBackBtn')
    const backHandler = () => UIManager.back()
    backBtn.addEventListener('click', backHandler)
    this._listeners.push({ el: backBtn, type: 'click', fn: backHandler })

    // 讀取 pending 審核資料
    await this._loadReviews()
    this._renderList()
  }

  /**
   * 從 Firestore 讀取所有 status='pending' 的審核項目
   */
  async _loadReviews() {
    try {
      const uid = AppState.uid
      if (!uid) {
        this._reviews = []
        return
      }
      // 讀取 users/{uid}/pending_reviews 集合中 status=pending 的文件
      const docs = await FirestoreAPI.queryCollection(
        `users/${uid}/pending_reviews`,
        [{ field: 'status', op: '==', value: 'pending' }],
        { orderBy: 'created_at', direction: 'asc' }
      )
      this._reviews = docs || []
    } catch (e) {
      console.error('[ParentReviewPage] 讀取審核資料失敗', e)
      this._reviews = []
    }
  }

  /**
   * 渲染審核清單到 #prList
   */
  _renderList() {
    const list = document.getElementById('prList')
    if (!list) return

    if (this._reviews.length === 0) {
      list.innerHTML = `
        <div class="pr-empty">
          <div class="pr-empty-icon">🎉</div>
          <div class="pr-empty-text">目前沒有待審核的作業</div>
        </div>
      `
      return
    }

    list.innerHTML = this._reviews.map((r, idx) => `
      <div class="pr-card" id="prCard_${r.id}" data-idx="${idx}">
        <div class="pr-card-meta">
          <span class="pr-char-badge">${r.character || '?'}</span>
          <span class="pr-game-mode">${this._getModeLabel(r.game_mode)}</span>
          <span class="pr-stars-badge">★ ${r.expected_stars || 0}</span>
        </div>

        ${r.game_mode === 3 ? `
          <div class="pr-pattern">
            <span class="pr-label">句型：</span>
            <span class="pr-value">${this._escHtml(r.example_pattern || '')}</span>
          </div>
          <div class="pr-example">
            <span class="pr-label">範例：</span>
            <span class="pr-value">${this._escHtml(r.example_sentence || '')}</span>
          </div>
        ` : `
          <div class="pr-target-char">
            <span class="pr-label">造句用字：</span>
            <span class="pr-value pr-big-char">${this._escHtml(r.character || '')}</span>
          </div>
        `}

        <div class="pr-answer-row">
          <span class="pr-label">學生答案：</span>
          <span class="pr-answer-text">${this._escHtml(r.student_answer || '')}</span>
        </div>

        <div class="pr-ai-row">
          <span class="pr-label">AI 評分：</span>
          <span class="pr-ai-score ${r.ai_score >= 0.8 ? 'pr-score-high' : 'pr-score-low'}">
            ${r.ai_score >= 0 ? Math.round(r.ai_score * 100) + '分' : '未評'}
          </span>
          ${r.ai_reason ? `<span class="pr-ai-reason">（${this._escHtml(r.ai_reason)}）</span>` : ''}
        </div>

        <!-- 修改後通過：展開區域 -->
        <div class="pr-edit-area" id="prEdit_${r.id}" style="display:none">
          <textarea class="pr-textarea" id="prTextarea_${r.id}" 
            placeholder="輸入修改後的正確答案…">${this._escHtml(r.student_answer || '')}</textarea>
        </div>

        <div class="pr-actions">
          <button class="pr-btn pr-btn-approve" data-id="${r.id}" data-idx="${idx}">✅ 通過</button>
          <button class="pr-btn pr-btn-edit" data-id="${r.id}" data-idx="${idx}">✏️ 修改後通過</button>
          <button class="pr-btn pr-btn-reject" data-id="${r.id}" data-idx="${idx}">❌ 不通過</button>
        </div>

        <!-- 修改後通過：確認按鈕（初始隱藏） -->
        <div class="pr-edit-confirm" id="prEditConfirm_${r.id}" style="display:none">
          <button class="pr-btn pr-btn-approve-edit" data-id="${r.id}" data-idx="${idx}">
            ✅ 確認修改後通過
          </button>
          <button class="pr-btn pr-btn-cancel-edit" data-id="${r.id}" data-idx="${idx}">
            取消
          </button>
        </div>
      </div>
    `).join('')

    // 綁定所有按鈕事件（event delegation）
    // 先移除舊的 clickHandler，避免 _renderList 多次呼叫時重複堆疊
    const listEl = document.getElementById('prList')
    if (this._listClickHandler) {
      listEl.removeEventListener('click', this._listClickHandler)
      // 從 _listeners 中也一併移除舊紀錄
      this._listeners = this._listeners.filter(
        l => !(l.el === listEl && l.type === 'click' && l.fn === this._listClickHandler)
      )
    }
    this._listClickHandler = (e) => {
      const btn = e.target.closest('button[data-id]')
      if (!btn) return
      const id = btn.dataset.id
      const idx = parseInt(btn.dataset.idx, 10)

      if (btn.classList.contains('pr-btn-approve')) {
        this.approve(id, idx)
      } else if (btn.classList.contains('pr-btn-reject')) {
        this.reject(id, idx)
      } else if (btn.classList.contains('pr-btn-edit')) {
        this._toggleEditArea(id)
      } else if (btn.classList.contains('pr-btn-approve-edit')) {
        const textarea = document.getElementById(`prTextarea_${id}`)
        const corrected = textarea ? textarea.value.trim() : ''
        this.approveWithCorrection(id, idx, corrected)
      } else if (btn.classList.contains('pr-btn-cancel-edit')) {
        this._toggleEditArea(id, false)
      }
    }
    listEl.addEventListener('click', this._listClickHandler)
    this._listeners.push({ el: listEl, type: 'click', fn: this._listClickHandler })
  }

  /**
   * 展開/收起修改文字區域
   * @param {string} id - 審核項目 ID
   * @param {boolean|undefined} force - 強制設定狀態
   */
  _toggleEditArea(id, force) {
    const editArea = document.getElementById(`prEdit_${id}`)
    const editConfirm = document.getElementById(`prEditConfirm_${id}`)
    if (!editArea || !editConfirm) return

    const isVisible = editArea.style.display !== 'none'
    const show = force !== undefined ? force : !isVisible

    editArea.style.display = show ? 'block' : 'none'
    editConfirm.style.display = show ? 'flex' : 'none'
  }

  /**
   * ✅ 通過審核
   * - 更新 Firestore status='approved'
   * - StarsManager.add(expected_stars)
   * - ForgettingCurve.recordResult(char, true)
   * - AppState.pendingReviewCount--
   *
   * @param {string} reviewId - Firestore 文件 ID
   * @param {number} idx - 本地陣列索引
   */
  async approve(reviewId, idx) {
    const review = this._reviews[idx]
    if (!review) return

    // 禁用該卡片按鈕，防止重複點擊
    this._disableCard(reviewId)

    try {
      const uid = AppState.uid
      // 更新 Firestore status → approved，記錄處理時間
      await FirestoreAPI.updateDoc(`users/${uid}/pending_reviews/${reviewId}`, {
        status: 'approved',
        resolved_at: FirestoreAPI.serverTimestamp()
      })

      // 發送星星
      if (review.expected_stars > 0) {
        await StarsManager.add(review.expected_stars)
      }

      // 遺忘曲線記錄為正確
      if (review.character) {
        await ForgettingCurve.recordResult(
          review.character,
          true,
          review.pronunciation || null
        )
      }

      // 更新本地計數
      this._decrementPendingCount()

      // 從清單移除並重新渲染
      this._reviews.splice(idx, 1)
      this._renderList()

      UIManager.showToast(`✅ 已通過，發送 ★${review.expected_stars}`, 'success', 2000)
    } catch (e) {
      console.error('[ParentReviewPage] approve 失敗', e)
      UIManager.showToast('操作失敗，請再試', 'error', 2000)
      this._enableCard(reviewId)
    }
  }

  /**
   * ✏️ 修改後通過
   * - 儲存 corrected_answer
   * - 其餘邏輯與 approve 相同
   *
   * @param {string} reviewId - Firestore 文件 ID
   * @param {number} idx - 本地陣列索引
   * @param {string} correctedAnswer - 修改後的正確答案
   */
  async approveWithCorrection(reviewId, idx, correctedAnswer) {
    const review = this._reviews[idx]
    if (!review) return

    // 驗證修改內容不可為空
    if (!correctedAnswer) {
      UIManager.showToast('請輸入修改後的答案', 'error', 1500)
      return
    }

    this._disableCard(reviewId)

    try {
      const uid = AppState.uid
      // 更新 Firestore：status=approved + 修改後的答案
      await FirestoreAPI.updateDoc(`users/${uid}/pending_reviews/${reviewId}`, {
        status: 'approved',
        corrected_answer: correctedAnswer,
        resolved_at: FirestoreAPI.serverTimestamp()
      })

      // 發送星星
      if (review.expected_stars > 0) {
        await StarsManager.add(review.expected_stars)
      }

      // 遺忘曲線記錄為正確
      if (review.character) {
        await ForgettingCurve.recordResult(
          review.character,
          true,
          review.pronunciation || null
        )
      }

      // 更新本地計數
      this._decrementPendingCount()

      // 從清單移除並重新渲染
      this._reviews.splice(idx, 1)
      this._renderList()

      UIManager.showToast(`✏️ 修改後通過，發送 ★${review.expected_stars}`, 'success', 2000)
    } catch (e) {
      console.error('[ParentReviewPage] approveWithCorrection 失敗', e)
      UIManager.showToast('操作失敗，請再試', 'error', 2000)
      this._enableCard(reviewId)
    }
  }

  /**
   * ❌ 不通過審核
   * - 更新 Firestore status='rejected'
   * - ForgettingCurve.recordResult(char, false)
   * - WrongQueue.add(char)
   * - AppState.pendingReviewCount--
   *
   * @param {string} reviewId - Firestore 文件 ID
   * @param {number} idx - 本地陣列索引
   */
  async reject(reviewId, idx) {
    const review = this._reviews[idx]
    if (!review) return

    this._disableCard(reviewId)

    try {
      const uid = AppState.uid
      // 更新 Firestore status → rejected
      await FirestoreAPI.updateDoc(`users/${uid}/pending_reviews/${reviewId}`, {
        status: 'rejected',
        resolved_at: FirestoreAPI.serverTimestamp()
      })

      // 遺忘曲線記錄為錯誤
      if (review.character) {
        await ForgettingCurve.recordResult(
          review.character,
          false,
          review.pronunciation || null
        )
        // 加入錯題優先池
        await WrongQueue.add(review.character)
      }

      // 更新本地計數
      this._decrementPendingCount()

      // 從清單移除並重新渲染
      this._reviews.splice(idx, 1)
      this._renderList()

      UIManager.showToast('❌ 已不通過', 'info', 2000)
    } catch (e) {
      console.error('[ParentReviewPage] reject 失敗', e)
      UIManager.showToast('操作失敗，請再試', 'error', 2000)
      this._enableCard(reviewId)
    }
  }

  /**
   * 遞減 AppState.pendingReviewCount 並通知 UIManager 更新 badge
   */
  _decrementPendingCount() {
    const current = AppState.pendingReviewCount || 0
    if (current > 0) {
      AppState.pendingReviewCount = current - 1
      UIManager.updatePendingReviews(AppState.pendingReviewCount)
    }
  }

  /**
   * 禁用卡片所有按鈕（操作中防重複點擊）
   * @param {string} id
   */
  _disableCard(id) {
    const card = document.getElementById(`prCard_${id}`)
    if (!card) return
    card.querySelectorAll('button').forEach(btn => {
      btn.disabled = true
      btn.style.opacity = '0.5'
    })
  }

  /**
   * 重新啟用卡片按鈕（操作失敗時復原）
   * @param {string} id
   */
  _enableCard(id) {
    const card = document.getElementById(`prCard_${id}`)
    if (!card) return
    card.querySelectorAll('button').forEach(btn => {
      btn.disabled = false
      btn.style.opacity = ''
    })
  }

  /**
   * 取得遊戲模式的中文標籤
   * @param {number} mode - 遊戲模式（3=照樣造句、4=自由造句）
   * @returns {string}
   */
  _getModeLabel(mode) {
    switch (mode) {
      case 3: return '照樣造句'
      case 4: return '自由造句'
      default: return '造句'
    }
  }

  /**
   * HTML 跳脫，防止 XSS
   * @param {string} str
   * @returns {string}
   */
  _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /**
   * 注入頁面 CSS（防重複注入）
   */
  _injectStyles() {
    if (document.getElementById('pr-page-style')) return
    const style = document.createElement('style')
    style.id = 'pr-page-style'
    style.textContent = `
      .pr-page {
        min-height: 100vh;
        background: #f5f0ff;
        padding-bottom: 2rem;
      }
      .pr-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.2rem;
        background: #7c3aed;
        color: #fff;
        position: sticky;
        top: 0;
        z-index: 10;
        box-shadow: 0 2px 8px rgba(124,58,237,0.3);
      }
      .pr-back-btn {
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        padding: 0.4rem 0.8rem;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.9rem;
        flex-shrink: 0;
      }
      .pr-back-btn:hover { background: rgba(255,255,255,0.35); }
      .pr-title {
        margin: 0;
        font-size: 1.2rem;
        font-weight: 700;
      }
      .pr-list {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 640px;
        margin: 0 auto;
      }
      .pr-loading {
        text-align: center;
        color: #888;
        padding: 3rem 0;
        font-size: 1rem;
      }
      .pr-empty {
        text-align: center;
        padding: 4rem 0;
      }
      .pr-empty-icon { font-size: 3rem; margin-bottom: 0.8rem; }
      .pr-empty-text { color: #666; font-size: 1rem; }
      .pr-card {
        background: #fff;
        border-radius: 16px;
        padding: 1.2rem;
        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      }
      .pr-card-meta {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-bottom: 0.8rem;
        flex-wrap: wrap;
      }
      .pr-char-badge {
        background: #7c3aed;
        color: #fff;
        font-size: 1.4rem;
        font-weight: 700;
        width: 2.2rem;
        height: 2.2rem;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .pr-game-mode {
        background: #ede9fe;
        color: #5b21b6;
        font-size: 0.8rem;
        padding: 0.2rem 0.6rem;
        border-radius: 20px;
      }
      .pr-stars-badge {
        background: #fef9c3;
        color: #92400e;
        font-size: 0.85rem;
        padding: 0.2rem 0.6rem;
        border-radius: 20px;
        margin-left: auto;
      }
      .pr-pattern, .pr-example, .pr-target-char, .pr-answer-row, .pr-ai-row {
        margin-bottom: 0.5rem;
        font-size: 0.95rem;
        line-height: 1.5;
      }
      .pr-label {
        color: #888;
        font-size: 0.85rem;
      }
      .pr-value { color: #333; }
      .pr-big-char {
        font-size: 1.6rem;
        font-weight: 700;
        color: #7c3aed;
      }
      .pr-answer-text {
        color: #1a1a1a;
        font-weight: 500;
        font-size: 1rem;
      }
      .pr-ai-score {
        font-weight: 700;
        font-size: 0.9rem;
        padding: 0.1rem 0.5rem;
        border-radius: 4px;
      }
      .pr-score-high { background: #dcfce7; color: #166534; }
      .pr-score-low  { background: #fee2e2; color: #991b1b; }
      .pr-ai-reason  { color: #666; font-size: 0.82rem; }
      .pr-edit-area  { margin: 0.6rem 0; }
      .pr-textarea {
        width: 100%;
        min-height: 3.5rem;
        border: 1.5px solid #c4b5fd;
        border-radius: 8px;
        padding: 0.5rem 0.7rem;
        font-size: 0.95rem;
        resize: vertical;
        box-sizing: border-box;
        font-family: inherit;
      }
      .pr-textarea:focus { outline: none; border-color: #7c3aed; }
      .pr-actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.8rem;
        flex-wrap: wrap;
      }
      .pr-edit-confirm {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      .pr-btn {
        border: none;
        border-radius: 10px;
        padding: 0.5rem 0.9rem;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.1s, opacity 0.2s;
        flex: 1;
      }
      .pr-btn:active { transform: scale(0.96); }
      .pr-btn:disabled { cursor: default; }
      .pr-btn-approve         { background: #dcfce7; color: #166534; }
      .pr-btn-approve:hover   { background: #bbf7d0; }
      .pr-btn-edit            { background: #fef9c3; color: #92400e; }
      .pr-btn-edit:hover      { background: #fef08a; }
      .pr-btn-reject          { background: #fee2e2; color: #991b1b; }
      .pr-btn-reject:hover    { background: #fecaca; }
      .pr-btn-approve-edit    { background: #a7f3d0; color: #064e3b; }
      .pr-btn-approve-edit:hover { background: #6ee7b7; }
      .pr-btn-cancel-edit     { background: #f3f4f6; color: #374151; flex: 0 0 auto; }
      .pr-btn-cancel-edit:hover { background: #e5e7eb; }
    `
    document.head.appendChild(style)
  }

  /**
   * 銷毀頁面：移除所有事件監聽，防止 memory leak
   */
  destroy() {
    this._listeners.forEach(({ el, type, fn }) => {
      el.removeEventListener(type, fn)
    })
    this._listeners = []
    this._reviews = []
    this._listClickHandler = null
  }
}
