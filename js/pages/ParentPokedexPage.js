/**
 * ParentPokedexPage.js — 圖鑑設定頁面（Task 44）
 * 位置：js/pages/ParentPokedexPage.js
 * 層級：第八層頁面
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 * v1.2.16：移除揭曉頻率設定，固定 15 題
 */

import { FirestoreAPI } from '../firebase.js'
import { AppState } from '../state.js'
import { UIManager } from '../ui/ui_manager.js'

export class ParentPokedexPage {
  constructor() {
    this._handlers = []
    this._pokedexSettings = null
  }

  async init(params = {}) {
    const app = document.getElementById('app')
    if (!app) return

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

    this._addHandler(
      document.getElementById('ppd-back'),
      'click',
      () => UIManager.back()
    )

    const uid = AppState.uid
    if (!uid) {
      document.getElementById('ppd-body').innerHTML =
        '<p class="error-text">請先登入後再進入此頁面</p>'
      return
    }

    try {
      const userData = await FirestoreAPI.read(`users/${uid}`)
      this._pokedexSettings = {
        active_series: userData?.pokedex?.active_series || 'pokemon',
      }
    } catch (e) {
      console.error('[ParentPokedexPage] 讀取圖鑑設定失敗', e)
      this._pokedexSettings = {
        active_series: AppState.pokedex?.active_series || 'pokemon',
      }
    }

    this._render()
  }

  _render() {
    const body = document.getElementById('ppd-body')
    if (!body) return

    const activeSeries = this._pokedexSettings.active_series || 'pokemon'

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
      <section class="settings-section">
        <h3>圖鑑系列</h3>
        <div class="series-list" id="ppd-series-list">
          ${seriesHTML}
        </div>
      </section>

      <div class="save-area">
        <p class="save-status" id="ppd-save-status"></p>
      </div>
    `

    body.querySelectorAll('.btn-switch').forEach(btn => {
      this._addHandler(btn, 'click', () => {
        this.switchSeries(btn.dataset.series)
      })
    })
  }

  async switchSeries(seriesId) {
    if (!seriesId || seriesId === this._pokedexSettings.active_series) return

    this._pokedexSettings.active_series = seriesId

    const statusEl = document.getElementById('ppd-save-status')
    if (statusEl) statusEl.textContent = '切換中…'

    try {
      const uid = AppState.uid
      await FirestoreAPI.update(`users/${uid}`, {
        'pokedex.active_series': seriesId,
      })

      if (AppState.pokedex) {
        AppState.pokedex.active_series = seriesId
      }

      UIManager.showToast(`已切換至 ${seriesId} 系列`, 'success', 2000)
      if (statusEl) statusEl.textContent = ''
    } catch (e) {
      console.error('[ParentPokedexPage] switchSeries 失敗', e)
      UIManager.showToast('切換失敗，請稍後再試', 'error', 2000)
      if (statusEl) statusEl.textContent = '❌ 切換失敗'
    }

    this._render()
  }

  _addHandler(el, event, fn) {
    if (!el) return
    el.addEventListener(event, fn)
    this._handlers.push({ el, event, fn })
  }

  destroy() {
    this._handlers.forEach(({ el, event, fn }) => {
      el.removeEventListener(event, fn)
    })
    this._handlers = []
    this._pokedexSettings = null
  }
}
