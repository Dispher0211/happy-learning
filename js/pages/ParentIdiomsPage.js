/**
 * ParentIdiomsPage.js — 成語簿設定頁面（Task 42.6）
 * 位置：js/pages/ParentIdiomsPage.js
 * 層級：第八層頁面
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 */

import { FirestoreAPI } from '../firebase.js';
import { AppState } from '../state.js';
import { getItemText, isItemEnabled, isItemPriority } from '../content_filter.js';

export class ParentIdiomsPage {

  constructor() {
    /** 頁面根元素 */
    this._container = null;
    /** 輸入框元素 */
    this._inputEl = null;
    /** 錯誤提示元素 */
    this._errorEl = null;
    /** 清單容器元素 */
    this._listEl = null;
    /** 新增按鈕的點擊處理器（存放供 destroy 移除） */
    this._onAddClick = null;
    /** 輸入框 keydown 處理器 */
    this._onInputKeydown = null;
    /** 清單事件委派處理器 */
    this._onListClick = null;
    /** 一鍵刪除按鈕的點擊處理器 */
    this._onClearAllClick = null;
  }

  /**
   * 初始化頁面：讀取 Firestore my_idioms，渲染成語清單
   * @param {Object} [params] - 路由參數（本頁不使用）
   */
  async init(params) {
    // 取得 #app 元素並渲染頁面骨架
    const app = document.getElementById('app');
    app.innerHTML = this._renderShell();

    // 快取常用元素
    this._container = app.querySelector('.parent-idioms-page');
    this._inputEl   = app.querySelector('#idiom-input');
    this._errorEl   = app.querySelector('#idiom-error');
    this._listEl    = app.querySelector('#idiom-list');

    // 從 Firestore 讀取目前成語清單
    await this._loadIdioms();

    // 綁定事件
    this._bindEvents();
  }

  // ─── 私有方法 ────────────────────────────────────────────────

  /**
   * 渲染頁面 HTML 骨架
   * @returns {string}
   */
  _renderShell() {
    return `
      <div class="parent-idioms-page" style="
        max-width: 480px;
        margin: 0 auto;
        padding: 16px;
        font-family: 'Noto Sans TC', sans-serif;
      ">
        <!-- 頁首 -->
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:20px;">
          <button id="idioms-back-btn" style="
            background:none; border:none; font-size:22px; cursor:pointer;
          ">←</button>
          <h2 style="margin:0; font-size:20px; flex:1;">🀄 成語簿設定</h2>
          <button id="idioms-clear-all-btn" title="一鍵刪除所有成語" style="
            flex-shrink:0; height:32px; padding:0 12px;
            background:#fdecea; color:#e53935; border:1.5px solid #f5c6c2;
            border-radius:16px; font-size:13px; font-weight:600; cursor:pointer;
            white-space:nowrap;
          ">🗑️ 清空</button>
        </div>

        <!-- 新增成語區塊 -->
        <div style="
          background:#f9f9f9; border-radius:12px; padding:16px; margin-bottom:16px;
        ">
          <label style="font-size:14px; color:#555; display:block; margin-bottom:8px;">
            新增成語（必須是 4 個中文字）
          </label>
          <div style="display:flex; gap:8px;">
            <input
              id="idiom-input"
              type="text"
              maxlength="4"
              placeholder="例：一石二鳥"
              style="
                flex:1; padding:10px 12px; border:1.5px solid #ddd;
                border-radius:8px; font-size:16px; outline:none;
              "
            />
            <button id="idiom-add-btn" style="
              padding:10px 18px; background:#4CAF50; color:#fff;
              border:none; border-radius:8px; font-size:16px; cursor:pointer;
            ">新增</button>
          </div>
          <!-- 格式錯誤提示 -->
          <p id="idiom-error" style="
            color:#e53935; font-size:13px; margin:6px 0 0; min-height:18px;
          "></p>
        </div>

        <!-- 成語清單 -->
        <div id="idiom-list" style="
          display:flex; flex-direction:column; gap:8px;
        ">
          <!-- 由 _renderList() 填入 -->
        </div>
      </div>
    `;
  }

  /**
   * 從 Firestore 讀取 my_idioms，同步至 AppState 並渲染清單
   */
  async _loadIdioms() {
    const uid = AppState.uid;
    if (!uid) return;

    const doc = await FirestoreAPI.read(`users/${uid}`);
    const idioms = (doc && Array.isArray(doc.my_idioms)) ? doc.my_idioms : [];

    // 同步 AppState
    AppState.idioms = idioms;

    this._renderList(idioms);
  }

  /**
   * 渲染成語清單 DOM
   * @param {Array<string|Object>} idioms - 純字串或 { idiom, enabled, priority } 物件
   */
  _renderList(idioms) {
    if (!this._listEl) return;

    if (idioms.length === 0) {
      this._listEl.innerHTML = `
        <p style="text-align:center; color:#aaa; padding:24px 0; font-size:14px;">
          尚未新增任何成語
        </p>
      `;
      return;
    }

    this._listEl.innerHTML = idioms.map((item) => {
      const idiom    = getItemText(item, ['idiom']);
      const enabled  = isItemEnabled(item);
      const priority = isItemPriority(item);

      return `
        <div class="idiom-item" data-idiom="${idiom}" style="
          display:flex; align-items:center; gap:8px;
          background:#fff; border:1px solid #eee; border-radius:10px;
          padding:12px 14px; opacity:${enabled ? '1' : '.5'};
        ">
          <button
            class="idiom-priority-btn"
            data-priority-idiom="${idiom}"
            title="${priority ? '取消優先' : '設為優先（更常出現在學習與考題中）'}"
            style="
              background:none; border:none; font-size:16px; cursor:pointer;
              padding:0 2px; color:${priority ? '#f5a623' : '#d8dde6'};
            "
          >★</button>
          <span style="flex:1; font-size:18px; letter-spacing:2px;">${idiom}</span>
          <button
            class="idiom-toggle-btn"
            data-toggle-idiom="${idiom}"
            title="${enabled ? '點擊暫停（暫停後不會出現在學習與考題中）' : '點擊恢復啟用'}"
            style="
              flex-shrink:0; font-size:11px; padding:3px 10px; border-radius:10px;
              border:1px solid ${enabled ? '#cfe8d8' : '#e3e6ec'};
              background:${enabled ? '#eafaf0' : '#f0f2f5'};
              color:${enabled ? '#2e9e5b' : '#93a0b0'};
              cursor:pointer; font-weight:600; white-space:nowrap;
            "
          >${enabled ? '啟用中' : '已暫停'}</button>
          <button
            class="idiom-delete-btn"
            data-idiom="${idiom}"
            style="
              background:none; border:none; color:#e53935;
              font-size:20px; cursor:pointer; padding:0 4px;
            "
            title="刪除「${idiom}」"
          >🗑</button>
        </div>
      `;
    }).join('');
    // 事件委派：由 _bindEvents() 中統一監聽，不在此重複綁定
  }

  /**
   * 綁定新增按鈕與輸入框 Enter 鍵事件
   */
  _bindEvents() {
    const addBtn = this._container.querySelector('#idiom-add-btn');
    const backBtn = this._container.querySelector('#idioms-back-btn');

    // 新增按鈕點擊
    this._onAddClick = () => this._addIdiom();
    addBtn.addEventListener('click', this._onAddClick);

    // 輸入框 Enter 鍵觸發新增
    this._onInputKeydown = (e) => {
      if (e.key === 'Enter') this._addIdiom();
    };
    this._inputEl.addEventListener('keydown', this._onInputKeydown);

    // 返回按鈕
    this._onBackClick = () => {
      import('../ui/ui_manager.js').then(({ UIManager }) => {
        UIManager.back();
      });
    };
    backBtn.addEventListener('click', this._onBackClick);

    // 刪除／啟用切換／優先切換事件委派（統一監聽 _listEl，不在 _renderList 重複綁定）
    this._onListClick = (e) => {
      const deleteBtn = e.target.closest('.idiom-delete-btn');
      if (deleteBtn) {
        const idiom = deleteBtn.dataset.idiom;
        if (idiom) this._deleteIdiom(idiom);
        return;
      }
      const toggleBtn = e.target.closest('.idiom-toggle-btn');
      if (toggleBtn) {
        const idiom = toggleBtn.getAttribute('data-toggle-idiom');
        if (idiom) this._toggleEnabled(idiom);
        return;
      }
      const priorityBtn = e.target.closest('.idiom-priority-btn');
      if (priorityBtn) {
        const idiom = priorityBtn.getAttribute('data-priority-idiom');
        if (idiom) this._togglePriority(idiom);
        return;
      }
    };
    this._listEl.addEventListener('click', this._onListClick);

    // 一鍵刪除全部成語
    const clearAllBtn = this._container.querySelector('#idioms-clear-all-btn');
    this._onClearAllClick = () => this._clearAllIdioms();
    clearAllBtn.addEventListener('click', this._onClearAllClick);
  }

  /**
   * 新增成語：格式驗證 → 加入清單 → 整陣列覆寫 Firestore → 同步 AppState → 重繪清單
   */
  async _addIdiom() {
    const raw = this._inputEl.value.trim();
    this._clearError();

    // 格式驗證：必須 4 個中文字
    const IDIOM_PATTERN = /^[\u4e00-\u9fff]{4}$/;
    if (!IDIOM_PATTERN.test(raw)) {
      this._showError('成語必須是4個中文字');
      return;
    }

    const uid = AppState.uid;
    if (!uid) return;

    // 防止重複（純字串或物件格式皆比對文字內容）
    const existing = AppState.idioms || [];
    const alreadyIn = existing.some(item => getItemText(item, ['idiom']) === raw);
    if (alreadyIn) {
      this._showError(`「${raw}」已在成語簿中`);
      return;
    }

    // 防止 UI 重複點擊
    const addBtn = this._container.querySelector('#idiom-add-btn');
    addBtn.disabled = true;

    try {
      const newEntry = { idiom: raw, enabled: true, priority: false };
      const updated  = [...existing, newEntry];

      // 整陣列覆寫，確保新格式與舊格式項目皆能正確保存
      // ⚠️ 必須用 update() 而非 write()，write() 內部 spread {...data} 可能造成非預期合併
      await FirestoreAPI.update(`users/${uid}`, { my_idioms: updated });

      // 同步 AppState
      AppState.idioms = updated;

      // 清空輸入框並重繪清單
      this._inputEl.value = '';
      this._renderList(AppState.idioms);

    } catch (err) {
      console.error('[ParentIdiomsPage] 新增成語失敗：', err);
      this._showError('新增失敗，請稍後再試');
    } finally {
      addBtn.disabled = false;
      this._inputEl.focus();
    }
  }

  /**
   * 刪除成語：依文字比對從清單移除 → 整陣列覆寫 Firestore → 同步 AppState → 重繪清單
   * @param {string} idiom - 要刪除的成語
   */
  async _deleteIdiom(idiom) {
    const uid = AppState.uid;
    if (!uid) return;

    try {
      const existing = AppState.idioms || [];
      const updated  = existing.filter((item) => getItemText(item, ['idiom']) !== idiom);

      await FirestoreAPI.update(`users/${uid}`, { my_idioms: updated });

      // 同步 AppState
      AppState.idioms = updated;

      // 重繪清單
      this._renderList(AppState.idioms);

    } catch (err) {
      console.error('[ParentIdiomsPage] 刪除成語失敗：', err);
      this._showError('刪除失敗，請稍後再試');
    }
  }

  /**
   * 切換成語的啟用／暫停狀態
   * @param {string} idiom
   */
  async _toggleEnabled(idiom) {
    const existing = AppState.idioms || [];
    const idx = existing.findIndex((item) => getItemText(item, ['idiom']) === idiom);
    if (idx === -1) return;

    const current = existing[idx];
    const newItem = (current && typeof current === 'object')
      ? { ...current, idiom: getItemText(current, ['idiom']), enabled: !isItemEnabled(current) }
      : { idiom, enabled: false, priority: false };

    const updated = [...existing];
    updated[idx] = newItem;

    AppState.idioms = updated;
    this._renderList(updated);

    const uid = AppState.uid;
    if (!uid) return;
    try {
      await FirestoreAPI.update(`users/${uid}`, { my_idioms: updated });
    } catch (err) {
      console.error('[ParentIdiomsPage] 切換啟用狀態失敗：', err);
      this._showError('更新失敗，請稍後再試');
    }
  }

  /**
   * 切換成語的優先狀態
   * @param {string} idiom
   */
  async _togglePriority(idiom) {
    const existing = AppState.idioms || [];
    const idx = existing.findIndex((item) => getItemText(item, ['idiom']) === idiom);
    if (idx === -1) return;

    const current = existing[idx];
    const newItem = (current && typeof current === 'object')
      ? { ...current, idiom: getItemText(current, ['idiom']), priority: !isItemPriority(current) }
      : { idiom, enabled: true, priority: true };

    const updated = [...existing];
    updated[idx] = newItem;

    AppState.idioms = updated;
    this._renderList(updated);

    const uid = AppState.uid;
    if (!uid) return;
    try {
      await FirestoreAPI.update(`users/${uid}`, { my_idioms: updated });
    } catch (err) {
      console.error('[ParentIdiomsPage] 切換優先狀態失敗：', err);
      this._showError('更新失敗，請稍後再試');
    }
  }

  /**
   * 一鍵刪除全部成語：覆寫 my_idioms 為空陣列 → 同步 AppState → 重繪清單
   */
  async _clearAllIdioms() {
    const current = Array.isArray(AppState.idioms) ? AppState.idioms : [];

    if (current.length === 0) {
      this._showError('目前沒有成語可刪除');
      return;
    }

    const confirmed = window.confirm(
      `⚠️ 確定要刪除全部 ${current.length} 個成語嗎？\n\n這個動作無法復原！`
    );
    if (!confirmed) return;

    const uid = AppState.uid;
    if (!uid) return;

    const clearAllBtn = this._container?.querySelector('#idioms-clear-all-btn');
    if (clearAllBtn) clearAllBtn.disabled = true;

    try {
      await FirestoreAPI.update(`users/${uid}`, { my_idioms: [] });

      AppState.idioms = [];
      this._renderList([]);

    } catch (err) {
      console.error('[ParentIdiomsPage] 一鍵刪除成語失敗：', err);
      this._showError('刪除失敗，請稍後再試');
    } finally {
      if (clearAllBtn) clearAllBtn.disabled = false;
    }
  }

  /**
   * 顯示格式錯誤訊息
   * @param {string} msg
   */
  _showError(msg) {
    if (this._errorEl) this._errorEl.textContent = msg;
  }

  /**
   * 清除錯誤訊息
   */
  _clearError() {
    if (this._errorEl) this._errorEl.textContent = '';
  }

  // ─── 生命週期 ────────────────────────────────────────────────

  /**
   * 清理資源：移除所有事件監聽，防止 memory leak
   */
  destroy() {
    const addBtn  = this._container?.querySelector('#idiom-add-btn');
    const backBtn = this._container?.querySelector('#idioms-back-btn');
    const clearAllBtn = this._container?.querySelector('#idioms-clear-all-btn');

    if (addBtn && this._onAddClick) {
      addBtn.removeEventListener('click', this._onAddClick);
    }
    if (this._inputEl && this._onInputKeydown) {
      this._inputEl.removeEventListener('keydown', this._onInputKeydown);
    }
    if (backBtn && this._onBackClick) {
      backBtn.removeEventListener('click', this._onBackClick);
    }
    if (this._listEl && this._onListClick) {
      this._listEl.removeEventListener('click', this._onListClick);
    }
    if (clearAllBtn && this._onClearAllClick) {
      clearAllBtn.removeEventListener('click', this._onClearAllClick);
    }

    // 清空刪除按鈕的監聽（移除 DOM 即可，GC 自動回收）
    this._container  = null;
    this._inputEl    = null;
    this._errorEl    = null;
    this._listEl     = null;
    this._onAddClick = null;
    this._onInputKeydown = null;
    this._onBackClick    = null;
    this._onListClick    = null;
    this._onClearAllClick = null;
  }
}
