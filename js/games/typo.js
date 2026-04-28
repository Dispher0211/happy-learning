/**
 * typo.js — 改錯別字 × 藏寶箱
 * Task 25：繼承 GameEngine，實作「改錯別字」遊戲邏輯
 *
 * 遊戲規格（SECTION 9 D.7）：
 *   題目來源：confusables.json
 *   模式比例：30% 找藏寶箱（模式一）/ 70% 手寫（模式二）
 *
 *   模式一（選擇題）：
 *     顯示含錯字的句子，4個寶箱供點選，其中一個寶箱放正確字
 *     答對：🗝️金鑰匙→寶箱蓋彈開→💰
 *     答錯兩次：寶箱鎖上，顯示正確答案及字義說明
 *
 *   模式二（手寫題）：
 *     點出句中錯字位置，再手寫正確的字
 *     手寫辨識失敗：{ fallback: 'retry' } → 「請再寫一次」，不計答錯
 *     [↩撤銷] 按鈕：呼叫 HandwritingManager.undoLastStroke() 重繪 canvas
 *
 *   注音規則：句子中非生字簿字依注音開關；生字簿字永遠純文字
 *
 *   提示一：「錯字是第N個字」
 *   提示二：「正確字的部首是...」
 *
 * 星星（依 GameConfig）：
 *   首次答對：★+2；重試：★+1
 *
 * 依賴模組：
 *   GameEngine.js（T14）、GameConfig.js（T15）
 *   state.js（T02）、firebase.js（T05）、audio.js（T08）
 *   forgetting.js（T09）、stars.js（T10）、wrong_queue.js（T11）
 *   sync.js（T12）、handwriting.js（T12.7）、json_loader.js（T06）
 */

import { GameEngine } from './GameEngine.js';
import { GameConfig } from './GameConfig.js';
import { AppState } from '../state.js';
import { JSONLoader } from '../json_loader.js';

// HandwritingManager 透過 globalThis 存取（避免循環依賴）
// globalThis.HandwritingManager 由 handwriting.js 掛載

// ─────────────────────────────────────────────────────────────────────────────
// 常數定義
// ─────────────────────────────────────────────────────────────────────────────

/** 模式一（選擇）出現的機率 */
const MODE1_RATIO = 0.3;

/** 藏寶箱選項數量 */
const CHEST_COUNT = 4;

/** 模式二手寫 canvas ID */
const CANVAS_ID = 'typo-handwriting-canvas';

/** 模式二子步驟：找錯字 / 手寫正確字 */
const SUBSTEP = Object.freeze({ FIND: 'find', WRITE: 'write' });

// ─────────────────────────────────────────────────────────────────────────────
// TypoGame 類別
// ─────────────────────────────────────────────────────────────────────────────

export class TypoGame extends GameEngine {
  /**
   * @param {object} options - 遊戲選項（傳入 GameEngine）
   */
  constructor(options = {}) {
    super('typo', options);

    /** @type {Array} confusables.json 全部資料 */
    this._allConfusables = [];

    /** @type {'mode1'|'mode2'} 目前題目的模式 */
    this._currentMode = null;

    /** @type {Array<string>} 模式一：4個寶箱內容（亂序） */
    this._chestOptions = [];

    /** @type {number|null} 模式一：正確寶箱的 index */
    this._correctChestIndex = null;

    /** @type {string} 模式二子步驟：SUBSTEP.FIND 或 SUBSTEP.WRITE */
    this._substep = SUBSTEP.FIND;

    /** @type {number|null} 模式二第一步：玩家點選的錯字 index（字元索引） */
    this._selectedWrongIndex = null;

    /** @type {boolean} 模式二手寫：是否已辨識完成 */
    this._hwRecognizing = false;

    /** @type {Function|null} 模式二手寫確認按鈕 handler（供 destroy 解除） */
    this._hwConfirmHandler = null;

    /** @type {Function|null} 模式二撤銷按鈕 handler */
    this._hwUndoHandler = null;

    /** @type {Function|null} 模式二清除按鈕 handler */
    this._hwClearHandler = null;

    /** @type {boolean} 防止模式二「請再寫一次」重複觸發 */
    this._hwRetrying = false;

    /** @type {Array<Function>} 所有需 destroy 時移除的 listener */
    this._eventListeners = [];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GameEngine 抽象方法實作
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 載入題目
   * 從 confusables.json 取得所有可用資料，
   * 依 AppState.characters 過濾（若有生字清單），隨機選出 N 題
   * @param {object} config - { count: number }
   */
  async loadQuestions(config) {
    const count = config?.count ?? 10;

    // 載入 confusables.json（JSONLoader 已含快取與 fallback）
    if (this._allConfusables.length === 0) {
      this._allConfusables = await JSONLoader.load('confusables') ?? [];
    }

    if (this._allConfusables.length === 0) {
      console.warn('[TypoGame] confusables.json 無資料，使用示範題');
      this._allConfusables = _getFallbackData();
    }

    // 優先選含生字簿字的題目；不足再補其他題
    const myChars = new Set(
      (AppState.characters ?? []).map(c => c.char ?? c['字'] ?? '')
    );

    let prioritized = [];
    let rest = [];

    for (const item of this._allConfusables) {
      if (myChars.has(item.correct) || myChars.has(item.wrong)) {
        prioritized.push(item);
      } else {
        rest.push(item);
      }
    }

    // 打亂後取 count 題
    const pool = [..._shuffle(prioritized), ..._shuffle(rest)];
    const selected = pool.slice(0, count);

    // 轉換為 GameEngine 標準 question 格式
    this.questions = selected.map(item => ({
      char: item.correct,        // 正確的字（作為 WrongQueue key）
      correct: item.correct,     // 正確字
      wrong: item.wrong,         // 句中出現的錯字
      sentence: item.sentence,   // 含錯字的句子
      wrongPosition: item.wrong_position ?? _findWrongPos(item.sentence, item.wrong),
      explanation: item.explanation ?? {},
      relatedChars: item.related_characters ?? [],
      radical: _getRadical(item.explanation, item.correct),
      // 模式由 renderQuestion 決定
      mode: Math.random() < MODE1_RATIO ? 'mode1' : 'mode2',
    }));
  }

  /**
   * 渲染目前題目到 #app
   * @param {object} question
   */
  renderQuestion(question) {
    const app = document.getElementById('app');
    if (!app) return;

    this._currentMode = question.mode;
    this._substep = SUBSTEP.FIND;
    this._selectedWrongIndex = null;
    this._hwRetrying = false;

    // 重置手寫相關 handler（每題重建）
    this._cleanupHandwritingListeners();

    // 建立 DOM
    app.innerHTML = `
      <div class="typo-game" id="typo-game-root">
        ${_renderHeader(this)}
        <div class="typo-content" id="typo-content">
          ${this._currentMode === 'mode1'
            ? this._renderMode1(question)
            : this._renderMode2FindStep(question)
          }
        </div>
        ${_renderHintBar(this)}
      </div>
    `;

    // 綁定模式一事件
    if (this._currentMode === 'mode1') {
      this._bindMode1Events(question);
    }
    // 模式二事件在 renderMode2FindStep 內綁定
    if (this._currentMode === 'mode2') {
      this._bindMode2FindEvents(question);
    }

    // 更新進度條
    this.updateProgress();
  }

  /**
   * 判斷答案是否正確
   * - 模式一：由 _bindMode1Events 直接呼叫 super.submitAnswer
   * - 模式二：分兩步，此處處理手寫辨識結果
   * @param {string|object} answer - 模式一=點選字；模式二={ recognized, step }
   * @returns {{ correct: boolean }}
   */
  async judgeAnswer(answer, question) {
    if (question.mode === 'mode1') {
      // 模式一：直接比對點選字與正確字
      const correct = answer === question.correct;
      return { correct };
    }

    // 模式二手寫步驟：answer = { recognized: string }
    if (answer && typeof answer === 'object' && 'recognized' in answer) {
      const { recognized } = answer;

      // 辨識失敗（空字串或 null）→ fallback: retry
      if (!recognized) {
        return { correct: false, fallback: 'retry' };
      }

      const correct = recognized.trim() === question.correct;
      return { correct };
    }

    return { correct: false };
  }

  /**
   * 答對動畫：🗝️ → 寶箱蓋彈開 → 💰
   * @param {number} stars
   */
  async playCorrectAnimation(stars) {
    const root = document.getElementById('typo-game-root');
    if (!root) return;

    // 顯示金鑰匙閃爍
    const keyEl = document.createElement('div');
    keyEl.className = 'typo-key-animation';
    keyEl.textContent = '🗝️';
    root.appendChild(keyEl);

    await _sleep(400);

    // 寶箱開啟
    const chest = root.querySelector('.typo-chest.selected, .typo-answer-chest');
    if (chest) {
      chest.classList.add('open');
      chest.querySelector('.chest-icon')
        && (chest.querySelector('.chest-icon').textContent = '💰');
    }

    // 星星數字浮現
    const starEl = document.createElement('div');
    starEl.className = 'typo-star-popup';
    starEl.textContent = `+★${stars}`;
    root.appendChild(starEl);

    await _sleep(1200);
    keyEl.remove();
    starEl.remove();
  }

  /**
   * 答錯動畫：寶箱搖晃
   */
  async playWrongAnimation() {
    const root = document.getElementById('typo-game-root');
    if (!root) return;

    const chests = root.querySelectorAll('.typo-chest, .typo-sentence-char.selected');
    chests.forEach(el => {
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 600);
    });

    await _sleep(700);
  }

  /**
   * 答錯兩次：寶箱鎖上，顯示正確答案與字義說明
   * @param {object} result
   */
  async showCorrectAnswer(result) {
    const content = document.getElementById('typo-content');
    if (!content) return;

    const q = this.currentQuestion;
    const explanation = q.explanation[q.correct] ?? '';
    const radical = q.radical ?? '';

    content.innerHTML = `
      <div class="typo-reveal">
        <div class="typo-reveal-locked">🔒</div>
        <div class="typo-reveal-answer">
          正確答案：<span class="typo-reveal-char">${q.correct}</span>
        </div>
        ${explanation
          ? `<div class="typo-reveal-explanation">字義：${explanation}</div>`
          : ''}
        ${radical
          ? `<div class="typo-reveal-radical">部首：${radical}</div>`
          : ''}
        <div class="typo-reveal-sentence">
          ${_highlightSentence(q.sentence, q.wrongPosition, q.correct)}
        </div>
      </div>
    `;
  }

  /**
   * 取得提示內容
   * @param {number} level - 1 或 2
   * @param {object} question
   * @returns {string} 提示文字
   */
  getHint(level, question) {
    if (level === 1) {
      const pos = (question.wrongPosition ?? 0) + 1;
      return `提示：錯字是第 ${pos} 個字`;
    }
    if (level === 2) {
      const radical = question.radical ?? '？';
      return `提示：正確字的部首是「${radical}」`;
    }
    return '';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 模式一 DOM 建立與事件綁定
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 建立模式一 HTML（顯示句子 + 4個寶箱）
   * @param {object} question
   * @returns {string} HTML 字串
   */
  _renderMode1(question) {
    // 準備 4 個寶箱選項：正確字 + 3 個干擾字
    const distractors = _pickDistractors(
      question.relatedChars,
      question.correct,
      this._allConfusables,
      3
    );
    const options = _shuffle([question.correct, ...distractors]);
    this._chestOptions = options;
    this._correctChestIndex = options.indexOf(question.correct);

    // 顯示含錯字的句子（注音依開關）
    const sentenceHtml = _renderSentenceWithZhuyin(
      question.sentence,
      question.wrongPosition,
      question.wrong
    );

    const chestsHtml = options.map((char, i) => `
      <div class="typo-chest" data-index="${i}" data-char="${char}">
        <div class="chest-lid">🪙</div>
        <div class="chest-icon">📦</div>
        <div class="chest-char">${char}</div>
      </div>
    `).join('');

    return `
      <div class="typo-mode1">
        <div class="typo-instruction">找出正確的字，打開寶箱！</div>
        <div class="typo-sentence mode1">${sentenceHtml}</div>
        <div class="typo-chests">${chestsHtml}</div>
      </div>
    `;
  }

  /**
   * 綁定模式一點選事件
   * @param {object} question
   */
  _bindMode1Events(question) {
    const chests = document.querySelectorAll('.typo-chest');
    chests.forEach(chest => {
      const handler = () => {
        if (this.isAnswering) return;
        const char = chest.dataset.char;
        chest.classList.add('selected');
        this.submitAnswer(char);
      };
      chest.addEventListener('click', handler);
      this._eventListeners.push({ el: chest, type: 'click', handler });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 模式二：第一步「找出錯字位置」
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 建立模式二第一步 HTML（點選句中錯字）
   * @param {object} question
   * @returns {string} HTML 字串
   */
  _renderMode2FindStep(question) {
    const chars = [...question.sentence];
    const charSpans = chars.map((ch, i) => {
      // 非漢字（標點、空白）不可點選
      const isHanzi = /[\u4e00-\u9fff]/.test(ch);
      return `<span
        class="typo-sentence-char ${isHanzi ? 'clickable' : ''}"
        data-index="${i}"
      >${ch}</span>`;
    }).join('');

    return `
      <div class="typo-mode2-find">
        <div class="typo-instruction">請點出句中的<strong>錯字</strong></div>
        <div class="typo-sentence mode2-find">${charSpans}</div>
        <div class="typo-mode2-hint">點選你認為寫錯的那個字</div>
      </div>
    `;
  }

  /**
   * 綁定模式二第一步事件
   * @param {object} question
   */
  _bindMode2FindEvents(question) {
    const spans = document.querySelectorAll('.typo-sentence-char.clickable');
    spans.forEach(span => {
      const handler = () => {
        if (this._substep !== SUBSTEP.FIND) return;
        if (this.isAnswering) return;

        const clickedIndex = parseInt(span.dataset.index, 10);

        // 視覺高亮
        spans.forEach(s => s.classList.remove('selected'));
        span.classList.add('selected');
        this._selectedWrongIndex = clickedIndex;

        // 判斷是否點到正確的錯字位置
        const isCorrectPos = clickedIndex === question.wrongPosition;

        if (!isCorrectPos) {
          // 點錯位置：搖晃，不記入答錯次數（僅視覺反饋）
          span.classList.add('shake');
          setTimeout(() => span.classList.remove('shake'), 600);
          this._selectedWrongIndex = null;
          return;
        }

        // 點到正確位置 → 進入手寫步驟
        this._substep = SUBSTEP.WRITE;
        this._renderMode2WriteStep(question);
      };
      span.addEventListener('click', handler);
      this._eventListeners.push({ el: span, type: 'click', handler });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 模式二：第二步「手寫正確字」
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 渲染模式二第二步（手寫區）
   * @param {object} question
   */
  _renderMode2WriteStep(question) {
    const content = document.getElementById('typo-content');
    if (!content) return;

    content.innerHTML = `
      <div class="typo-mode2-write">
        <div class="typo-instruction">
          請寫出正確的字（原句中「<span class="typo-wrong-char">${question.wrong}</span>」應改為？）
        </div>
        <div class="typo-canvas-wrap">
          <canvas id="${CANVAS_ID}" width="280" height="280"></canvas>
        </div>
        <div class="typo-hw-buttons">
          <button id="typo-btn-undo" class="typo-btn secondary">↩撤銷</button>
          <button id="typo-btn-clear" class="typo-btn secondary">清除</button>
          <button id="typo-btn-confirm" class="typo-btn primary">確認</button>
        </div>
        ${this._hwRetrying
          ? '<div class="typo-retry-msg">請再寫一次 ✏️</div>'
          : ''}
      </div>
    `;

    // 初始化 HandwritingManager canvas
    const hwManager = globalThis.HandwritingManager;
    if (hwManager) {
      hwManager.init(CANVAS_ID, { mode: 'hanzi' });
    } else {
      console.warn('[TypoGame] HandwritingManager 未載入，手寫功能不可用');
    }

    // 綁定撤銷
    const undoBtn = document.getElementById('typo-btn-undo');
    if (undoBtn) {
      this._hwUndoHandler = () => {
        globalThis.HandwritingManager?.undoLastStroke();
      };
      undoBtn.addEventListener('click', this._hwUndoHandler);
      this._eventListeners.push({ el: undoBtn, type: 'click', handler: this._hwUndoHandler });
    }

    // 綁定清除
    const clearBtn = document.getElementById('typo-btn-clear');
    if (clearBtn) {
      this._hwClearHandler = () => {
        globalThis.HandwritingManager?.clearCanvas(CANVAS_ID);
      };
      clearBtn.addEventListener('click', this._hwClearHandler);
      this._eventListeners.push({ el: clearBtn, type: 'click', handler: this._hwClearHandler });
    }

    // 綁定確認（送出手寫辨識）
    const confirmBtn = document.getElementById('typo-btn-confirm');
    if (confirmBtn) {
      this._hwConfirmHandler = async () => {
        if (this._hwRecognizing || this.isAnswering) return;
        this._hwRecognizing = true;
        confirmBtn.disabled = true;

        try {
          const hwManager = globalThis.HandwritingManager;
          if (!hwManager) {
            // 無手寫 SDK → 直接 retry
            await this._handleHwFallback(question);
            return;
          }

          const result = await hwManager.recognize(CANVAS_ID);

          if (!result || !result.candidates || result.candidates.length === 0) {
            // 辨識失敗 → fallback: retry
            await this._handleHwFallback(question);
            return;
          }

          const recognized = result.candidates[0];
          // 送進 GameEngine submitAnswer 流程
          await this.submitAnswer({ recognized });

        } catch (err) {
          console.error('[TypoGame] 手寫辨識錯誤:', err);
          await this._handleHwFallback(question);
        } finally {
          this._hwRecognizing = false;
          if (confirmBtn && !confirmBtn.closest('[data-destroyed]')) {
            confirmBtn.disabled = false;
          }
        }
      };
      confirmBtn.addEventListener('click', this._hwConfirmHandler);
      this._eventListeners.push({ el: confirmBtn, type: 'click', handler: this._hwConfirmHandler });
    }
  }

  /**
   * 手寫辨識失敗處理（fallback: retry）
   * 顯示「請再寫一次」，清空 canvas，不計入答錯
   * @param {object} question
   */
  async _handleHwFallback(question) {
    this._hwRetrying = true;
    globalThis.HandwritingManager?.clearCanvas(CANVAS_ID);
    this._renderMode2WriteStep(question);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 答對 / 答錯後的 UI 覆寫
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * GameEngine 答對後：連續模式自動進下一題，手動模式顯示按鈕
   * （由 GameEngine.onCorrect 呼叫 playCorrectAnimation 後處理）
   */

  /**
   * GameEngine 答錯第一次：顯示錯誤反饋
   * （GameEngine.onWrongFirstTime 呼叫 playWrongAnimation）
   * 模式二手寫若 fallback=retry：不計答錯，回到手寫畫面
   */

  // ───────────────────────────────────────────────────────────────────────────
  // 清理
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 清除手寫相關 event listener
   */
  _cleanupHandwritingListeners() {
    // 不從 _eventListeners 移除（destroy 統一處理）
    // 此處僅清除舊的 hwConfirmHandler 等，防止多次 renderMode2WriteStep 重複綁定
    if (this._hwConfirmHandler) {
      const btn = document.getElementById('typo-btn-confirm');
      if (btn) btn.removeEventListener('click', this._hwConfirmHandler);
      this._hwConfirmHandler = null;
    }
    if (this._hwUndoHandler) {
      const btn = document.getElementById('typo-btn-undo');
      if (btn) btn.removeEventListener('click', this._hwUndoHandler);
      this._hwUndoHandler = null;
    }
    if (this._hwClearHandler) {
      const btn = document.getElementById('typo-btn-clear');
      if (btn) btn.removeEventListener('click', this._hwClearHandler);
      this._hwClearHandler = null;
    }
  }

  /**
   * 釋放所有資源（由 GameEngine.destroy 呼叫）
   */
  destroy() {
    // 移除所有 event listener
    this._eventListeners.forEach(({ el, type, handler }) => {
      try { el.removeEventListener(type, handler); } catch (_) { /* 忽略 */ }
    });
    this._eventListeners = [];

    // 標記 canvas 已銷毀，防止 confirm handler 誤操作
    const root = document.getElementById('typo-game-root');
    if (root) root.dataset.destroyed = '1';

    // 清除手寫 canvas
    globalThis.HandwritingManager?.destroy?.(CANVAS_ID);

    // 呼叫父類別 destroy（處理 wrongPool、移除基本監聽）
    super.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 私有輔助函式
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 渲染遊戲標題列（進度 + 靜音按鈕）
 * @param {TypoGame} game
 * @returns {string}
 */
function _renderHeader(game) {
  return `
    <div class="typo-header">
      <div class="typo-title">🗝️ 改錯別字</div>
      <div class="typo-progress-wrap">
        <div class="typo-progress-bar">
          <div class="typo-progress-fill" id="typo-progress-fill"
            style="width: ${_progressPct(game)}%"></div>
        </div>
        <span class="typo-progress-text" id="typo-progress-text">
          ${game.currentIndex ?? 0}/${game.questions?.length ?? 0}
        </span>
      </div>
      <div class="typo-stars-display">⭐ ${_formatStars(game)}</div>
    </div>
  `;
}

/**
 * 渲染提示列
 * @param {TypoGame} game
 * @returns {string}
 */
function _renderHintBar(game) {
  return `
    <div class="typo-hint-bar">
      <button class="typo-hint-btn ${game.usedHints >= 1 ? 'used' : ''}"
        onclick="window._typoHint && window._typoHint(1)"
        ${game.usedHints >= 2 ? 'disabled' : ''}>
        💡 提示一 ${game.usedHints < 1 ? '(-0.5★)' : ''}
      </button>
      <button class="typo-hint-btn ${game.usedHints >= 2 ? 'used' : ''}"
        onclick="window._typoHint && window._typoHint(2)"
        ${game.usedHints >= 2 ? 'disabled' : ''}>
        🔍 提示二 ${game.usedHints < 2 ? '(-0.5★)' : ''}
      </button>
      <div class="typo-hint-content" id="typo-hint-content"></div>
    </div>
  `;
}

/**
 * 顯示模式一句子（含注音開關）
 * 錯字位置用特殊樣式標出（不提前揭露）
 * @param {string} sentence
 * @param {number} wrongPos
 * @param {string} wrongChar
 * @returns {string}
 */
function _renderSentenceWithZhuyin(sentence, wrongPos, wrongChar) {
  const chars = [...sentence];
  return chars.map((ch, i) => {
    const isWrong = i === wrongPos;
    return `<span class="typo-s-char ${isWrong ? 'wrong-target' : ''}">${ch}</span>`;
  }).join('');
}

/**
 * 揭曉正確答案時：句子中將錯字用正確字替換並高亮
 * @param {string} sentence
 * @param {number} wrongPos
 * @param {string} correctChar
 * @returns {string}
 */
function _highlightSentence(sentence, wrongPos, correctChar) {
  const chars = [...sentence];
  return chars.map((ch, i) => {
    if (i === wrongPos) {
      return `<span class="typo-corrected">${correctChar}</span>`;
    }
    return ch;
  }).join('');
}

/**
 * 從 relatedChars / confusables 中挑選干擾字
 * @param {Array<string>} relatedChars
 * @param {string} correct
 * @param {Array} allConfusables
 * @param {number} count
 * @returns {Array<string>}
 */
function _pickDistractors(relatedChars, correct, allConfusables, count) {
  // 先用 relatedChars（同一組易混字）
  const candidates = (relatedChars ?? [])
    .filter(c => c !== correct && c.length === 1);

  // 不足則從其他 confusables 補充
  if (candidates.length < count) {
    for (const item of allConfusables) {
      if (item.correct !== correct) {
        candidates.push(item.correct, item.wrong);
      }
      if (candidates.length >= count + 5) break;
    }
  }

  // 去重、去掉正確字
  const unique = [...new Set(candidates.filter(c => c !== correct && c.length === 1))];
  return _shuffle(unique).slice(0, count);
}

/**
 * 在句子中搜尋錯字位置（fallback）
 * @param {string} sentence
 * @param {string} wrongChar
 * @returns {number}
 */
function _findWrongPos(sentence, wrongChar) {
  return [...sentence].indexOf(wrongChar);
}

/**
 * 從 explanation 中提取正確字的部首
 * @param {object|undefined} explanation
 * @param {string} correctChar
 * @returns {string}
 */
function _getRadical(explanation, correctChar) {
  if (!explanation) return '';
  const desc = explanation[correctChar] ?? '';
  // 格式如 "已經（注音：ㄧˇ）" — 部首從別處取
  // 此處回傳 '' 待 characters.json 補充
  return '';
}

/**
 * Fisher-Yates 亂序
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function _shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @param {number} ms */
const _sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 計算進度百分比
 */
function _progressPct(game) {
  const total = game.questions?.length ?? 1;
  const done = game.currentIndex ?? 0;
  return Math.round((done / total) * 100);
}

/**
 * 格式化目前星星數
 */
function _formatStars(game) {
  const stars = AppState?.stars?.yellow_total ?? 0;
  return Number.isInteger(stars) ? stars : stars.toFixed(1);
}

/**
 * 當 confusables.json 無法載入時的最小示範資料
 */
function _getFallbackData() {
  return [
    {
      correct: '已',
      wrong: '己',
      sentence: '他每天都己好功課了。',
      wrong_position: 5,
      explanation: { '已': '已經（ㄧˇ）', '己': '自己（ㄐㄧˇ）' },
      related_characters: ['己', '已', '巳'],
    },
    {
      correct: '在',
      wrong: '再',
      sentence: '小明再家裡寫作業。',
      wrong_position: 3,
      explanation: { '在': '在家（ㄗㄞˋ）', '再': '再次（ㄗㄞˋ）' },
      related_characters: ['在', '再'],
    },
    {
      correct: '的',
      wrong: '得',
      sentence: '他跑得很快得樣子。',
      wrong_position: 7,
      explanation: { '的': '助詞（ㄉㄜ˙）', '得': '助詞結果（ㄉㄜ˙）' },
      related_characters: ['的', '得', '地'],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 提示按鈕全域橋接（供 inline onclick 使用）
// GamePage 初始化遊戲後設定 window._typoHint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 安裝全域提示橋接（由 GamePage 呼叫）
 * @param {TypoGame} game
 */
export function installTypoHintBridge(game) {
  window._typoHint = async (level) => {
    if (game.usedHints >= 2) return;
    const hintText = await game.useHint(level);

    const hintContent = document.getElementById('typo-hint-content');
    if (hintContent && hintText) {
      hintContent.textContent = hintText;
      hintContent.classList.add('visible');
    }

    // 更新提示按鈕狀態
    const btns = document.querySelectorAll('.typo-hint-btn');
    btns.forEach((btn, i) => {
      if (i < game.usedHints) btn.classList.add('used');
    });
    if (game.usedHints >= 2) {
      btns.forEach(btn => (btn.disabled = true));
    }
  };
}

/**
 * 移除全域提示橋接
 */
export function removeTypoHintBridge() {
  delete window._typoHint;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS 樣式（注入到 <head>，僅在此遊戲使用時）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 注入 typo.js 專用樣式
 * 由 GamePage 在 init 時呼叫
 */
export function injectTypoStyles() {
  if (document.getElementById('typo-styles')) return;
  const style = document.createElement('style');
  style.id = 'typo-styles';
  style.textContent = `
    /* ── 遊戲外框 ── */
    .typo-game {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      background: linear-gradient(160deg, #fef9e7 0%, #fde9b5 100%);
      padding: 0 0 80px;
      font-family: 'Noto Sans TC', sans-serif;
    }

    /* ── 標題列 ── */
    .typo-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(255,255,255,0.7);
      backdrop-filter: blur(6px);
      border-bottom: 2px solid #f5c842;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .typo-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: #7d4e00;
      min-width: 90px;
    }
    .typo-progress-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .typo-progress-bar {
      flex: 1;
      height: 8px;
      background: #e8d88a;
      border-radius: 4px;
      overflow: hidden;
    }
    .typo-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #f5c842, #e08c00);
      border-radius: 4px;
      transition: width 0.4s ease;
    }
    .typo-progress-text {
      font-size: 0.8rem;
      color: #7d4e00;
      white-space: nowrap;
    }
    .typo-stars-display {
      font-size: 0.9rem;
      color: #e08c00;
      font-weight: 600;
    }

    /* ── 內容區 ── */
    .typo-content {
      flex: 1;
      padding: 20px 16px;
    }
    .typo-instruction {
      font-size: 1rem;
      color: #5a3a00;
      text-align: center;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .typo-instruction strong {
      color: #c0392b;
    }

    /* ── 句子展示 ── */
    .typo-sentence {
      font-size: 1.4rem;
      line-height: 2.2;
      text-align: center;
      margin: 12px auto 20px;
      max-width: 320px;
    }
    .typo-s-char {
      display: inline-block;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .typo-s-char.wrong-target {
      background: #ffeaa0;
      border: 2px dashed #f39c12;
      border-radius: 4px;
    }
    .typo-sentence-char {
      display: inline-block;
      font-size: 1.5rem;
      padding: 4px 6px;
      margin: 2px;
      border-radius: 6px;
      border: 2px solid transparent;
      transition: background 0.15s, border-color 0.15s;
    }
    .typo-sentence-char.clickable {
      cursor: pointer;
    }
    .typo-sentence-char.clickable:hover {
      background: #fef3cd;
      border-color: #f5c842;
    }
    .typo-sentence-char.selected {
      background: #fff3a3;
      border-color: #e08c00;
    }

    /* ── 寶箱（模式一）── */
    .typo-chests {
      display: flex;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .typo-chest {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      padding: 12px;
      background: #fff8e1;
      border: 3px solid #e0b000;
      border-radius: 12px;
      min-width: 68px;
      transition: transform 0.15s, box-shadow 0.15s;
      user-select: none;
    }
    .typo-chest:hover {
      transform: translateY(-3px);
      box-shadow: 0 6px 16px rgba(224,176,0,0.35);
    }
    .typo-chest.selected {
      border-color: #e08c00;
      background: #fef3cd;
    }
    .typo-chest.open .chest-icon {
      transform: scale(1.3) rotate(-10deg);
      transition: transform 0.3s;
    }
    .chest-icon {
      font-size: 2rem;
      transition: transform 0.3s;
    }
    .chest-lid {
      font-size: 1.1rem;
      opacity: 0.7;
    }
    .chest-char {
      font-size: 1.3rem;
      font-weight: 700;
      color: #7d4e00;
    }

    /* ── 模式二第一步提示 ── */
    .typo-mode2-hint {
      text-align: center;
      font-size: 0.85rem;
      color: #999;
      margin-top: 8px;
    }

    /* ── 手寫區（模式二第二步）── */
    .typo-canvas-wrap {
      display: flex;
      justify-content: center;
      margin: 12px 0;
    }
    #typo-handwriting-canvas {
      border: 3px solid #e0b000;
      border-radius: 16px;
      background: #fff;
      cursor: crosshair;
      touch-action: none;
    }
    .typo-hw-buttons {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 8px;
    }
    .typo-btn {
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
    }
    .typo-btn:active { transform: scale(0.96); }
    .typo-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .typo-btn.primary {
      background: linear-gradient(135deg, #f5c842, #e08c00);
      color: #fff;
    }
    .typo-btn.secondary {
      background: #ede7d0;
      color: #7d4e00;
    }
    .typo-retry-msg {
      text-align: center;
      color: #e07b00;
      font-weight: 600;
      font-size: 1rem;
      margin-top: 8px;
      animation: fadeIn 0.4s ease;
    }
    .typo-wrong-char {
      color: #c0392b;
      font-weight: 700;
    }

    /* ── 揭曉答案 ── */
    .typo-reveal {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 20px;
      background: #fff8e1;
      border-radius: 16px;
      border: 2px solid #e0b000;
    }
    .typo-reveal-locked { font-size: 2rem; }
    .typo-reveal-answer {
      font-size: 1rem;
      color: #7d4e00;
    }
    .typo-reveal-char {
      font-size: 2rem;
      font-weight: 700;
      color: #27ae60;
    }
    .typo-reveal-explanation,
    .typo-reveal-radical {
      font-size: 0.9rem;
      color: #888;
    }
    .typo-reveal-sentence {
      font-size: 1.2rem;
      line-height: 2;
    }
    .typo-corrected {
      color: #27ae60;
      font-weight: 700;
      background: #eafaf1;
      padding: 0 4px;
      border-radius: 4px;
    }

    /* ── 提示列 ── */
    .typo-hint-bar {
      position: sticky;
      bottom: 0;
      background: rgba(255,252,235,0.95);
      backdrop-filter: blur(4px);
      border-top: 2px solid #f5c842;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .typo-hint-btn {
      padding: 6px 12px;
      border-radius: 8px;
      border: 2px solid #e0b000;
      background: #fff;
      color: #7d4e00;
      font-size: 0.8rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .typo-hint-btn.used {
      background: #f5e9b5;
      border-color: #c9a900;
      color: #aaa;
    }
    .typo-hint-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .typo-hint-content {
      flex: 1;
      font-size: 0.9rem;
      color: #5a3a00;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.3s;
    }
    .typo-hint-content.visible { opacity: 1; }

    /* ── 動畫 ── */
    .typo-key-animation {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 4rem;
      animation: keyPop 0.4s ease forwards;
      z-index: 100;
      pointer-events: none;
    }
    @keyframes keyPop {
      0%   { transform: translate(-50%,-50%) scale(0.5); opacity:0; }
      60%  { transform: translate(-50%,-50%) scale(1.3); opacity:1; }
      100% { transform: translate(-50%,-50%) scale(1);   opacity:1; }
    }
    .typo-star-popup {
      position: fixed;
      top: 40%;
      left: 50%;
      transform: translateX(-50%);
      font-size: 1.8rem;
      font-weight: 900;
      color: #f5c842;
      text-shadow: 0 2px 8px rgba(0,0,0,0.25);
      animation: starFloat 1.2s ease forwards;
      z-index: 101;
      pointer-events: none;
    }
    @keyframes starFloat {
      0%   { opacity:0; transform: translateX(-50%) translateY(0); }
      30%  { opacity:1; }
      100% { opacity:0; transform: translateX(-50%) translateY(-60px); }
    }
    .shake {
      animation: shake 0.5s ease;
    }
    @keyframes shake {
      0%,100% { transform: translateX(0); }
      20%     { transform: translateX(-8px); }
      40%     { transform: translateX(8px); }
      60%     { transform: translateX(-6px); }
      80%     { transform: translateX(6px); }
    }
    @keyframes fadeIn {
      from { opacity:0; transform: translateY(4px); }
      to   { opacity:1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * 移除 typo.js 專用樣式（destroy 時呼叫）
 */
export function removeTypoStyles() {
  document.getElementById('typo-styles')?.remove();
}
