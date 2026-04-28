/**
 * ParentReviewPage.js ??å®¶é•·å¯©æ ¸?é¢ï¼ˆTask 43ï¼? * ä½ç½®ï¼šjs/pages/ParentReviewPage.js
 * å±¤ç?ï¼šç¬¬?«å±¤?é¢
 * ä¾è³´ï¼šfirebase.jsï¼ˆT05ï¼‰ã€stars.jsï¼ˆT10ï¼‰ã€forgetting.jsï¼ˆT09ï¼‰ã€wrong_queue.jsï¼ˆT11ï¼‰ã€? *       state.jsï¼ˆT02ï¼‰ã€ui_manager.jsï¼ˆT28ï¼? *
 * ?Ÿèƒ½ï¼? *   - é¡¯ç¤º?€??status='pending' ?„çŸ­?¥é€ è?å¯©æ ¸é¡Œç›®
 *   - å®¶é•·?¯åŸ·è¡Œï??…é€šé??â?ä¸é€šé??â?ï¸ä¿®?¹å??šé?
 *   - å¯©æ ¸å¾Œå?æ­?AppState.pendingReviewCount
 */

import { AppState } from '../state.js'
import { FirestoreAPI } from '../firebase.js'
import { StarsManager } from '../stars.js'
import { ForgettingCurve } from '../forgetting.js'
import { WrongQueue } from '../wrong_queue.js'
import { UIManager } from '../ui/ui_manager.js'

export class ParentReviewPage {
  constructor() {
    // ?²å?äº‹ä»¶??½?¨ä? destroy() ç§»é™¤
    this._listeners = []
    // å¯©æ ¸é¡Œç›®æ¸…å–®
    this._reviews = []
  }

  /**
   * ?å??–é??¢ï?è®€?–æ???pending å¯©æ ¸é¡Œç›®ä¸¦æ¸²??   */
  async init(params = {}) {
    // æ³¨å…¥?é¢æ¨??ï¼ˆé˜²?è?æ³¨å…¥ï¼?    this._injectStyles()

    // ?ˆæ¸²?“è??¥ä¸­éª¨æ¶
    const app = document.getElementById('app')
    app.innerHTML = `
      <div class="pr-page">
        <div class="pr-header">
          <button class="pr-back-btn" id="prBackBtn">??è¿”å?</button>
          <h1 class="pr-title">?? å¯©æ ¸ä½œæ?</h1>
        </div>
        <div class="pr-list" id="prList">
          <div class="pr-loading">è¼‰å…¥ä¸­â€?/div>
        </div>
      </div>
    `

    // ç¶å?è¿”å??‰é?
    const backBtn = document.getElementById('prBackBtn')
    const backHandler = () => UIManager.back()
    backBtn.addEventListener('click', backHandler)
    this._listeners.push({ el: backBtn, type: 'click', fn: backHandler })

    // è®€??pending å¯©æ ¸è³‡æ?
    await this._loadReviews()
    this._renderList()
  }

  /**
   * å¾?Firestore è®€?–æ???status='pending' ?„å¯©?¸é???   */
  async _loadReviews() {
    try {
      const uid = AppState.uid
      if (!uid) {
        this._reviews = []
        return
      }
      // è®€??users/{uid}/pending_reviews ?†å?ä¸?status=pending ?„æ?ä»?      const allDocs = await FirestoreAPI.readCollection(`users/${uid}/pending_reviews`)
      const docs = (allDocs || []).filter(d => d.status === 'pending').sort((a,b) => { const ta = a.created_at?.seconds ?? 0; const tb = b.created_at?.seconds ?? 0; return ta - tb })
      this._reviews = docs || []
    } catch (e) {
      console.error('[ParentReviewPage] è®€?–å¯©?¸è??™å¤±??, e)
      this._reviews = []
    }
  }

  /**
   * æ¸²æ?å¯©æ ¸æ¸…å–®??#prList
   */
  _renderList() {
    const list = document.getElementById('prList')
    if (!list) return

    if (this._reviews.length === 0) {
      list.innerHTML = `
        <div class="pr-empty">
          <div class="pr-empty-icon">??</div>
          <div class="pr-empty-text">?®å?æ²’æ?å¾…å¯©?¸ç?ä½œæ¥­</div>
        </div>
      `
      return
    }

    list.innerHTML = this._reviews.map((r, idx) => `
      <div class="pr-card" id="prCard_${r.id}" data-idx="${idx}">
        <div class="pr-card-meta">
          <span class="pr-char-badge">${r.character || '?'}</span>
          <span class="pr-game-mode">${this._getModeLabel(r.game_mode)}</span>
          <span class="pr-stars-badge">??${r.expected_stars || 0}</span>
        </div>

        ${r.game_mode === 3 ? `
          <div class="pr-pattern">
            <span class="pr-label">?¥å?ï¼?/span>
            <span class="pr-value">${this._escHtml(r.example_pattern || '')}</span>
          </div>
          <div class="pr-example">
            <span class="pr-label">ç¯„ä?ï¼?/span>
            <span class="pr-value">${this._escHtml(r.example_sentence || '')}</span>
          </div>
        ` : `
          <div class="pr-target-char">
            <span class="pr-label">? å¥?¨å?ï¼?/span>
            <span class="pr-value pr-big-char">${this._escHtml(r.character || '')}</span>
          </div>
        `}

        <div class="pr-answer-row">
          <span class="pr-label">å­¸ç?ç­”æ?ï¼?/span>
          <span class="pr-answer-text">${this._escHtml(r.student_answer || '')}</span>
        </div>

        <div class="pr-ai-row">
          <span class="pr-label">AI è©•å?ï¼?/span>
          <span class="pr-ai-score ${r.ai_score >= 0.8 ? 'pr-score-high' : 'pr-score-low'}">
            ${r.ai_score >= 0 ? Math.round(r.ai_score * 100) + '?? : '?ªè?'}
          </span>
          ${r.ai_reason ? `<span class="pr-ai-reason">ï¼?{this._escHtml(r.ai_reason)}ï¼?/span>` : ''}
        </div>

        <!-- ä¿®æ”¹å¾Œé€šé?ï¼šå??‹å???-->
        <div class="pr-edit-area" id="prEdit_${r.id}" style="display:none">
          <textarea class="pr-textarea" id="prTextarea_${r.id}" 
            placeholder="è¼¸å…¥ä¿®æ”¹å¾Œç?æ­?¢ºç­”æ???>${this._escHtml(r.student_answer || '')}</textarea>
        </div>

        <div class="pr-actions">
          <button class="pr-btn pr-btn-approve" data-id="${r.id}" data-idx="${idx}">???šé?</button>
          <button class="pr-btn pr-btn-edit" data-id="${r.id}" data-idx="${idx}">?ï? ä¿®æ”¹å¾Œé€šé?</button>
          <button class="pr-btn pr-btn-reject" data-id="${r.id}" data-idx="${idx}">??ä¸é€šé?</button>
        </div>

        <!-- ä¿®æ”¹å¾Œé€šé?ï¼šç¢ºèªæ??•ï??å??±è?ï¼?-->
        <div class="pr-edit-confirm" id="prEditConfirm_${r.id}" style="display:none">
          <button class="pr-btn pr-btn-approve-edit" data-id="${r.id}" data-idx="${idx}">
            ??ç¢ºè?ä¿®æ”¹å¾Œé€šé?
          </button>
          <button class="pr-btn pr-btn-cancel-edit" data-id="${r.id}" data-idx="${idx}">
            ?–æ?
          </button>
        </div>
      </div>
    `).join('')

    // ç¶å??€?‰æ??•ä?ä»¶ï?event delegationï¼?    // ?ˆç§»?¤è???clickHandlerï¼Œé¿??_renderList å¤šæ¬¡?¼å«?‚é?è¤‡å???    const listEl = document.getElementById('prList')
    if (this._listClickHandler) {
      listEl.removeEventListener('click', this._listClickHandler)
      // å¾?_listeners ä¸­ä?ä¸€ä½µç§»?¤è?ç´€??      this._listeners = this._listeners.filter(
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
   * å±•é?/?¶èµ·ä¿®æ”¹?‡å??€??   * @param {string} id - å¯©æ ¸?…ç›® ID
   * @param {boolean|undefined} force - å¼·åˆ¶è¨­å??€??   */
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
   * ???šé?å¯©æ ¸
   * - ?´æ–° Firestore status='approved'
   * - StarsManager.add(expected_stars)
   * - ForgettingCurve.recordResult(char, true)
   * - AppState.pendingReviewCount--
   *
   * @param {string} reviewId - Firestore ?‡ä»¶ ID
   * @param {number} idx - ?¬åœ°???ç´¢å?
   */
  async approve(reviewId, idx) {
    const review = this._reviews[idx]
    if (!review) return

    // ç¦ç”¨è©²å¡?‡æ??•ï??²æ­¢?è?é»æ?
    this._disableCard(reviewId)

    try {
      const uid = AppState.uid
      // ?´æ–° Firestore status ??approvedï¼Œè??„è??†æ???      await FirestoreAPI.updateDoc(`users/${uid}/pending_reviews/${reviewId}`, {
        status: 'approved',
        resolved_at: FirestoreAPI.serverTimestamp()
      })

      // ?¼é€æ???      if (review.expected_stars > 0) {
        await StarsManager.add(review.expected_stars)
      }

      // ?ºå??²ç?è¨˜é??ºæ­£ç¢?      if (review.character) {
        await ForgettingCurve.recordResult(
          review.character,
          true,
          review.pronunciation || null
        )
      }

      // ?´æ–°?¬åœ°è¨ˆæ•¸
      this._decrementPendingCount()

      // å¾æ??®ç§»?¤ä¸¦?æ–°æ¸²æ?
      this._reviews.splice(idx, 1)
      this._renderList()

      UIManager.showToast(`??å·²é€šé?ï¼Œç™¼????{review.expected_stars}`, 'success', 2000)
    } catch (e) {
      console.error('[ParentReviewPage] approve å¤±æ?', e)
      UIManager.showToast('?ä?å¤±æ?ï¼Œè??è©¦', 'error', 2000)
      this._enableCard(reviewId)
    }
  }

  /**
   * ?ï? ä¿®æ”¹å¾Œé€šé?
   * - ?²å? corrected_answer
   * - ?¶é??è¼¯??approve ?¸å?
   *
   * @param {string} reviewId - Firestore ?‡ä»¶ ID
   * @param {number} idx - ?¬åœ°???ç´¢å?
   * @param {string} correctedAnswer - ä¿®æ”¹å¾Œç?æ­?¢ºç­”æ?
   */
  async approveWithCorrection(reviewId, idx, correctedAnswer) {
    const review = this._reviews[idx]
    if (!review) return

    // é©—è?ä¿®æ”¹?§å®¹ä¸å¯?ºç©º
    if (!correctedAnswer) {
      UIManager.showToast('è«‹è¼¸?¥ä¿®?¹å??„ç?æ¡?, 'error', 1500)
      return
    }

    this._disableCard(reviewId)

    try {
      const uid = AppState.uid
      // ?´æ–° Firestoreï¼šstatus=approved + ä¿®æ”¹å¾Œç?ç­”æ?
      await FirestoreAPI.updateDoc(`users/${uid}/pending_reviews/${reviewId}`, {
        status: 'approved',
        corrected_answer: correctedAnswer,
        resolved_at: FirestoreAPI.serverTimestamp()
      })

      // ?¼é€æ???      if (review.expected_stars > 0) {
        await StarsManager.add(review.expected_stars)
      }

      // ?ºå??²ç?è¨˜é??ºæ­£ç¢?      if (review.character) {
        await ForgettingCurve.recordResult(
          review.character,
          true,
          review.pronunciation || null
        )
      }

      // ?´æ–°?¬åœ°è¨ˆæ•¸
      this._decrementPendingCount()

      // å¾æ??®ç§»?¤ä¸¦?æ–°æ¸²æ?
      this._reviews.splice(idx, 1)
      this._renderList()

      UIManager.showToast(`?ï? ä¿®æ”¹å¾Œé€šé?ï¼Œç™¼????{review.expected_stars}`, 'success', 2000)
    } catch (e) {
      console.error('[ParentReviewPage] approveWithCorrection å¤±æ?', e)
      UIManager.showToast('?ä?å¤±æ?ï¼Œè??è©¦', 'error', 2000)
      this._enableCard(reviewId)
    }
  }

  /**
   * ??ä¸é€šé?å¯©æ ¸
   * - ?´æ–° Firestore status='rejected'
   * - ForgettingCurve.recordResult(char, false)
   * - WrongQueue.add(char)
   * - AppState.pendingReviewCount--
   *
   * @param {string} reviewId - Firestore ?‡ä»¶ ID
   * @param {number} idx - ?¬åœ°???ç´¢å?
   */
  async reject(reviewId, idx) {
    const review = this._reviews[idx]
    if (!review) return

    this._disableCard(reviewId)

    try {
      const uid = AppState.uid
      // ?´æ–° Firestore status ??rejected
      await FirestoreAPI.updateDoc(`users/${uid}/pending_reviews/${reviewId}`, {
        status: 'rejected',
        resolved_at: FirestoreAPI.serverTimestamp()
      })

      // ?ºå??²ç?è¨˜é??ºéŒ¯èª?      if (review.character) {
        await ForgettingCurve.recordResult(
          review.character,
          false,
          review.pronunciation || null
        )
        // ? å…¥?¯é??ªå?æ±?        await WrongQueue.add(review.character)
      }

      // ?´æ–°?¬åœ°è¨ˆæ•¸
      this._decrementPendingCount()

      // å¾æ??®ç§»?¤ä¸¦?æ–°æ¸²æ?
      this._reviews.splice(idx, 1)
      this._renderList()

      UIManager.showToast('??å·²ä??šé?', 'info', 2000)
    } catch (e) {
      console.error('[ParentReviewPage] reject å¤±æ?', e)
      UIManager.showToast('?ä?å¤±æ?ï¼Œè??è©¦', 'error', 2000)
      this._enableCard(reviewId)
    }
  }

  /**
   * ?æ? AppState.pendingReviewCount ä¸¦é€šçŸ¥ UIManager ?´æ–° badge
   */
  _decrementPendingCount() {
    const current = AppState.pendingReviewCount || 0
    if (current > 0) {
      AppState.pendingReviewCount = current - 1
      UIManager.updatePendingReviews(AppState.pendingReviewCount)
    }
  }

  /**
   * ç¦ç”¨?¡ç??€?‰æ??•ï??ä?ä¸­é˜²?è?é»æ?ï¼?   * @param {string} id
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
   * ?æ–°?Ÿç”¨?¡ç??‰é?ï¼ˆæ?ä½œå¤±?—æ?å¾©å?ï¼?   * @param {string} id
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
   * ?–å??Šæˆ²æ¨¡å??„ä¸­?‡æ?ç±?   * @param {number} mode - ?Šæˆ²æ¨¡å?ï¼?=?§æ¨£? å¥??=?ªç”±? å¥ï¼?   * @returns {string}
   */
  _getModeLabel(mode) {
    switch (mode) {
      case 3: return '?§æ¨£? å¥'
      case 4: return '?ªç”±? å¥'
      default: return '? å¥'
    }
  }

  /**
   * HTML è·³è„«ï¼Œé˜²æ­?XSS
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
   * æ³¨å…¥?é¢ CSSï¼ˆé˜²?è?æ³¨å…¥ï¼?   */
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
   * ?·æ??é¢ï¼šç§»?¤æ??‰ä?ä»¶ç›£?½ï??²æ­¢ memory leak
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
