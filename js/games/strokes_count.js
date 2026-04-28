/**
 * strokes_count.js — 算出筆劃 × 🎯 射箭遊戲
 * Task 17：繼承 GameEngine，實作兩射流程
 *
 * 遊戲規則（SECTION 9 D.6）：
 *   第一射：猜總筆劃（4個靶含正確答案）
 *   第一射答對 → 立即顯示第二射（猜部首筆劃）
 *   兩射全對 → ★+1
 *   任一射答錯第一次 → 再試（onWrongFirstTime）
 *   再試仍錯 → onWrongSecondTime（整題失敗）
 *   靶速度依遺忘等級：hard=3000ms / medium=2000ms / easy=1500ms / easy_plus=1000ms
 *
 * 依賴模組：
 *   GameEngine.js（T14）、GameConfig.js（T15）
 *   state.js（T02）、firebase.js（T05）、audio.js（T08）
 *   forgetting.js（T09）、stars.js（T10）、wrong_queue.js（T11）、sync.js（T12）
 */

import { GameEngine } from './GameEngine.js';
import { GameConfig } from './GameConfig.js';
import { AppState } from '../state.js';
import { AudioManager } from '../audio.js';
import { ForgettingCurve } from '../forgetting.js';

// ─────────────────────────────────────────────
// 靶移動速度對應表（毫秒/遍歷一輪）
// hard 最慢（靶移動慢，難以瞄準），easy_plus 最快
// ─────────────────────────────────────────────
const TARGET_SPEEDS = {
  hard:       3000,
  medium:     2000,
  easy:       1500,
  easy_plus:  1000,
};

// 靶的數量（固定4個）
const TARGET_COUNT = 4;

export class StrokesCountGame extends GameEngine {
  constructor() {
    super('strokes_count');

    // ── 兩射狀態追蹤 ──
    this._phase = 'first';       // 'first'（猜總筆劃）或 'second'（猜部首筆劃）
    this._phaseWrongCount = 0;   // 本射答錯次數（每射獨立計算）
    this._hintPending = false;   // 提示文字是否顯示中

    // ── 動畫 ──
    this._targetAnimFrames = []; // requestAnimationFrame 的 id 陣列
    this._targetPositions = [];  // 每個靶的目前 X 位置（0~100%）
    this._targetDirections = []; // 每個靶的移動方向（+1 或 -1）
    this._targetSpeeds = [];     // 每個靶的像素/ms 速度
    this._lastTimestamp = null;  // 上次 rAF 時間戳
    this._animRunning = false;   // 動畫是否執行中
  }

  // ════════════════════════════════════════════
  // loadQuestions — 從 characters.json 讀取題目
  // ════════════════════════════════════════════
  async loadQuestions() {
    // 取得本局題目字元陣列（由 GameEngine 的 init 提供）
    const chars = this.questionChars; // 由 GameEngine 從 ForgettingCurve 排序後給予

    if (!chars || chars.length === 0) {
      throw new Error('strokes_count: 題目字元為空，請確認 questionChars 已設定');
    }

    // 從 AppState.characters（已由 JSONLoader 載入）取得筆劃資料
    const allChars = AppState.characters || [];

    const questions = [];
    for (const char of chars) {
      const charData = allChars.find(c => c.char === char);
      if (!charData) continue;

      // 確保有總筆劃和部首筆劃資料
      const totalStrokes = charData.strokes;          // 總筆劃數
      const radicalStrokes = charData.radical_strokes; // 部首筆劃數
      const radical = charData.radical;                // 部首字

      if (!totalStrokes || !radicalStrokes || !radical) continue;

      questions.push({
        char,
        totalStrokes,      // 總筆劃
        radicalStrokes,    // 部首筆劃
        radical,           // 部首
        pronunciation: charData.pronunciation || '',
        level: charData.level || 'medium',
      });
    }

    this.questions = questions;
    return questions;
  }

  // ════════════════════════════════════════════
  // renderQuestion — 渲染當前題目到 #app
  // ════════════════════════════════════════════
  renderQuestion() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    // 每次換題重置兩射狀態
    this._phase = 'first';
    this._phaseWrongCount = 0;
    this._hintPending = false;

    const appEl = document.getElementById('app');
    if (!appEl) return;

    // 取得遺忘等級，決定靶速度
    const level = q.level || 'medium';
    const speedMs = TARGET_SPEEDS[level] || TARGET_SPEEDS.medium;

    appEl.innerHTML = this._buildGameHTML(q, speedMs);
    this._initTargets(q, speedMs);
    this._bindEvents(q);
    this._updateHintButton();
    this._renderProgressBar();
  }

  // ════════════════════════════════════════════
  // _buildGameHTML — 組建遊戲 HTML 骨架
  // ════════════════════════════════════════════
  _buildGameHTML(q, speedMs) {
    const level = q.level || 'medium';
    const levelLabel = { hard: '困難', medium: '中等', easy: '簡單', easy_plus: '加強' }[level] || '中等';

    return `
      <div class="sc-game" id="sc-game-root">
        <!-- 頂部資訊列 -->
        <div class="sc-header">
          <div class="sc-question-char">${q.char}</div>
          <div class="sc-phase-label" id="sc-phase-label">
            🎯 第一射：「${q.char}」共有幾劃？
          </div>
          <div class="sc-difficulty-badge sc-difficulty--${level}">${levelLabel}</div>
        </div>

        <!-- 進度列（由 GameEngine 控制） -->
        <div class="sc-progress-bar" id="sc-progress-bar">
          <div class="sc-progress-fill" id="sc-progress-fill"></div>
        </div>

        <!-- 射箭場：4個移動靶 -->
        <div class="sc-archery-range" id="sc-archery-range" aria-label="射箭場">
          ${this._buildTargetHTML()}
        </div>

        <!-- 弓箭手（靜止在中央下方）-->
        <div class="sc-archer" id="sc-archer" aria-label="弓箭手">
          🏹
        </div>

        <!-- 提示區 -->
        <div class="sc-hint-area" id="sc-hint-area"></div>

        <!-- 操作按鈕 -->
        <div class="sc-controls">
          <button class="sc-btn sc-btn--hint" id="sc-hint-btn" onclick="window.__scHint()">
            💡 提示（剩 ${2 - this.usedHints} 次）
          </button>
        </div>

        <!-- 答對/答錯遮罩（動畫用） -->
        <div class="sc-feedback-overlay" id="sc-feedback-overlay"></div>
      </div>
    `;
  }

  // ════════════════════════════════════════════
  // _buildTargetHTML — 組建4個靶的 HTML（數字暫為佔位符）
  // ════════════════════════════════════════════
  _buildTargetHTML() {
    let html = '';
    for (let i = 0; i < TARGET_COUNT; i++) {
      html += `
        <div class="sc-target" id="sc-target-${i}" data-index="${i}"
             style="left: ${25 * i}%"
             role="button" tabindex="0"
             aria-label="靶 ${i + 1}">
          <div class="sc-target-face">
            <span class="sc-target-number" id="sc-target-num-${i}">?</span>
          </div>
        </div>
      `;
    }
    return html;
  }

  // ════════════════════════════════════════════
  // _initTargets — 初始化靶的數字與動畫
  // ════════════════════════════════════════════
  _initTargets(q, speedMs) {
    // 停止舊動畫
    this._stopTargetAnimation();

    // 依 phase 決定正確答案
    const correctAnswer = this._phase === 'first' ? q.totalStrokes : q.radicalStrokes;

    // 產生4個靶的數字（正確值 ± 2~8，確保正整數，不重複）
    const numbers = this._generateTargetNumbers(correctAnswer);
    this._currentTargetNumbers = numbers;
    this._correctAnswer = correctAnswer;

    // 設定靶數字到 DOM
    for (let i = 0; i < TARGET_COUNT; i++) {
      const numEl = document.getElementById(`sc-target-num-${i}`);
      if (numEl) numEl.textContent = numbers[i];

      const targetEl = document.getElementById(`sc-target-${i}`);
      if (targetEl) {
        targetEl.classList.remove('sc-target--correct', 'sc-target--wrong', 'sc-target--glow');
        targetEl.setAttribute('aria-label', `靶 ${i + 1}，數字 ${numbers[i]}`);
      }
    }

    // 初始化位置與方向（每個靶錯開起始位置）
    this._targetPositions = [10, 30, 55, 78]; // 初始左側百分比
    this._targetDirections = [1, -1, 1, -1];  // 初始移動方向
    // 每個靶速度略有差異，增加視覺趣味
    const baseSpeed = 100 / speedMs; // %/ms
    this._targetSpeeds = [
      baseSpeed * 1.0,
      baseSpeed * 0.85,
      baseSpeed * 1.1,
      baseSpeed * 0.95,
    ];

    // 啟動動畫
    this._animRunning = true;
    this._lastTimestamp = null;
    requestAnimationFrame((ts) => this._animateTargets(ts));
  }

  // ════════════════════════════════════════════
  // _generateTargetNumbers — 產生4個不重複的靶數字
  // 正確答案一定包含，其餘為 ±2~8 的隨機整數（正整數）
  // ════════════════════════════════════════════
  _generateTargetNumbers(correct) {
    const candidates = new Set();
    candidates.add(correct);

    let attempts = 0;
    while (candidates.size < TARGET_COUNT && attempts < 50) {
      const offset = Math.floor(Math.random() * 7) + 2; // 2~8
      const sign = Math.random() < 0.5 ? 1 : -1;
      const val = correct + sign * offset;
      if (val >= 1) candidates.add(val); // 確保正整數
      attempts++;
    }

    // 如果候選數不足（極端情況），補充
    let fill = 1;
    while (candidates.size < TARGET_COUNT) {
      if (!candidates.has(fill)) candidates.add(fill);
      fill++;
    }

    // 轉為陣列並打亂
    const arr = Array.from(candidates);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr.slice(0, TARGET_COUNT);
  }

  // ════════════════════════════════════════════
  // _animateTargets — rAF 動畫迴圈：讓靶左右移動
  // ════════════════════════════════════════════
  _animateTargets(timestamp) {
    if (!this._animRunning) return;

    if (this._lastTimestamp === null) {
      this._lastTimestamp = timestamp;
    }
    const delta = timestamp - this._lastTimestamp; // ms 差值
    this._lastTimestamp = timestamp;

    for (let i = 0; i < TARGET_COUNT; i++) {
      const targetEl = document.getElementById(`sc-target-${i}`);
      if (!targetEl) continue;

      // 更新位置
      this._targetPositions[i] += this._targetDirections[i] * this._targetSpeeds[i] * delta;

      // 邊界反彈（5% ~ 88%，留邊距避免靶衝出畫面）
      if (this._targetPositions[i] >= 88) {
        this._targetPositions[i] = 88;
        this._targetDirections[i] = -1;
      } else if (this._targetPositions[i] <= 5) {
        this._targetPositions[i] = 5;
        this._targetDirections[i] = 1;
      }

      targetEl.style.left = this._targetPositions[i] + '%';
    }

    requestAnimationFrame((ts) => this._animateTargets(ts));
  }

  // ════════════════════════════════════════════
  // _stopTargetAnimation — 停止靶移動動畫
  // ════════════════════════════════════════════
  _stopTargetAnimation() {
    this._animRunning = false;
    this._lastTimestamp = null;
  }

  // ════════════════════════════════════════════
  // _bindEvents — 綁定靶的點擊事件
  // ════════════════════════════════════════════
  _bindEvents(q) {
    // 使用 window 全域函式避免 ES Module 內 inline onclick 問題
    window.__scSelectTarget = (index) => {
      if (this.isAnswering) return; // 防重複點擊
      const selectedNumber = this._currentTargetNumbers[index];
      this.submitAnswer(selectedNumber);
    };

    window.__scHint = () => {
      this.useHint();
    };

    // 為每個靶綁定點擊與鍵盤事件
    for (let i = 0; i < TARGET_COUNT; i++) {
      const targetEl = document.getElementById(`sc-target-${i}`);
      if (!targetEl) continue;

      // 移除舊有監聽器（換題時重建）
      const newTarget = targetEl.cloneNode(true);
      targetEl.parentNode.replaceChild(newTarget, targetEl);

      const idx = i; // 閉包捕獲
      document.getElementById(`sc-target-${i}`)?.addEventListener('click', () => {
        window.__scSelectTarget(idx);
      });
      document.getElementById(`sc-target-${i}`)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') window.__scSelectTarget(idx);
      });
    }
  }

  // ════════════════════════════════════════════
  // judgeAnswer — 判斷玩家選擇的數字是否正確
  // 此方法由 GameEngine.submitAnswer 在內部呼叫
  // ════════════════════════════════════════════
  async judgeAnswer(selectedNumber) {
    const q = this.getCurrentQuestion();
    if (!q) throw new Error('judgeAnswer: 無當前題目');

    const isCorrect = (selectedNumber === this._correctAnswer);
    return isCorrect;
  }

  // ════════════════════════════════════════════
  // onCorrectAnswer — 覆寫：處理兩射流程
  // GameEngine 在 judgeAnswer 回傳 true 後呼叫此方法
  // ════════════════════════════════════════════
  async onCorrectAnswer() {
    const q = this.getCurrentQuestion();

    if (this._phase === 'first') {
      // ── 第一射答對：立即顯示第二射（猜部首筆劃）──
      this._phase = 'second';
      this._phaseWrongCount = 0;

      // 顯示答對動畫（箭矢命中效果）
      this._showArrowHit(true);

      // 短暫停頓後切換到第二射
      await this._delay(600);

      // 更新題目提示文字
      const labelEl = document.getElementById('sc-phase-label');
      if (labelEl) {
        labelEl.textContent = `🎯 第二射：「${q.char}」的部首「${q.radical}」有幾劃？`;
      }

      // 重新初始化靶（換成部首筆劃題目）
      const level = q.level || 'medium';
      const speedMs = TARGET_SPEEDS[level] || TARGET_SPEEDS.medium;
      this._initTargets(q, speedMs);
      this._updateHintButton();

      // 清除提示區
      const hintArea = document.getElementById('sc-hint-area');
      if (hintArea) hintArea.innerHTML = '';

      // 第一射答對不呼叫 super.onCorrectAnswer()，不給星星，繼續等第二射
      return;
    }

    // ── 第二射答對：兩射全對，給星星、進下一題 ──
    this._showArrowHit(true);

    // 呼叫 GameEngine 的答對流程（計算星星、更新遺忘曲線等）
    await super.onCorrectAnswer();
  }

  // ════════════════════════════════════════════
  // onWrongAnswer — 覆寫：處理兩射答錯邏輯
  // ════════════════════════════════════════════
  async onWrongAnswer(selectedNumber) {
    this._phaseWrongCount++;
    this._showArrowHit(false);

    const q = this.getCurrentQuestion();

    if (this._phaseWrongCount === 1) {
      // ── 第一次答錯：給予提示，可再試 ──
      await super.onWrongFirstTime();

      // 高亮被點擊的錯誤靶
      const wrongIndex = this._currentTargetNumbers.indexOf(selectedNumber);
      if (wrongIndex !== -1) {
        const wrongTarget = document.getElementById(`sc-target-${wrongIndex}`);
        wrongTarget?.classList.add('sc-target--wrong');
        // 0.8秒後移除紅色高亮，讓玩家繼續嘗試
        setTimeout(() => wrongTarget?.classList.remove('sc-target--wrong'), 800);
      }

      // 若第一射答錯 → 整題失敗（不進第二射）
      // 根據規格：「第一射答錯 → 整題失敗（不進第二射），onWrongFirstTime」
      // 此處規格意為：第一次答錯允許再試，若第二次再錯才 onWrongSecondTime
      // 但「第一射答錯 → 整題失敗」代表第一射沒有第二次機會進入第二射
      // 解釋：「第一射答錯」指在第一射中任何一次答錯 → 整題失敗，不進第二射
      //       「再試」指的是同一射的重試（onWrongFirstTime = 仍可再試本射）
      // 根據 D.6：「任一射錯第一次→再試；再試仍錯→onWrongSecondTime」
      // → 所以第一射也可以錯一次後再試，再錯才算整題失敗
      return;
    }

    // ── 第二次答錯：整題失敗（不論哪一射）──
    await super.onWrongSecondTime();
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation — 答對整題動畫（兩射全過）
  // ════════════════════════════════════════════
  async playCorrectAnimation() {
    this._stopTargetAnimation();

    const overlay = document.getElementById('sc-feedback-overlay');
    const archer = document.getElementById('sc-archer');

    if (overlay) {
      overlay.innerHTML = '<div class="sc-correct-burst">🎉 命中！★+1</div>';
      overlay.classList.add('sc-feedback--visible');
    }
    if (archer) archer.classList.add('sc-archer--celebrate');

    // 高亮所有正確靶
    for (let i = 0; i < TARGET_COUNT; i++) {
      const targetEl = document.getElementById(`sc-target-${i}`);
      if (targetEl && this._currentTargetNumbers[i] === this._correctAnswer) {
        targetEl.classList.add('sc-target--correct');
      }
    }

    await this._delay(1200);

    if (overlay) overlay.classList.remove('sc-feedback--visible');
    if (archer) archer.classList.remove('sc-archer--celebrate');
  }

  // ════════════════════════════════════════════
  // playWrongAnimation — 答錯動畫
  // ════════════════════════════════════════════
  async playWrongAnimation() {
    const archer = document.getElementById('sc-archer');
    if (archer) {
      archer.classList.add('sc-archer--miss');
      await this._delay(500);
      archer.classList.remove('sc-archer--miss');
    }
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer — 答錯兩次後顯示正確答案
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    this._stopTargetAnimation();
    const q = this.getCurrentQuestion();
    if (!q) return;

    // 高亮正確靶
    for (let i = 0; i < TARGET_COUNT; i++) {
      const targetEl = document.getElementById(`sc-target-${i}`);
      if (!targetEl) continue;
      if (this._currentTargetNumbers[i] === this._correctAnswer) {
        targetEl.classList.add('sc-target--correct', 'sc-target--glow');
      }
    }

    // 顯示正確答案說明
    const hintArea = document.getElementById('sc-hint-area');
    if (hintArea) {
      const phaseLabel = this._phase === 'first'
        ? `「${q.char}」的總筆劃是 <strong>${q.totalStrokes}</strong> 劃`
        : `部首「${q.radical}」有 <strong>${q.radicalStrokes}</strong> 劃`;

      hintArea.innerHTML = `
        <div class="sc-answer-reveal">
          ✅ 正確答案：${phaseLabel}
        </div>
      `;
    }

    // 顯示「下一題」按鈕（GameEngine 通常由 showNextButton 處理）
    await this._delay(500);
  }

  // ════════════════════════════════════════════
  // getHint — 提供提示內容
  //   提示一：「總筆劃在 min～max 之間」（±4）
  //   提示二：「部首是『...』（帶注音體）」
  // ════════════════════════════════════════════
  getHint() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    const hintArea = document.getElementById('sc-hint-area');
    if (!hintArea) return;

    if (this.usedHints === 0) {
      // 提示一：範圍提示（±4），針對當前射的答案
      const answer = this._phase === 'first' ? q.totalStrokes : q.radicalStrokes;
      const min = Math.max(1, answer - 4);
      const max = answer + 4;
      hintArea.innerHTML = `
        <div class="sc-hint sc-hint--1">
          💡 提示：答案在 <strong>${min}</strong> 到 <strong>${max}</strong> 之間
        </div>
      `;
    } else if (this.usedHints === 1) {
      // 提示二：部首提示（帶注音體）
      // 部首注音：嘗試從 AppState.radicals 取得，否則只顯示部首字
      const radicalData = (AppState.radicals || []).find(r => r.char === q.radical);
      const radicalZhuyin = radicalData ? radicalData.pronunciation : '';
      const zhuyinDisplay = radicalZhuyin
        ? `<ruby>${q.radical}<rt>${radicalZhuyin}</rt></ruby>`
        : q.radical;

      hintArea.innerHTML = `
        <div class="sc-hint sc-hint--2">
          🔑 提示：「${q.char}」的部首是 ${zhuyinDisplay}
        </div>
      `;
    }
    // 第三次點提示無反應（由 GameEngine.useHint 上限控制）
  }

  // ════════════════════════════════════════════
  // _showArrowHit — 視覺效果：箭矢命中或落空
  // ════════════════════════════════════════════
  _showArrowHit(isHit) {
    const overlay = document.getElementById('sc-feedback-overlay');
    if (!overlay) return;

    overlay.innerHTML = isHit
      ? '<div class="sc-hit-effect">🏹💥</div>'
      : '<div class="sc-miss-effect">🏹❌</div>';
    overlay.classList.add('sc-feedback--visible');
    setTimeout(() => overlay.classList.remove('sc-feedback--visible'), 500);
  }

  // ════════════════════════════════════════════
  // _updateHintButton — 更新提示按鈕顯示
  // ════════════════════════════════════════════
  _updateHintButton() {
    const hintBtn = document.getElementById('sc-hint-btn');
    if (!hintBtn) return;
    const remaining = 2 - (this.usedHints || 0);
    hintBtn.textContent = `💡 提示（剩 ${remaining} 次）`;
    hintBtn.disabled = remaining <= 0;
  }

  // ════════════════════════════════════════════
  // _renderProgressBar — 渲染題目進度條
  // ════════════════════════════════════════════
  _renderProgressBar() {
    const fill = document.getElementById('sc-progress-fill');
    if (!fill || !this.questions) return;
    const pct = (this.currentIndex / this.questions.length) * 100;
    fill.style.width = pct + '%';
  }

  // ════════════════════════════════════════════
  // destroy — 清理遊戲資源
  // ════════════════════════════════════════════
  destroy() {
    this._stopTargetAnimation();
    // 清除 window 全域函式
    delete window.__scSelectTarget;
    delete window.__scHint;
    // 呼叫父類清理
    super.destroy();
  }

  // ════════════════════════════════════════════
  // _delay — Promise 包裝的延遲工具
  // ════════════════════════════════════════════
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─────────────────────────────────────────────
// CSS 樣式（動態注入，避免外部 CSS 依賴）
// ─────────────────────────────────────────────
(function injectStyles() {
  if (document.getElementById('sc-game-styles')) return; // 防重複注入
  const style = document.createElement('style');
  style.id = 'sc-game-styles';
  style.textContent = `
    /* ── 整體佈局 ── */
    .sc-game {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 100vh;
      background: linear-gradient(180deg, #0d1b2a 0%, #1b3a4b 40%, #2d6a4f 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow: hidden;
      font-family: 'Noto Serif TC', serif;
      color: #f0e6d3;
    }

    /* ── 頂部資訊列 ── */
    .sc-header {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px 8px;
      background: rgba(0,0,0,0.3);
      backdrop-filter: blur(4px);
      z-index: 10;
      flex-wrap: wrap;
    }

    .sc-question-char {
      font-size: 3rem;
      font-weight: 900;
      color: #ffd700;
      text-shadow: 0 0 20px rgba(255,215,0,0.5);
      line-height: 1;
      min-width: 3.5rem;
    }

    .sc-phase-label {
      font-size: 1.1rem;
      flex: 1;
      color: #e0f0ff;
      min-width: 180px;
    }

    .sc-difficulty-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: bold;
    }
    .sc-difficulty--hard       { background: #c62828; color: #fff; }
    .sc-difficulty--medium     { background: #e65100; color: #fff; }
    .sc-difficulty--easy       { background: #2e7d32; color: #fff; }
    .sc-difficulty--easy_plus  { background: #1565c0; color: #fff; }

    /* ── 進度條 ── */
    .sc-progress-bar {
      width: 90%;
      height: 6px;
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
      margin: 8px 0;
      overflow: hidden;
    }
    .sc-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #ffd700, #ff8c00);
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* ── 射箭場 ── */
    .sc-archery-range {
      position: relative;
      width: 95%;
      height: 220px;
      margin: 16px 0 0;
      /* 草地背景 */
      background: repeating-linear-gradient(
        90deg,
        rgba(45,106,79,0.4) 0px,
        rgba(45,106,79,0.4) 40px,
        rgba(27,58,75,0.3) 40px,
        rgba(27,58,75,0.3) 80px
      );
      border-radius: 12px;
      overflow: visible;
    }

    /* ── 移動靶 ── */
    .sc-target {
      position: absolute;
      top: 30px;
      width: 80px;
      height: 80px;
      cursor: pointer;
      transition: none; /* 動畫由 JS 控制，不需要 CSS transition */
      transform: translateX(-50%); /* 以靶中心為基準 */
      user-select: none;
    }

    .sc-target-face {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      /* 同心圓靶樣式 */
      background:
        radial-gradient(circle at center,
          #ffd700 0%, #ffd700 20%,
          #ff4444 20%, #ff4444 40%,
          #fff 40%, #fff 60%,
          #ff4444 60%, #ff4444 80%,
          #fff 80%, #fff 100%
        );
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      border: 3px solid #8b6914;
      transition: box-shadow 0.2s, transform 0.2s;
    }

    .sc-target:hover .sc-target-face,
    .sc-target:focus .sc-target-face {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(255,215,0,0.6);
    }

    .sc-target-number {
      font-size: 1.5rem;
      font-weight: 900;
      color: #1a1a2e;
      text-shadow: 1px 1px 0 #fff;
      z-index: 2;
      position: relative;
    }

    /* 靶繩（裝飾） */
    .sc-target::before {
      content: '';
      position: absolute;
      top: -30px;
      left: 50%;
      width: 2px;
      height: 30px;
      background: #8b6914;
      transform: translateX(-50%);
    }

    /* 答對高亮 */
    .sc-target--correct .sc-target-face {
      box-shadow: 0 0 30px 8px #00ff88, 0 4px 12px rgba(0,0,0,0.4);
      animation: sc-pulse-correct 0.6s ease infinite alternate;
    }

    /* 答錯高亮 */
    .sc-target--wrong .sc-target-face {
      box-shadow: 0 0 20px 6px #ff2222;
      animation: sc-shake 0.4s ease;
    }

    .sc-target--glow .sc-target-face {
      box-shadow: 0 0 40px 12px #ffd700;
    }

    @keyframes sc-pulse-correct {
      from { transform: scale(1); }
      to   { transform: scale(1.1); }
    }

    @keyframes sc-shake {
      0%, 100% { transform: translateX(-50%) rotate(0); }
      25%       { transform: translateX(-50%) rotate(-5deg); }
      75%       { transform: translateX(-50%) rotate(5deg); }
    }

    /* ── 弓箭手 ── */
    .sc-archer {
      font-size: 3.5rem;
      margin-top: 12px;
      transition: transform 0.3s;
      text-shadow: 0 4px 12px rgba(0,0,0,0.5);
      filter: drop-shadow(0 0 8px rgba(255,215,0,0.4));
    }

    .sc-archer--celebrate {
      animation: sc-celebrate 0.8s ease;
    }
    .sc-archer--miss {
      animation: sc-miss-wobble 0.5s ease;
    }

    @keyframes sc-celebrate {
      0%   { transform: scale(1) rotate(0); }
      30%  { transform: scale(1.3) rotate(-10deg); }
      60%  { transform: scale(1.2) rotate(10deg); }
      100% { transform: scale(1) rotate(0); }
    }

    @keyframes sc-miss-wobble {
      0%, 100% { transform: rotate(0); }
      25%       { transform: rotate(-8deg); }
      75%       { transform: rotate(8deg); }
    }

    /* ── 提示區 ── */
    .sc-hint-area {
      width: 90%;
      min-height: 48px;
      margin: 12px 0;
    }

    .sc-hint {
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 1rem;
      animation: sc-hint-appear 0.3s ease;
    }
    .sc-hint--1 { background: rgba(255,215,0,0.15); border-left: 4px solid #ffd700; }
    .sc-hint--2 { background: rgba(0,200,255,0.15); border-left: 4px solid #00c8ff; }

    .sc-answer-reveal {
      padding: 10px 16px;
      border-radius: 8px;
      background: rgba(0,255,100,0.15);
      border-left: 4px solid #00ff64;
      font-size: 1rem;
      animation: sc-hint-appear 0.3s ease;
    }

    @keyframes sc-hint-appear {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── 操作按鈕 ── */
    .sc-controls {
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }

    .sc-btn {
      padding: 10px 24px;
      border: none;
      border-radius: 24px;
      font-size: 1rem;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.15s, opacity 0.15s;
    }

    .sc-btn:active { transform: scale(0.95); }
    .sc-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .sc-btn--hint {
      background: linear-gradient(135deg, #1e3a5f, #2d6a9f);
      color: #e0f0ff;
      border: 1px solid #4a90d0;
    }

    /* ── 回饋遮罩 ── */
    .sc-feedback-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 100;
    }
    .sc-feedback--visible {
      opacity: 1;
    }

    .sc-correct-burst, .sc-hit-effect, .sc-miss-effect {
      font-size: 3rem;
      font-weight: 900;
      text-shadow: 0 0 30px rgba(255,255,255,0.8);
      animation: sc-burst 0.6s ease forwards;
    }

    .sc-correct-burst { color: #ffd700; }
    .sc-hit-effect    { color: #00ff88; }
    .sc-miss-effect   { color: #ff4444; }

    @keyframes sc-burst {
      0%   { transform: scale(0.5); opacity: 0; }
      50%  { transform: scale(1.4); opacity: 1; }
      100% { transform: scale(1);   opacity: 0; }
    }

    /* ── RWD 手機適配 ── */
    @media (max-width: 480px) {
      .sc-question-char { font-size: 2.2rem; }
      .sc-phase-label   { font-size: 0.95rem; }
      .sc-archery-range { height: 180px; }
      .sc-target        { width: 64px; height: 64px; }
      .sc-target-face   { width: 64px; height: 64px; }
      .sc-target-number { font-size: 1.2rem; }
    }
  `;
  document.head.appendChild(style);
})();

// ─────────────────────────────────────────────
// 預設匯出（供 GamePage.js 使用）
// ─────────────────────────────────────────────
export default StrokesCountGame;
