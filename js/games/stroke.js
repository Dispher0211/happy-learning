/**
 * stroke.js — 筆順訓練 × ✍️ HanziWriter 遊戲
 * Task 19：繼承 GameEngine，純手寫筆順模式
 *
 * 遊戲規則（SECTION 9 D.2 簡化版）：
 *   全部題目 → 手寫模式（依筆順描繪完整字）
 *
 *   星星：★+1（首次答對）/ ★+0.5（重試答對）
 *   答對後：完整筆順自動回放一次
 *
 * 額外依賴：hanzi_writer_manager.js（T13）
 */

import { GameEngine } from './GameEngine.js';
import { AppState } from '../state.js';
import { JSONLoader } from '../json_loader.js';
import { AudioManager } from '../audio.js';
import { HanziWriterManager } from '../hanzi_writer_manager.js';

// ─────────────────────────────────────────────
// HanziWriterManager 直接從模組匯入（不透過 window）
// ─────────────────────────────────────────────
const getHWM = () => HanziWriterManager;

// HW 容器 ID（固定，不重建）
const HW_CONTAINER_ID = 'stroke-hw-container';

// ─────────────────────────────────────────────
// _renderZhuyinPv2(pron) — 直式注音渲染（pv2 格式，與 CardPage 一致）
// ─────────────────────────────────────────────
function _renderZhuyinPv2(pron) {
  if (!pron) return '';
  const INITIALS = new Set('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ');
  const MEDIALS  = new Set('ㄧㄨㄩ');
  const TONES    = new Set(['ˊ','ˇ','ˋ','˙']);

  let src = pron, tone = '';
  if (src.startsWith('˙')) { tone = '˙'; src = src.slice(1); }
  else if (src.length > 0 && TONES.has(src[src.length - 1])) {
    tone = src[src.length - 1]; src = src.slice(0, -1);
  }

  let initial = '', medial = '', final = '';
  for (const c of src) {
    if (INITIALS.has(c))     initial = c;
    else if (MEDIALS.has(c)) medial  = c;
    else                     final  += c;
  }

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const count = [initial, medial, final].filter(Boolean).length;
  const hasDot  = tone === '˙';
  const dotHtml = hasDot ? `<span class="pv2-dot">${esc(tone)}</span>` : '';
  const toneHtml = (tone && tone !== '˙')
    ? `<span class="pv2-tone">${esc(tone)}</span>`
    : `<span class="pv2-tone pv2-empty"></span>`;
  const toneCol = `<span class="pv2-tone-col"><span class="pv2-empty pv2-tone-spacer"></span>${toneHtml}<span class="pv2-empty pv2-tone-spacer"></span></span>`;
  const dotCls  = hasDot ? ' pv2--dot' : '';

  if (count <= 1) {
    const sym = initial || medial || final || src;
    return `<span class="pv2 pv2-a${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1 pv2-empty"></span><span class="pv2-r2">${esc(sym)}</span><span class="pv2-r3 pv2-empty"></span></span>${toneCol}</span>`;
  }
  if (count === 2) {
    const slots = [initial, medial, final].filter(Boolean);
    return `<span class="pv2 pv2-b${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1">${esc(slots[0])}</span><span class="pv2-r2 pv2-empty"></span><span class="pv2-r3">${esc(slots[1])}</span></span>${toneCol}</span>`;
  }
  return `<span class="pv2 pv2-c${dotCls}">${dotHtml}<span class="pv2-col"><span class="pv2-r1">${esc(initial)}</span><span class="pv2-r2">${esc(medial)}</span><span class="pv2-r3">${esc(final)}</span></span>${toneCol}</span>`;
}

export class StrokeGame extends GameEngine {
  constructor() {
    super('stroke');

    this._quizCompleted = false; // 手寫完成旗標
    this._wrongCount = 0;
    this._replayingAnimation = false; // 是否正在回放動畫（防重複觸發）
  }

  // ════════════════════════════════════════════
  // loadQuestions
  // ════════════════════════════════════════════
  async loadQuestions() {
    const chars = this.questionChars;
    if (!chars || chars.length === 0) {
      throw new Error('stroke: 題目字元為空');
    }

    const allCharsDict = JSONLoader.get('characters') || [];
    const questions = [];

    for (const char of chars) {
      const charData = allCharsDict.find(c => (c['字'] || c.char) === char);
      if (!charData) continue;

      const strokes = charData.total_strokes || charData.strokes || 5;

      questions.push({
        char,
        strokes,
        pronunciation: charData.pronunciations?.[0]?.zhuyin || charData.pronunciation || '',
        level: charData.level || 'medium',
        mode: 2, // 純手寫模式
      });
    }

    this.questions = questions;
    return questions;
  }

  // ════════════════════════════════════════════
  // renderQuestion
  // ════════════════════════════════════════════
  renderQuestion(question) {
    const q = question || this.currentQuestion;
    if (!q) return;

    this._wrongCount = 0;
    this._quizCompleted = false;
    this._replayingAnimation = false;

    // 清除舊 HanziWriter instance（DOM 即將被替換，必須先釋放）
    const hwm = getHWM();
    if (hwm) {
      try { hwm._safeStop?.(hwm._instances?.[HW_CONTAINER_ID]); } catch (_e) {}
      if (hwm._instances) delete hwm._instances[HW_CONTAINER_ID];
      if (hwm._requestIds) delete hwm._requestIds[HW_CONTAINER_ID];
      if (hwm._lastQuizCallbacks) delete hwm._lastQuizCallbacks[HW_CONTAINER_ID];
    }

    const container = this._getContainer();
    if (!container) return;

    container.innerHTML = this._buildHTML(q);
    this._renderProgressBar();
    this._updateHintButton();

    requestAnimationFrame(() => this._initHanziWriter(q));
  }

  // ════════════════════════════════════════════
  // _buildHTML
  // ════════════════════════════════════════════
  _buildHTML(q) {
    const levelLabel = { hard: '困難', medium: '中等', easy: '簡單', easy_plus: '加強' }[q.level] || '中等';

    return `
      <div class="sw-game" id="sw-game-root">
        <!-- 頂部 -->
        <div class="sw-header">
          <div class="sw-char-display">${q.char}</div>
          <div class="sw-meta">
            <div class="sw-question-text">請按照正確筆順寫出「${q.char}」</div>
            <div class="sw-badges">
              <span class="sw-badge sw-badge--mode">手寫模式</span>
              <span class="sw-badge sw-badge--${q.level}">${levelLabel}</span>
              <span class="sw-badge sw-badge--strokes">${q.strokes} 劃</span>
            </div>
          </div>
        </div>

        <!-- 進度條 -->
        <div class="sw-progress-bar">
          <div class="sw-progress-fill" id="sw-progress-fill"></div>
        </div>

        <!-- HanziWriter 容器 -->
        <div class="sw-writer-area">
          <div id="${HW_CONTAINER_ID}" class="sw-hw-container"
               aria-label="筆順練習區域"></div>
          <div class="sw-writer-guide">✍️ 請依照筆順書寫</div>
        </div>

        <!-- 提示區 -->
        <div class="sw-hint-area" id="sw-hint-area"></div>

        <!-- 操作按鈕 -->
        <div class="sw-controls" id="sw-controls">
          <button class="sw-btn sw-btn--hint" id="sw-hint-btn" disabled
                  onclick="window.__swHint?.()">
            💡 提示（剩 ${2 - (this.usedHints || 0)} 次）
          </button>
          <button class="sw-btn sw-btn--replay" id="sw-replay-btn" disabled
                  onclick="window.__swReplay?.()">
            🔄 重新演示
          </button>
        </div>

        <!-- 回饋遮罩 -->
        <div class="sw-feedback" id="sw-feedback"></div>
      </div>
    `;
  }

  // ════════════════════════════════════════════
  // _initHanziWriter — 初始化 HanziWriter
  // ════════════════════════════════════════════
  async _initHanziWriter(q) {
    const hwm = getHWM();
    if (!hwm) {
      console.error('stroke.js: HanziWriterManager 未載入');
      this._showHWFallback(q);
      return;
    }

    const container = document.getElementById(HW_CONTAINER_ID);
    if (!container) return;

    // 取得或建立 HanziWriter instance（HWM 保證同容器不重建）
    // 動態取得容器實際尺寸，確保平板手機上畫布填滿容器
    // 等待一個 rAF 確保 CSS vmin 已計算完成
    await new Promise(r => requestAnimationFrame(r));
    const containerSize = Math.max(container.offsetWidth || 0, container.offsetHeight || 0);
    const hwSize = containerSize > 20 ? containerSize : Math.min(Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.72), 340);
    const writerOptions = {
      width: hwSize,
      height: hwSize,
      padding: Math.round(hwSize * 0.045),
      strokeColor: '#2c3e50',
      radicalColor: '#e74c3c',
      highlightColor: '#f1c40f',
      outlineColor: '#dfe6e9',
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 200,
    };

    try {
      // 純手寫模式：先展示完整筆順動畫，再啟動 quiz
      await hwm.switchChar(q.char, HW_CONTAINER_ID, {
        ...writerOptions,
        showOutline: true,
        showCharacter: false,
      });

      // 展示一次完整筆順供學生參考
      await hwm.animateStrokes(q.char, HW_CONTAINER_ID, {
        strokeAnimationSpeed: 0.8,
        delayBetweenStrokes: 150,
      });
      await this._delay(600);

      // 開始手寫測驗
      await this._startQuiz(hwm, q);

    } catch (err) {
      console.error('stroke.js: HanziWriter 初始化失敗', err);
      this._showHWFallback(q);
    }

    // 綁定全域事件
    window.__swHint = () => this.useHint();
    window.__swReplay = () => this._replayDemo(q);
    // 啟用按鈕（初始化完成後才可點擊）
    const replayBtn = document.getElementById('sw-replay-btn');
    const hintBtn   = document.getElementById('sw-hint-btn');
    if (replayBtn) replayBtn.disabled = false;
    if (hintBtn)   hintBtn.disabled   = false;
  }

  // ════════════════════════════════════════════
  // ════════════════════════════════════════════
  // _startQuiz — 啟動 HanziWriter 手寫測驗
  //   instance 已由 _initHanziWriter 中的 switchChar 建立
  //   直接用 restartQuiz 啟動 quiz，不重建 instance
  // ════════════════════════════════════════════
  async _startQuiz(hwm, q) {
    const callbacks = {
      onMistake: (strokeData) => {
        this._wrongCount++;
        AudioManager.playEffect?.('wrong').catch?.(() => {});
        this._flashFeedback('❌', false);
      },
      onCorrectStroke: (strokeData) => {
        this._flashFeedback('✓', true);
      },
      onComplete: async (summaryData) => {
        if (this._quizCompleted) return;
        this._quizCompleted = true;

        const isCorrect = !summaryData?.totalMistakes ||
                          summaryData.totalMistakes <= 1;

        // 直接評分，不在此處重播（playCorrectAnimation 負責動畫和聲音）
        await this.submitAnswer(isCorrect ? '__quiz_complete__' : '__quiz_wrong__');
      },
    };

    // 確保字元隱藏、outline 顯示（quiz 模式需要）
    const writer = hwm._instances?.[HW_CONTAINER_ID];
    if (writer) {
      try {
        writer.hideCharacter({ duration: 0 });
        writer.showOutline({ duration: 0 });
        await this._delay(50); // 等待 DOM 更新完成
      } catch (_e) { /* 忽略 */ }
    }

    // 使用 restartQuiz（不重建 instance，直接在已有 instance 上啟動 quiz）
    const ok = hwm.restartQuiz(HW_CONTAINER_ID, callbacks);
    if (!ok) {
      console.error('stroke.js: _startQuiz restartQuiz 失敗，嘗試 startQuiz fallback');
      // Fallback：若 instance 不存在才用 startQuiz（會重建）
      hwm.startQuiz(q.char, HW_CONTAINER_ID, callbacks);
    }
  }

  // ════════════════════════════════════════════
  // _playStrokeReplay — 答對後完整筆順回放（模式二核心）
  // ════════════════════════════════════════════
  async _playStrokeReplay(hwm, q) {
    if (this._replayingAnimation) return;
    this._replayingAnimation = true;

    const replayBtn = document.getElementById('sw-replay-btn');
    if (replayBtn) replayBtn.disabled = true;

    try {
      // 等待短暫後播放完整筆順回放
      await this._delay(400);
      await hwm.animateStrokes(q.char, HW_CONTAINER_ID, {
        strokeAnimationSpeed: 0.7,
        delayBetweenStrokes: 300,
      });
    } catch (e) {
      console.warn('stroke.js: 筆順回放失敗', e);
    }

    this._replayingAnimation = false;
    if (replayBtn) replayBtn.disabled = false;
  }

  // ════════════════════════════════════════════
  // _replayDemo — 手動觸發重新演示（模式二）
  // ════════════════════════════════════════════
  async _replayDemo(q) {
    if (this._replayingAnimation || this._quizCompleted) return;
    const hwm = getHWM();
    if (!hwm) return;

    this._replayingAnimation = true;
    const replayBtn = document.getElementById('sw-replay-btn');
    if (replayBtn) replayBtn.disabled = true;

    try {
      // 先停止測驗，播放動畫，再重啟測驗（不重建 instance）
      hwm.pause?.();
      await hwm.animateStrokes(q.char, HW_CONTAINER_ID, {
        strokeAnimationSpeed: 0.8,
        delayBetweenStrokes: 200,
      });
      await this._delay(500);
      // 確保字元隱藏（quiz 模式需要）
      const writerR = hwm._instances?.[HW_CONTAINER_ID];
      if (writerR) {
        try { writerR.hideCharacter({ duration: 0 }); writerR.showOutline({ duration: 0 }); } catch (_e) {}
      }
      // 使用 restartQuiz 重啟，不重建 instance（T13 規格）
      hwm.restartQuiz?.(HW_CONTAINER_ID, {
        onMistake: () => {
          this._wrongCount++;
          this._flashFeedback('❌', false);
        },
        onCorrectStroke: () => this._flashFeedback('✓', true),
        onComplete: async (summaryData) => {
          if (this._quizCompleted) return;
          this._quizCompleted = true;
          const isCorrect = !summaryData?.totalMistakes || summaryData.totalMistakes <= 1;
          await this.submitAnswer(isCorrect ? '__quiz_complete__' : '__quiz_wrong__');
        },
      });
    } catch (e) {
      console.warn('stroke.js: restartQuiz 失敗', e);
    }

    this._replayingAnimation = false;
    if (replayBtn) replayBtn.disabled = false;
  }

  // ════════════════════════════════════════════
  // judgeAnswer
  // ════════════════════════════════════════════
  async judgeAnswer(selected) {
    // 手寫模式：由 onComplete 傳入特殊標記決定
    return { correct: selected === '__quiz_complete__' };
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation
  // ════════════════════════════════════════════
  async playCorrectAnimation(stars = 1) {
    // 答對音效
    if (AppState.settings?.soundOn !== false) {
      AudioManager.playEffect?.('correct')?.catch?.(() => {});
    }

    // 星星飛行動畫（飛向右上角星星計數器）
    this._flyStarsToHeader(Math.min(Math.ceil(stars), 4));

    // 畫面回饋
    const feedback = document.getElementById('sw-feedback');
    if (feedback) {
      feedback.innerHTML = `<div class="sw-correct-burst">🎉 答對了！${'★'.repeat(Math.ceil(stars))}</div>`;
      feedback.classList.add('sw-feedback--show');
    }

    await this._delay(900);
    if (feedback) feedback.classList.remove('sw-feedback--show');
  }

  // ════════════════════════════════════════════
  // _flyStarsToHeader — 星星飛向右上角計數器
  // ════════════════════════════════════════════
  _flyStarsToHeader(count) {
    if (typeof document === 'undefined' || count <= 0) return;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const star = document.createElement('div');
        star.textContent = '★';
        star.style.cssText = `
          position: fixed;
          font-size: 22px;
          color: #FFD700;
          text-shadow: 0 0 6px #FFA500;
          pointer-events: none;
          z-index: 9999;
          left: ${25 + Math.random() * 50}%;
          top: ${40 + Math.random() * 20}%;
          transition: all 0.75s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          opacity: 1;
        `;
        document.body.appendChild(star);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          star.style.left = 'calc(100% - 80px)';
          star.style.top = '8px';
          star.style.opacity = '0';
          star.style.fontSize = '10px';
        }));
        setTimeout(() => star.remove(), 900);
      }, i * 100);
    }
  }

  // ════════════════════════════════════════════
  // playWrongAnimation
  // ════════════════════════════════════════════
  async playWrongAnimation() {
    const feedback = document.getElementById('sw-feedback');
    if (feedback) {
      feedback.innerHTML = '<div class="sw-wrong-burst">❌ 再試一次</div>';
      feedback.classList.add('sw-feedback--show');
      await this._delay(700);
      feedback.classList.remove('sw-feedback--show');
    }

    // 模式二：重啟測驗（不重建 instance）
    const q = this.currentQuestion;
    if (q?.mode === 2) {
      this._quizCompleted = false;
      const hwm = getHWM();
      if (hwm) {
        await this._delay(300);
        // 確保字元隱藏（quiz 模式需要）
        const writer2 = hwm._instances?.[HW_CONTAINER_ID];
        if (writer2) {
          try { writer2.hideCharacter({ duration: 0 }); writer2.showOutline({ duration: 0 }); } catch (_e) {}
        }
        hwm.restartQuiz?.(HW_CONTAINER_ID, {
          onMistake: () => this._flashFeedback('❌', false),
          onCorrectStroke: () => this._flashFeedback('✓', true),
          onComplete: async (summaryData) => {
            if (this._quizCompleted) return;
            this._quizCompleted = true;
            const isCorrect = !summaryData?.totalMistakes || summaryData.totalMistakes <= 1;
            await this.submitAnswer(isCorrect ? '__quiz_complete__' : '__quiz_wrong__');
          },
        });
      }
    }
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer — 答錯兩次顯示正確答案
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    const q = this.currentQuestion;
    if (!q) return;

    const hwm = getHWM();
    const hintArea = document.getElementById('sw-hint-area');

    // 播放完整筆順演示後自動進下一題
    if (hintArea) {
      hintArea.innerHTML = `<div class="sw-answer-reveal">✅ 請觀看正確筆順</div>`;
    }
    if (hwm) await this._playStrokeReplay(hwm, q);
    await this._delay(1500);
    await this.nextQuestion();
  }

  // ════════════════════════════════════════════
  // getHint
  //   提示一：顯示筆劃範圍提示（模式一）或「第N筆方向」（模式二）
  //   提示二：顯示完整筆劃動畫（模式二）或筆劃說明（模式一）
  // ════════════════════════════════════════════
  getHint() {
    const q = this.currentQuestion;
    if (!q) return;
    const hintArea = document.getElementById('sw-hint-area');
    if (!hintArea) return;

    if (this.usedHints === 0) {
      // 提示一：慢速重播筆順
      hintArea.innerHTML = `<div class="sw-hint sw-hint--1">💡 請觀看慢速筆順示範</div>`;
      const hwm = getHWM();
      if (hwm && !this._replayingAnimation) {
        this._replayingAnimation = true;
        hwm.animateStrokes(q.char, HW_CONTAINER_ID, {
          strokeAnimationSpeed: 0.4,
          delayBetweenStrokes: 500,
        }).then(() => {
          this._replayingAnimation = false;
          const hwm2 = getHWM();
          const writer3 = hwm2?._instances?.[HW_CONTAINER_ID];
          if (writer3) {
            try { writer3.hideCharacter({ duration: 0 }); writer3.showOutline({ duration: 0 }); } catch (_e) {}
          }
          hwm2?.restartQuiz?.(HW_CONTAINER_ID, {
            onMistake: () => this._flashFeedback('❌', false),
            onCorrectStroke: () => this._flashFeedback('✓', true),
            onComplete: async (s) => {
              if (this._quizCompleted) return;
              this._quizCompleted = true;
              const isCorrect = !s?.totalMistakes || s.totalMistakes <= 1;
              await this.submitAnswer(isCorrect ? '__quiz_complete__' : '__quiz_wrong__');
            },
          });
        }).catch(() => { this._replayingAnimation = false; });
      }
    } else if (this.usedHints === 1) {
      // 提示二：文字提示
      hintArea.innerHTML = `
        <div class="sw-hint sw-hint--2">
          🔑 每一筆的方向請觀察輪廓線，由上到下、由左到右為基本原則
        </div>
      `;
    }
  }

  // ════════════════════════════════════════════
  // _flashFeedback — 短暫顯示筆劃正確/錯誤回饋
  // ════════════════════════════════════════════
  _flashFeedback(text, isCorrect) {
    const feedback = document.getElementById('sw-feedback');
    if (!feedback) return;
    feedback.innerHTML = `<div class="sw-stroke-flash ${isCorrect ? 'sw-flash--ok' : 'sw-flash--miss'}">${text}</div>`;
    feedback.classList.add('sw-feedback--show');
    setTimeout(() => feedback.classList.remove('sw-feedback--show'), 400);
  }

  // ════════════════════════════════════════════
  // _showHWFallback — HanziWriter 載入失敗時的降級顯示
  // ════════════════════════════════════════════
  _showHWFallback(q) {
    const container = document.getElementById(HW_CONTAINER_ID);
    if (container) {
      container.innerHTML = `
        <div class="sw-fallback">
          <div class="sw-fallback-char">${q.char}</div>
          <div class="sw-fallback-note">（筆順動畫載入中...）</div>
        </div>
      `;
    }
  }

  // ════════════════════════════════════════════
  // _updateHintButton
  // ════════════════════════════════════════════
  _updateHintButton() {
    const btn = document.getElementById('sw-hint-btn');
    if (!btn) return;
    const remaining = 2 - (this.usedHints || 0);
    btn.textContent = `💡 提示（剩 ${remaining} 次）`;
    btn.disabled = remaining <= 0;
  }

  // ════════════════════════════════════════════
  // _renderProgressBar
  // ════════════════════════════════════════════
  _renderProgressBar() {
    const fill = document.getElementById('sw-progress-fill');
    if (!fill || !this.questions) return;
    const pct = (this.currentIndex / this.questions.length) * 100;
    fill.style.width = pct + '%';
  }

  // ════════════════════════════════════════════
  // destroy
  // ════════════════════════════════════════════
  destroy() {
    const hwm = getHWM();
    hwm?.pause?.();
    delete window.__swHint;
    delete window.__swReplay;
    delete window.__swSelectOption;
    super.destroy();
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─────────────────────────────────────────────
// CSS 動態注入
// ─────────────────────────────────────────────
(function injectStrokeStyles() {
  if (document.getElementById('sw-game-styles')) return;
  const style = document.createElement('style');
  style.id = 'sw-game-styles';
  style.textContent = `
    .sw-game {
      position: relative;
      width: 100%;
      min-height: 100vh;
      background: linear-gradient(160deg, #f8f0e3 0%, #fdf6ec 50%, #e8f4f0 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: 'Noto Serif TC', serif;
      color: #2c3e50;
      overflow: hidden;
    }

    /* ── 頂部 ── */
    .sw-header {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 20px 8px;
      background: rgba(255,255,255,0.7);
      backdrop-filter: blur(4px);
      border-bottom: 2px solid rgba(0,0,0,0.08);
      flex-wrap: wrap;
    }

    .sw-char-display {
      font-size: 4rem;
      font-weight: 900;
      color: #c0392b;
      text-shadow: 2px 2px 0 rgba(192,57,43,0.15);
      line-height: 1;
      min-width: 4.5rem;
    }

    .sw-meta { flex: 1; }

    .sw-question-text {
      font-size: 1.05rem;
      margin-bottom: 6px;
      color: #2c3e50;
    }

    .sw-badges { display: flex; gap: 6px; flex-wrap: wrap; }

    .sw-badge {
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: bold;
    }
    .sw-badge--mode     { background: #3498db; color: #fff; }
    .sw-badge--strokes  { background: #95a5a6; color: #fff; }
    .sw-badge--hard       { background: #e74c3c; color: #fff; }
    .sw-badge--medium     { background: #e67e22; color: #fff; }
    .sw-badge--easy       { background: #27ae60; color: #fff; }
    .sw-badge--easy_plus  { background: #2980b9; color: #fff; }

    /* ── 進度條 ── */
    .sw-progress-bar {
      width: 90%;
      height: 6px;
      background: rgba(0,0,0,0.08);
      border-radius: 3px;
      margin: 8px 0;
      overflow: hidden;
    }
    .sw-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #e74c3c, #f39c12);
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* ── HanziWriter 容器 ── */
    .sw-writer-area {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 8px 0;
    }

    .sw-hw-container {
      width: min(72vmin, 340px);
      height: min(72vmin, 340px);
      border: 3px solid #bdc3c7;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .sw-writer-guide {
      margin-top: 6px;
      font-size: 0.85rem;
      color: #7f8c8d;
    }

    /* ── 模式一：選項網格 ── */
    .sw-options-area {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      width: 90%;
      max-width: 400px;
      margin: 12px 0;
    }

    .sw-option-btn {
      padding: 14px 8px;
      border: 2px solid #bdc3c7;
      border-radius: 12px;
      background: #fff;
      cursor: pointer;
      font-family: inherit;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      transition: border-color 0.2s, background 0.2s, transform 0.15s;
    }
    .sw-option-btn:hover, .sw-option-btn:focus {
      border-color: #3498db;
      background: #eaf4fd;
      transform: scale(1.03);
    }
    .sw-option-btn:active { transform: scale(0.97); }

    .sw-option-char {
      font-size: 1.5rem;
      font-weight: bold;
      color: #2c3e50;
    }
    .sw-option-zhuyin {
      font-size: 0.95rem;
      color: #7f8c8d;
      display: inline-flex;
      justify-content: center;
    }

    /* pv2 直式注音核心（確保在遊戲頁生效）*/
    .sw-option-zhuyin .pv2,
    .sw-answer-reveal .pv2 {
      display: inline-flex;
      flex-direction: row;
      align-items: flex-start;
      vertical-align: middle;
      line-height: 1;
      font-family: 'BpmfIVS', serif;
    }
    .sw-option-zhuyin .pv2-col,
    .sw-answer-reveal .pv2-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
    }
    .sw-option-zhuyin .pv2-tone-col,
    .sw-answer-reveal .pv2-tone-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      min-width: 0.7em;
    }
    .sw-option-zhuyin .pv2-empty { visibility: hidden; }
    .sw-answer-reveal .pv2-empty { visibility: hidden; }
    .sw-option-zhuyin .pv2-b .pv2-r2 { visibility: hidden; }
    .sw-answer-reveal .pv2-b .pv2-r2 { visibility: hidden; }

    /* pv2 注音符號在 stroke 選項中的字體大小 */
    .sw-option-zhuyin .pv2-r1,
    .sw-option-zhuyin .pv2-r2,
    .sw-option-zhuyin .pv2-r3,
    .sw-option-zhuyin .pv2-tone { font-size: 0.85rem; min-width: 0.9em; }
    .sw-option-zhuyin .pv2-dot  { font-size: 0.75rem; }

    /* pv2 注音在答案揭示區 */
    .sw-answer-reveal .pv2-r1,
    .sw-answer-reveal .pv2-r2,
    .sw-answer-reveal .pv2-r3,
    .sw-answer-reveal .pv2-tone { font-size: 0.85rem; min-width: 0.9em; }

    .sw-option--correct {
      border-color: #27ae60 !important;
      background: #eafaf1 !important;
      box-shadow: 0 0 12px rgba(39,174,96,0.4);
    }

    /* ── 提示區 ── */
    .sw-hint-area {
      width: 90%;
      min-height: 40px;
      margin: 6px 0;
    }
    .sw-hint {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.92rem;
      animation: sw-appear 0.3s ease;
    }
    .sw-hint--1 { background: rgba(241,196,15,0.15); border-left: 4px solid #f1c40f; }
    .sw-hint--2 { background: rgba(52,152,219,0.12); border-left: 4px solid #3498db; }

    .sw-answer-reveal {
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(39,174,96,0.12);
      border-left: 4px solid #27ae60;
      font-size: 0.92rem;
      animation: sw-appear 0.3s ease;
    }
    .sw-zhuyin { margin-left: 8px; color: #7f8c8d; font-family: 'BpmfIVS', serif; }

    /* ── 控制按鈕 ── */
    .sw-controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: center;
      margin: 8px 0;
    }
    .sw-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 22px;
      font-size: 0.9rem;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.15s, opacity 0.15s;
    }
    .sw-btn:active { transform: scale(0.95); }
    .sw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .sw-btn--hint   { background: #3498db; color: #fff; }
    .sw-btn--replay { background: #8e44ad; color: #fff; }

    /* ── 回饋 ── */
    .sw-feedback {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 60;
    }
    .sw-feedback--show { opacity: 1; }

    .sw-correct-burst, .sw-wrong-burst {
      font-size: 2.5rem;
      font-weight: 900;
      animation: sw-burst 0.5s ease forwards;
    }
    .sw-correct-burst { color: #f1c40f; text-shadow: 0 0 20px rgba(241,196,15,0.8); }
    .sw-wrong-burst   { color: #e74c3c; }

    .sw-stroke-flash {
      font-size: 3rem;
      font-weight: 900;
    }
    .sw-flash--ok   { color: #27ae60; }
    .sw-flash--miss { color: #e74c3c; }

    /* ── 降級顯示 ── */
    .sw-fallback {
      width: min(72vmin, 340px); height: min(72vmin, 340px);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: #f8f9fa;
    }
    .sw-fallback-char { font-size: 5rem; color: #2c3e50; }
    .sw-fallback-note { font-size: 0.8rem; color: #95a5a6; margin-top: 8px; }

    @keyframes sw-appear {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes sw-burst {
      0%   { transform: scale(0.5); opacity: 0; }
      50%  { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(1);   opacity: 0; }
    }

    @media (max-width: 480px) {
      .sw-char-display { font-size: 3rem; }
    }
    
      /* ── RWD 平板（≥600px）── */
      @media (min-width: 600px) {
        .sw-char-display  { font-size: 5rem; }
        .sw-options-area  { max-width: 520px; }
      }
/* ── RWD 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .sw-game { max-width: 760px; margin: 0 auto; }
    }
  `;
  document.head.appendChild(style);
})();

export default StrokeGame;
