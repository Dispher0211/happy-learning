/**
 * SelectChildPage.js — 選擇子帳號頁面
 * Task 32（v4 修改：忘記密碼入口）
 * 依賴：firebase.js（T05）、auth.js（T48）、ui_manager.js（T28）
 */

import { FirestoreAPI } from '../firebase.js';
import { Auth } from '../auth.js';
import { UIManager } from '../ui/ui_manager.js';
import { AppState } from '../state.js';
import { PAGES } from '../ui/pages.js';

export class SelectChildPage {
  constructor() {
    /** @type {HTMLElement|null} 頁面容器 */
    this._container = null;

    /** @type {Array<{id:string, name:string, avatar:string}>} 子帳號清單 */
    this._children = [];

    /** @type {boolean} 是否顯示 PIN 輸入區 */
    this._pinVisible = false;

    /** @type {string} 目前輸入的 PIN 字串（最多4位）*/
    this._pinValue = '';

    /** @type {boolean} 是否正在設定新 PIN（忘記密碼流程）*/
    this._settingNewPin = false;

    /** @type {string} 新 PIN 第一次輸入的暫存值 */
    this._newPinFirst = '';

    /** @type {string|null} 新增子帳號時選擇的頭像 */
    this._selectedAvatar = '🐱';

    // 事件處理器參照（destroy 時移除用）
    this._boundHandleClick = this._handleClick.bind(this);
  }

  // ─────────────────────────────────────────
  // 公開方法
  // ─────────────────────────────────────────

  /**
   * 初始化頁面：讀取子帳號清單並渲染
   */
  async init() {
    // 注入 CSS（僅注入一次）
    this._injectStyles();

    // 取得 #app 容器
    this._container = document.getElementById('app');
    if (!this._container) {
      console.error('[SelectChildPage] 找不到 #app');
      return;
    }

    // 讀取子帳號清單
    await this._loadChildren();

    // 渲染主畫面
    this._render();

    // 掛載事件（事件委派至 #app）
    this._container.addEventListener('click', this._boundHandleClick);
  }

  /**
   * 清除事件監聽，釋放資源
   */
  destroy() {
    if (this._container) {
      this._container.removeEventListener('click', this._boundHandleClick);
    }
    this._container    = null;
    this._children     = [];
    this._pinValue     = '';
    this._pinVisible   = false;
    this._settingNewPin  = false;
    this._newPinFirst    = '';
    this._selectedAvatar = '🐱';
  }

  // ─────────────────────────────────────────
  // 子帳號選擇
  // ─────────────────────────────────────────

  /**
   * 選擇子帳號：設定 AppState，navigate 到卡片主頁
   * @param {string} childId
   */
  async selectChild(childId) {
    const child = this._children.find(c => c.id === childId);
    if (!child) return;

    // 設定 AppState 子帳號資訊
    AppState.childId     = childId;
    AppState.childName   = child.name;
    AppState.childAvatar = child.avatar;
    AppState.mode        = 'child';

    // 讀取該子帳號的個人進度（載入 stars、pokedex 等）
    try {
      const uid  = AppState.uid;
      const data = await FirestoreAPI.read(`users/${uid}/children/${childId}`);
      if (data) {
        AppState.stars   = data.stars   || { yellow_total: 0, blue_total: 0, red_total: 0, star_pokedex_count: 0 };
        AppState.pokedex = data.pokedex || {};
      }
    } catch (err) {
      console.error('[SelectChildPage] 讀取子帳號進度失敗', err);
      // 不阻擋進入主頁，使用預設值
    }

    // 導航到卡片主頁
    UIManager.navigate(PAGES.CARD);
  }

  // ─────────────────────────────────────────
  // 家長模式
  // ─────────────────────────────────────────

  /**
   * 顯示 PIN 輸入框 + 「忘記密碼？」按鈕（v4 新增）
   */
  enterParentMode() {
    this._pinVisible    = true;
    this._pinValue      = '';
    // 若非忘記密碼流程，重置 settingNewPin
    if (!this._settingNewPin) {
      this._settingNewPin = false;
      this._newPinFirst   = '';
    }
    this._renderPinPanel();
  }

  /**
   * 驗證 PIN：正確→家長模式；錯誤→toast
   * @param {string} pin
   */
  async verifyPin(pin) {
    if (!pin || pin.length !== 4) {
      UIManager.showToast('請輸入4位數密碼', 'warning', 2000);
      return;
    }

    try {
      const ok = await Auth.verifyParentPassword(pin);
      if (ok) {
        AppState.mode = 'parent';
        UIManager.navigate(PAGES.PARENT_HOME);
      } else {
        UIManager.showToast('密碼錯誤，請再試一次', 'error', 2000);
        this._pinValue = '';
        this._updatePinDots();
      }
    } catch (err) {
      console.error('[SelectChildPage] verifyPin 失敗', err);
      UIManager.showToast('驗證失敗，請稍後再試', 'error', 2000);
    }
  }

  /**
   * 忘記密碼：呼叫 Auth.resetParentPin()（v4 新增）
   */
  async forgotPin() {
    try {
      await Auth.resetParentPin();
      // Auth.resetParentPin() 成功後會引導重新驗證 Google 並設定新 PIN
      // 若流程在 auth.js 內部已完整完成，此處顯示完成訊息即可
      UIManager.showToast('密碼已重設，請用新密碼進入家長模式', 'success', 3000);
      this._pinValue      = '';
      this._settingNewPin = false;
      this._newPinFirst   = '';
      this._renderPinPanel();
    } catch (err) {
      // Auth.resetParentPin() 失敗時 auth.js 內已顯示 toast，此處靜默
      console.warn('[SelectChildPage] forgotPin 由 Auth 處理', err);
    }
  }

  // ─────────────────────────────────────────
  // 新增子帳號
  // ─────────────────────────────────────────

  /**
   * 新增子帳號：顯示輸入面板
   */
  addChild() {
    this._renderAddChildPanel();
  }

  // ─────────────────────────────────────────
  // 私有方法：讀取資料
  // ─────────────────────────────────────────

  /**
   * 從 Firestore 讀取子帳號清單
   */
  async _loadChildren() {
    try {
      const uid = AppState.uid;
      if (!uid) {
        console.warn('[SelectChildPage] AppState.uid 未設定');
        return;
      }
      const userData = await FirestoreAPI.read(`users/${uid}`);
      if (userData && Array.isArray(userData.children)) {
        this._children = userData.children;
      } else {
        this._children = [];
      }
    } catch (err) {
      console.error('[SelectChildPage] 讀取子帳號失敗', err);
      this._children = [];
    }
  }

  // ─────────────────────────────────────────
  // 私有方法：渲染
  // ─────────────────────────────────────────

  /**
   * 渲染整個頁面
   */
  _render() {
    if (!this._container) return;
    this._container.innerHTML = `
      <div class="scp-page">
        <div class="scp-header">
          <div class="scp-title">你好！請選擇小朋友：</div>
        </div>

        <!-- 子帳號卡片區 -->
        <div class="scp-children-grid" id="scp-children-grid">
          ${this._renderChildCards()}
        </div>

        <!-- 新增子帳號按鈕 -->
        <button class="scp-add-btn" data-action="add-child">
          <span class="scp-add-icon">＋</span>
          <span>新增小朋友</span>
        </button>

        <!-- 家長模式按鈕 -->
        <button class="scp-parent-btn" data-action="enter-parent">
          👪 進入家長模式
        </button>

        <!-- PIN 輸入區（預設隱藏）-->
        <div class="scp-pin-panel" id="scp-pin-panel" style="display:none;"></div>

        <!-- 新增子帳號面板（預設隱藏）-->
        <div class="scp-add-panel" id="scp-add-panel" style="display:none;"></div>
      </div>
    `;
  }

  /**
   * 產生子帳號卡片 HTML
   * @returns {string}
   */
  _renderChildCards() {
    if (this._children.length === 0) {
      return '<div class="scp-no-children">尚未建立子帳號，請先新增小朋友</div>';
    }
    return this._children.map(child => `
      <button class="scp-child-card" data-action="select-child" data-child-id="${child.id}">
        <div class="scp-child-avatar">${child.avatar || '🐱'}</div>
        <div class="scp-child-name">${this._escapeHtml(child.name)}</div>
      </button>
    `).join('');
  }

  /**
   * 產生 PIN 面板 HTML
   * @returns {string}
   */
  _buildPinPanelHTML() {
    // 決定面板標題
    let title = '輸入4位數家長密碼：';
    if (this._settingNewPin) {
      title = this._newPinFirst ? '請再輸入一次新密碼確認：' : '請設定新的4位數密碼：';
    }

    // 4個點點（已輸入顯示 ●，未輸入顯示 ＿）
    const dots = Array.from({ length: 4 }, (_, i) =>
      `<span class="scp-pin-dot ${i < this._pinValue.length ? 'filled' : ''}">
        ${i < this._pinValue.length ? '●' : '＿'}
      </span>`
    ).join('');

    return `
      <div class="scp-pin-inner">
        <div class="scp-pin-title">${title}</div>
        <div class="scp-pin-dots" id="scp-pin-dots">${dots}</div>
        <!-- 數字鍵盤 -->
        <div class="scp-numpad">
          ${[1,2,3,4,5,6,7,8,9].map(n =>
            `<button class="scp-num-btn" data-action="pin-digit" data-digit="${n}">${n}</button>`
          ).join('')}
          <button class="scp-num-btn scp-num-clear" data-action="pin-clear">清除</button>
          <button class="scp-num-btn" data-action="pin-digit" data-digit="0">0</button>
          <button class="scp-num-btn scp-num-del" data-action="pin-delete">⌫</button>
        </div>
        <!-- 操作按鈕 -->
        <div class="scp-pin-actions">
          <button class="scp-confirm-btn" data-action="pin-confirm">確認</button>
          ${!this._settingNewPin
            ? `<button class="scp-forgot-btn" data-action="forgot-pin">忘記密碼？</button>`
            : ''
          }
          <button class="scp-cancel-btn" data-action="pin-cancel">取消</button>
        </div>
      </div>
    `;
  }

  /**
   * 渲染（顯示）PIN 面板
   */
  _renderPinPanel() {
    const panel = document.getElementById('scp-pin-panel');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = this._buildPinPanelHTML();
  }

  /**
   * 渲染新增子帳號面板
   */
  _renderAddChildPanel() {
    const panel = document.getElementById('scp-add-panel');
    if (!panel) return;

    const avatars = ['🐱','🐶','🐻','🐼','🦊','🐸','🐯','🦁','🐨','🐧'];
    this._selectedAvatar = avatars[0];

    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="scp-add-inner">
        <div class="scp-add-title">新增小朋友</div>
        <div class="scp-add-field">
          <label>名稱：</label>
          <input type="text" id="scp-new-name" maxlength="10" placeholder="請輸入名稱" />
        </div>
        <div class="scp-add-field">
          <label>選擇頭像：</label>
          <div class="scp-avatar-grid">
            ${avatars.map((a, i) =>
              `<button class="scp-avatar-opt${i===0?' selected':''}" data-action="select-avatar" data-avatar="${a}">${a}</button>`
            ).join('')}
          </div>
        </div>
        <div class="scp-add-actions">
          <button class="scp-confirm-btn" data-action="confirm-add-child">建立</button>
          <button class="scp-cancel-btn"  data-action="cancel-add-child">取消</button>
        </div>
        <div class="scp-add-error" id="scp-add-error"></div>
      </div>
    `;
  }

  // ─────────────────────────────────────────
  // 私有方法：事件處理（委派）
  // ─────────────────────────────────────────

  /**
   * 統一 click 事件處理器
   * @param {MouseEvent} e
   */
  _handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {

      // ── 選擇子帳號 ──
      case 'select-child': {
        const childId = btn.dataset.childId;
        if (childId) this.selectChild(childId);
        break;
      }

      // ── 新增子帳號按鈕 ──
      case 'add-child':
        this.addChild();
        break;

      // ── 進入家長模式 ──
      case 'enter-parent':
        this._settingNewPin = false;
        this._newPinFirst   = '';
        this.enterParentMode();
        break;

      // ── PIN 輸入數字 ──
      case 'pin-digit': {
        if (this._pinValue.length < 4) {
          this._pinValue += btn.dataset.digit;
          this._updatePinDots();
          // 滿4位自動確認（延遲200ms讓使用者看到最後一位）
          if (this._pinValue.length === 4) {
            setTimeout(() => this._processPinConfirm(), 200);
          }
        }
        break;
      }

      // ── PIN 刪除一位 ──
      case 'pin-delete':
        this._pinValue = this._pinValue.slice(0, -1);
        this._updatePinDots();
        break;

      // ── PIN 清除全部 ──
      case 'pin-clear':
        this._pinValue = '';
        this._updatePinDots();
        break;

      // ── PIN 手動確認 ──
      case 'pin-confirm':
        this._processPinConfirm();
        break;

      // ── 忘記密碼（v4 新增）──
      case 'forgot-pin':
        this.forgotPin();
        break;

      // ── PIN 取消 ──
      case 'pin-cancel': {
        const panel = document.getElementById('scp-pin-panel');
        if (panel) panel.style.display = 'none';
        this._pinVisible    = false;
        this._pinValue      = '';
        this._settingNewPin = false;
        this._newPinFirst   = '';
        break;
      }

      // ── 選擇頭像 ──
      case 'select-avatar':
        this._selectedAvatar = btn.dataset.avatar;
        document.querySelectorAll('[data-action="select-avatar"]').forEach(b => {
          b.classList.toggle('selected', b === btn);
        });
        break;

      // ── 確認新增子帳號 ──
      case 'confirm-add-child':
        this._confirmAddChild();
        break;

      // ── 取消新增子帳號 ──
      case 'cancel-add-child': {
        const addPanel = document.getElementById('scp-add-panel');
        if (addPanel) addPanel.style.display = 'none';
        break;
      }

      default:
        break;
    }
  }

  // ─────────────────────────────────────────
  // 私有方法：PIN 處理
  // ─────────────────────────────────────────

  /**
   * 局部更新 PIN 點點顯示
   */
  _updatePinDots() {
    const dotsEl = document.getElementById('scp-pin-dots');
    if (!dotsEl) return;
    dotsEl.innerHTML = Array.from({ length: 4 }, (_, i) =>
      `<span class="scp-pin-dot ${i < this._pinValue.length ? 'filled' : ''}">
        ${i < this._pinValue.length ? '●' : '＿'}
      </span>`
    ).join('');
  }

  /**
   * 處理 PIN 確認邏輯
   * - settingNewPin=false → 驗證舊 PIN
   * - settingNewPin=true  → 兩次輸入確認新 PIN
   */
  async _processPinConfirm() {
    const pin = this._pinValue;
    if (pin.length !== 4) {
      UIManager.showToast('請輸入完整4位數密碼', 'warning', 2000);
      return;
    }

    if (this._settingNewPin) {
      // ── 設定新 PIN 流程 ──
      if (!this._newPinFirst) {
        // 第一次：暫存，要求確認
        this._newPinFirst = pin;
        this._pinValue    = '';
        this._renderPinPanel();
      } else {
        // 第二次：比對
        if (pin === this._newPinFirst) {
          try {
            await Auth.setParentPassword(pin);
            UIManager.showToast('密碼已設定完成', 'success', 2000);
            AppState.mode = 'parent';
            UIManager.navigate(PAGES.PARENT_HOME);
          } catch (err) {
            console.error('[SelectChildPage] 設定密碼失敗', err);
            UIManager.showToast('密碼設定失敗，請再試', 'error', 2000);
            this._pinValue    = '';
            this._newPinFirst = '';
            this._renderPinPanel();
          }
        } else {
          UIManager.showToast('兩次密碼不一致，請重新輸入', 'error', 2000);
          this._pinValue    = '';
          this._newPinFirst = '';
          this._renderPinPanel();
        }
      }
    } else {
      // ── 驗證現有 PIN ──
      await this.verifyPin(pin);
    }
  }

  // ─────────────────────────────────────────
  // 私有方法：新增子帳號確認
  // ─────────────────────────────────────────

  /**
   * 確認建立新子帳號，寫入 Firestore
   */
  async _confirmAddChild() {
    const nameInput = document.getElementById('scp-new-name');
    const errorEl   = document.getElementById('scp-add-error');
    if (!nameInput) return;

    const name = nameInput.value.trim();
    if (!name) {
      if (errorEl) errorEl.textContent = '請輸入名稱';
      return;
    }

    const avatar  = this._selectedAvatar || '🐱';
    const childId = `child_${Date.now()}`;
    const uid     = AppState.uid;
    if (!uid) {
      if (errorEl) errorEl.textContent = '請先登入';
      return;
    }

    try {
      // 使用 arrayUnion 附加子帳號（防重複由 id 唯一性保證）
      const { arrayUnion } = await import('../firebase.js');
      await FirestoreAPI.write(`users/${uid}`, {
        children: arrayUnion({ id: childId, name, avatar })
      });

      // 同步本地清單
      this._children.push({ id: childId, name, avatar });

      UIManager.showToast(`已新增 ${name}`, 'success', 2000);

      // 隱藏新增面板，刷新卡片格
      const addPanel = document.getElementById('scp-add-panel');
      if (addPanel) addPanel.style.display = 'none';
      this._refreshChildrenGrid();

      // 若尚未設定家長密碼，引導設定新 PIN
      const userData = await FirestoreAPI.read(`users/${uid}`);
      const hasPin   = !!(userData && userData.parent_password_hash);
      if (!hasPin) {
        this._settingNewPin = true;
        this._pinValue      = '';
        this._newPinFirst   = '';
        this._renderPinPanel();
        UIManager.showToast('請設定家長密碼（4位數）', 'info', 3000);
      }
    } catch (err) {
      console.error('[SelectChildPage] 新增子帳號失敗', err);
      if (errorEl) errorEl.textContent = '新增失敗，請稍後再試';
    }
  }

  /**
   * 局部刷新子帳號卡片格
   */
  _refreshChildrenGrid() {
    const grid = document.getElementById('scp-children-grid');
    if (grid) grid.innerHTML = this._renderChildCards();
  }

  // ─────────────────────────────────────────
  // 私有方法：樣式注入
  // ─────────────────────────────────────────

  /**
   * 動態注入 CSS（帶去重複 guard）
   */
  _injectStyles() {
    const STYLE_ID = 'scp-styles';
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .scp-page {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-height: 100%;
        padding: 24px 16px 40px;
        box-sizing: border-box;
        background: linear-gradient(180deg, #e8f4fd 0%, #f9f3ff 100%);
        font-family: 'Noto Sans TC', sans-serif;
      }
      .scp-header { width: 100%; max-width: 480px; margin-bottom: 24px; }
      .scp-title {
        font-size: 1.4rem;
        font-weight: bold;
        color: #4a3f6b;
        text-align: center;
      }
      .scp-children-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        justify-content: center;
        width: 100%;
        max-width: 480px;
        margin-bottom: 24px;
      }
      .scp-child-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 20px 24px;
        background: #fff;
        border: 2px solid #d5c9f0;
        border-radius: 20px;
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s;
        min-width: 110px;
      }
      .scp-child-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 6px 18px rgba(100,80,180,0.18);
        border-color: #a98ff5;
      }
      .scp-child-card:active { transform: scale(0.97); }
      .scp-child-avatar { font-size: 2.8rem; line-height: 1; }
      .scp-child-name { font-size: 1.05rem; color: #4a3f6b; font-weight: 600; }
      .scp-no-children {
        font-size: 0.95rem; color: #888;
        text-align: center; padding: 12px;
      }
      .scp-add-btn, .scp-parent-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 28px;
        border-radius: 40px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        margin-bottom: 12px;
        transition: background 0.2s, transform 0.1s;
        border: none;
      }
      .scp-add-btn {
        background: #f0ebff;
        color: #6c4fcf;
        border: 2px dashed #a98ff5;
      }
      .scp-add-btn:hover { background: #e2d9ff; }
      .scp-parent-btn {
        background: #fff3e0;
        color: #b25f00;
        border: 2px solid #ffc06a;
      }
      .scp-parent-btn:hover { background: #ffe8b0; }
      .scp-add-icon { font-size: 1.3rem; }
      .scp-pin-panel, .scp-add-panel {
        width: 100%;
        max-width: 400px;
        margin-top: 16px;
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        padding: 24px 20px;
        box-sizing: border-box;
      }
      .scp-pin-inner, .scp-add-inner { width: 100%; }
      .scp-pin-title, .scp-add-title {
        font-size: 1.1rem;
        font-weight: bold;
        color: #4a3f6b;
        text-align: center;
        margin-bottom: 16px;
      }
      .scp-pin-dots {
        display: flex;
        justify-content: center;
        gap: 16px;
        margin-bottom: 20px;
      }
      .scp-pin-dot {
        font-size: 1.6rem;
        color: #bbb;
        width: 36px;
        text-align: center;
        transition: color 0.15s;
      }
      .scp-pin-dot.filled { color: #7c5cbf; }
      .scp-numpad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-bottom: 16px;
      }
      .scp-num-btn {
        padding: 14px 0;
        font-size: 1.2rem;
        background: #f5f0ff;
        border: 1px solid #d5c9f0;
        border-radius: 12px;
        cursor: pointer;
        font-weight: 600;
        color: #4a3f6b;
        transition: background 0.15s;
      }
      .scp-num-btn:hover { background: #ede0ff; }
      .scp-num-btn:active { background: #c7b0ff; }
      .scp-num-clear { color: #b25f00; font-size: 0.9rem; }
      .scp-pin-actions, .scp-add-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      .scp-confirm-btn {
        padding: 10px 24px;
        background: #7c5cbf;
        color: #fff;
        border: none;
        border-radius: 30px;
        font-size: 1rem;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.2s;
      }
      .scp-confirm-btn:hover { background: #5e3fa0; }
      .scp-forgot-btn {
        padding: 10px 18px;
        background: transparent;
        color: #b25f00;
        border: 1px solid #ffc06a;
        border-radius: 30px;
        font-size: 0.9rem;
        cursor: pointer;
        transition: background 0.2s;
      }
      .scp-forgot-btn:hover { background: #fff3e0; }
      .scp-cancel-btn {
        padding: 10px 18px;
        background: #f0f0f0;
        color: #666;
        border: none;
        border-radius: 30px;
        font-size: 0.9rem;
        cursor: pointer;
      }
      .scp-cancel-btn:hover { background: #e0e0e0; }
      .scp-add-field { margin-bottom: 14px; }
      .scp-add-field label {
        display: block;
        font-size: 0.9rem;
        color: #666;
        margin-bottom: 6px;
      }
      .scp-add-field input[type="text"] {
        width: 100%;
        padding: 10px 14px;
        border: 1px solid #d5c9f0;
        border-radius: 10px;
        font-size: 1rem;
        box-sizing: border-box;
        outline: none;
      }
      .scp-add-field input[type="text"]:focus {
        border-color: #a98ff5;
        box-shadow: 0 0 0 3px rgba(169,143,245,0.2);
      }
      .scp-avatar-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .scp-avatar-opt {
        font-size: 1.6rem;
        width: 44px;
        height: 44px;
        background: #f5f0ff;
        border: 2px solid transparent;
        border-radius: 12px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
      }
      .scp-avatar-opt:hover   { background: #ede0ff; }
      .scp-avatar-opt.selected {
        border-color: #7c5cbf;
        background: #e8daff;
      }
      .scp-add-error {
        font-size: 0.85rem;
        color: #d32f2f;
        text-align: center;
        margin-top: 8px;
        min-height: 1.2em;
      }
    `;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────
  // 私有方法：工具
  // ─────────────────────────────────────────

  /**
   * HTML 跳脫，防 XSS
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
