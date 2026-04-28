/**
 * ParentCharsPage.js ??ÂÆ∂Èï∑?üÂ?Á∞øÁÆ°?ÜÈ??? * Task 42 / Âø´Ê?Â≠∏Á? Happy Learning
 * ‰ΩçÁΩÆÔºöjs/pages/ParentCharsPage.js
 *
 * ‰æùË≥¥Ôº? *   firebase.jsÔºàT05Ôº???FirestoreAPI?ÅarrayUnion?ÅarrayRemove
 *   state.jsÔºàT02Ôº?   ??AppState
 *   ui_manager.jsÔºàT28Ôºâ‚Ä?UIManager?ÅPAGES
 */

import { AppState } from '../state.js'
import { FirestoreAPI } from '../firebase.js'
import { arrayUnion, arrayRemove } from '../firebase.js'
import { UIManager } from '../ui/ui_manager.js'
import { PAGES } from '../ui/pages.js'

export class ParentCharsPage {
  constructor() {
    // ‰∫ã‰ª∂??ÅΩ?®Â??ßÔ?destroy ?ÇÁßª?§Áî®Ôº?    this._onAddClick    = null
    this._onInputKeyup  = null
    this._onDeleteClick = null
    this._onBackClick   = null
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // initÔºöË???my_charactersÔºåÊ∏≤?ìÊ???  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  async init(params = {}) {
    const app = document.getElementById('app')
    if (!app) return

    // Ê≥®ÂÖ• CSSÔºàÂ?Á¨¨‰?Ê¨°Ô?
    this._injectCSS()

    // ?ùÂ? HTML È™®Êû∂
    app.innerHTML = `
      <div class="pcp-root">

        <!-- ?ÇÈÉ®Â∞éË¶Ω??-->
        <header class="pcp-header">
          <button class="pcp-back-btn" id="pcpBack">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h1 class="pcp-title">?? ?üÂ?Á∞øÁÆ°??/h1>
          <div class="pcp-header-space"></div>
        </header>

        <!-- ?∞Â??üÂ??Ä -->
        <section class="pcp-add-section">
          <div class="pcp-input-row">
            <input
              id="pcpInput"
              class="pcp-input"
              type="text"
              maxlength="1"
              placeholder="Ëº∏ÂÖ•‰∏Ä?ãÊº¢Â≠?
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
            />
            <button id="pcpAddBtn" class="pcp-add-btn">
              ?∞Â?
            </button>
          </div>
          <p id="pcpError" class="pcp-error" aria-live="polite"></p>
        </section>

        <!-- ?üÂ?Áµ±Ë? -->
        <div class="pcp-stats" id="pcpStats">
          <span id="pcpCount">??0 ?ãÁ?Â≠?/span>
        </div>

        <!-- ?üÂ?Ê∏ÖÂñÆ -->
        <section class="pcp-list-section">
          <div id="pcpLoading" class="pcp-loading">
            <span class="pcp-spinner"></span>
            <span>ËºâÂÖ•‰∏≠‚Ä?/span>
          </div>
          <div id="pcpEmpty" class="pcp-empty" style="display:none">
            <div class="pcp-empty-icon">??</div>
            <p>Â∞öÊú™?†ÂÖ•‰ªª‰??üÂ?</p>
            <p class="pcp-empty-hint">?®‰??πËº∏?•Ê??∞Â?Á¨¨‰??ãÁ?Â≠óÂêßÔº?/p>
          </div>
          <ul id="pcpList" class="pcp-list" role="list"></ul>
        </section>

      </div>
    `

    // Á∂ÅÂ?‰∫ã‰ª∂
    this._bindEvents()

    // ËÆÄ?ñ‰∏¶Ê∏≤Ê??æÊ??üÂ?
    await this._loadAndRender()
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // ‰∫ã‰ª∂Á∂ÅÂ?
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  _bindEvents() {
    // ËøîÂ??âÈ?
    const backBtn = document.getElementById('pcpBack')
    this._onBackClick = () => UIManager.back()
    backBtn?.addEventListener('click', this._onBackClick)

    // ?∞Â??âÈ?
    const addBtn = document.getElementById('pcpAddBtn')
    this._onAddClick = () => this._handleAdd()
    addBtn?.addEventListener('click', this._onAddClick)

    // Ëº∏ÂÖ•Ê°?Enter ?µËß∏?ºÊñ∞Â¢?    const input = document.getElementById('pcpInput')
    this._onInputKeyup = (e) => {
      if (e.key === 'Enter') this._handleAdd()
    }
    input?.addEventListener('keyup', this._onInputKeyup)

    // Ê∏ÖÂñÆÈªûÊ?Ôºà‰?‰ª∂‰ª£?ÜÔ??™Èô§?âÈ?Ôº?    const list = document.getElementById('pcpList')
    this._onDeleteClick = (e) => {
      const btn = e.target.closest('[data-delete-char]')
      if (!btn) return
      const char = btn.getAttribute('data-delete-char')
      if (char) this._handleDelete(char)
    }
    list?.addEventListener('click', this._onDeleteClick)
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // ËÆÄ??Firestore ??AppState ??Ê∏≤Ê?Ê∏ÖÂñÆ
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  async _loadAndRender() {
    try {
      const uid = AppState.uid
      if (!uid) {
        this._showError('Ë´ãÂ??ªÂÖ•')
        return
      }

      // Âæ?Firestore ËÆÄ??my_charactersÔºàÈô£?óÔ?ÊØèÈ???{ Â≠? zhuyin, ... }Ôº?      const data = await FirestoreAPI.read(`users/${uid}`)
      const chars = data?.my_characters || []

      // ?åÊ≠•??AppStateÔºàÁ¢∫‰øùÊú¨?∞Á??ãÊ??∞Ô?
      AppState.characters = chars

      this._renderList(chars)
    } catch (err) {
      console.error('[ParentCharsPage] ËÆÄ?ñÁ?Â≠óÂ§±??, err)
      this._showError('ËÆÄ?ñÂ§±?óÔ?Ë´ãÁ?ÂæåÂ?Ë©?)
    } finally {
      // ?±Ë?ËºâÂÖ•‰∏?      const loading = document.getElementById('pcpLoading')
      if (loading) loading.style.display = 'none'
    }
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // Ê∏≤Ê??üÂ?Ê∏ÖÂñÆ
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  _renderList(chars) {
    const list   = document.getElementById('pcpList')
    const empty  = document.getElementById('pcpEmpty')
    const count  = document.getElementById('pcpCount')

    if (!list) return

    // ?¥Êñ∞Áµ±Ë?
    if (count) count.textContent = `??${chars.length} ?ãÁ?Â≠ó`

    if (chars.length === 0) {
      list.innerHTML = ''
      if (empty) empty.style.display = 'flex'
      return
    }

    if (empty) empty.style.display = 'none'

    // Ê∏≤Ê?Ê∏ÖÂñÆ?ÖÁõÆ
    list.innerHTML = chars.map((item, idx) => {
      // my_characters ?ÑÂ?Á¥†ÂèØ?ΩÊòØ?©‰ª∂ { Â≠? zhuyin } ?ñÁ?Â≠ó‰∏≤
      const char   = (typeof item === 'object') ? (item['Â≠?] || item.char || '') : String(item)
      const zhuyin = (typeof item === 'object') ? (item.zhuyin || item['Ê≥®Èü≥'] || '') : ''
      const safeChar   = this._escapeHTML(char)
      const safeZhuyin = this._escapeHTML(zhuyin)

      return `
        <li class="pcp-item" data-char="${safeChar}" style="animation-delay:${idx * 30}ms">
          <div class="pcp-item-char">
            <span class="pcp-char-display">${safeChar}</span>
            ${zhuyin ? `<span class="pcp-char-zhuyin">${safeZhuyin}</span>` : ''}
          </div>
          <button
            class="pcp-delete-btn"
            data-delete-char="${safeChar}"
            aria-label="?™Èô§?üÂ?Ôº?{safeChar}"
            title="?™Èô§??{safeChar}??
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </li>
      `
    }).join('')
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // ?∞Â??üÂ?
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  async _handleAdd() {
    const input = document.getElementById('pcpInput')
    const addBtn = document.getElementById('pcpAddBtn')
    if (!input) return

    const raw  = input.value.trim()
    this._clearError()

    // È©óË?ÔºöÂ??àÊòØ‰∏Ä?ãÊº¢Â≠?    if (!raw) {
      this._showError('Ë´ãËº∏?•‰??ãÊº¢Â≠?)
      return
    }
    if (raw.length !== 1) {
      this._showError('?™ËÉΩËº∏ÂÖ•‰∏Ä?ãÊº¢Â≠?)
      return
    }
    if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(raw)) {
      this._showError('Ë´ãËº∏?•‰∏≠?áÊº¢Â≠?)
      return
    }

    // ?≤È?Ë§áÈ???    if (addBtn) {
      addBtn.disabled = true
      addBtn.textContent = '?∞Â?‰∏≠‚Ä?
    }

    try {
      const uid = AppState.uid
      if (!uid) throw new Error('?™Áôª??)

      // Ê™¢Êü•?ØÂê¶Â∑≤Â??®Ô?Âæ?AppState Âø´ÈÄüÂà§?∑Ô?
      const existing = AppState.characters || []
      const alreadyIn = existing.some(item => {
        const c = (typeof item === 'object') ? (item['Â≠?] || item.char || '') : String(item)
        return c === raw
      })

      if (alreadyIn) {
        this._showError(`??{raw}?çÂ∑≤?®Á?Â≠óÁ∞ø‰∏≠`)
        return
      }

      // Âæ?characters.json ?•Ë©¢Ê≥®Èü≥ÔºàÈÄèÈ? AppState.characterMap ?ñÁõ¥?•Êü•?æÔ?
      const charData  = this._findCharData(raw)
      const newEntry  = charData
        ? { Â≠? raw, zhuyin: charData.zhuyin || charData['Ê≥®Èü≥'] || '' }
        : { Â≠? raw, zhuyin: '' }

      // ÂØ´ÂÖ• FirestoreÔºàarrayUnion ?≤È?Ë§áÔ?
      await FirestoreAPI.update(`users/${uid}`, {
        my_characters: arrayUnion(newEntry)
      })

      // ?åÊ≠• AppState
      AppState.characters = [...existing, newEntry]

      // Ê∏ÖÁ©∫Ëº∏ÂÖ•Ê°?      input.value = ''

      // ?çÊñ∞Ê∏≤Ê?Ê∏ÖÂñÆ
      this._renderList(AppState.characters)

      // ?≠Êö´?êÁ§∫
      this._flashSuccess(`??{raw}?çÂ∑≤?∞Â?`)

    } catch (err) {
      console.error('[ParentCharsPage] ?∞Â??üÂ?Â§±Ê?', err)
      this._showError('?∞Â?Â§±Ê?ÔºåË?Á®çÂ??çË©¶')
    } finally {
      if (addBtn) {
        addBtn.disabled  = false
        addBtn.textContent = '?∞Â?'
      }
    }
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // ?™Èô§?üÂ?
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  async _handleDelete(char) {
    try {
      const uid = AppState.uid
      if (!uid) return

      const existing = AppState.characters || []

      // ?æÂà∞ÂÆåÊï¥?©‰ª∂ÔºàarrayRemove ?Ä?≥Áõ∏?åÁâ©‰ª∂Ô?
      const target = existing.find(item => {
        const c = (typeof item === 'object') ? (item['Â≠?] || item.char || '') : String(item)
        return c === char
      })

      if (!target) return

      // ÂæûÊ??ÆÁ??≥Áßª?§Ô?Ê®ÇË??¥Êñ∞ ???´Èù¢?¥Ê??¢Ô?
      const updated = existing.filter(item => {
        const c = (typeof item === 'object') ? (item['Â≠?] || item.char || '') : String(item)
        return c !== char
      })
      AppState.characters = updated
      this._renderList(updated)

      // ÂØ´ÂÖ• Firestore
      await FirestoreAPI.update(`users/${uid}`, {
        my_characters: arrayRemove(target)
      })

    } catch (err) {
      console.error('[ParentCharsPage] ?™Èô§?üÂ?Â§±Ê?', err)
      // ?ûÂæ©ÔºöÈ??∞Ë???      await this._loadAndRender()
    }
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // Â∑•ÂÖ∑ÔºöÂ?Â∑≤Ë??•Á? characters Ë≥áÊ??•ÊâæÊ≥®Èü≥
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  _findCharData(char) {
    // AppState.allCharacters ??characters.json ?®Â?Ë°®Ô?T05 json_loader ?ÉË??•Ô?
    const all = AppState.allCharacters || []
    return all.find(item => (item['Â≠?] || item.char || '') === char) || null
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // ?ØË™§?êÁ§∫
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  _showError(msg) {
    const el = document.getElementById('pcpError')
    if (el) {
      el.textContent = msg
      el.classList.add('pcp-error--visible')
    }
  }

  _clearError() {
    const el = document.getElementById('pcpError')
    if (el) {
      el.textContent = ''
      el.classList.remove('pcp-error--visible')
    }
  }

  // ?∞Â??êÂ??≠Êö´?ÉË?
  _flashSuccess(msg) {
    const statsEl = document.getElementById('pcpStats')
    if (!statsEl) return
    const toast = document.createElement('span')
    toast.className = 'pcp-flash-success'
    toast.textContent = msg
    statsEl.appendChild(toast)
    setTimeout(() => toast.remove(), 1800)
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // HTML Ë∑≥ËÑ´ÔºàÈò≤ XSSÔº?  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  _escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // Ê≥®ÂÖ• CSSÔºàÂê´?ªÈ?Ë§á‰?Ë≠∑Ô?
  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  _injectCSS() {
    if (document.getElementById('pcp-style')) return

    const style = document.createElement('style')
    style.id = 'pcp-style'
    style.textContent = `
      /* ?Ä?Ä?Ä?Ä ParentCharsPage ?¥È?‰ΩàÂ? ?Ä?Ä?Ä?Ä */
      .pcp-root {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: #f7f8fc;
        font-family: 'Noto Sans TC', sans-serif;
        color: #2d3a4a;
      }

      /* ?Ä?Ä?Ä?Ä ?ÇÈÉ®Â∞éË¶Ω???Ä?Ä?Ä?Ä */
      .pcp-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        background: #ffffff;
        border-bottom: 1px solid #e8eaf0;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .pcp-back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: #f0f2f8;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        color: #4a6280;
        flex-shrink: 0;
        transition: background .15s;
      }
      .pcp-back-btn:hover { background: #e4e7f2; }
      .pcp-title {
        font-size: 18px;
        font-weight: 700;
        margin: 0;
        flex: 1;
        letter-spacing: 0.5px;
      }
      .pcp-header-space { width: 36px; }

      /* ?Ä?Ä?Ä?Ä ?∞Â??Ä ?Ä?Ä?Ä?Ä */
      .pcp-add-section {
        background: #ffffff;
        padding: 16px;
        border-bottom: 1px solid #e8eaf0;
      }
      .pcp-input-row {
        display: flex;
        gap: 10px;
      }
      .pcp-input {
        flex: 1;
        height: 44px;
        border: 2px solid #d6dbe8;
        border-radius: 10px;
        padding: 0 14px;
        font-size: 22px;
        text-align: center;
        font-family: 'BpmfIVS', 'Noto Sans TC', serif;
        color: #2d3a4a;
        outline: none;
        transition: border-color .2s;
        max-width: 80px;
      }
      .pcp-input:focus { border-color: #4d8cf5; }
      .pcp-add-btn {
        height: 44px;
        padding: 0 22px;
        background: #4d8cf5;
        color: #fff;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: background .15s, opacity .15s;
        letter-spacing: 1px;
      }
      .pcp-add-btn:hover:not(:disabled) { background: #3576e0; }
      .pcp-add-btn:disabled { opacity: .55; cursor: not-allowed; }

      /* ?Ä?Ä?Ä?Ä ?ØË™§?êÁ§∫ ?Ä?Ä?Ä?Ä */
      .pcp-error {
        margin: 6px 0 0;
        min-height: 18px;
        font-size: 13px;
        color: #e05252;
        opacity: 0;
        transition: opacity .2s;
      }
      .pcp-error--visible { opacity: 1; }

      /* ?Ä?Ä?Ä?Ä Áµ±Ë????Ä?Ä?Ä?Ä */
      .pcp-stats {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        font-size: 13px;
        color: #6b7a90;
        position: relative;
      }

      /* ?Ä?Ä?Ä?Ä ?∞Â??êÂ??ÉË? ?Ä?Ä?Ä?Ä */
      .pcp-flash-success {
        position: absolute;
        right: 16px;
        background: #34c97a;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 20px;
        animation: pcpFlashFade 1.8s forwards;
        pointer-events: none;
      }
      @keyframes pcpFlashFade {
        0%   { opacity: 0; transform: translateY(4px); }
        15%  { opacity: 1; transform: translateY(0);   }
        70%  { opacity: 1; }
        100% { opacity: 0; }
      }

      /* ?Ä?Ä?Ä?Ä Ê∏ÖÂñÆ?Ä ?Ä?Ä?Ä?Ä */
      .pcp-list-section {
        flex: 1;
        padding: 8px 16px 32px;
        overflow-y: auto;
      }

      /* ËºâÂÖ•‰∏?*/
      .pcp-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: center;
        padding: 40px 0;
        color: #a0aab8;
        font-size: 14px;
      }
      .pcp-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid #d0d8e8;
        border-top-color: #4d8cf5;
        border-radius: 50%;
        animation: pcpSpin .8s linear infinite;
        display: inline-block;
      }
      @keyframes pcpSpin { to { transform: rotate(360deg); } }

      /* Á©∫Á???*/
      .pcp-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 50px 20px;
        text-align: center;
        color: #8fa0b8;
      }
      .pcp-empty-icon { font-size: 48px; margin-bottom: 12px; }
      .pcp-empty p { margin: 4px 0; font-size: 14px; }
      .pcp-empty-hint { font-size: 12px; color: #b0bcc8; }

      /* Ê∏ÖÂñÆ */
      .pcp-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
        gap: 12px;
      }

      /* Ê∏ÖÂñÆ?ÖÁõÆ */
      .pcp-item {
        background: #ffffff;
        border-radius: 14px;
        border: 1.5px solid #e8eaf0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 14px 8px 10px;
        position: relative;
        animation: pcpItemIn .25s ease both;
        transition: box-shadow .15s;
      }
      .pcp-item:hover { box-shadow: 0 4px 14px rgba(77,140,245,.12); }
      @keyframes pcpItemIn {
        from { opacity: 0; transform: scale(.88) translateY(6px); }
        to   { opacity: 1; transform: scale(1)   translateY(0);   }
      }

      .pcp-item-char {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
      }
      .pcp-char-display {
        font-size: 32px;
        line-height: 1;
        font-family: 'BpmfIVS', 'Noto Sans TC', serif;
        font-weight: 500;
      }
      .pcp-char-zhuyin {
        font-size: 11px;
        color: #7b90ac;
        font-family: 'BpmfIVS', 'Noto Sans TC', serif;
        letter-spacing: 1px;
      }

      /* ?™Èô§?âÈ? */
      .pcp-delete-btn {
        position: absolute;
        top: 5px;
        right: 5px;
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        color: #c8d0dc;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity .15s, color .15s, background .15s;
        pointer-events: none;
      }
      .pcp-item:hover .pcp-delete-btn {
        opacity: 1;
        pointer-events: auto;
      }
      .pcp-delete-btn:hover {
        color: #e05252;
        background: #fdecea;
      }
    `
    document.head.appendChild(style)
  }

  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  // destroyÔºöÁßª?§Ê??â‰?‰ª∂Áõ£??  // ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
  destroy() {
    const backBtn = document.getElementById('pcpBack')
    const addBtn  = document.getElementById('pcpAddBtn')
    const input   = document.getElementById('pcpInput')
    const list    = document.getElementById('pcpList')

    if (backBtn && this._onBackClick) {
      backBtn.removeEventListener('click', this._onBackClick)
    }
    if (addBtn && this._onAddClick) {
      addBtn.removeEventListener('click', this._onAddClick)
    }
    if (input && this._onInputKeyup) {
      input.removeEventListener('keyup', this._onInputKeyup)
    }
    if (list && this._onDeleteClick) {
      list.removeEventListener('click', this._onDeleteClick)
    }

    this._onBackClick   = null
    this._onAddClick    = null
    this._onInputKeyup  = null
    this._onDeleteClick = null
  }
}
