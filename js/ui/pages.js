/**
 * pages.js — 頁面路由常數定義
 * Task 29（v4 修改：補入 PARENT_WORDS / PARENT_IDIOMS，共 19 個常數）
 *
 * 所有模組透過此檔案取得頁面 ID，確保全文件一致性。
 * 禁止在其他模組中硬寫字串頁面 ID。
 */

export const PAGES = Object.freeze({

  // ── 系統頁面 ──────────────────────────────────────────
  /** 載入畫面（啟動 splash） */
  LOADING:         'loading',

  /** 登入頁（Google / Apple 登入） */
  LOGIN:           'login',

  /** 選擇孩子帳號頁 */
  SELECT_CHILD:    'select_child',

  /** 新手教學導覽頁 */
  TUTORIAL:        'tutorial',

  // ── 主要功能頁面 ──────────────────────────────────────
  /** 生字學習卡片頁 */
  CARD:            'card',

  /** 遊戲選單列表頁 */
  GAME_LIST:       'game_list',

  /** 遊戲進行頁（含遊戲容器） */
  GAME:            'game',

  // ── 收藏 / 統計頁面 ──────────────────────────────────
  /** 寶可夢圖鑑收藏頁 */
  POKEDEX:         'pokedex',

  /** 遺忘排名頁（高失敗率生字列表） */
  FORGET_RANK:     'forget_rank',

  // ── Overlay 頁面（render 至 #overlay-root） ───────────
  /** 筆順全螢幕 Overlay */
  STROKE_ORDER:    'stroke_order',

  /** 星星合成 Overlay */
  STAR_MERGE:      'star_merge',

  /** 圖鑑揭曉動畫 Overlay */
  POKEDEX_REVEAL:  'pokedex_reveal',

  // ── 家長端頁面 ────────────────────────────────────────
  /** 家長首頁 */
  PARENT_HOME:     'parent_home',

  /** 家長端：生字管理頁 */
  PARENT_CHARS:    'parent_chars',

  /** 家長端：詞語管理頁（v4 新增） */
  PARENT_WORDS:    'parent_words',

  /** 家長端：成語管理頁（v4 新增） */
  PARENT_IDIOMS:   'parent_idioms',

  /** 家長端：待審核作業頁 */
  PARENT_REVIEW:   'parent_review',

  /** 家長端：圖鑑管理頁 */
  PARENT_POKEDEX:  'parent_pokedex',

  /** 家長端：API 金鑰設定頁 */
  PARENT_API:      'parent_api',

});
