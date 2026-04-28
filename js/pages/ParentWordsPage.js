/**
 * ParentWordsPage.js — 詞語簿設定頁面（Task 42.5）
 * 位置：js/pages/ParentWordsPage.js
 * 層級：第八層頁面
 * 依賴：firebase.js（T05）、state.js（T02）、ui_manager.js（T28）
 */

import { FirestoreAPI, arrayUnion, arrayRemove } from '../firebase.js';
import { AppState } from '../state.js';
import { UIManager } from '../ui/ui_manager.js';

export class ParentWordsPage {

  constructor() {
    // 儲存所有事件監聽，以便 destroy() 時移除
    this._listeners = [];
  }

  /**
   * 初始化頁面：讀取 Firestore my_words，渲染詞語清單與新增介面
   * @param {Object} params - 路由參數（保留供擴充）
   */
  async init(params = {}) {
    // 注入頁面 CSS
    this._injectStyles();

    // 渲染初始骨架
    const app = document.getElementById('app');
    app.innerHTML = this._renderSkeleton();

    // 從 Firestore 讀取詞語清單
    let words = [];
    try {
      const uid = AppState.uid;
      const userData = await FirestoreAPI.read(`users/${uid}`);
      words = (userData && Array.isArray(userData.my_words)) ? userData.my_words : [];
    } catch (e) {
      console.warn('[ParentWordsPage] 讀取 my_words 失敗，使用空清單', e);
    }

    // 同步到 AppState
    AppState.words = words;

    // 渲染詞語清單
    this._renderList(words);

    // 綁定新增按鈕事件
    this._bindEvents();
  }

  /**
   * 渲染頁面骨架（標題列、輸入框、清單容器）
   * @returns {string} HTML 字串
   */
  _renderSkeleton() {
    return `
      <div class="pw-page">
        <div class="pw-header">
          <button class="pw-back-btn" id="pw-back-btn">&#8592;</button>
          <h1 class="pw-title">📋 詞語簿設定</h1>
        </div>

        <div class="pw-add-bar">
          <input
            type="text"
            id="pw-input"
            class="pw-input"
            placeholder="輸入詞語，例如：大小"
            maxlength="20"
          />
          <button class="pw-add-btn" id="pw-add-btn">新增</button>
        </div>
        <p class="pw-error" id="pw-error"></p>

        <ul class="pw-list" id="pw-list"></ul>
      </div>
    `;
  }

  /**
   * 將詞語陣列渲染到清單容器
   * @param {string[]} words - 詞語陣列
   */
  _renderList(words) {
    const list = document.getElementById('pw-list');
    if (!list) return;

    if (words.length === 0) {
      list.innerHTML = '<li class="pw-empty">尚未新增任何詞語</li>';
      return;
    }

    list.innerHTML = words.map(word => `
      <li class="pw-item" data-word="${this._escapeHtml(word)}">
        <span class="pw-word-text">${this._escapeHtml(word)}</span>
        <button class="pw-delete-btn" data-word="${this._escapeHtml(word)}" aria-label="刪除 ${this._escapeHtml(word)}">
          🗑️
        </button>
      </li>
    `).join('');

    // 綁定每個刪除按鈕的事件
    list.querySelectorAll('.pw-delete-btn').forEach(btn => {
      const handler = (e) => {
        const word = e.currentTarget.dataset.word;
        this._deleteWord(word);
      };
      btn.addEventListener('click', handler);
      // 記錄以供 destroy() 移除
      this._listeners.push({ el: btn, type: 'click', fn: handler });
    });
  }

  /**
   * 綁定新增按鈕、Enter 鍵、返回按鈕事件
   */
  _bindEvents() {
    // 新增按鈕
    const addBtn = document.getElementById('pw-add-btn');
    if (addBtn) {
      const addHandler = () => this._addWord();
      addBtn.addEventListener('click', addHandler);
      this._listeners.push({ el: addBtn, type: 'click', fn: addHandler });
    }

    // 輸入框 Enter 鍵
    const input = document.getElementById('pw-input');
    if (input) {
      const keyHandler = (e) => {
        if (e.key === 'Enter') this._addWord();
      };
      input.addEventListener('keydown', keyHandler);
      this._listeners.push({ el: input, type: 'keydown', fn: keyHandler });
    }

    // 返回按鈕
    const backBtn = document.getElementById('pw-back-btn');
    if (backBtn) {
      const backHandler = () => UIManager.back();
      backBtn.addEventListener('click', backHandler);
      this._listeners.push({ el: backBtn, type: 'click', fn: backHandler });
    }
  }

  /**
   * 新增詞語：讀取輸入框 → 驗證 → arrayUnion 寫入 Firestore → 同步 AppState
   */
  async _addWord() {
    const input = document.getElementById('pw-input');
    const errorEl = document.getElementById('pw-error');
    if (!input || !errorEl) return;

    const word = input.value.trim();

    // 清空錯誤訊息
    errorEl.textContent = '';

    // 驗證：不可為空
    if (!word) {
      errorEl.textContent = '請輸入詞語';
      return;
    }

    // 防止重複（先做 UI 層快速檢查）
    if (AppState.words && AppState.words.includes(word)) {
      errorEl.textContent = '此詞語已存在';
      input.value = '';
      return;
    }

    // 防止按鈕重複點擊
    const addBtn = document.getElementById('pw-add-btn');
    if (addBtn) addBtn.disabled = true;

    try {
      const uid = AppState.uid;
      // arrayUnion 確保 Firestore 層級也不重複
      await FirestoreAPI.update(`users/${uid}`, {
        my_words: arrayUnion(word)
      });

      // 同步更新 AppState
      if (!Array.isArray(AppState.words)) AppState.words = [];
      if (!AppState.words.includes(word)) {
        AppState.words = [...AppState.words, word];
      }

      // 清空輸入框並重新渲染清單
      input.value = '';
      this._renderList(AppState.words);
      // 重新綁定刪除事件（renderList 內含）

      UIManager.showToast(`已新增「${word}」`, 'success', 2000);
    } catch (e) {
      console.error('[ParentWordsPage] 新增詞語失敗', e);
      errorEl.textContent = '新增失敗，請稍後再試';
    } finally {
      if (addBtn) addBtn.disabled = false;
    }
  }

  /**
   * 刪除詞語：arrayRemove 從 Firestore 移除 → 同步 AppState → 重新渲染
   * @param {string} word - 要刪除的詞語
   */
  async _deleteWord(word) {
    try {
      const uid = AppState.uid;
      await FirestoreAPI.update(`users/${uid}`, {
        my_words: arrayRemove(word)
      });

      // 同步更新 AppState
      if (Array.isArray(AppState.words)) {
        AppState.words = AppState.words.filter(w => w !== word);
      }

      // 重新渲染清單
      this._renderList(AppState.words);

      UIManager.showToast(`已刪除「${word}」`, 'success', 2000);
    } catch (e) {
      console.error('[ParentWordsPage] 刪除詞語失敗', e);
      UIManager.showToast('刪除失敗，請稍後再試', 'error', 2000);
    }
  }

  /**
   * 注入頁面所需 CSS（含重複注入防護）
   */
  _injectStyles() {
    const STYLE_ID = 'parent-words-page-styles';
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .pw-page {
        max-width: 600px;
        margin: 0 auto;
        padding: 16px;
        font-family: 'Noto Sans TC', sans-serif;
        min-height: 100vh;
        box-sizing: border-box;
      }

      .pw-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }

      .pw-back-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        padding: 4px 8px;
        color: #555;
        line-height: 1;
      }

      .pw-back-btn:hover {
        color: #000;
      }

      .pw-title {
        font-size: 22px;
        font-weight: 700;
        color: #2c2c2c;
        margin: 0;
      }

      .pw-add-bar {
        display: flex;
        gap: 8px;
        margin-bottom: 6px;
      }

      .pw-input {
        flex: 1;
        padding: 10px 14px;
        font-size: 16px;
        border: 2px solid #ccc;
        border-radius: 10px;
        outline: none;
        transition: border-color 0.2s;
        font-family: 'Noto Sans TC', sans-serif;
      }

      .pw-input:focus {
        border-color: #5b8dee;
      }

      .pw-add-btn {
        padding: 10px 18px;
        font-size: 16px;
        font-weight: 600;
        background: #5b8dee;
        color: #fff;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.2s;
        font-family: 'Noto Sans TC', sans-serif;
        white-space: nowrap;
      }

      .pw-add-btn:hover:not(:disabled) {
        background: #3a6fdb;
      }

      .pw-add-btn:disabled {
        background: #aac2f5;
        cursor: not-allowed;
      }

      .pw-error {
        color: #e53935;
        font-size: 13px;
        min-height: 18px;
        margin: 0 0 12px 2px;
      }

      .pw-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .pw-empty {
        text-align: center;
        color: #999;
        padding: 32px 0;
        font-size: 15px;
      }

      .pw-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        margin-bottom: 8px;
        background: #f8f9fa;
        border-radius: 10px;
        border: 1px solid #e9ecef;
        transition: background 0.15s;
      }

      .pw-item:hover {
        background: #f0f4ff;
      }

      .pw-word-text {
        font-size: 18px;
        color: #2c2c2c;
        font-weight: 500;
        letter-spacing: 1px;
      }

      .pw-delete-btn {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        transition: background 0.15s;
        line-height: 1;
      }

      .pw-delete-btn:hover {
        background: #ffebee;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 防 XSS：跳脫 HTML 特殊字元
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 銷毀頁面：移除所有事件監聽，防止 memory leak
   * 規範：super.destroy() 無基底類別，直接清理
   */
  destroy() {
    // 移除所有已記錄的事件監聽
    this._listeners.forEach(({ el, type, fn }) => {
      if (el && el.removeEventListener) {
        el.removeEventListener(type, fn);
      }
    });
    this._listeners = [];
  }
}
