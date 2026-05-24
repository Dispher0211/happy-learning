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
import { HandwritingManager } from '../handwriting.js';
import { GeminiManager } from '../gemini.js';

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
    this._hwRetryCount = 0;

    /** @type {number} 手寫辨識連續 fallback 計數（達3次強制判答錯） */
    this._hwRetryCount = 0;

    /** @type {string|null} 上一次辨識結果（用於 fallback 提示） */
    this._lastRecognizedText = null;

    /** @type {HTMLCanvasElement|null} 模式二手寫 canvas 元素 */
    this._typoCanvas = null;

    /** @type {CanvasRenderingContext2D|null} canvas 繪圖 context */
    this._typoCtx = null;

    /** @type {Array<Array<{x:number,y:number}>>} 已繪筆畫（供 undo 用） */
    this._typoStrokes = [];

    /** @type {Array<{x:number,y:number}>|null} 目前繪製中的筆畫點 */
    this._typoCurrentStroke = null;
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

    // 載入 confusables.json
    if (this._allConfusables.length === 0) {
      this._allConfusables = await JSONLoader.load('confusables') ?? [];
    }
    if (this._allConfusables.length === 0) {
      console.warn('[TypoGame] confusables.json 無資料，使用示範題');
      this._allConfusables = _getFallbackData();
    }

    // 生字簿過濾
    const myChars = new Set(
      (AppState.characters ?? []).map(c => c.char ?? c['字'] ?? '')
    );

    let prioritized = [];
    let rest = [];

    for (const item of this._allConfusables) {
      // 支援新格式（sentences[]）與舊格式（wrong）取出所有可能的錯字
      const wrongs = _extractWrongs(item);
      const isRelated = myChars.has(item.correct) || wrongs.some(w => myChars.has(w));
      if (isRelated) prioritized.push(item);
      else rest.push(item);
    }

    let pool;
    if (myChars.size > 0 && prioritized.length >= count) {
      pool = _shuffle(prioritized);
    } else if (myChars.size > 0 && prioritized.length > 0) {
      pool = [..._shuffle(prioritized), ..._shuffle(rest)];
    } else {
      pool = _shuffle([...prioritized, ...rest]);
    }
    // ── 動態補題：生字簿中不在 confusables 的字，動態從 characters.json 生成 ──
    const coveredChars = new Set(this._allConfusables.map(i => i.correct));
    const missingChars = [...myChars].filter(ch => !coveredChars.has(ch));

    let dynamicItems = [];
    if (missingChars.length > 0) {
      // 限制最多 2 個並行 AI 請求（降低 429 風險），整體 timeout 20 秒
      // 超時或全部失敗 → 靜態 fallback（不阻擋遊戲啟動）
      const MAX_DYNAMIC = Math.min(missingChars.length, 2);
      const dynamicPromises = missingChars.slice(0, MAX_DYNAMIC).map(
        ch => _buildDynamicQuestion(ch, this._allConfusables)
      );
      // 顯示 AI 等待動畫
      _showTypoLoadingOverlay();
      try {
        const timeoutPromise = _sleep(20000).then(() => null);
        const results = await Promise.race([
          Promise.all(dynamicPromises),
          timeoutPromise.then(() => {
            console.warn('[TypoGame] 動態出題超時（20s），改用靜態題目');
            return [];
          }),
        ]);
        dynamicItems = (Array.isArray(results) ? results : []).filter(Boolean);
      } catch (e) {
        console.warn('[TypoGame] 動態出題失敗:', e.message);
        dynamicItems = [];
      } finally {
        _hideTypoLoadingOverlay();
      }
    }

    // 動態題放最前（優先出現），再補 pool
    const combined = [..._shuffle(dynamicItems), ...pool];
    const selected = combined.slice(0, count);

    // 轉換為 GameEngine 標準格式
    // 支援新格式（sentences[]）與舊格式（sentence/wrong_position/wrong）
    this.questions = selected.map(item => {
      // ① 從 sentences[] 隨機挑一個句子（新格式），或用舊格式單句
      //    wrong 固定來自 sentenceData（句子設計時已確保語意正確）
      const sentenceData = _pickSentence(item);
      const wrong = sentenceData.wrong ?? item.wrong ?? '';
      const sentence = sentenceData.sentence ?? '';
      const wrongPosition = sentenceData.wrong_position
        ?? _findWrongPos(sentence, wrong);

      return {
        char: item.correct,
        correct: item.correct,
        wrong,
        sentence,
        wrongPosition,
        explanation: item.explanation ?? {},
        // relatedChars 是干擾字來源池（不含正確字）；正確字在 _renderMode1 另外加入
        relatedChars: (item.related_characters ?? []).filter(ch => ch !== item.correct),
        radical: item.radical || _getRadical(item.explanation, item.correct),
        mode: Math.random() < MODE1_RATIO ? 'mode1' : 'mode2',
      };
    });
  }

  /**
   * 渲染目前題目到 #app
   * @param {object} question
   */
  renderQuestion(question) {
    const app = this._getContainer();
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
   * 答對動畫：closebox 放大→鑰匙旋轉一圈→openbox 全螢幕，配 open.mp3
   * @param {number} stars
   */
  async playCorrectAnimation(stars) {
    // ── 答對動畫：closebox全螢幕 → 消失 → key1~4輪播旋轉(配open.mp3) → 消失 → openbox全螢幕 → 星星 ──

    // 播放音效（與 closebox 出現同步）
    try {
      const audio = new Audio('audio/effects/open.mp3');
      audio.play().catch(() => {});
    } catch (_e) {}

    // ── 步驟一：closebox 全螢幕出現 ──
    const overlay = document.createElement('div');
    overlay.className = 'typo-anim-overlay';
    overlay.innerHTML = `<div class="typo-anim-stage"><img id="typo-fs-img" class="typo-fs-img" src="images/closebox.png" alt=""></div>`;
    document.body.appendChild(overlay);

    const fsImg = overlay.querySelector('#typo-fs-img');
    const stage = overlay.querySelector('.typo-anim-stage');

    // 放大入場
    fsImg.style.animation = 'typoFsZoomIn 0.5s cubic-bezier(.17,.67,.35,1.3) forwards';
    await _sleep(600);

    // ── 步驟二：closebox 淡出消失 ──
    fsImg.style.animation = 'typoFsFadeOut 0.3s ease forwards';
    await _sleep(350);
    fsImg.style.display = 'none';

    // ── 步驟三：key1→key2→key3→key4→key1 輪播（模擬旋轉），共 4 格 × 200ms = 0.8s × 2圈 ──
    const keyFrames = ['images/key1.png','images/key2.png','images/key3.png','images/key4.png'];
    const keyEl = document.createElement('img');
    keyEl.className = 'typo-fs-img';
    keyEl.alt = '鑰匙';
    keyEl.style.opacity = '0';
    stage.appendChild(keyEl);

    // 淡入
    keyEl.src = keyFrames[0];
    await _sleep(50);
    keyEl.style.transition = 'opacity 0.15s';
    keyEl.style.opacity = '1';
    await _sleep(150);

    // 輪播 2 圈（4幀 × 2 = 8步，每步 200ms）
    const totalSteps = 8;
    for (let i = 1; i <= totalSteps; i++) {
      await _sleep(200);
      keyEl.src = keyFrames[i % 4];
    }
    await _sleep(200);

    // 鑰匙淡出
    keyEl.style.opacity = '0';
    await _sleep(200);
    keyEl.style.display = 'none';

    // ── 步驟四：openbox 全螢幕出現 ──
    const openEl = document.createElement('img');
    openEl.className = 'typo-fs-img';
    openEl.alt = '開箱';
    openEl.src = 'images/openbox.png';
    openEl.style.opacity = '0';
    stage.appendChild(openEl);
    openEl.style.transition = 'opacity 0.3s';
    await _sleep(30);
    openEl.style.opacity = '1';
    await _sleep(400);

    // ── 步驟五：星星飛出 ──
    const starsCount = Math.min(Math.max(Math.round(stars * 3), 10), 24);
    for (let i = 0; i < starsCount; i++) {
      const s = document.createElement('div');
      s.className = 'typo-fly-star';
      s.textContent = i % 3 === 0 ? '🌟' : '⭐';
      const angle = (i / starsCount) * 360 + Math.random() * 15;
      const dist = 120 + Math.random() * 100;
      s.style.setProperty('--angle', `${angle}deg`);
      s.style.setProperty('--dist', `${dist}px`);
      s.style.animationDelay = `${i * 35}ms`;
      stage.appendChild(s);
    }
    const starEl = document.createElement('div');
    starEl.className = 'typo-star-popup';
    starEl.textContent = `+★${stars}`;
    stage.appendChild(starEl);

    await _sleep(1400);
    overlay.remove();
  }

  /**
   * 答錯動畫：寶箱搖晃
   */
  async playWrongAnimation() {
    const root = document.getElementById('typo-game-root');
    if (!root) return;

    if (this._currentMode === 'mode1') {
      // 模式一：標記點錯的寶箱為紅色，保留其他寶箱可點
      const selected = root.querySelector('.typo-chest.selected');
      if (selected) {
        selected.classList.add('shake', 'typo-chest-wrong');
        setTimeout(() => {
          selected.classList.remove('shake');
          // 保留 wrong 標記讓小朋友知道這個選錯了
        }, 600);
      }
    } else {
      // 模式二：搖動
      const chests = root.querySelectorAll('.typo-sentence-char.selected');
      chests.forEach(el => {
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 600);
      });
    }

    await _sleep(700);
  }

  /**
   * 答錯兩次：寶箱鎖上，顯示正確答案與字義說明
   * @param {object} result
   */
  async showCorrectAnswer(result) {
    const q = this.currentQuestion;
    const explanation = q.explanation[q.correct] ?? '';
    let radical = q.radical ?? '';
    if (!radical) {
      try {
        const chars = JSONLoader.get('characters') ?? [];
        const entry = chars.find(c => (c['字'] ?? c.char) === q.correct);
        radical = entry?.radical ?? entry?.['部首'] ?? '';
      } catch (_e) {}
    }

    // ── 步驟一：errorbox 全螢幕出現 ──
    const overlay = document.createElement('div');
    overlay.className = 'typo-anim-overlay';
    overlay.innerHTML = `<div class="typo-anim-stage"><img id="typo-error-fs" class="typo-fs-img" src="images/errorbox.png" alt="失敗"></div>`;
    document.body.appendChild(overlay);

    const errImg = overlay.querySelector('#typo-error-fs');
    errImg.style.animation = 'typoFsZoomIn 0.5s cubic-bezier(.17,.67,.35,1.3) forwards';
    await _sleep(700);

    // ── 步驟二：errorbox 縮小到寶箱位置（模擬飛入 content 區） ──
    errImg.style.animation = 'typoErrorboxShrink 0.45s cubic-bezier(.6,0,.4,1) forwards';
    await _sleep(480);
    overlay.remove();

    // ── 步驟三：顯示正確答案畫面 ──
    const content = document.getElementById('typo-content');
    if (!content) return;

    content.innerHTML = `
      <div class="typo-reveal">
        <img class="typo-reveal-errorbox" src="images/errorbox.png" alt="失敗寶箱">
        <div class="typo-reveal-answer">
          正確答案：<span class="typo-reveal-char">${q.correct}</span>
        </div>
        ${explanation
          ? `<div class="typo-reveal-explanation">字義：${_renderTypoExplanation(explanation)}</div>`
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
      // 先用預存 radical，若空則即時查 characters.json
      let radical = question.radical ?? '';
      if (!radical) {
        try {
          const chars = JSONLoader.get('characters') ?? [];
          const entry = chars.find(c => (c['字'] ?? c.char) === question.correct);
          radical = entry?.radical ?? entry?.['部首'] ?? '？';
        } catch (_e) { radical = '？'; }
      }
      if (!radical) radical = '？';
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
        <img class="chest-img" src="images/closebox.png" alt="寶箱" draggable="false">
        <div class="chest-char">${char}</div>
      </div>
    `).join('');

    return `
      <div class="typo-mode1">
        <div class="typo-instruction">找出正確的字，打開寶箱！</div>
        <div class="typo-question-box">
          <div class="typo-sentence mode1">${sentenceHtml}</div>
        </div>
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
      this._addEventListener(chest, 'click', handler);
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
        <div class="typo-instruction">請點出句中的<strong>錯字</strong>位置</div>
        <div class="typo-question-box">
          <div class="typo-sentence mode2-find">${charSpans}</div>
        </div>
        <div class="typo-mode2-hint">👆 點選你認為寫錯的那個字</div>
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
      this._addEventListener(span, 'click', handler);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 模式二：第二步「手寫正確字」
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 渲染模式二第二步（手寫區）
   * @param {object} question
   */
  _renderMode2WriteStep(question, recognizedResult = null) {
    const content = document.getElementById('typo-content');
    if (!content) return;

    // 產生辨識結果提示 HTML（辨識失敗 fallback 時顯示）
    // 組裝提示訊息：顯示辨識結果給小朋友，引導重寫
    let recognizedHtml = '';
    if (this._hwRetrying) {
      if (recognizedResult) {
        recognizedHtml = `
          <div class="typo-recognized-hint">
            🔍 你寫的是「<span class="typo-recognized-char">${recognizedResult}</span>」
            <span class="typo-recognized-sub">再試一次，寫出正確的字 ✏️</span>
          </div>`;
      } else {
        recognizedHtml = '<div class="typo-retry-msg">看不清楚，再寫一次 ✏️</div>';
      }
    }

    content.innerHTML = `
      <div class="typo-mode2-write">
        <div class="typo-instruction">
          請寫出正確的字（原句中「<span class="typo-wrong-char">${question.wrong}</span>」應改為？）
        </div>
        ${recognizedHtml}
        <div class="typo-canvas-wrap">
          <canvas id="${CANVAS_ID}" width="280" height="280"></canvas>
        </div>
        <div class="typo-hw-buttons">
          <button id="typo-btn-undo" class="typo-btn secondary">↩撤銷</button>
          <button id="typo-btn-clear" class="typo-btn secondary">清除</button>
          <button id="typo-btn-confirm" class="typo-btn primary">確認</button>
        </div>
      </div>
    `;

    // 初始化 canvas 手寫繪圖（與 writing.js 相同模式）
    this._typoStrokes = [];
    this._typoCurrentStroke = null;
    this._initTypoCanvas();

    // 綁定撤銷
    const undoBtn = document.getElementById('typo-btn-undo');
    if (undoBtn) {
      this._hwUndoHandler = () => this._typoUndoStroke();
      this._addEventListener(undoBtn, 'click', this._hwUndoHandler);
    }

    // 綁定清除
    const clearBtn = document.getElementById('typo-btn-clear');
    if (clearBtn) {
      this._hwClearHandler = () => this._typoClearCanvas();
      this._addEventListener(clearBtn, 'click', this._hwClearHandler);
    }

    // 綁定確認（送出手寫辨識）
    const confirmBtn = document.getElementById('typo-btn-confirm');
    if (confirmBtn) {
      this._hwConfirmHandler = async () => {
        // 防止重複觸發（辨識中）；但 isAnswering 不阻擋，因 fallback 後 isAnswering 仍可能為 true
        if (this._hwRecognizing) return;
        if (!this._typoCanvas || this._typoStrokes.length === 0) {
          // 尚未繪製任何筆畫 → 提示
          const msg = document.querySelector('.typo-retry-msg');
          if (msg) { msg.textContent = '請先在框內寫字 ✏️'; msg.style.display = 'block'; }
          return;
        }
        this._hwRecognizing = true;
        confirmBtn.disabled = true;

        try {
          // 直接使用 import 的 HandwritingManager（不依賴 globalThis）
          const result = await HandwritingManager.recognize(this._typoCanvas, { mode: 'chinese' });

          // 辨識失敗 → fallback: retry（不計入答錯，不走 submitAnswer）
          const recognized = result?.text ?? result?.candidates?.[0] ?? '';
          if (!result || !recognized) {
            this._lastRecognizedText = recognized || null;
            await this._handleHwFallback(question);
            return;
          }

          // 辨識成功 → 儲存辨識結果（供 onWrongFirstTime 顯示），再走 submitAnswer
          this._lastRecognizedText = recognized;
          this.isAnswering = false;
          await this.submitAnswer({ recognized });

        } catch (err) {
          console.error('[TypoGame] 手寫辨識錯誤:', err);
          this._lastRecognizedText = null;
          await this._handleHwFallback(question);
        } finally {
          this._hwRecognizing = false;
          // 只在 DOM 仍存在且非 fallback 重建後更新按鈕（fallback 會重建整個 DOM）
          const btn = document.getElementById('typo-btn-confirm');
          if (btn && !btn.closest('[data-destroyed]')) {
            btn.disabled = false;
          }
        }
      };
      this._addEventListener(confirmBtn, 'click', this._hwConfirmHandler);
    }
  }

  /**
   * 手寫辨識失敗處理（fallback: retry）
   * 顯示「請再寫一次」，清空 canvas，不計入答錯
   * @param {object} question
   */
  async _handleHwFallback(question) {
    this._hwRetryCount = (this._hwRetryCount ?? 0) + 1;

    // 連續辨識失敗達 3 次 → 強制計入一次答錯（不永久卡住）
    if (this._hwRetryCount >= 3) {
      console.warn('[TypoGame] 手寫辨識連續失敗3次，強制答錯');
      this._hwRetryCount = 0;
      this.isAnswering = false;
      // 直接走 submitAnswer 空字串 → judgeAnswer 會回 { correct: false }
      await this.submitAnswer({ recognized: '' });
      return;
    }

    // 一般 fallback：顯示辨識結果 + 清空畫布，讓玩家重寫
    this.isAnswering = false;
    this._hwRetrying = true;
    this._typoClearCanvas();
    this._cleanupHandwritingListeners();
    this._renderMode2WriteStep(question, this._lastRecognizedText);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 答對 / 答錯後的 UI 覆寫
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * GameEngine 答對後：連續模式自動進下一題，手動模式顯示按鈕
   * （由 GameEngine.onCorrect 呼叫 playCorrectAnimation 後處理）
   */

  /**
   * 覆寫 onWrongFirstTime：
   * - 模式一：走預設（搖動 + 等重試）
   * - 模式二手寫：播完錯誤動畫後，清空畫布並顯示辨識結果，讓小朋友重寫
   */
  async onWrongFirstTime(result) {
    await super.onWrongFirstTime(result);   // 播放搖動動畫、記錄 wrongPool

    if (this._currentMode === 'mode2' && this._substep === SUBSTEP.WRITE) {
      // 顯示辨識為何字，並清空畫布讓小朋友重寫（不重新出題，保持同一題）
      this._hwRetrying = true;
      this._typoClearCanvas();
      this._cleanupHandwritingListeners();
      this._renderMode2WriteStep(this.currentQuestion, this._lastRecognizedText);
    }
  }

  /**
   * 覆寫 onWrongSecondTime：顯示錯誤答案後 2 秒自動跳下一題
   */
  async onWrongSecondTime(result) {
    await super.onWrongSecondTime(result);
    // 2 秒後自動進下一題
    await _sleep(2000);
    if (!this._gameCompleted) {
      await this.nextQuestion();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 清理
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // 模式二 canvas 手寫繪圖（自行管理，不依賴 globalThis.HandwritingManager）
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 初始化 typo canvas，設定樣式並綁定手寫事件
   */
  _initTypoCanvas() {
    const canvas = document.getElementById(CANVAS_ID);
    if (!canvas) return;
    this._typoCanvas = canvas;
    this._typoCtx = canvas.getContext('2d');
    this._typoCtx.strokeStyle = '#1a1a2e';
    this._typoCtx.lineWidth = 6;
    this._typoCtx.lineCap = 'round';
    this._typoCtx.lineJoin = 'round';

    let drawing = false;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const src = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
    };

    const onStart = (e) => {
      e.preventDefault();
      drawing = true;
      const pos = getPos(e);
      this._typoCurrentStroke = [pos];
      this._typoCtx.beginPath();
      this._typoCtx.moveTo(pos.x, pos.y);
    };

    const onMove = (e) => {
      e.preventDefault();
      if (!drawing || !this._typoCurrentStroke) return;
      const pos = getPos(e);
      this._typoCurrentStroke.push(pos);
      this._typoCtx.lineTo(pos.x, pos.y);
      this._typoCtx.stroke();
    };

    const onEnd = () => {
      if (!drawing) return;
      drawing = false;
      if (this._typoCurrentStroke && this._typoCurrentStroke.length > 1) {
        this._typoStrokes.push([...this._typoCurrentStroke]);
      }
      this._typoCurrentStroke = null;
    };

    this._addEventListener(canvas, 'mousedown',  onStart);
    this._addEventListener(canvas, 'mousemove',  onMove);
    this._addEventListener(canvas, 'mouseup',    onEnd);
    this._addEventListener(canvas, 'mouseleave', onEnd);
    this._addEventListener(canvas, 'touchstart', onStart, { passive: false });
    this._addEventListener(canvas, 'touchmove',  onMove,  { passive: false });
    this._addEventListener(canvas, 'touchend',   onEnd);
  }

  /** 撤銷最後一筆 */
  _typoUndoStroke() {
    this._typoStrokes.pop();
    this._typoRedrawStrokes();
  }

  /** 清除全部筆畫 */
  _typoClearCanvas() {
    this._typoStrokes = [];
    this._typoCurrentStroke = null;
    if (this._typoCtx && this._typoCanvas) {
      this._typoCtx.clearRect(0, 0, this._typoCanvas.width, this._typoCanvas.height);
    }
  }

  /** 重繪所有筆畫（撤銷後呼叫）*/
  _typoRedrawStrokes() {
    if (!this._typoCtx || !this._typoCanvas) return;
    this._typoCtx.clearRect(0, 0, this._typoCanvas.width, this._typoCanvas.height);
    for (const stroke of this._typoStrokes) {
      if (stroke.length < 2) continue;
      this._typoCtx.beginPath();
      this._typoCtx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) this._typoCtx.lineTo(stroke[i].x, stroke[i].y);
      this._typoCtx.stroke();
    }
  }

  /**
   * 清除手寫相關 event listener
   */
  _cleanupHandwritingListeners() {
    // _listeners 由 GameEngine.destroy() 統一清除
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
    // 標記 canvas 已銷毀，防止 confirm handler 誤操作
    const root = document.getElementById('typo-game-root');
    if (root) root.dataset.destroyed = '1';

    // 清除手寫 canvas 狀態
    this._typoCanvas = null;
    this._typoCtx = null;
    this._typoStrokes = [];
    this._typoCurrentStroke = null;

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
  // 支援新格式（sentences[].wrong）與舊格式（.wrong）
  if (candidates.length < count) {
    for (const item of allConfusables) {
      if (item.correct !== correct) {
        candidates.push(item.correct);
        // 新格式：從 sentences[] 取 wrong；舊格式：item.wrong
        const wrongs = _extractWrongs(item);
        candidates.push(...wrongs);
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
  // 從 JSONLoader 快取的 characters.json 查部首
  try {
    const chars = JSONLoader.get('characters') ?? [];
    const entry = chars.find(c => (c['字'] ?? c.char) === correctChar);
    if (entry?.radical) return entry.radical;
    if (entry?.['部首']) return entry['部首'];
  } catch (_e) {}
  return '';
}

/**
 * Fisher-Yates 亂序
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
/**
 * 為不在 confusables.json 的生字，透過 AI 動態生成改錯別字題目
 * 流程：
 *   1. 從 characters.json 找該字的 2-5 字詞語
 *   2. 呼叫 GeminiManager.generateTypoQuestion 取得 AI 造句 + 混淆字
 *   3. AI 失敗時 fallback 到形近字靜態邏輯
 * @param {string} char
 * @param {Array}  allConf
 * @returns {Promise<object|null>}
 */
async function _buildDynamicQuestion(char, allConf) {
  // Step1：從 characters.json 找詞語
  const charData = (JSONLoader.get('characters') ?? []).find(
    d => (d['字'] ?? d.char) === char
  );
  if (!charData) return null;

  const words = [];
  for (const pron of charData.pronunciations ?? []) {
    for (const w of pron.words ?? []) {
      if (w.length >= 2 && w.length <= 5 && w.includes(char)) words.push(w);
    }
  }
  if (words.length === 0) return null;

  const word = words[Math.floor(Math.random() * words.length)];

  // Step2：嘗試 AI 出題
  try {
    const aiResult = await GeminiManager.generateTypoQuestion({ char, word });
    if (aiResult) {
      const explanation = {};
      explanation[char] = charData.pronunciations?.[0]?.zhuyin ?? '';
      // 從 allConf 找混淆字的注音
      for (const conf of aiResult.confusables) {
        for (const item of allConf) {
          if ((item.explanation ?? {})[conf]) {
            explanation[conf] = item.explanation[conf];
            break;
          }
        }
      }
      return {
        correct: char,
        sentences: [{
          sentence:       aiResult.sentence,
          wrong_position: aiResult.wrong_position,
          wrong:          aiResult.wrong,
        }],
        explanation,
        related_characters: aiResult.confusables,
        radical: charData.radical ?? '',
        _isDynamic: true,
        _aiGenerated: true,
      };
    }
  } catch (e) {
    console.warn('[TypoGame] AI 出題失敗，使用靜態邏輯:', e.message);
  }

  // Step3：AI 失敗 fallback — 靜態形近字邏輯
  const wrongPosition = [...word].indexOf(char);
  if (wrongPosition === -1) return null;

  let wrongCandidates = [];
  for (const item of allConf) {
    const rel = item.related_characters ?? [];
    if (rel.includes(char) && item.correct !== char) {
      wrongCandidates.push(item.correct);
      wrongCandidates.push(..._extractWrongs(item));
    }
  }
  wrongCandidates = [...new Set(wrongCandidates.filter(c => c !== char && c.length === 1))];

  if (wrongCandidates.length === 0) return null;

  const wrong = wrongCandidates[Math.floor(Math.random() * wrongCandidates.length)];
  const sentenceChars = [...word];
  sentenceChars[wrongPosition] = wrong;

  const explanation = {};
  explanation[char] = charData.pronunciations?.[0]?.zhuyin ?? '';
  for (const item of allConf) {
    if ((item.explanation ?? {})[wrong]) { explanation[wrong] = item.explanation[wrong]; break; }
  }

  return {
    correct: char,
    sentences: [{ sentence: sentenceChars.join(''), wrong_position: wrongPosition, wrong }],
    explanation,
    related_characters: _shuffle(wrongCandidates).slice(0, 4),
    radical: charData.radical ?? '',
    _isDynamic: true,
  };
}

function _shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 取出一筆 confusable 資料中所有可能的錯字
 * 支援新格式（sentences[].wrong）與舊格式（.wrong）
 * @param {object} item
 * @returns {string[]}
 */
function _extractWrongs(item) {
  if (Array.isArray(item.sentences) && item.sentences.length > 0) {
    return [...new Set(item.sentences.map(s => s.wrong).filter(Boolean))];
  }
  return item.wrong ? [item.wrong] : [];
}

/**
 * 從 sentences[] 隨機挑一個句子（新格式），或回傳舊格式單句
 * @param {object} item
 * @returns {{ sentence: string, wrong_position: number, wrong: string }}
 */
function _pickSentence(item) {
  if (Array.isArray(item.sentences) && item.sentences.length > 0) {
    return item.sentences[Math.floor(Math.random() * item.sentences.length)];
  }
  // 舊格式相容
  return {
    sentence: item.sentence ?? '',
    wrong_position: item.wrong_position ?? 0,
    wrong: item.wrong ?? '',
  };
}

/**
 * 從 related_characters 隨機挑一個字作為本次錯字
 * 排除 correct 本身；若可選字不足則回退到 sentenceData.wrong
 * @param {object} item
 * @param {{ wrong: string }} sentenceData
 * @returns {string}
 */
/**
 * 取得本次題目使用的錯字
 * 錯字固定為 sentenceData.wrong（該句子設計時指定，確保語意正確）
 * related_characters 只作為選項干擾，不用來替換句中字
 */
function _pickRandomWrong(item, sentenceData) {
  return sentenceData.wrong ?? item.wrong ?? item.correct;
}

/**
 * 將句子中指定位置的字換成新的錯字（若不同）
 * 若 originalWrong 與 newWrong 相同則直接回傳原句
 * @param {string} sentence
 * @param {number} wrongPosition
 * @param {string} originalWrong
 * @param {string} newWrong
 * @returns {{ sentence: string, wrongPosition: number }}
 */
function _substituteWrong(sentence, wrongPosition, originalWrong, newWrong) {
  if (!newWrong || newWrong === originalWrong) {
    return { sentence, wrongPosition };
  }
  const chars = [...sentence];
  // 若 wrongPosition 在範圍內且該位置就是 originalWrong，直接替換
  if (wrongPosition >= 0 && wrongPosition < chars.length) {
    chars[wrongPosition] = newWrong;
    return { sentence: chars.join(''), wrongPosition };
  }
  // fallback：找 originalWrong 的第一個位置替換
  const idx = [...sentence].indexOf(originalWrong);
  if (idx !== -1) {
    const arr = [...sentence];
    arr[idx] = newWrong;
    return { sentence: arr.join(''), wrongPosition: idx };
  }
  return { sentence, wrongPosition };
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
/**
 * 顯示 AI 出題等待動畫（小人跑步）
 */
function _showTypoLoadingOverlay() {
  if (document.getElementById('typo-loading-overlay')) return;
  const el = document.createElement('div');
  el.id = 'typo-loading-overlay';
  el.innerHTML = `
    <div class="typo-loading-runner">🏃</div>
    <div class="typo-loading-text">AI 老師正在出題<span class="typo-loading-dots"></span></div>
    <div class="typo-loading-sub">請稍候片刻 ⏳</div>
  `;
  // 優先放入遊戲畫布容器，使小人出現在畫布中央
  const container = document.getElementById('app') || document.body;
  // 確保容器有 position: relative（CSS 裡已設定）
  el.style.borderRadius = getComputedStyle(container).borderRadius || '16px';
  container.style.position = 'relative';
  container.appendChild(el);
}

/**
 * 移除 AI 等待動畫
 */
function _hideTypoLoadingOverlay() {
  document.getElementById('typo-loading-overlay')?.remove();
}

/**
 * 將 explanation 字串中的注音轉為 pv2 格式 HTML
 * explanation 格式例如：「ㄓㄨ˙、ㄓㄨㄛˊ」
 */
function _renderTypoExplanation(text) {
  if (!text) return '';
  const BPMF_RE = /[ㄅ-ㄩ][ㄅ-ㄩ]*[ˊˇˋ˙]?/g;
  return text.replace(BPMF_RE, zhuyin => _renderZhuyinPv2(zhuyin));
}

/**
 * 單個注音字串轉 pv2 HTML（從 polyphone._renderBubbleZhuyin 提取為獨立函式）
 */
function _renderZhuyinPv2(pron) {
  if (!pron) return '';
  const INITIALS = new Set('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ');
  const MEDIALS  = new Set('ㄧㄨㄩ');
  const TONES    = new Set(['ˊ','ˇ','ˋ','˙']);
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  let src = pron, tone = '';
  if (src.startsWith('˙')) { tone = '˙'; src = src.slice(1); }
  else if (src.length > 0 && TONES.has(src[src.length-1])) {
    tone = src[src.length-1]; src = src.slice(0,-1);
  }
  let initial = '', medial = '', final = '';
  for (const ch of src) {
    if (INITIALS.has(ch)) initial = ch;
    else if (MEDIALS.has(ch)) medial = ch;
    else final += ch;
  }
  const count   = [initial, medial, final].filter(Boolean).length;
  const hasDot  = tone === '˙';
  const dotHtml = hasDot ? `<span class="pv2-dot">${esc(tone)}</span>` : '';
  const toneHtml = (tone && !hasDot)
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

function _getFallbackData() {
  return [
    {
      correct: '已',
      sentences: [
        { sentence: '他每天都己好功課了。', wrong_position: 5, wrong: '己' },
        { sentence: '工作己經完成了。',     wrong_position: 2, wrong: '己' },
      ],
      explanation: { '已': '已經（ㄧˇ）', '己': '自己（ㄐㄧˇ）', '巳': 'ㄙˋ' },
      related_characters: ['己', '已', '巳'],
    },
    {
      correct: '在',
      sentences: [
        { sentence: '小明再家裡寫作業。', wrong_position: 3, wrong: '再' },
        { sentence: '他再學校等你。',     wrong_position: 2, wrong: '再' },
      ],
      explanation: { '在': '在家（ㄗㄞˋ）', '再': '再次（ㄗㄞˋ）' },
      related_characters: ['在', '再'],
    },
    {
      correct: '的',
      sentences: [
        { sentence: '他跑得很快得樣子。', wrong_position: 7, wrong: '得' },
        { sentence: '漂亮得花朵。',       wrong_position: 3, wrong: '得' },
      ],
      explanation: { '的': '助詞（ㄉㄜ˙）', '得': '助詞結果（ㄉㄜ˙）', '地': 'ㄉㄜ˙' },
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
      font-size: 1.2rem;
      color: #5a3a00;
      text-align: center;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .typo-instruction strong {
      color: #c0392b;
    }

    /* ── 題目框 ── */
    .typo-question-box {
      background: #fff;
      border: 3px solid #e0b000;
      border-radius: 16px;
      padding: 16px 20px;
      margin: 12px auto 20px;
      max-width: 380px;
      box-shadow: 0 4px 12px rgba(224,176,0,0.2);
    }

    /* ── 句子展示 ── */
    .typo-sentence {
      font-size: 2rem;
      line-height: 2.6;
      text-align: center;
      margin: 0;
    }
    .typo-s-char {
      display: inline-block;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .typo-s-char.wrong-target {
      /* 不顯示提示方框，避免洩漏答案 */
    }
    .typo-sentence-char {
      display: inline-block;
      font-size: 2rem;
      padding: 4px 8px;
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

    /* ── 寶箱圖片（模式一）── */
    .typo-chest .chest-img {
      width: 72px;
      height: 72px;
      object-fit: contain;
      display: block;
      transition: transform 0.15s;
    }
    .typo-chest:hover .chest-img {
      transform: scale(1.08);
    }
    .typo-chest.selected .chest-img {
      transform: scale(1.12);
      filter: drop-shadow(0 0 8px #f5c842);
    }

    /* ── 揭曉錯誤寶箱 ── */
    .typo-reveal-errorbox {
      width: 100px;
      height: 100px;
      object-fit: contain;
      animation: typoErrorboxShake 0.5s ease;
    }

    /* ── 答對動畫覆蓋層 ── */
    .typo-anim-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      z-index: 999;
      pointer-events: none;
    }
    .typo-anim-stage {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .typo-fly-star {
      position: absolute;
      font-size: min(6vw, 2rem);
      top: 50%;
      left: 50%;
      pointer-events: none;
      animation: typoStarFly 1.2s ease-out forwards;
      --angle: 0deg;
      --dist: min(40vw, 180px);
    }

    @keyframes typoFsZoomIn {
      0%   { transform: scale(0.15); opacity: 0; }
      100% { transform: scale(1);    opacity: 1; }
    }
    @keyframes typoFsFadeOut {
      0%   { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.05); }
    }
    @keyframes typoErrorboxShrink {
      0%   { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(0.12); }
    }
    /* ── 辨識結果提示 ── */
    /* ── AI 等待動畫覆蓋層 ── */
    #typo-loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(255,250,220,0.92);
      z-index: 50;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      border-radius: 16px;
      font-size: 1rem;
      color: #7b5e00;
      font-weight: 600;
      pointer-events: none;
    }
    .typo-loading-runner {
      font-size: 5rem;
      line-height: 1;
      animation: typoRunnerRun 0.35s steps(1) infinite;
    }
    @keyframes typoRunnerRun {
      0%   { transform: translateX(-6px) scaleX(1); }
      25%  { transform: translateX(0px) scaleX(1); }
      50%  { transform: translateX(6px) scaleX(1); }
      75%  { transform: translateX(0px) scaleX(1); }
      100% { transform: translateX(-6px) scaleX(1); }
    }
    .typo-loading-text {
      font-size: 1.05rem;
      font-weight: 700;
      color: #7b5e00;
      letter-spacing: 1px;
    }
    .typo-loading-sub {
      font-size: 0.82rem;
      color: #a07800;
      font-weight: 400;
    }
    .typo-loading-dots::after {
      content: '';
      animation: typoDots 1.2s steps(3, end) infinite;
    }
    @keyframes typoDots {
      0%   { content: ''; }
      33%  { content: '.'; }
      66%  { content: '..'; }
      100% { content: '...'; }
    }
    /* ── 選錯的寶箱變紅 ── */
    .typo-chest-wrong {
      border-color: #e74c3c !important;
      background: #fdecea !important;
      opacity: 0.7;
      pointer-events: none;  /* 不可再點 */
    }
    .typo-chest-wrong .typo-chest-label,
    .typo-chest-wrong .chest-label {
      color: #c0392b !important;
    }
    /* ── 字義注音 inline pv2 ── */
    .typo-reveal-explanation .pv2 {
      display: inline-flex;
      align-items: flex-start;
      font-size: 0.95em;
      vertical-align: middle;
      margin: 0 1px;
    }
    .typo-recognized-hint {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      text-align: center;
      font-size: 1rem;
      color: #7b3f00;
      font-weight: 600;
      background: #fff3cd;
      border: 2px solid #f5c842;
      border-radius: 12px;
      padding: 10px 16px;
      margin: 0 auto 8px;
      max-width: 320px;
      animation: fadeIn 0.3s ease;
    }
    .typo-recognized-char {
      font-size: 1.6em;
      font-weight: 900;
      color: #c0392b;
      background: #ffe0e0;
      padding: 2px 10px;
      border-radius: 6px;
    }
    .typo-recognized-sub {
      font-size: 0.88em;
      color: #555;
      font-weight: 400;
    }
    @keyframes typoStarFly {
      0%   { transform: translate(-50%,-50%) rotate(var(--angle)) translateX(0); opacity: 1; }
      100% { transform: translate(-50%,-50%) rotate(var(--angle)) translateX(var(--dist)); opacity: 0; }
    }
    @keyframes typoErrorboxShake {
      0%,100% { transform: rotate(0deg); }
      20%     { transform: rotate(-8deg); }
      40%     { transform: rotate(8deg); }
      60%     { transform: rotate(-5deg); }
      80%     { transform: rotate(5deg); }
    }
    /* ── 鑰匙動畫 ── */
    .typo-fs-img {
      position: relative;
      width: min(92vw, 92vh);
      height: min(92vw, 92vh);
      object-fit: contain;
      z-index: 2;
      pointer-events: none;
    }
    .typo-chests {
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: nowrap;
      margin-top: 8px;
      overflow-x: auto;
      padding: 4px 0;
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
      min-width: 76px;
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
      font-size: 1.8rem;
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
      /* 米字格參考線 */
      background-image:
        linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px),
        linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
      background-size: 140px 140px, 140px 140px, 70px 70px, 70px 70px;
      cursor: crosshair;
      touch-action: none;
      max-width: 100%;
      display: block;
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
    .typo-reveal { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px; background: #fff8e1; border-radius: 16px; border: 2px solid #e0b000; }
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
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: min(12vw, 3.5rem);
      font-weight: 900;
      color: #f5c842;
      text-shadow: 0 4px 16px rgba(0,0,0,0.5), 0 0 24px #fff;
      animation: starFloat 1.4s ease forwards;
      z-index: 10;
      pointer-events: none;
      white-space: nowrap;
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
    
      /* ── RWD 平板（≥600px）── */
      @media (min-width: 600px) {
        .typo-sentence    { max-width: 480px; }
        .typo-canvas-wrap { max-width: 480px; }
      }
/* ── RWD 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .typo-game { max-width: 760px; margin: 0 auto; }
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
