/**
 * ParentPokedexPage.js — 圖鑑設定頁面（Task 44）
 * 位置：js/pages/ParentPokedexPage.js
 * 層級：第八層頁面
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 */

import { FirestoreAPI } from '../firebase.js'
import { AppState } from '../state.js'
import { UIManager } from '../ui/ui_manager.js'

export class ParentPokedexPage {
  constructor() {
    // 事件處理器清單（供 destroy() 移除）
    this._handlers = []
    // 目前圖鑑設定（從 Firestore 讀入）
    this._pokedexSettings = null
  }

  // ══════════════════════════════════════════════════
  // init()：讀取 Firestore pokedex 設定，渲染 UI
  // ══════════════════════════════════════════════════
  async init(params = {}) {
    const app = document.getElementById('app')
    if (!app) return

    // 渲染骨架
    app.innerHTML = `
      <div class="parent-pokedex-page">
        <div class="page-header">
          <button class="btn-back" id="ppd-back">← 返回</button>
          <h2>🎴 圖鑑設定</h2>
        </div>
        <div class="page-body" id="ppd-body">
          <p class="loading-text">讀取中…</p>
        </div>
      </div>
    `

    // 返回按鈕
    this._addHandler(
      document.getElementById('ppd-back'),
      'click',
      () => UIManager.back()
    )

    // uid 由 app.js 登入後設定於 AppState
    const uid = AppState.uid
    if (!uid) {
      document.getElementById('ppd-body').innerHTML =
        '<p class="error-text">請先登入後再進入此頁面</p>'
      return
    }

    try {
      // 讀取 Firestore users/{uid} 中的 pokedex 設定
      const userData = await FirestoreAPI.read(`users/${uid}`)
      this._pokedexSettings = userData?.pokedex || {
        active_series: 'pokemon',
        reveal_by_sentence: 10,
      }
    } catch (e) {
      console.error('[ParentPokedexPage] 讀取圖鑑設定失敗', e)
      this._pokedexSettings = {
        active_series: AppState.pokedex?.active_series || 'pokemon',
        reveal_by_sentence: AppState.pokedex?.reveal_by_sentence || 10,
      }
    }

    this._render()
  }

  // ══════════════════════════════════════════════════
  // _render()：依設定渲染完整 UI
  // ══════════════════════════════════════════════════
  _render() {
    const body = document.getElementById('ppd-body')
    if (!body) return

    const settings = this._pokedexSettings
    const revealCount = settings.reveal_by_sentence || 10
    const activeSeries = settings.active_series || 'pokemon'

    // 系列清單（固定，未來可改由 pokedex_series.json 載入）
    const seriesList = [
      { id: 'pokemon',  label: '⚡ 寶可夢',   desc: '使用 PokéAPI 自動抓取圖片' },
      { id: 'animals',  label: '🐾 動物圖鑑', desc: '可愛動物插圖系列' },
      { id: 'space',    label: '🚀 太空探索', desc: '星球與太空主題系列' },
    ]

    const seriesHTML = seriesList.map(s => `
      <div class="series-item ${s.id === activeSeries ? 'active' : ''}"
           data-series="${s.id}">
        <span class="series-label">${s.label}</span>
        <span class="series-desc">${s.desc}</span>
        ${s.id === activeSeries
          ? '<span class="series-badge">✅ 使用中</span>'
          : '<button class="btn-switch" data-series="' + s.id + '">切換</button>'}
      </div>
    `).join('')

    body.innerHTML = `
      <!-- 區塊一：系列選擇 -->
      <section class="settings-section">
        <h3>圖鑑系列</h3>
        <div class="series-list" id="ppd-series-list">
          ${seriesHTML}
        </div>
      </section>

      <!-- 區塊二：每N題揭曉 -->
      <section class="settings-section">
        <h3>揭曉頻率</h3>
        <p class="setting-hint">每完成幾題揭曉一格？（5 ～ 20 題）</p>
        <div class="reveal-control">
          <button class="btn-adjust" id="ppd-reveal-dec" data-delta="-1">－</button>
          <span class="reveal-count" id="ppd-reveal-count">${revealCount}</span>
          <button class="btn-adjust" id="ppd-reveal-inc" data-delta="1">＋</button>
        </div>
        <p class="reveal-label">每完成 <strong id="ppd-reveal-label">${revealCount}</strong> 題揭曉一格</p>
      </section>

      <!-- 區塊三：儲存按鈕 -->
      <div class="save-area">
        <button class="btn-save" id="ppd-save">💾 儲存設定</button>
        <p class="save-status" id="ppd-save-status"></p>
      </div>
    `

    // 綁定：系列切換按鈕
    body.querySelectorAll('.btn-switch').forEach(btn => {
      this._addHandler(btn, 'click', () => {
        const seriesId = btn.dataset.series
        this.switchSeries(seriesId)
      })
    })

    // 綁定：揭曉頻率 -/+
    this._addHandler(
      document.getElementById('ppd-reveal-dec'),
      'click',
      () => this._adjustCount(-1)
    )
    this._addHandler(
      document.getElementById('ppd-reveal-inc'),
      'click',
      () => this._adjustCount(1)
    )

    // 綁定：儲存按鈕
    this._addHandler(
      document.getElementById('ppd-save'),
      'click',
      () => this._save()
    )
  }

  // ══════════════════════════════════════════════════
  // switchSeries(seriesId)：切換圖鑑系列
  // 更新 pokedex.active_series 並寫入 Firestore
  // ══════════════════════════════════════════════════
  async switchSeries(seriesId) {
    if (!seriesId || seriesId === this._pokedexSettings.active_series) return

    // 先更新本地狀態
    this._pokedexSettings.active_series = seriesId

    try {
      const uid = AppState.uid
      await FirestoreAPI.update(`users/${uid}`, {
        'pokedex.active_series': seriesId,
      })

      // 同步 AppState
      if (AppState.pokedex) {
        AppState.pokedex.active_series = seriesId
      }

      UIManager.showToast(`已切換至 ${seriesId} 系列`, 'success', 2000)
    } catch (e) {
      console.error('[ParentPokedexPage] switchSeries 失敗', e)
      UIManager.showToast('切換失敗，請稍後再試', 'error', 2000)
    }

    // 重新渲染 UI 反映新選擇
    this._render()
  }

  // ══════════════════════════════════════════════════
  // adjustRevealCount(count)：調整每N題揭曉（5-20）
  // 更新本地狀態、UI 顯示，並寫入 Firestore
  // ══════════════════════════════════════════════════
  async adjustRevealCount(count) {
    // 限制範圍 5～20
    const clamped = Math.max(5, Math.min(20, count))
    this._pokedexSettings.reveal_by_sentence = clamped

    // 即時更新 UI 數字
    const countEl = document.getElementById('ppd-reveal-count')
    const labelEl = document.getElementById('ppd-reveal-label')
    if (countEl) countEl.textContent = clamped
    if (labelEl) labelEl.textContent = clamped

    try {
      const uid = AppState.uid
      await FirestoreAPI.update(`users/${uid}`, {
        'pokedex.reveal_by_sentence': clamped,
      })

      // 同步 AppState
      if (AppState.pokedex) {
        AppState.pokedex.reveal_by_sentence = clamped
      }
    } catch (e) {
      console.error('[ParentPokedexPage] adjustRevealCount 失敗', e)
      UIManager.showToast('設定更新失敗，請稍後再試', 'error', 2000)
    }
  }

  // ══════════════════════════════════════════════════
  // _adjustCount(delta)：+1 或 -1 調整揭曉頻率
  // ══════════════════════════════════════════════════
  _adjustCount(delta) {
    const current = this._pokedexSettings.reveal_by_sentence || 10
    this.adjustRevealCount(current + delta)
  }

  // ══════════════════════════════════════════════════
  // _save()：儲存全部設定到 Firestore
  // ══════════════════════════════════════════════════
  async _save() {
    const saveBtn = document.getElementById('ppd-save')
    const statusEl = document.getElementById('ppd-save-status')
    if (saveBtn) saveBtn.disabled = true
    if (statusEl) statusEl.textContent = '儲存中…'

    try {
      const uid = AppState.uid
      const settings = this._pokedexSettings

      await FirestoreAPI.update(`users/${uid}`, {
        'pokedex.active_series': settings.active_series,
        'pokedex.reveal_by_sentence': settings.reveal_by_sentence,
      })

      // 同步 AppState
      if (AppState.pokedex) {
        AppState.pokedex.active_series = settings.active_series
        AppState.pokedex.reveal_by_sentence = settings.reveal_by_sentence
      }

      if (statusEl) statusEl.textContent = '✅ 已儲存'
      UIManager.showToast('圖鑑設定已儲存', 'success', 2000)
    } catch (e) {
      console.error('[ParentPokedexPage] _save 失敗', e)
      if (statusEl) statusEl.textContent = '❌ 儲存失敗'
      UIManager.showToast('儲存失敗，請稍後再試', 'error', 2000)
    } finally {
      if (saveBtn) saveBtn.disabled = false
    }
  }

  // ══════════════════════════════════════════════════
  // _addHandler(el, event, fn)：統一註冊，供 destroy 清理
  // ══════════════════════════════════════════════════
  _addHandler(el, event, fn) {
    if (!el) return
    el.addEventListener(event, fn)
    this._handlers.push({ el, event, fn })
  }

  // ══════════════════════════════════════════════════
  // destroy()：移除所有事件監聽，防止 memory leak
  // ══════════════════════════════════════════════════
  destroy() {
    this._handlers.forEach(({ el, event, fn }) => {
      el.removeEventListener(event, fn)
    })
    this._handlers = []
    this._pokedexSettings = null
  }
}
