/**
 * handwriting.js — HandwritingManager 手寫辨識備援機制
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）
 * 位置：/js/handwriting.js
 *
 * 備援順序：MyScript → Google Vision → Gemini Vision
 * 全部失敗：zhuyin → { fallback:'keyboard' }；chinese → { fallback:'retry' }
 *
 * Gemini Vision Fallback 鏈（與 gemini.js 同步）：
 *   ① gemini-3.1-flash-lite-preview  → 首選，最快，免費額度高
 *   ② gemini-flash-latest            → 永不退役 alias
 *   ③ gemini-2.5-flash               → 穩定版保險
 *   ④ gemini-2.5-flash-lite          → RPD 最高最終保險
 *
 * v4 Undo 介面：recordStroke / undoLastStroke / clearStrokes
 */

import { AppState } from './state.js'

// ── Vision Fallback 模型鏈（與 gemini.js 保持一致）──
const VISION_MODEL_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]

const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`

export const HandwritingManager = {

  _strokeStack: [],
  _maxStrokes:  20,

  // ─────────────────────────────────────────────
  // recognize — 主辨識入口
  // ─────────────────────────────────────────────

  async recognize(canvas, options = {}) {
    const mode       = options.mode || 'chinese'
    const geminiKeys = (AppState.settings?.api_keys?.gemini   || []).filter(k => k?.trim())
    const msKeys     = (AppState.settings?.api_keys?.myScript || []).filter(k => k?.trim())
    const visionKeys = (AppState.settings?.api_keys?.vision   || []).filter(k => k?.trim())

    // 整體 timeout 30s，防止所有模型串聯等待時畫面凍結
    const timeoutPromise = new Promise(resolve =>
      setTimeout(() => resolve({ fallback: mode === 'zhuyin' ? 'keyboard' : 'retry' }), 30000)
    )

    const recognizePromise = this._doRecognize(canvas, mode, geminiKeys, msKeys, visionKeys)

    return Promise.race([recognizePromise, timeoutPromise])
  },

  async _doRecognize(canvas, mode, geminiKeys, msKeys, visionKeys) {
    // ① Gemini Vision（免費額度高，優先使用）
    if (geminiKeys.length > 0) {
      const r = await this._callGeminiWithFallback(canvas, geminiKeys, mode)
      if (r) return r
    }

    // ② MyScript（付費，有設定才嘗試）
    for (const key of msKeys) {
      try {
        const r = await this._callMyScript(canvas, key, mode)
        if (r?.text) { this._incrementAPIUsage('myScript'); return { text: r.text } }
      } catch (e) {
        console.warn('HandwritingManager: MyScript 失敗', e.message)
      }
    }

    // ③ Google Vision（付費，有設定才嘗試）
    for (const key of visionKeys) {
      try {
        const r = await this._callVision(canvas, key)
        if (r?.text) { this._incrementAPIUsage('vision'); return { text: r.text } }
      } catch (e) {
        console.warn('HandwritingManager: Google Vision 失敗', e.message)
      }
    }

    return mode === 'zhuyin'
      ? { fallback: 'keyboard' }
      : { fallback: 'retry' }
  },

  // ─────────────────────────────────────────────
  // MyScript
  // ─────────────────────────────────────────────

  async _callMyScript(canvas, key, mode) {
    // MyScript key 格式：applicationKey:hmacKey（冒號分隔）
    const colonIdx = key.indexOf(':')
    if (colonIdx < 0) throw new Error('MyScript key 格式應為 applicationKey:hmacKey')
    const applicationKey = key.slice(0, colonIdx).trim()
    const hmacKey        = key.slice(colonIdx + 1).trim()
    if (!applicationKey || !hmacKey) throw new Error('MyScript key 格式應為 applicationKey:hmacKey')

    // 將 _strokeStack（{points:[{x,y}]}格式）轉為 MyScript 所需的 {x:[],y:[]} 格式
    const strokes = this._strokeStack
      .map((s, i) => {
        const pts = s.points ?? []
        return {
          id: `s${i}`,
          x:  pts.map(p => p.x),
          y:  pts.map(p => p.y),
        }
      })
      .filter(s => s.x.length > 0)

    const body = JSON.stringify({
      configuration: { lang: 'zh_TW' },
      xDPI: 96, yDPI: 96,
      contentType: 'Text',
      height: canvas.height, width: canvas.width,
      strokeGroups: [{ strokes }],
    })

    // HMAC-SHA512 簽名（Web Crypto API）
    const hmacHex = await this._hmacSha512Hex(hmacKey, body)

    const controller = new AbortController()
    const tid        = setTimeout(() => controller.abort(), 10000)
    try {
      const res = await fetch('https://cloud.myscript.com/api/v4.0/iink/batch', {
        method:  'POST',
        headers: {
          'Accept':         'application/json,application/vnd.myscript.jiix',
          'Content-Type':   'application/json',
          'applicationKey': applicationKey,
          'hmac':           hmacHex,
        },
        signal: controller.signal,
        body,
      })
      clearTimeout(tid)
      if (!res.ok) throw new Error(`MyScript HTTP ${res.status}`)
      const data = await res.json()
      const text = data?.label || data?.exports?.['application/vnd.myscript.jiix']?.label
      return text ? { text: text.trim() } : null
    } catch (e) { clearTimeout(tid); throw e }
  },

  // ─────────────────────────────────────────────
  // HMAC-SHA512（Web Crypto API）
  // ─────────────────────────────────────────────

  async _hmacSha512Hex(secret, message) {
    const enc     = new TextEncoder()
    const keyData = enc.encode(secret)
    const msgData = enc.encode(message)
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData,
      { name: 'HMAC', hash: 'SHA-512' },
      false, ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  },

  // ─────────────────────────────────────────────
  // Google Vision
  // ─────────────────────────────────────────────

  async _callVision(canvas, key) {
    const base64 = this._canvasToBase64(canvas)
    const res    = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${key}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(10000),
        body: JSON.stringify({
          requests: [{
            image:    { content: base64 },
            features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
          }],
        }),
      }
    )
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`)
    const data = await res.json()
    const text = data.responses?.[0]?.textAnnotations?.[0]?.description
    return text ? { text: text.trim().replace(/\s+/g, '') } : null
  },

  // ─────────────────────────────────────────────
  // Gemini Vision（多模型 Fallback）
  // ─────────────────────────────────────────────

  async _callGeminiWithFallback(canvas, keys, mode) {
    for (const model of VISION_MODEL_CHAIN) {
      for (const key of keys) {
        try {
          const r = await this._callGeminiOne(canvas, key, model, mode)
          if (r?.text) {
            this._incrementAPIUsage('gemini')
            return { text: r.text }
          }
        } catch (e) {
          if (e.status === 429) {
            console.warn(`HandwritingManager: Gemini Vision [${model}] 429，切換模型`)
            break
          }
          if (e.status === 503) {
            console.warn(`HandwritingManager: Gemini Vision [${model}] 503 過載，切換模型`)
            break
          }
          console.warn(`HandwritingManager: Gemini Vision [${model}] 失敗 — ${e.message}`)
        }
      }
    }
    return null
  },

  async _callGeminiOne(canvas, key, model, mode) {
    const base64   = this._canvasToBase64(canvas)
    const modeHint = mode === 'zhuyin' ? '注音符號（如ㄅㄆㄇㄈ）' : '中文字'

    const res = await fetch(GEMINI_URL(model, key), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(15000),
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: 'image/png', data: base64 } },
            { text: `這是一個小朋友手寫的${modeHint}圖片。請辨識圖片中的${modeHint}，只輸出辨識結果，不要任何解釋、標點或換行。` },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 20 },
      }),
    })

    if (!res.ok) {
      const err  = new Error(`Gemini Vision HTTP ${res.status}`)
      err.status = res.status
      try { const b = await res.json(); err.message = `${err.message}: ${b?.error?.message || ''}` } catch (_) {}
      throw err
    }
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    return text ? { text } : null
  },

  // ─────────────────────────────────────────────
  // 工具方法
  // ─────────────────────────────────────────────

  _canvasToBase64(canvas) {
    return canvas.toDataURL('image/png').split(',')[1]
  },

  _incrementAPIUsage(service) {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const usage = AppState.apiUsage?.[service]
      if (!usage) return
      if (usage.lastReset !== today) { usage.todayCount = 0; usage.lastReset = today }
      usage.todayCount++
    } catch (_e) {}
  },

  // ─────────────────────────────────────────────
  // v4 Undo 介面
  // ─────────────────────────────────────────────

  recordStroke(pathData) {
    this._strokeStack.push(pathData)
    if (this._strokeStack.length > this._maxStrokes) this._strokeStack.shift()
  },

  undoLastStroke() {
    this._strokeStack.pop()
    return [...this._strokeStack]
  },

  clearStrokes() {
    this._strokeStack = []
  },
}
