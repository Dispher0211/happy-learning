/**
 * state.js — AppState 全域狀態管理
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：version.js（APP_VERSION）
 * v4 修改：
 *   - 新增 settings.soundOn（預設 true）
 *   - save() 改為 debounce 300ms
 *   - load() 版本遷移補強（缺 soundOn 補 true）
 *   - Proxy 監聽 stars / isOnline / pendingReviewCount
 */

import { APP_VERSION } from '../version.js'

// ─────────────────────────────────────────────
// 內部狀態物件（透過 Proxy 對外暴露）
// ─────────────────────────────────────────────
const _AppState = {

  // ── 使用者識別 ──
  uid:            null,   // Firebase Auth UID
  childName:      null,   // 目前選擇的子帳號名稱
  childAvatar:    null,   // 子帳號頭像（emoji 字串）
  currentMode:    'child', // 'child' | 'parent'

  // ── 頁面狀態 ──
  currentPage:       null,
  currentPageParams: {},

  // ── 卡片狀態 ──
  cardType:  'character', // 'character' | 'idiom' | 'word'
  cardIndex: 0,

  // ── 全域開關 ──
  zhuyinOn: true,   // 注音顯示開關
  isOnline: true,   // 網路狀態

  // ── 待審核數 ──
  pendingReviewCount: 0,

  // ── 星星資產 ──
  stars: {
    yellow_total:       0,   // 黃星（float，含半星）
    blue_total:         0,   // 藍星（integer）
    red_total:          0,   // 紅星（integer）
    star_pokedex_count: 0,   // 圖鑑進度計數（只加不扣）
  },

  // ── 圖鑑狀態（由 PokedexManager.init() 填入）──
  pokedex: {},

  // ── 本地資料快取 ──
  characters: [],   // 家長設定的生字清單
  idioms:     [],   // 家長設定的成語清單
  words:      [],   // 家長設定的詞語清單

  // ── 設定（含 v4 新增 soundOn）──
  settings: {
    soundOn:             true,      // v4：靜音開關，預設有聲
    zhuyinOn:            true,      // 注音顯示
    parent_review_mode:  'notify',  // 'notify' | 'all_ai' | 'all_parent'
    api_keys: {
      myScript: [],   // MyScript API Keys（最多3個）
      vision:   [],   // Google Vision API Keys
      gemini:   [],   // Google Gemini API Keys
    },
  },

  // ── 細粒度操作鎖（防連點/防競態）──
  locks: {
    submit_answer: false,   // 答題提交中
    hint:          false,   // 提示使用中
    navigation:    false,   // 頁面切換中
    handwriting:   false,   // 手寫辨識中
    animation:     false,   // 動畫播放中
    card_swipe:    false,   // 卡片滑動中
    star_merge:    false,   // 星星合成中
  },

  // ── API 使用量追蹤（每日重置）──
  apiUsage: {
    myScript: { todayCount: 0, lastReset: '' },
    vision:   { todayCount: 0, lastReset: '' },
    gemini:   { todayCount: 0, lastReset: '' },
  },

  // ─────────────────────────────────────────────
  // 內部 debounce 計時器（不序列化到 localStorage）
  // ─────────────────────────────────────────────
  _saveTimer: null,

  /**
   * save()
   * 將關鍵狀態序列化到 localStorage。
   * v4：改為 debounce 300ms，避免遊戲進行中頻繁寫入。
   * 無痕模式下 localStorage 不可用時靜默忽略，不拋出例外。
   */
  save() {
    // 清除上一個 debounce timer，重新計時
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      try {
        const data = JSON.stringify({
          uid:           this.uid,
          childName:     this.childName,
          childAvatar:   this.childAvatar,
          zhuyinOn:      this.zhuyinOn,
          stars:         this.stars,
          characters:    this.characters,
          idioms:        this.idioms,
          words:         this.words,
          settings:      this.settings,
          apiUsage:      this.apiUsage,
          _version:      APP_VERSION,  // 版本號，供 load() 遷移判斷
        })
        localStorage.setItem('happylearn_state', data)
      } catch (e) {
        // 無痕模式或 storage 已滿，靜默忽略
        console.warn('AppState.save 失敗（可能為無痕模式或儲存空間不足）', e)
      }
    }, 300)
  },

  /**
   * load()
   * 從 localStorage 讀回狀態。
   * v4：版本遷移補強，缺欄位補預設值，缺 soundOn 補 true。
   * 解析失敗時使用記憶體預設值，不崩潰。
   */
  load() {
    try {
      const raw = localStorage.getItem('happylearn_state')
      if (!raw) return  // 首次使用，無快取，使用預設值

      const data = JSON.parse(raw)

      // ── 基本欄位（缺值補 null / 預設）──
      this.uid          = data.uid          ?? null
      this.childName    = data.childName    ?? null
      this.childAvatar  = data.childAvatar  ?? null
      this.zhuyinOn     = data.zhuyinOn     ?? true

      // ── 星星：深度合併，缺欄位補 0 ──
      this.stars = {
        yellow_total:       0,
        blue_total:         0,
        red_total:          0,
        star_pokedex_count: 0,
        ...(data.stars || {}),
      }

      // ── 清單資料 ──
      this.characters = Array.isArray(data.characters) ? data.characters : []
      this.idioms     = Array.isArray(data.idioms)     ? data.idioms     : []
      this.words      = Array.isArray(data.words)      ? data.words      : []

      // ── settings：深度合併，確保 v4 新欄位有預設值 ──
      const savedSettings = data.settings || {}
      this.settings = {
        soundOn:            true,      // v4 新增預設值
        zhuyinOn:           true,
        parent_review_mode: 'notify',
        api_keys: { myScript: [], vision: [], gemini: [] },
        ...savedSettings,
        // api_keys 需再次合併，避免被整個 savedSettings 覆蓋
        api_keys: {
          myScript: [],
          vision:   [],
          gemini:   [],
          ...(savedSettings.api_keys || {}),
        },
      }
      // v4 補強：若舊版資料 soundOn 為 undefined，明確補 true
      if (this.settings.soundOn === undefined) {
        this.settings.soundOn = true
      }

      // ── apiUsage：深度合併 ──
      const savedUsage = data.apiUsage || {}
      this.apiUsage = {
        myScript: { todayCount: 0, lastReset: '', ...(savedUsage.myScript || {}) },
        vision:   { todayCount: 0, lastReset: '', ...(savedUsage.vision   || {}) },
        gemini:   { todayCount: 0, lastReset: '', ...(savedUsage.gemini   || {}) },
      }

    } catch (e) {
      // JSON 解析失敗或其他錯誤，使用記憶體中的預設值，不崩潰
      console.warn('AppState.load 失敗，使用預設值', e)
    }
  },

  /**
   * clear()
   * 清除 localStorage 中的狀態（登出時呼叫）。
   */
  clear() {
    try {
      localStorage.removeItem('happylearn_state')
    } catch (e) {
      // 無痕模式忽略
    }
  },
}

// ─────────────────────────────────────────────
// Proxy 包裝：監聽特定 key 的 set，自動通知 UI
// 使用 globalThis 可選鏈，避免 UIManager 尚未初始化時報錯
// ─────────────────────────────────────────────
export const AppState = new Proxy(_AppState, {
  set(target, key, value) {
    target[key] = value

    // 星星變動 → 通知 UIManager 更新頂部顯示
    if (key === 'stars') {
      globalThis.UIManager?.updateStarsDisplay?.(value)
    }

    // 網路狀態變動 → 通知 UIManager 更新離線/上線 badge
    if (key === 'isOnline') {
      globalThis.UIManager?.updateOnlineStatus?.(value)
    }

    // 待審核數變動 → 通知 UIManager 更新 🔔 badge
    if (key === 'pendingReviewCount') {
      globalThis.UIManager?.updatePendingReviews?.(value)
    }

    return true
  },
})

// 掛載到 globalThis，供無法 import 的模組（如 Service Worker）使用
// 注意：一般模組應透過 import { AppState } 使用，不依賴 globalThis
globalThis.AppState = AppState
