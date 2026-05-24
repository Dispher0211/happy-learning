/**
 * gemini.js — GeminiManager AI 造句判斷模組
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）
 * 位置：/js/gemini.js
 *
 * ═══════════════════════════════════════
 * 模型 Fallback 鏈（2026/04 最終策略）
 * ═══════════════════════════════════════
 *
 *  ① gemini-3.1-flash-lite-preview
 *     → 首選：最快（2.5x）、免費額度高、截圖確認可用
 *       免費：~15 RPM（Preview 模型可能更嚴，實測為準）
 *
 *  ② gemini-flash-latest
 *     → 永遠指向最新 Flash，截圖確認存在
 *       好處：模型退役後自動切換，程式碼不用改
 *
 *  ③ gemini-2.5-flash
 *     → 穩定版保險，10 RPM / 250 RPD 免費
 *
 *  ④ gemini-2.5-flash-lite
 *     → 最終保險，30 RPM / 1000 RPD 免費額度最高
 *
 *  規則：
 *    遇到 429 RESOURCE_EXHAUSTED → 跳下一個模型
 *    遇到其他錯誤（400/Key 無效）→ 換下一個 Key
 *    全部失敗 → { score: 0.0, reason: '...' }，不拋出
 */

import { AppState } from './state.js'

// ── 文字判斷 Fallback 鏈 ──
const TEXT_MODEL_CHAIN = [
  'gemini-flash-latest',            // 首選：永不退役 alias，穩定
  'gemini-2.5-flash',               // 備援：穩定版
  'gemini-2.5-flash-lite',          // 備援：RPD 最高（1000/天）
  'gemini-3.1-flash-lite-preview',  // 最終：preview 版，服務不穩定
]

const API_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`

export const GeminiManager = {

  // 目前使用中的模型（供外部查詢）
  CURRENT_MODEL: TEXT_MODEL_CHAIN[0],

  /**
   * judgeAnswer(question, answer, mode)
   *
   * 外層：依序嘗試 TEXT_MODEL_CHAIN 每個模型
   *   內層：依序嘗試每個 API Key
   *     成功     → 回傳結果
   *     429      → break 換模型
   *     其他錯誤 → 換下一個 Key
   *
   * @param {object} question  { character?, example_pattern?, example_sentence? }
   * @param {string} answer    學生答案
   * @param {3|4}    mode      3=照樣造句；4=自由造句
   * @returns {Promise<{ score: number, reason: string }>}
   */
  async judgeAnswer(question, answer, mode) {
    const keys = (AppState.settings?.api_keys?.gemini || [])
      .filter(k => k && k.trim())

    if (keys.length === 0) {
      return { score: 0.0, reason: '未設定 Gemini API Key' }
    }

    for (const model of TEXT_MODEL_CHAIN) {
      for (const key of keys) {
        try {
          const result = await this._call(key, model, question, answer, mode)
          this.CURRENT_MODEL = model
          return result
        } catch (e) {
          if (e.status === 429) {
            console.warn(`GeminiManager: [${model}] 429 Rate Limit，切換模型`)
            break  // 此模型已過載，跳出 Key 迴圈換下一個模型
          }
          console.warn(`GeminiManager: [${model}] key 失敗 — ${e.message}`)
        }
      }
    }

    return { score: 0.0, reason: '所有模型及 API Key 均失敗' }
  },

  /**
   * _call(key, model, question, answer, mode)
   * @throws {{ status: number, message: string }}
   */
  async _call(key, model, question, answer, mode) {
    const prompt = this._buildPrompt(question, answer, mode)

    const res = await fetch(API_URL(model, key), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(10000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0.1,
          maxOutputTokens: 150,
          topP:            0.8,
        },
      }),
    })

    if (!res.ok) {
      const err  = new Error(`HTTP ${res.status}`)
      err.status = res.status
      try {
        const body  = await res.json()
        err.message = `HTTP ${res.status}: ${body?.error?.message || ''}`
      } catch (_) {}
      throw err
    }

    const data  = await res.json()
    const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const clean = text.replace(/```json\n?|```\n?/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch (_e) {
      const match = clean.match(/\{[^}]+\}/)
      if (match) parsed = JSON.parse(match[0])
      else throw new Error('無法解析回應: ' + clean.slice(0, 80))
    }

    return {
      score:  Math.max(0, Math.min(1, Number(parsed.score) || 0)),
      reason: String(parsed.reason || '').slice(0, 50),
    }
  },

  /**
   * _buildPrompt — Section 3.8 完整 Prompt（不可省略）
   */
  _buildPrompt(question, answer, mode) {
    if (mode === 3) {
      return `你是國小低年級國語老師。請判斷學生的照樣造句。

句型：「${question.example_pattern}」
範例：「${question.example_sentence}」
學生答案：「${answer}」

評分標準（總分 1.0）：
- 符合句型結構 0.4 分
- 句子通順流暢 0.3 分
- 詞彙適合低年級 0.3 分

請只輸出 JSON，不要有其他文字：{"score": 數字, "reason": "15字以內的說明"}`
    }
    if (mode === 4) {
      return `你是國小低年級國語老師。請判斷學生用「${question.character}」造的句子。

學生答案：「${answer}」

評分標準（總分 1.0）：
- 正確使用「${question.character}」0.4 分
- 句子通順 0.3 分
- 有主語和述語（完整句子）0.3 分

請只輸出 JSON，不要有其他文字：{"score": 數字, "reason": "15字以內的說明"}`
    }
    return '{"score": 0, "reason": "未知模式"}'
  },

  /**
   * generateTypoQuestion({ char, word })
   *
   * 為不在 confusables.json 的生字，透過 AI 動態生成改錯別字題目
   *
   * Prompt：
   *   你是一位低年級國文老師，根據低年級小朋友，
   *   利用以下列詞語造出短句，20字以內，
   *   並列出生字的易混淆字。
   *   詞語：{word}。生字：{char}。
   *   不需要解釋，僅給出短句及3個易混淆字。
   *
   * 回傳 JSON：
   *   { sentence: string, wrong_position: number, wrong: string, confusables: [3字] }
   *   sentence  = 含錯字的短句（已把生字換成第一個混淆字）
   *   wrong_position = 錯字在 sentence 的索引（0 起算）
   *   wrong     = 替換的混淆字
   *   confusables = 3 個易混淆字（不含正確字）
   *
   * @param {{ char: string, word: string }} params
   * @returns {Promise<{ sentence:string, wrong_position:number, wrong:string, confusables:string[] }|null>}
   */
  async generateTypoQuestion({ char, word }) {
    const keys = (AppState.settings?.api_keys?.gemini || []).filter(k => k?.trim())
    if (keys.length === 0) return null

    const prompt = `你是一位低年級國文老師，根據低年級小朋友，利用以下詞語造出短句（20字以內），並列出該生字的3個易混淆字。
詞語：${word}。生字：${char}。
請直接輸出 JSON，格式如下，不要有其他文字：
{"correct_sentence":"正確短句","wrong":"第一個混淆字","confusables":["混淆字1","混淆字2","混淆字3"]}
要求：
1. correct_sentence 為語意正確的短句，包含「${char}」字，20字以內
2. confusables 為3個與「${char}」字形相近或音近的字，不含「${char}」本身
3. wrong 為 confusables[0]`

    // 只嘗試前 2 個模型（避免全部 429 時等待時間過長）
    const TYPO_MODEL_CHAIN = TEXT_MODEL_CHAIN.slice(0, 2);
    for (const model of TYPO_MODEL_CHAIN) {
      for (const key of keys) {
        try {
          const res = await fetch(API_URL(model, key), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000),
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 200, topP: 0.9 },
            }),
          })

          if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`)
            err.status = res.status
            throw err
          }

          const data = await res.json()
          const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
          const clean = raw.replace(/```json\n?|```\n?/g, '').trim()

          let parsed
          try {
            parsed = JSON.parse(clean)
          } catch (_) {
            const m = clean.match(/\{[\s\S]*?\}/)
            if (m) parsed = JSON.parse(m[0])
            else continue
          }

          const correctSentence = parsed.correct_sentence ?? parsed.sentence ?? ''
          const confusables     = (parsed.confusables ?? []).filter(
            c => c !== char && c.length === 1
          ).slice(0, 3)
          const wrong = parsed.wrong && parsed.wrong !== char
            ? parsed.wrong
            : confusables[0]

          if (!correctSentence || !wrong || confusables.length === 0) continue

          // 將正確句中的 char 換成 wrong，生成錯句
          const chars = [...correctSentence]
          const idx   = chars.indexOf(char)
          if (idx === -1) continue
          chars[idx] = wrong
          const wrongSentence = chars.join('')

          console.log(`[GeminiManager] generateTypoQuestion 成功 char=${char} word=${word} wrong=${wrong}`)
          return {
            sentence:       wrongSentence,
            correct_sentence: correctSentence,
            wrong_position: idx,
            wrong,
            confusables,
          }
        } catch (e) {
          if (e.status === 429) {
            console.warn(`GeminiManager: generateTypoQuestion [${model}] 429，切換模型`)
            break
          }
          console.warn(`GeminiManager: generateTypoQuestion [${model}] 失敗 — ${e.message}`)
        }
      }
    }

    console.warn('[GeminiManager] generateTypoQuestion 全部失敗，回傳 null')
    return null
  },
}
