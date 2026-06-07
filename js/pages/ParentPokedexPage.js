/**
 * ParentPokedexPage.js — 圖鑑設定頁（含自訂系列）
 * v1.2.18
 *
 * 功能：
 *   1. 查看目前收集進度
 *   2. 切換內建系列（寶可夢）
 *   3. 新增自訂系列（URL 規則化批次，最多 3 組）
 *   4. 刪除自訂系列
 */

import { FirestoreAPI } from '../firebase.js'
import { AppState }     from '../state.js'
import { UIManager }    from '../ui/ui_manager.js'

const MAX_CUSTOM = 3  // 最多 3 個自訂系列

export class ParentPokedexPage {
  constructor() {
    this._handlers    = []
    this._customList  = []   // 目前的自訂系列陣列
    this._showForm    = false // 是否顯示新增表單
  }

  // ══════════════════════════════════════
  // init
  // ══════════════════════════════════════
  async init(params = {}) {
    const app = document.getElementById('app')
    if (!app) return

    app.innerHTML = `
      <div id="ppd-root" style="padding:16px 20px 60px;max-width:620px;margin:0 auto;font-family:'Noto Sans TC',sans-serif">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
          <button id="ppd-back" style="border:none;background:rgba(0,0,0,0.08);border-radius:8px;padding:6px 14px;font-size:14px;cursor:pointer">← 返回</button>
          <h2 style="margin:0;font-size:18px">🎴 圖鑑設定</h2>
        </div>
        <div id="ppd-body" style="color:#333">讀取中…</div>
      </div>
    `
    this._addHandler(document.getElementById('ppd-back'), 'click', () => UIManager.back())

    if (!AppState.uid) {
      document.getElementById('ppd-body').innerHTML = '<p style="color:red">請先登入</p>'
      return
    }

    try {
      const userData = await FirestoreAPI.read(`users/${AppState.uid}`)
      this._customList = userData?.custom_series || []
      // 同步到 PokedexManager 快取
      if (globalThis.PokedexManager) {
        globalThis.PokedexManager._customSeriesCache = this._customList
        globalThis.PokedexManager._customSeriesCacheUid = AppState.uid
      }
    } catch (e) {
      console.error('[ParentPokedexPage] 讀取失敗', e)
      this._customList = []
    }

    this._render()
  }

  // ══════════════════════════════════════
  // _render
  // ══════════════════════════════════════
  _render() {
    const body = document.getElementById('ppd-body')
    if (!body) return
    // 移除舊有事件（重新 render 前清理）
    this._handlers = this._handlers.filter(h => {
      if (h.el?.id === 'ppd-back') return true
      h.el?.removeEventListener(h.event, h.fn)
      return false
    })

    const seriesId  = AppState.pokedex?.active_series || 'pokemon'
    const collected = (AppState.pokedex?.[seriesId]?.collected_ids || []).length

    body.innerHTML = `
      ${this._renderProgress(collected)}
      ${this._renderBuiltinSection(seriesId)}
      ${this._renderCustomSection()}
      ${this._showForm ? this._renderAddForm() : ''}
    `

    this._bindBodyEvents()
  }

  // ── 進度卡片 ──
  _renderProgress(collected) {
    return `
      <div style="background:#fff;border-radius:14px;padding:14px 18px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,0.07)">
        <div style="font-size:12px;color:#888;margin-bottom:4px">目前收集進度</div>
        <div style="font-size:26px;font-weight:800;color:#7C3AED">${collected} <span style="font-size:13px;color:#aaa">/ 898 隻寶可夢</span></div>
      </div>
    `
  }

  // ── 內建系列 ──
  _renderBuiltinSection(activeSeries) {
    return `
      <div style="background:#fff;border-radius:14px;padding:14px 18px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,0.07)">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px">🌟 內建系列</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0">
          <div>
            <span style="font-size:15px">⚡ 寶可夢圖鑑</span>
            <div style="font-size:12px;color:#888;margin-top:2px">898 隻 · 自動從 PokéAPI 抓取圖片</div>
          </div>
          ${activeSeries === 'pokemon'
            ? '<span style="background:#DCFCE7;color:#166534;font-size:12px;padding:3px 10px;border-radius:20px;font-weight:700">✅ 使用中</span>'
            : '<button id="btn-switch-pokemon" style="background:#7C3AED;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer">切換</button>'
          }
        </div>
        ${this._customList.map(s => this._renderSeriesRow(s, activeSeries)).join('')}
      </div>
    `
  }

  _renderSeriesRow(s, activeSeries) {
    const isActive = activeSeries === s.id
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0" data-series-row="${s.id}">
        <div>
          <span style="font-size:15px">${s.icon || '🖼'} ${this._escHtml(s.name)}</span>
          <div style="font-size:12px;color:#888;margin-top:2px">共 ${s.total} 張 · 自訂系列</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${isActive
            ? '<span style="background:#DCFCE7;color:#166534;font-size:12px;padding:3px 10px;border-radius:20px;font-weight:700">✅ 使用中</span>'
            : `<button class="btn-switch-custom" data-sid="${s.id}" style="background:#7C3AED;color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer">切換</button>`
          }
          <button class="btn-del-custom" data-sid="${s.id}" style="background:#FEE2E2;color:#DC2626;border:none;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer">刪除</button>
        </div>
      </div>
    `
  }

  // ── 自訂系列區 ──
  _renderCustomSection() {
    const canAdd = this._customList.length < MAX_CUSTOM
    return `
      <div style="background:#fff;border-radius:14px;padding:14px 18px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,0.07)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${canAdd && !this._showForm ? '0' : '10px'}">
          <div style="font-size:15px;font-weight:700">➕ 自訂圖鑑系列</div>
          <span style="font-size:12px;color:#aaa">${this._customList.length} / ${MAX_CUSTOM}</span>
        </div>
        ${canAdd && !this._showForm
          ? `<button id="btn-show-add-form" style="width:100%;margin-top:10px;padding:10px;border:2px dashed #d0c0f0;border-radius:10px;background:#faf8ff;color:#7C3AED;font-size:14px;font-weight:600;cursor:pointer">+ 新增自訂系列</button>`
          : ''
        }
        ${!canAdd
          ? `<div style="font-size:13px;color:#888;margin-top:8px">已達上限（${MAX_CUSTOM} 個），請先刪除再新增</div>`
          : ''
        }
      </div>
    `
  }

  // ── 新增表單（含詳細說明）──
  _renderAddForm() {
    return `
      <div style="background:#fff;border-radius:14px;padding:16px 18px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,0.07)">
        <div style="font-size:15px;font-weight:700;margin-bottom:12px">🖊 新增自訂系列</div>

        <!-- 使用說明 -->
        <div style="background:#FFF7ED;border-left:4px solid #F59E0B;border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:16px;font-size:13px;color:#92400E;line-height:1.8">
          <div style="font-weight:700;margin-bottom:6px">📋 使用說明</div>
          <div>本功能讓你用一批統一命名的圖片建立專屬圖鑑。</div>
          <div style="margin-top:8px;font-weight:700">步驟一：準備圖片</div>
          <div>將圖片統一命名為 <code style="background:#FEF3C7;padding:1px 5px;border-radius:4px">1.jpg、2.jpg、3.jpg…</code> 的格式，上傳到可公開存取的網路空間（例如 Google Drive 公開資料夾、Imgur 相簿、或任何圖床）。</div>
          <div style="margin-top:8px;font-weight:700">步驟二：取得 URL 規則</div>
          <div>找到第 1 張圖片的完整網址，例如：</div>
          <div style="background:#FEF3C7;padding:6px 10px;border-radius:6px;margin-top:4px;font-family:monospace;font-size:12px;word-break:break-all">https://example.com/animals/1.jpg</div>
          <div style="margin-top:6px">把網址中的數字 <code style="background:#FEF3C7;padding:1px 5px;border-radius:4px">1</code> 換成 <code style="background:#FEF3C7;padding:1px 5px;border-radius:4px">{index}</code>，填入下方「圖片網址規則」欄位：</div>
          <div style="background:#FEF3C7;padding:6px 10px;border-radius:6px;margin-top:4px;font-family:monospace;font-size:12px;word-break:break-all">https://example.com/animals/{index}.jpg</div>
          <div style="margin-top:8px;font-weight:700">步驟三：填寫張數</div>
          <div>填入你準備了幾張圖片（1～100 張）。系統會隨機從 1 到你設定的數字中解鎖圖片。</div>
        </div>

        <!-- 表單欄位 -->
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">系列名稱 <span style="color:red">*</span></label>
            <input id="form-name" type="text" placeholder="例如：恐龍世界、台灣動物…"
              style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;outline:none"
              maxlength="20">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">系列圖示（emoji）</label>
            <input id="form-icon" type="text" placeholder="例如：🦕 🐘 🌸"
              style="width:80px;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:18px;outline:none"
              maxlength="4">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">圖片網址規則 <span style="color:red">*</span></label>
            <input id="form-url" type="url" placeholder="https://example.com/img/{index}.jpg"
              style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:13px;font-family:monospace;outline:none">
            <div style="font-size:11px;color:#aaa;margin-top:4px">網址中必須包含 <code>{index}</code> 作為圖片編號佔位符</div>
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#555;display:block;margin-bottom:4px">圖片總數 <span style="color:red">*</span>（1 ～ 100 張）</label>
            <input id="form-total" type="number" min="1" max="100" placeholder="例如：30"
              style="width:100px;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;outline:none">
          </div>
          <div id="form-error" style="color:red;font-size:13px;display:none"></div>
          <div style="display:flex;gap:10px;margin-top:4px">
            <button id="btn-save-form" style="flex:1;background:#7C3AED;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">✅ 儲存新系列</button>
            <button id="btn-cancel-form" style="flex:1;background:#f0f0f0;color:#555;border:none;border-radius:10px;padding:12px;font-size:14px;cursor:pointer">取消</button>
          </div>
        </div>
      </div>
    `
  }

  // ══════════════════════════════════════
  // _bindBodyEvents
  // ══════════════════════════════════════
  _bindBodyEvents() {
    // 返回寶可夢
    const btnPoke = document.getElementById('btn-switch-pokemon')
    if (btnPoke) this._addHandler(btnPoke, 'click', () => this._switchSeries('pokemon'))

    // 切換自訂系列
    document.querySelectorAll('.btn-switch-custom').forEach(btn => {
      this._addHandler(btn, 'click', () => this._switchSeries(btn.dataset.sid))
    })

    // 刪除自訂系列
    document.querySelectorAll('.btn-del-custom').forEach(btn => {
      this._addHandler(btn, 'click', () => this._deleteSeries(btn.dataset.sid))
    })

    // 顯示新增表單
    const btnShow = document.getElementById('btn-show-add-form')
    if (btnShow) this._addHandler(btnShow, 'click', () => {
      this._showForm = true
      this._render()
    })

    // 取消表單
    const btnCancel = document.getElementById('btn-cancel-form')
    if (btnCancel) this._addHandler(btnCancel, 'click', () => {
      this._showForm = false
      this._render()
    })

    // 儲存新系列
    const btnSave = document.getElementById('btn-save-form')
    if (btnSave) this._addHandler(btnSave, 'click', () => this._saveNewSeries())
  }

  // ══════════════════════════════════════
  // _switchSeries
  // ══════════════════════════════════════
  async _switchSeries(seriesId) {
    try {
      await FirestoreAPI.update(`users/${AppState.uid}`, {
        'pokedex.active_series': seriesId,
      })
      if (AppState.pokedex) AppState.pokedex.active_series = seriesId
      UIManager.showToast('已切換系列', 'success', 2000)
    } catch (e) {
      UIManager.showToast('切換失敗', 'error', 2000)
    }
    this._render()
  }

  // ══════════════════════════════════════
  // _deleteSeries
  // ══════════════════════════════════════
  async _deleteSeries(seriesId) {
    if (!confirm(`確定刪除「${this._customList.find(s=>s.id===seriesId)?.name || seriesId}」系列？\n收集記錄也會一併刪除。`)) return

    this._customList = this._customList.filter(s => s.id !== seriesId)

    // 若刪除的是目前使用中的系列，切回 pokemon
    if (AppState.pokedex?.active_series === seriesId) {
      await this._switchSeries('pokemon')
    }

    try {
      await FirestoreAPI.update(`users/${AppState.uid}`, {
        custom_series: this._customList,
        [`pokedex.${seriesId}`]: null,
      })
      if (globalThis.PokedexManager) {
        globalThis.PokedexManager._customSeriesCache = this._customList
      }
      UIManager.showToast('已刪除系列', 'success', 2000)
    } catch (e) {
      UIManager.showToast('刪除失敗', 'error', 2000)
    }
    this._render()
  }

  // ══════════════════════════════════════
  // _saveNewSeries
  // ══════════════════════════════════════
  async _saveNewSeries() {
    const name  = document.getElementById('form-name')?.value.trim()
    const icon  = document.getElementById('form-icon')?.value.trim() || '🖼'
    const url   = document.getElementById('form-url')?.value.trim()
    const total = parseInt(document.getElementById('form-total')?.value || '0', 10)
    const errEl = document.getElementById('form-error')

    // 驗證
    const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block' } }
    if (!name) return showErr('請填寫系列名稱')
    if (!url || !url.includes('{index}')) return showErr('圖片網址規則必須包含 {index}')
    if (!url.startsWith('http')) return showErr('網址格式不正確，需以 http 或 https 開頭')
    if (!total || total < 1 || total > 100) return showErr('圖片總數需在 1 ～ 100 之間')

    // 產生唯一 id
    const id = `custom_${Date.now()}`
    const newSeries = { id, name, icon, source: 'url_pattern', url_pattern: url, total }

    this._customList = [...this._customList, newSeries]

    try {
      await FirestoreAPI.update(`users/${AppState.uid}`, {
        custom_series: this._customList,
      })
      if (globalThis.PokedexManager) {
        globalThis.PokedexManager._customSeriesCache = this._customList
      }
      // 同時清除圖片快取（以防舊快取殘留）
      globalThis.PokedexManager?._imageCache?.clear()
      this._showForm = false
      UIManager.showToast(`「${name}」已新增！`, 'success', 2500)
    } catch (e) {
      this._customList = this._customList.filter(s => s.id !== id)
      UIManager.showToast('儲存失敗，請稍後再試', 'error', 2000)
    }
    this._render()
  }

  // ══════════════════════════════════════
  // 工具
  // ══════════════════════════════════════
  _escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  _addHandler(el, event, fn) {
    if (!el) return
    el.addEventListener(event, fn)
    this._handlers.push({ el, event, fn })
  }

  destroy() {
    this._handlers.forEach(({ el, event, fn }) => el?.removeEventListener(event, fn))
    this._handlers = []
  }
}
