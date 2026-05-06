/**
 * audio.js — AudioManager 音效語音管理
 * 快樂學習 Happy Learning v4.0.0
 *
 * 依賴：state.js（AppState）
 * 位置：/js/audio.js
 *
 * v4：play() / playEffect() 開頭加靜音檢查
 *
 * 修正（Bug fix）：
 *   - playEffect() 加入 finalize 旗標，確保 _effectCount 只扣一次
 *   - 加入 Math.max(0, ...) 邊界保護，計數器永不低於 0
 *   - 修正前：onerror / onended / play().catch 可能各自觸發，導致 -5/-8 負數
 *   - 修正後：finalized 旗標確保只有第一次觸發才執行 resolve + 扣減
 */

import { AppState } from './state.js'

// ── GitHub Pages 子目錄相容：自動偵測路徑前綴 ──
// GitHub Pages 部署後 pathname 為 /happy-learning/...，需加前綴
// 本機開發（localhost）pathname 為 /，前綴為空字串
const _pathPrefix = location.pathname.startsWith('/happy-learning')
  ? '/happy-learning'
  : ''

export const AudioManager = {

  // ── 語音通道（互斥）──
  _voicePlayId:  0,
  _currentVoice: null,

  // ── 音效通道（最多 2 個同時）──
  _effectCount: 0,
  _maxEffects:  2,

  // ── 初始化狀態 ──
  _initialized: false,
  _ttsVoices:   [],

  /**
   * init() — 初始化（App 啟動時呼叫一次）
   */
  async init() {
    if (this._initialized) return
    this._initialized = true
    await this._loadTTSVoices()
  },

  /**
   * play(zhuyin) — 播放注音發音
   * 主方案：/audio/zhuyin/{注音}.ogg；備援：TTS
   * fallbackWord（選填）：OGG 不存在時改以 TTS 讀整詞，發音更自然
   * v4：soundOn=false 時立即 return
   */
  async play(zhuyin, fallbackWord) {
    if (AppState.settings?.soundOn === false) return Promise.resolve()
    if (!zhuyin) return

    const playId = ++this._voicePlayId
    this._stopVoice()

    try {
      // 音檔命名格式：直接使用注音字元（與 GitHub Pages 實際檔名一致）
      // 輕聲（˙）統一移至開頭，例如 ㄉㄜ˙ → ˙ㄉㄜ
      const normalizedZhuyin = zhuyin.endsWith('˙')
        ? '˙' + zhuyin.slice(0, -1)
        : zhuyin
      await this._playAudioFile(
        `${_pathPrefix}/audio/zhuyin/${encodeURIComponent(normalizedZhuyin)}.ogg`,
        playId
      )
    } catch (_err) {
      if (playId !== this._voicePlayId) return
      // 有 fallbackWord 時以整詞 TTS（自然），否則以注音字串 TTS（備援）
      const ttsText = fallbackWord || zhuyin
      console.warn(`AudioManager: 音檔不存在，降到 TTS: ${ttsText}`)
      await this._playTTS(ttsText, playId)
    }
  },

  /**
   * playEffect(name) — 播放音效
   * 最多 2 個同時；音效通道互不干擾語音通道
   *
   * v4：soundOn=false 時立即 return
   *
   * 修正：使用 finalize 旗標確保計數器只扣一次，
   *       防止 onerror / onended / play().catch 重複觸發導致負數
   */
  async playEffect(name) {
    if (AppState.settings?.soundOn === false) return Promise.resolve()
    if (this._effectCount >= this._maxEffects) return

    const audio = new Audio(`${_pathPrefix}/audio/effects/${name}.ogg`)
    this._effectCount++

    return new Promise((resolve) => {
      // ── finalize 旗標：確保只扣一次計數 ──
      let finalized = false
      const finalize = () => {
        if (!finalized) {
          finalized = true
          // 邊界保護：計數器不低於 0
          this._effectCount = Math.max(0, this._effectCount - 1)
          resolve()
        }
      }

      audio.onended = finalize

      audio.onerror = () => {
        console.warn(`AudioManager: 音效不存在: ${name}`)
        finalize()
      }

      audio.play().catch((err) => {
        console.warn(`AudioManager: play() 被攔截或失敗: ${name}`, err)
        finalize()
      })
    })
  },

  /** playCorrect() — 便捷方法：播放答對音效 */
  playCorrect() { return this.playEffect('correct') },

  /** playWrong() — 便捷方法：播放答錯音效 */
  playWrong()   { return this.playEffect('wrong') },

  /**
   * playQueue(items) — 依序播放注音陣列
   */
  async playQueue(items) {
    for (const item of items) {
      await this.play(item)
    }
  },

  /**
   * stopAll(options) — 停止播放
   * @param {{ voice?: boolean, effect?: boolean }} options  不傳時停止全部
   */
  stopAll(options = { voice: true, effect: true }) {
    if (options.voice !== false) {
      this._voicePlayId++
      this._stopVoice()
      try { speechSynthesis.cancel() } catch (_e) {}
    }
    // effect 通道讓 HTML Audio 自然結束（finalize 機制確保計數正確）
  },

  /**
   * onPageLeave() — 頁面離開時停止所有聲音
   */
  onPageLeave() {
    this.stopAll()
  },

  // ════════════════════════════════════════════
  // 私有方法
  // ════════════════════════════════════════════

  _playAudioFile(url, playId) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url)
      this._currentVoice = audio

      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error(`音檔載入失敗: ${url}`))

      audio.play().then(() => {
        if (playId !== this._voicePlayId) {
          audio.pause()
          resolve()
        }
      }).catch(reject)
    })
  },

  /**
   * _playTTS — Web Speech API 備援
   * Chrome bug：cancel 後等 100ms；watchdog 3 秒防 onend 不觸發
   */
  async _playTTS(text, playId) {
    const voice = this._getTTSVoice()

    return new Promise((resolve) => {
      try { speechSynthesis.cancel() } catch (_e) {}

      setTimeout(() => {
        if (playId !== this._voicePlayId) { resolve(); return }

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang  = 'zh-TW'
        utterance.rate  = 0.9
        if (voice) utterance.voice = voice

        const watchdog = setTimeout(() => {
          console.warn('AudioManager: TTS watchdog 觸發')
          try { speechSynthesis.cancel() } catch (_e) {}
          resolve()
        }, 3000)

        utterance.onend   = () => { clearTimeout(watchdog); resolve() }
        utterance.onerror = () => { clearTimeout(watchdog); resolve() }

        try {
          speechSynthesis.speak(utterance)
        } catch (_e) {
          clearTimeout(watchdog)
          resolve()
        }
      }, 100)
    })
  },

  /**
   * playWord(text) — 直接以 TTS 播放整個詞語（自然、不拆字）
   * 適用於詞語、成語等多字詞，rate 使用正常語速
   */
  async playWord(text) {
    if (AppState.settings?.soundOn === false) return Promise.resolve()
    if (!text) return

    const playId = ++this._voicePlayId
    this._stopVoice()

    return new Promise((resolve) => {
      try { speechSynthesis.cancel() } catch (_e) {}

      setTimeout(() => {
        if (playId !== this._voicePlayId) { resolve(); return }

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang  = 'zh-TW'
        utterance.rate  = 1.0   // 正常語速，不拆字所以自然流暢
        const voice = this._getTTSVoice()
        if (voice) utterance.voice = voice

        const watchdog = setTimeout(() => {
          try { speechSynthesis.cancel() } catch (_e) {}
          resolve()
        }, 4000)

        utterance.onend   = () => { clearTimeout(watchdog); resolve() }
        utterance.onerror = () => { clearTimeout(watchdog); resolve() }

        try {
          speechSynthesis.speak(utterance)
        } catch (_e) {
          clearTimeout(watchdog)
          resolve()
        }
      }, 100)
    })
  },

  _stopVoice() {
    if (this._currentVoice) {
      try { this._currentVoice.pause(); this._currentVoice.currentTime = 0 } catch (_e) {}
      this._currentVoice = null
    }
  },

  async _loadTTSVoices() {
    try {
      if (!('speechSynthesis' in window)) return
      this._ttsVoices = speechSynthesis.getVoices()

      if (this._ttsVoices.length === 0) {
        await new Promise(resolve => {
          speechSynthesis.addEventListener('voiceschanged', () => {
            this._ttsVoices = speechSynthesis.getVoices()
            resolve()
          }, { once: true })
          setTimeout(resolve, 2000)
        })
      }
    } catch (_e) {}
  },

  _getTTSVoice() {
    if (!this._ttsVoices.length) {
      try { this._ttsVoices = speechSynthesis.getVoices() } catch (_e) {}
    }
    return (
      this._ttsVoices.find(v => v.lang === 'zh-TW' && v.name.toLowerCase().includes('google')) ||
      this._ttsVoices.find(v => v.lang === 'zh-TW') ||
      null
    )
  },
}

// 掛到 window 供非 ES module 的遊戲（radical.js 等）使用
window.AudioManager = AudioManager
