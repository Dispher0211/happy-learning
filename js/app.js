/**
 * app.js — 快樂學習 Happy Learning 主架構整合
 * Task 46（v4.1 規格）
 *
 * 初始化順序（v4 修正）：
 *   1. AppState.load()
 *   2. Service Worker 初始化
 *   3. JSONLoader.loadMultiple(['characters','radicals'])
 *   4. UIManager.init()
 *   5. AudioManager.init()
 *   6. SyncManager.initNetworkListener()
 *   7. Auth.init() → onAuthStateChanged callback 中執行：
 *        AppState.uid = user.uid
 *        await PokedexManager.init()   ← v4 修正：在 callback 內
 *        await WrongQueue.dailyDecay() ← v4 新增
 *        → route 到選子帳號畫面
 *
 * ⚠️ v4 重要：PokedexManager.init() 必須在 onAuthStateChanged callback 內呼叫，
 *             確保 AppState.uid 已設定，不可在 Auth.init() 之前呼叫。
 */

// ── 核心模組匯入 ──────────────────────────────────────────────────────────────
import { AppState }          from './state.js'
import { JSONLoader }        from './json_loader.js'
import { UIManager }         from './ui/ui_manager.js'
import { PAGES }             from './ui/pages.js'
import { AudioManager }      from './audio.js'
import { SyncManager }       from './sync.js'
import { Auth }              from './auth.js'
import { PokedexManager }    from './pokedex.js'
import { WrongQueue }        from './wrong_queue.js'

// ── Service Worker 初始化 ─────────────────────────────────────────────────────

/**
 * 向瀏覽器註冊 Service Worker（sw.js 位於根目錄）
 * 若瀏覽器不支援或已在 localhost 環境中失敗，靜默忽略
 */
async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[App] 此瀏覽器不支援 Service Worker，略過註冊')
    return
  }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js')
    console.log('[App] Service Worker 已註冊，scope：', registration.scope)

    // ── 自動更新機制 ──────────────────────────────────────────────
    // 偵測到新版 SW 進入 waiting 狀態時，自動發送 SKIP_WAITING
    // 讓新 SW 立即接管，下次 fetch 就用新快取
    // 開發時只需重新整理一次，不需要每次手動升版本號

    const autoUpdate = (reg) => {
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        // SW 接管後重新載入頁面
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload()
        }, { once: true })
      }
    }

    // 新版 SW 正在安裝
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' || registration.waiting) {
          autoUpdate(registration)
        }
      })
    })

    // 頁面已有 waiting 的新 SW（例如前次 skipWaiting 未完成）
    autoUpdate(registration)

    // 定期檢查更新（每 30 分鐘）
    setInterval(() => registration.update(), 30 * 60 * 1000)
    // ─────────────────────────────────────────────────────────────

  } catch (err) {
    // 開發環境或本機測試時可能失敗，不影響主流程
    console.warn('[App] Service Worker 註冊失敗（不影響主流程）：', err.message)
  }
}

// ── Auth 狀態變更回調 ─────────────────────────────────────────────────────────

/**
 * onAuthStateChanged 觸發時執行（v4 修正：所有需要 uid 的初始化放在此處）
 * @param {Object|null} user — Firebase Auth user 物件，null 表示已登出
 */
async function handleAuthStateChanged(user) {
  if (!user) {
    // 未登入 → 重置所有帳號相關狀態，再導向登入頁面
    console.log('[App] 未登入，清除 AppState 並導向登入頁面')
    AppState.reset()
    UIManager.navigate(PAGES.LOGIN)
    return
  }

  // 設定 AppState.uid（PokedexManager.init 需要此值）
  AppState.uid = user.uid
  console.log('[App] 已登入，uid：', user.uid)

  try {
    // v4 修正：PokedexManager.init() 在 callback 內呼叫，確保 uid 已設定
    await PokedexManager.init()
    console.log('[App] PokedexManager 初始化完成，AppState.pokedex：', AppState.pokedex)
  } catch (err) {
    // 圖鑑初始化失敗不阻止後續流程
    console.error('[App] PokedexManager.init() 失敗：', err)
  }

  try {
    // v4 新增：每日 WrongQueue decay（同日只執行一次，內部有日期鎖）
    await WrongQueue.dailyDecay()
    console.log('[App] WrongQueue.dailyDecay() 執行完成')
  } catch (err) {
    // decay 失敗不阻止後續流程
    console.error('[App] WrongQueue.dailyDecay() 失敗：', err)
  }

  // 導向選子帳號畫面
  UIManager.navigate(PAGES.SELECT_CHILD)
}

// ── 主要初始化流程 ─────────────────────────────────────────────────────────────

/**
 * App 主要初始化入口
 * 嚴格依照 v4 規格的初始化順序執行
 */
async function main() {
  console.log('[App] 快樂學習 Happy Learning 啟動中…')

  // ── 步驟 1：載入持久化狀態 ──────────────────────────────────────────────────
  // 從 localStorage 還原 soundOn、stars 等設定
  try {
    await AppState.load()
    console.log('[App] Step 1 完成：AppState.load()')
  } catch (err) {
    // AppState.load() 失敗時使用預設值繼續，不中止啟動
    console.error('[App] AppState.load() 失敗，使用預設值繼續：', err)
  }

  // ── 步驟 2：Service Worker 初始化 ──────────────────────────────────────────
  await initServiceWorker()
  console.log('[App] Step 2 完成：Service Worker')

  // ── 步驟 3：載入基礎 JSON 資料 ─────────────────────────────────────────────
  // 只載入 characters 與 radicals，其他 JSON 由各遊戲模組按需載入
  try {
    await JSONLoader.loadMultiple(['characters', 'radicals', 'idioms', 'idiom_dict'])
    console.log('[App] Step 3 完成：JSONLoader.loadMultiple([characters, radicals, idioms])')
  } catch (err) {
    // JSON 載入失敗記錄警告，不中止啟動（各模組有空陣列 fallback）
    console.warn('[App] JSON 載入部分失敗（各模組有空陣列 fallback）：', err)
  }

  // ── 步驟 4：初始化 UIManager（頁面容器準備就緒）──────────────────────────────
  try {
    UIManager.init()
    console.log('[App] Step 4 完成：UIManager.init()')
  } catch (err) {
    // UIManager 初始化失敗為致命錯誤，顯示錯誤並停止
    console.error('[App] UIManager.init() 失敗（致命）：', err)
    document.body.innerHTML =
      `<div style="padding:40px;color:#e74c3c;font-size:18px;text-align:center">
         ⚠️ 頁面初始化失敗，請重新整理<br>
         <small style="font-size:14px">${err.message}</small>
       </div>`
    return
  }

  // ── 步驟 5：初始化 AudioManager（音效系統）────────────────────────────────
  try {
    await AudioManager.init()
    console.log('[App] Step 5 完成：AudioManager.init()')
  } catch (err) {
    // 音效初始化失敗不影響主流程
    console.warn('[App] AudioManager.init() 失敗（不影響主流程）：', err)
  }

  // ── 步驟 6：初始化網路監聽（離線同步）─────────────────────────────────────
  try {
    SyncManager.initNetworkListener()
    console.log('[App] Step 6 完成：SyncManager.initNetworkListener()')
  } catch (err) {
    console.warn('[App] SyncManager.initNetworkListener() 失敗（不影響主流程）：', err)
  }

  // ── 步驟 7：初始化 Auth（含 onAuthStateChanged）─────────────────────────────
  // onAuthStateChanged callback 內才執行 PokedexManager.init() 與 WrongQueue.dailyDecay()
  try {
    Auth.init(handleAuthStateChanged)
    console.log('[App] Step 7 完成：Auth.init()（等待 onAuthStateChanged 回呼）')
  } catch (err) {
    console.error('[App] Auth.init() 失敗：', err)
    UIManager.showToast('認證系統初始化失敗，請重新整理頁面', 'error', 5000)
  }
}

// ── 啟動 ──────────────────────────────────────────────────────────────────────

// 等 DOM 完全載入後再執行（防止 #app / #overlay-root 尚未存在）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main)
} else {
  // DOMContentLoaded 已觸發（例如 defer script）
  main()
}
