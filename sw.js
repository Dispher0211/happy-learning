/**
 * service_worker.js — 離線快取 Service Worker
 * 快樂學習 Happy Learning v4.0.0
 *
 * ⚠️ SW 不支援 ES Module import，版本號直接用常數字串（與 version.js 保持一致）
 *
 * v4 快取策略：
 *   - /data/*.json    → Stale-While-Revalidate
 *   - HTML            → Network First（含離線 fallback）
 *   - JS / CSS        → Cache First（含回寫）
 *   - /audio/ /fonts/ → Cache First（含回寫）
 *
 * 修正（Bug fix）：
 *   - 所有 cache.put() 前加入 response.status === 200 檢查
 *   - 原因：音檔 Range Request 回傳 206 Partial Content，
 *           Cache API 不支援儲存 206 回應，會拋出 TypeError
 *   - 修正：只快取完整的 200 回應，206 讓瀏覽器直接使用，不存快取
 */

const APP_VERSION = '1.0.4'
const CACHE_NAME  = `happylearn-v${APP_VERSION}`

// ── 預快取清單 ──
const PRECACHE_URLS = [
  './',
  './index.html',
  './css/main.css',
  './css/card.css',
  './css/games.css',
  './css/parent.css',
  './css/animation.css',
  './js/app.js',
  './js/state.js',
  './js/firebase.js',
  './js/auth.js',
  './js/sync.js',
  './js/input_guard.js',
  './js/audio.js',
  './js/json_loader.js',
  './js/wrong_queue.js',
  './js/forgetting.js',
  './js/stars.js',
  './js/pokedex.js',
  './js/gemini.js',
  './js/handwriting.js',
  './js/hanzi_writer_manager.js',
  './js/page_history.js',
  './js/ui/pages.js',
  './js/ui/ui_manager.js',
  './js/games/GameConfig.js',
  './js/games/GameEngine.js',
  './version.js',
  './fonts/BpmfIVS.woff2',
  `./data/characters.json?v=${APP_VERSION}`,
  `./data/radicals.json?v=${APP_VERSION}`,
]

// ════════════════════════════════════════════
// install — 預快取關鍵資源
// ════════════════════════════════════════════
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache   = await caches.open(CACHE_NAME)
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url))
      )
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.warn(`SW: 預快取失敗，略過: ${PRECACHE_URLS[i]}`)
        }
      })
      await self.skipWaiting()
    })()
  )
})

// ════════════════════════════════════════════
// activate — 清除舊快取 + 立即接管
// ════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log(`SW: 刪除舊快取: ${name}`)
            return caches.delete(name)
          })
      )
      await self.clients.claim()
    })()
  )
})

// ════════════════════════════════════════════
// fetch — 依資源類型套用不同快取策略
// ════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url         = new URL(request.url)

  // 只處理同源請求（不攔截 Firebase / CDN / PokéAPI 等外部請求）
  if (url.origin !== self.location.origin) return

  const pathname = url.pathname

  // ── /data/*.json → Stale-While-Revalidate ──
  // 使用 includes 而非 startsWith，相容 GitHub Pages 子目錄路徑
  // 本機：/data/characters.json；GitHub Pages：/happy-learning/data/characters.json
  if (pathname.includes('/data/') && pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  // ── HTML → Network First ──
  if (
    request.headers.get('accept')?.includes('text/html') ||
    pathname === '/' ||
    pathname === '/happy-learning/' ||   // GitHub Pages 子目錄根路徑
    pathname.endsWith('.html')
  ) {
    event.respondWith(networkFirstWithFallback(request))
    return
  }

  // ── JS / CSS / fonts / audio → Cache First ──
  if (
    pathname.includes('/audio/')   ||
    pathname.includes('/fonts/')   ||
    pathname.endsWith('.js')        ||
    pathname.endsWith('.css')       ||
    pathname.endsWith('.woff2')     ||
    pathname.endsWith('.woff')      ||
    pathname.endsWith('.ogg')       ||
    pathname.endsWith('.mp3')
  ) {
    event.respondWith(cacheFirstWithFallback(request))
    return
  }

  // ── 其餘 → Network First ──
  event.respondWith(networkFirstWithFallback(request))
})

// ════════════════════════════════════════════
// 快取策略實作
// ════════════════════════════════════════════

/**
 * safePut(cache, request, response)
 * 修正：只快取 status === 200 的完整回應
 * 206 Partial Content（音檔 Range Request）不快取，避免 Cache API TypeError
 */
function safePut(cache, request, response) {
  if (response && response.status === 200) {
    cache.put(request, response.clone()).catch(() => {
      // 快取寫入失敗（空間不足等），靜默忽略，不影響主流程
    })
  }
  // status !== 200（包含 206）：直接略過，不存快取
}

/**
 * staleWhileRevalidate(request)
 * 先回快取（若有），同時背景 fetch 更新快取
 */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  // 背景更新（不等待，不阻塞回傳）
  const fetchPromise = fetch(request.clone())
    .then(response => {
      safePut(cache, request, response)
      return response
    })
    .catch(() => null)

  if (cached) return cached

  // 無快取 → 等待 fetch
  const response = await fetchPromise
  if (response) return response

  return new Response('', { status: 503, statusText: 'Service Unavailable' })
}

/**
 * networkFirstWithFallback(request)
 * 先嘗試網路；失敗時 fallback 到快取
 */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME)
      safePut(cache, request, response)
    }
    return response
  } catch (_err) {
    const cached = await caches.match(request)
    if (cached) return cached

    // SPA fallback：用 registration.scope 相容本機與 GitHub Pages 子目錄
    // self.registration.scope = 'https://domain/happy-learning/'
    // 直接 match scope 根路徑（即 index.html 所在位置）
    const indexFallback = await caches.match(self.registration.scope) ||
                          await caches.match(self.registration.scope + 'index.html')
    if (indexFallback) return indexFallback

    return new Response('', { status: 503, statusText: 'Offline' })
  }
}

/**
 * cacheFirstWithFallback(request)
 * 快取命中直接回傳；未命中則 fetch 並回寫（只存 200）
 */
async function cacheFirstWithFallback(request) {
  const cache  = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  if (cached) return cached

  try {
    const response = await fetch(request)
    safePut(cache, request, response)
    return response
  } catch (_err) {
    return new Response('', { status: 503, statusText: 'Offline' })
  }
}
