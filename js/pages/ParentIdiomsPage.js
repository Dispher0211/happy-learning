/**
 * ParentIdiomsPage.js — 成語簿設定頁面（Task 42.6）
 * 位置：js/pages/ParentIdiomsPage.js
 * 層級：第八層頁面
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 */

import { FirestoreAPI, arrayRemove, arrayUnion } from '../firebase.js';
import { AppState } from '../state.js';

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
          <h2 style="margin:0; font-size:20px;">🀄 成語簿設定</h2>
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
    const uid = AppState.currentUser?.uid;
    if (!uid) return;

    const doc = await FirestoreAPI.read(`users/${uid}`);
    const idioms = (doc && Array.isArray(doc.my_idioms)) ? doc.my_idioms : [];

    // 同步 AppState
    AppState.idioms = idioms;

    this._renderList(idioms);
  }

  /**
   * 渲染成語清單 DOM
   * @param {string[]} idioms
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

    this._listEl.innerHTML = idioms.map((idiom) => `
      <div class="idiom-item" data-idiom="${idiom}" style="
        display:flex; align-items:center; justify-content:space-between;
        background:#fff; border:1px solid #eee; border-radius:10px;
        padding:12px 14px;
      ">
        <span style="font-size:18px; letter-spacing:2px;">${idiom}</span>
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
    `).join('');
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

    // 刪除按鈕事件委派（統一監聽 _listEl，不在 _renderList 重複綁定）
    this._onListClick = (e) => {
      const btn = e.target.closest('.idiom-delete-btn');
      if (btn) {
        const idiom = btn.dataset.idiom;
        if (idiom) this._deleteIdiom(idiom);
      }
    };
    this._listEl.addEventListener('click', this._onListClick);
  }

  /**
   * 新增成語：格式驗證 → arrayUnion 寫入 Firestore → 同步 AppState → 重繪清單
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

    const uid = AppState.currentUser?.uid;
    if (!uid) return;

    // 防止 UI 重複點擊
    const addBtn = this._container.querySelector('#idiom-add-btn');
    addBtn.disabled = true;

    try {
      // 寫入 Firestore（arrayUnion 自動防重複）
      await FirestoreAPI.write(`users/${uid}`, { my_idioms: arrayUnion(raw) }, true);

      // 同步 AppState（本機去重）
      if (!AppState.idioms) AppState.idioms = [];
      if (!AppState.idioms.includes(raw)) {
        AppState.idioms = [...AppState.idioms, raw];
      }

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
   * 刪除成語：arrayRemove 移除 Firestore → 同步 AppState → 重繪清單
   * @param {string} idiom - 要刪除的成語
   */
  async _deleteIdiom(idiom) {
    const uid = AppState.currentUser?.uid;
    if (!uid) return;

    try {
      // 從 Firestore 移除
      await FirestoreAPI.write(`users/${uid}`, { my_idioms: arrayRemove(idiom) }, true);

      // 同步 AppState
      AppState.idioms = (AppState.idioms || []).filter((i) => i !== idiom);

      // 重繪清單
      this._renderList(AppState.idioms);

    } catch (err) {
      console.error('[ParentIdiomsPage] 刪除成語失敗：', err);
      this._showError('刪除失敗，請稍後再試');
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

    // 清空刪除按鈕的監聽（移除 DOM 即可，GC 自動回收）
    this._container  = null;
    this._inputEl    = null;
    this._errorEl    = null;
    this._listEl     = null;
    this._onAddClick = null;
    this._onInputKeydown = null;
    this._onBackClick    = null;
    this._onListClick    = null;
  }
}
