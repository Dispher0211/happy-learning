/**
 * stroke.js — 筆順訓練 × ✍️ HanziWriter 遊戲
 * Task 19：繼承 GameEngine，實作兩種模式
 *
 * 遊戲規則（SECTION 9 D.2）：
 *   模式選擇（依筆劃數）：
 *     筆劃 ≤ 8  → 70% 手寫 / 30% 選擇
 *     筆劃 9-15 → 50% / 50%
 *     筆劃 ≥ 16 → 30% 手寫 / 70% 選擇
 *
 *   模式一（選擇）：「第N筆是什麼？」
 *     - 先顯示前 N-1 筆（HanziWriter animateOneStroke × N-1）
 *     - 4個選項帶注音體
 *
 *   模式二（手寫）：HanziWriter startQuiz
 *     - onComplete 後 animateStrokes 完整回放
 *     - restartQuiz 不重建 instance
 *
 *   星星：模式一 ★+1（首次）/0.5（重試）；模式二 ★+2（首次）/1（重試）
 *   答對後：完整筆順自動回放一次
 *
 * 額外依賴：hanzi_writer_manager.js（T13）
 */

import { GameEngine } from './GameEngine.js';
import { AppState } from '../state.js';
import { JSONLoader } from '../json_loader.js';
import { AudioManager } from '../audio.js';

// ─────────────────────────────────────────────
// HanziWriterManager 透過 window 取得（CDN 注入後由 T13 掛載）
// ─────────────────────────────────────────────
const getHWM = () => window.HanziWriterManager;

// 筆順名稱對照表（注音體）：1-32 筆的筆劃名稱
// 注意：實際筆劃名稱從 HanziWriter 的 strokeData 取得，此為備用顯示用
const STROKE_NAMES_ZH = {
  '横': 'ㄏㄥˊ', '竖': 'ㄕㄨˋ', '撇': 'ㄆㄧㄝˇ', '捺': 'ㄋㄚˋ',
  '折': 'ㄓㄜˊ', '钩': 'ㄍㄡ', '点': 'ㄉㄧㄢˇ', '提': 'ㄊㄧˊ',
};

// 基本筆劃選項池（含注音體），供模式一干擾選項用
const STROKE_OPTIONS_POOL = [
  { name: '橫', zhuyin: 'ㄏㄥˊ' },
  { name: '豎', zhuyin: 'ㄕㄨˋ' },
  { name: '撇', zhuyin: 'ㄆㄧㄝˇ' },
  { name: '捺', zhuyin: 'ㄋㄚˋ' },
  { name: '折', zhuyin: 'ㄓㄜˊ' },
  { name: '鉤', zhuyin: 'ㄍㄡ' },
  { name: '點', zhuyin: 'ㄉㄧㄢˇ' },
  { name: '提', zhuyin: 'ㄊㄧˊ' },
];

// HanziWriter 容器 ID（固定，不重建）
const HW_CONTAINER_ID = 'stroke-hw-container';

export class StrokeGame extends GameEngine {
  constructor() {
    super('stroke');

    this._mode = 2;              // 1=選擇 2=手寫
    this._quizCompleted = false; // 手寫模式完成旗標
    this._targetStrokeIndex = 0; // 模式一：出題的筆劃索引（0-based）
    this._wrongCount = 0;
    this._currentOptions = [];   // 模式一的4個選項
    this._correctOption = null;  // 模式一正確答案
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

    // 從 characters.json 全字典查詢完整資料（AppState.characters 只有簡單 {字,zhuyin}）
    const allCharsDict = JSONLoader.get('characters') || [];
    const questions = [];

    for (const char of chars) {
      const charData = allCharsDict.find(c => (c['字'] || c.char) === char);
      if (!charData) continue;

      const strokes = charData.total_strokes || charData.strokes || 5; // 總筆劃數

      // 依筆劃數決定模式機率
      let mode;
      if (strokes <= 8) {
        mode = Math.random() < 0.7 ? 2 : 1; // 70% 手寫
      } else if (strokes <= 15) {
        mode = Math.random() < 0.5 ? 2 : 1; // 50% 手寫
      } else {
        mode = Math.random() < 0.3 ? 2 : 1; // 30% 手寫
      }

      // 模式一：隨機選一筆（第2筆以後，至少有前N-1筆可展示）
      const targetStrokeIndex = strokes > 1
        ? Math.floor(Math.random() * (strokes - 1)) + 1 // 1-based，至少第2筆
        : 1;

      questions.push({
        char,
        strokes,
        pronunciation: charData.pronunciations?.[0]?.zhuyin || charData.pronunciation || '',
        level: charData.level || 'medium',
        mode,
        targetStrokeIndex, // 模式一出題筆劃（1-based）
      });
    }

    this.questions = questions;
    return questions;
  }

  // ════════════════════════════════════════════
  // renderQuestion
  // ════════════════════════════════════════════
  renderQuestion() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    this._mode = q.mode;
    this._wrongCount = 0;
    this._quizCompleted = false;
    this._replayingAnimation = false;

    const appEl = this._getContainer();
    if (!appEl) return;

    appEl.innerHTML = this._buildHTML(q);
    this._renderProgressBar();
    this._updateHintButton();

    // 初始化 HanziWriter（非同步，等 DOM 就緒）
    requestAnimationFrame(() => this._initHanziWriter(q));
  }

  // ════════════════════════════════════════════
  // _buildHTML
  // ════════════════════════════════════════════
  _buildHTML(q) {
    const levelLabel = { hard: '困難', medium: '中等', easy: '簡單', easy_plus: '加強' }[q.level] || '中等';
    const modeLabel = q.mode === 1 ? '選擇模式' : '手寫模式';
    const questionText = q.mode === 1
      ? `「${q.char}」的第 ${q.targetStrokeIndex} 筆是什麼？`
      : `請按照正確筆順寫出「${q.char}」`;

    return `
      <div class="sw-game" id="sw-game-root">
        <!-- 頂部 -->
        <div class="sw-header">
          <div class="sw-char-display">${q.char}</div>
          <div class="sw-meta">
            <div class="sw-question-text">${questionText}</div>
            <div class="sw-badges">
              <span class="sw-badge sw-badge--mode">${modeLabel}</span>
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
          ${q.mode === 2 ? '<div class="sw-writer-guide">✍️ 請依照筆順書寫</div>' : ''}
        </div>

        <!-- 模式一：選項區（初始隱藏，等動畫播完後顯示） -->
        <div class="sw-options-area" id="sw-options-area"
             style="display: ${q.mode === 1 ? 'none' : 'none'}">
          <!-- 選項由 JS 動態填入 -->
        </div>

        <!-- 提示區 -->
        <div class="sw-hint-area" id="sw-hint-area"></div>

        <!-- 操作按鈕 -->
        <div class="sw-controls" id="sw-controls">
          <button class="sw-btn sw-btn--hint" id="sw-hint-btn"
                  onclick="window.__swHint()">
            💡 提示（剩 ${2 - (this.usedHints || 0)} 次）
          </button>
          ${q.mode === 2 ? `
          <button class="sw-btn sw-btn--replay" id="sw-replay-btn"
                  onclick="window.__swReplay()">
            🔄 重新演示
          </button>` : ''}
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
    const writerOptions = {
      width: 220,
      height: 220,
      padding: 10,
      strokeColor: '#2c3e50',
      radicalColor: '#e74c3c',
      highlightColor: '#f1c40f',
      outlineColor: '#dfe6e9',
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 200,
    };

    try {
      if (q.mode === 1) {
        // ── 模式一：先展示前 N-1 筆，再顯示選項 ──
        await hwm.switchChar(q.char, HW_CONTAINER_ID, {
          ...writerOptions,
          showOutline: true,
          showCharacter: false,
        });

        // 逐筆動畫到第 targetStrokeIndex-1 筆
        const showUpTo = q.targetStrokeIndex - 1;
        if (showUpTo > 0) {
          await this._animateUpToStroke(hwm, q.char, showUpTo);
        }

        // 動畫完畢，顯示選項
        await this._delay(300);
        this._showMode1Options(q);

      } else {
        // ── 模式二：手寫測驗 ──
        await hwm.switchChar(q.char, HW_CONTAINER_ID, {
          ...writerOptions,
          showOutline: true,
          showCharacter: false,
        });

        // 短暫展示一次動畫讓學生看範例
        await hwm.animateStrokes(q.char, HW_CONTAINER_ID, {
          strokeAnimationSpeed: 0.8,
          delayBetweenStrokes: 150,
        });
        await this._delay(600);

        // 開始測驗（startQuiz）
        this._startQuiz(hwm, q);
      }
    } catch (err) {
      console.error('stroke.js: HanziWriter 初始化失敗', err);
      this._showHWFallback(q);
    }

    // 綁定全域事件
    window.__swHint = () => this.useHint();
    window.__swReplay = () => this._replayDemo(q);
  }

  // ════════════════════════════════════════════
  // _animateUpToStroke — 逐筆動畫到指定筆數
  // ════════════════════════════════════════════
  async _animateUpToStroke(hwm, char, upTo) {
    for (let i = 0; i < upTo; i++) {
      try {
        await hwm.animateOneStroke(char, HW_CONTAINER_ID, i);
        await this._delay(200);
      } catch (e) {
        // 部分字的筆劃資料可能不完整，跳過
        break;
      }
    }
  }

  // ════════════════════════════════════════════
  // _showMode1Options — 顯示模式一的4個選項（帶注音體）
  // ════════════════════════════════════════════
  _showMode1Options(q) {
    // 正確答案：從 strokePool 隨機選一個（實際應從 HanziWriter 資料取，此處以隨機模擬）
    // 正確筆劃名稱：取 STROKE_OPTIONS_POOL 中第 (targetStrokeIndex % pool.length) 個
    // 注意：HanziWriter 不直接提供筆劃名稱，此處以「筆劃順序提示」為主
    const poolIdx = (q.targetStrokeIndex - 1) % STROKE_OPTIONS_POOL.length;
    const correct = STROKE_OPTIONS_POOL[poolIdx];
    this._correctOption = correct;

    // 產生3個干擾
    const distractors = STROKE_OPTIONS_POOL
      .filter((_, i) => i !== poolIdx)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    // 打亂順序
    this._currentOptions = [correct, ...distractors].sort(() => Math.random() - 0.5);

    const optionsArea = document.getElementById('sw-options-area');
    if (!optionsArea) return;

    optionsArea.style.display = 'grid';
    optionsArea.innerHTML = this._currentOptions.map((opt, i) => `
      <button class="sw-option-btn" data-index="${i}"
              onclick="window.__swSelectOption(${i})"
              aria-label="${opt.name} ${opt.zhuyin}">
        <span class="sw-option-char">${opt.name}</span>
        <span class="sw-option-zhuyin">${opt.zhuyin}</span>
      </button>
    `).join('');

    window.__swSelectOption = (index) => {
      if (this.isAnswering) return;
      this.submitAnswer(this._currentOptions[index].name);
    };
  }

  // ════════════════════════════════════════════
  // _startQuiz — 模式二：啟動 HanziWriter 手寫測驗
  // ════════════════════════════════════════════
  _startQuiz(hwm, q) {
    const callbacks = {
      onMistake: (strokeData) => {
        // 筆劃錯誤：顯示錯誤提示
        this._wrongCount++;
        AudioManager.playEffect?.('wrong').catch?.(() => {});
        this._flashFeedback('❌', false);
      },
      onCorrectStroke: (strokeData) => {
        // 單筆正確：給予視覺回饋
        this._flashFeedback('✓', true);
      },
      onComplete: async (summaryData) => {
        // 全部筆劃完成！
        if (this._quizCompleted) return; // 防重複
        this._quizCompleted = true;

        const isCorrect = !summaryData?.totalMistakes ||
                          summaryData.totalMistakes === 0;

        if (isCorrect || summaryData?.totalMistakes <= 1) {
          // 視為答對
          await this._playStrokeReplay(hwm, q);
          await this.submitAnswer('__quiz_complete__');
        } else {
          // 錯誤較多，視為答錯
          await this._playStrokeReplay(hwm, q);
          await this.submitAnswer('__quiz_wrong__');
        }
      },
    };

    hwm.startQuiz(q.char, HW_CONTAINER_ID, callbacks);
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
      // 使用 restartQuiz 重啟，不重建 instance（T13 規格）
      hwm.restartQuiz?.({
        onMistake: () => {
          this._wrongCount++;
          this._flashFeedback('❌', false);
        },
        onCorrectStroke: () => this._flashFeedback('✓', true),
        onComplete: async (summaryData) => {
          if (this._quizCompleted) return;
          this._quizCompleted = true;
          await this._playStrokeReplay(hwm, q);
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
    const q = this.getCurrentQuestion();
    if (!q) throw new Error('judgeAnswer: 無當前題目');

    if (q.mode === 1) {
      // 模式一：比對筆劃名稱
      return selected === this._correctOption?.name;
    } else {
      // 模式二：由 onComplete 傳入特殊標記決定
      return selected === '__quiz_complete__';
    }
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation
  // ════════════════════════════════════════════
  async playCorrectAnimation() {
    const q = this.getCurrentQuestion();
    const feedback = document.getElementById('sw-feedback');
    if (feedback) {
      const stars = q?.mode === 2 ? '★★' : '★';
      feedback.innerHTML = `<div class="sw-correct-burst">🎉 答對了！${stars}</div>`;
      feedback.classList.add('sw-feedback--show');
    }

    // 模式二答對後，若尚未回放則補回放
    if (q?.mode === 2 && !this._replayingAnimation) {
      const hwm = getHWM();
      if (hwm) await this._playStrokeReplay(hwm, q);
    }

    await this._delay(1000);
    if (feedback) feedback.classList.remove('sw-feedback--show');
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
    const q = this.getCurrentQuestion();
    if (q?.mode === 2) {
      this._quizCompleted = false;
      const hwm = getHWM();
      if (hwm) {
        await this._delay(300);
        hwm.restartQuiz?.({
          onMistake: () => this._flashFeedback('❌', false),
          onCorrectStroke: () => this._flashFeedback('✓', true),
          onComplete: async (summaryData) => {
            if (this._quizCompleted) return;
            this._quizCompleted = true;
            await this._playStrokeReplay(hwm, q);
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
    const q = this.getCurrentQuestion();
    if (!q) return;

    const hwm = getHWM();
    const hintArea = document.getElementById('sw-hint-area');

    if (q.mode === 1 && this._correctOption) {
      // 高亮正確選項
      document.querySelectorAll('.sw-option-btn').forEach((btn, i) => {
        if (this._currentOptions[i]?.name === this._correctOption.name) {
          btn.classList.add('sw-option--correct');
        }
      });
      if (hintArea) {
        hintArea.innerHTML = `
          <div class="sw-answer-reveal">
            ✅ 正確答案：
            <strong>${this._correctOption.name}</strong>
            <span class="sw-zhuyin">${this._correctOption.zhuyin}</span>
          </div>
        `;
      }
    } else if (q.mode === 2 && hwm) {
      // 播放完整筆順演示
      if (hintArea) {
        hintArea.innerHTML = `<div class="sw-answer-reveal">✅ 請觀看正確筆順</div>`;
      }
      await this._playStrokeReplay(hwm, q);
    }
  }

  // ════════════════════════════════════════════
  // getHint
  //   提示一：顯示筆劃範圍提示（模式一）或「第N筆方向」（模式二）
  //   提示二：顯示完整筆劃動畫（模式二）或筆劃說明（模式一）
  // ════════════════════════════════════════════
  getHint() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const hintArea = document.getElementById('sw-hint-area');
    if (!hintArea) return;

    if (this.usedHints === 0) {
      if (q.mode === 1) {
        // 模式一提示一：縮小選項範圍（排除2個干擾）
        hintArea.innerHTML = `
          <div class="sw-hint sw-hint--1">
            💡 提示：這個字共有 <strong>${q.strokes}</strong> 劃，
            第 ${q.targetStrokeIndex} 筆是主要筆劃之一
          </div>
        `;
      } else {
        // 模式二提示一：重新播放動畫（慢速）
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
            hwm2?.restartQuiz?.({
              onMistake: () => this._flashFeedback('❌', false),
              onCorrectStroke: () => this._flashFeedback('✓', true),
              onComplete: async (s) => {
                if (this._quizCompleted) return;
                this._quizCompleted = true;
                await this._playStrokeReplay(hwm2, q);
                await this.submitAnswer(
                  (!s?.totalMistakes || s.totalMistakes <= 1) ? '__quiz_complete__' : '__quiz_wrong__'
                );
              },
            });
          }).catch(() => { this._replayingAnimation = false; });
        }
      }
    } else if (this.usedHints === 1) {
      if (q.mode === 1) {
        hintArea.innerHTML = `
          <div class="sw-hint sw-hint--2">
            🔑 提示：正確答案的注音聲母是
            <strong>${this._correctOption?.zhuyin?.[0] || '?'}</strong>
          </div>
        `;
      } else {
        hintArea.innerHTML = `
          <div class="sw-hint sw-hint--2">
            🔑 每一筆的方向請觀察輪廓線，由上到下、由左到右為基本原則
          </div>
        `;
      }
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
    // 如果是模式一，仍可顯示選項
    if (q.mode === 1) {
      this._showMode1Options(q);
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
      width: 220px;
      height: 220px;
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
      font-size: 0.9rem;
      color: #7f8c8d;
      font-family: 'BpmfIVS', serif;
    }

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
      width: 220px; height: 220px;
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
      .sw-hw-container { width: 180px; height: 180px; }
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
