/**
 * polyphone.js — 多音判斷 × ✈️ 飛機撞答案遊戲
 * Task 20：繼承 GameEngine，實作飛機操控多音字判斷
 *
 * 遊戲規則（SECTION 9 D.4）：
 *   出題：包含多音字的詞語，判斷該字在此詞的讀音
 *   選項：該字的所有讀音（3-5個），以泡泡形式漂浮
 *   飛機速度（依遺忘等級，ms/格）：
 *     hard=300（慢）；medium=200；easy=150；easy_plus=100（快）
 *   操控：
 *     手機：左右滑動（touchmove）
 *     電腦：←→ 鍵移動 + 空白鍵發射
 *   答對：💥 爆炸；連續模式飛機持續飛翔不中斷
 *   答錯一次：飛機彈開（shake）
 *   答錯兩次：飛機降落，顯示正確讀音
 *   遺忘曲線：ForgettingCurve.recordResult(char, isCorrect, targetPronunciation)
 *   提示一：顯示其他讀音的詞語；提示二：高亮正確聲調
 *
 * 依賴模組：
 *   GameEngine.js（T14）、GameConfig.js（T15）
 *   state.js（T02）、audio.js（T08）、forgetting.js（T09）
 */

import { GameEngine } from './GameEngine.js';
import { AppState } from '../state.js';
import { AudioManager } from '../audio.js';

// ─────────────────────────────────────────────
// 飛機移動速度（px/ms，依遺忘等級）
// hard 最慢（飛機難以精準操控），easy_plus 最快
// ─────────────────────────────────────────────
const PLANE_SPEEDS = {
  hard:       0.12,   // 對應 300ms/格
  medium:     0.18,   // 200ms/格
  easy:       0.24,   // 150ms/格
  easy_plus:  0.36,   // 100ms/格
};

// 泡泡（答案選項）的數量上限
const MAX_BUBBLES = 5;

// 泡泡漂浮區高度（相對於遊戲區域）
const BUBBLE_AREA_HEIGHT_RATIO = 0.6;

export class PolyphoneGame extends GameEngine {
  constructor() {
    super('polyphone');

    // ── 飛機狀態 ──
    this._planeX = 50;           // 飛機 X 位置（%）
    this._planeY = 82;           // 飛機 Y 位置（%，固定下方）
    this._planeLanded = false;   // 飛機是否已降落（答錯二次）
    this._planeAnimFrame = null;
    this._planeSpeed = PLANE_SPEEDS.medium;

    // ── 泡泡狀態 ──
    this._bubbles = [];          // { id, text, isCorrect, x, y, vy, exploded }
    this._bubbleAnimFrame = null;
    this._bubbleIdCounter = 0;

    // ── 輸入狀態 ──
    this._keysDown = {};         // 目前按下的鍵
    this._touchStartX = null;    // 觸控起始 X
    this._lastTouchX = null;
    this._wrongCount = 0;

    // ── 題目資料 ──
    this._correctPronunciation = '';
    this._allReadings = [];      // 本題所有讀音

    // ── 動畫狀態 ──
    this._gameAnimRunning = false;
    this._lastTs = null;

    // ── 事件監聽器參考（destroy 時移除）──
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onTouchStart = null;
    this._onTouchMove = null;
    this._onTouchEnd = null;
  }

  // ════════════════════════════════════════════
  // loadQuestions — 從 polyphones.json 載入多音字資料
  // ════════════════════════════════════════════
  async loadQuestions() {
    const chars = this.questionChars;
    if (!chars || chars.length === 0) {
      throw new Error('polyphone: 題目字元為空');
    }

    // 取得多音字資料（已由 JSONLoader 載入到 AppState.polyphones）
    const polyData = AppState.polyphones || {};
    // 從 characters.json 全字典查詢完整資料（AppState.characters 只有簡單 {字,zhuyin}）
    const allChars = JSONLoader.get('characters') || [];
    const questions = [];

    for (const char of chars) {
      const poly = polyData[char];
      if (!poly || !poly.readings || poly.readings.length < 2) continue;

      const charData = allChars.find(c => (c['字'] || c.char) === char);

      // 從所有讀音中，選一個讀音作為本題目標
      // 優先選 fail_rate 最高的讀音（若有遺忘資料）
      // 簡化實作：隨機選一個讀音
      const targetIdx = Math.floor(Math.random() * poly.readings.length);
      const targetReading = poly.readings[targetIdx];

      // 找一個包含此字此讀音的詞語作為出題詞語
      const exampleWord = targetReading.words?.[0] || char;

      questions.push({
        char,
        targetPronunciation: targetReading.zhuyin,  // 正確讀音
        exampleWord,                                  // 出題詞語
        allReadings: poly.readings,                   // 所有讀音
        level: charData?.level || 'medium',
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

    // 停止舊動畫
    this._stopAllAnimations();
    this._removeInputListeners();

    // 重置狀態（連續模式下飛機不重置位置）
    this._wrongCount = 0;
    this._planeLanded = false;
    this._correctPronunciation = q.targetPronunciation;
    this._allReadings = q.allReadings;
    this._planeSpeed = PLANE_SPEEDS[q.level] || PLANE_SPEEDS.medium;

    // 連續模式（consecutiveCorrect > 0）：飛機 X 位置保持不變
    // 首題或答錯重來：飛機置中
    if (this.consecutiveCorrect === 0) {
      this._planeX = 50;
    }

    const appEl = this._getContainer();
    if (!appEl) return;

    appEl.innerHTML = this._buildHTML(q);
    this._renderProgressBar();
    this._updateHintButton();

    // 初始化泡泡（所有讀音）
    this._initBubbles(q);

    // 啟動遊戲動畫迴圈
    this._gameAnimRunning = true;
    this._lastTs = null;
    requestAnimationFrame(ts => this._gameLoop(ts));

    // 綁定輸入事件
    this._bindInputEvents();
  }

  // ════════════════════════════════════════════
  // _buildHTML
  // ════════════════════════════════════════════
  _buildHTML(q) {
    const levelLabel = { hard: '困難', medium: '中等', easy: '簡單', easy_plus: '加強' }[q.level] || '中等';

    return `
      <div class="pp-game" id="pp-game-root">
        <!-- 頂部題目 -->
        <div class="pp-header">
          <div class="pp-word-display">
            <span class="pp-word-text" id="pp-word-text">${q.exampleWord}</span>
            <span class="pp-char-highlight">「${q.char}」怎麼念？</span>
          </div>
          <div class="pp-badges">
            <span class="pp-badge pp-badge--${q.level}">${levelLabel}</span>
          </div>
        </div>

        <!-- 進度條 -->
        <div class="pp-progress-bar">
          <div class="pp-progress-fill" id="pp-progress-fill"></div>
        </div>

        <!-- 遊戲場景（天空） -->
        <div class="pp-sky" id="pp-sky">
          <!-- 泡泡由 JS 動態渲染 -->
          <div id="pp-bubbles-layer"></div>

          <!-- 飛機 -->
          <div class="pp-plane" id="pp-plane"
               style="left: ${this._planeX}%; top: ${this._planeY}%"
               aria-label="飛機">
            ✈️
            <div class="pp-missile" id="pp-missile" style="display:none">🚀</div>
          </div>

          <!-- 爆炸效果 -->
          <div class="pp-explosion" id="pp-explosion" style="display:none">💥</div>
        </div>

        <!-- 提示區 -->
        <div class="pp-hint-area" id="pp-hint-area"></div>

        <!-- 操控說明 + 按鈕 -->
        <div class="pp-controls">
          <span class="pp-control-tip">
            📱 左右滑動 &nbsp;|&nbsp; ⌨️ ←→ 移動，空白鍵發射
          </span>
          <button class="pp-btn pp-btn--hint" id="pp-hint-btn"
                  onclick="window.__ppHint()">
            💡 提示（剩 ${2 - (this.usedHints || 0)} 次）
          </button>
        </div>

        <!-- 回饋遮罩 -->
        <div class="pp-feedback" id="pp-feedback"></div>
      </div>
    `;
  }

  // ════════════════════════════════════════════
  // _initBubbles — 初始化所有讀音泡泡
  // ════════════════════════════════════════════
  _initBubbles(q) {
    this._bubbles = [];
    const readings = q.allReadings.slice(0, MAX_BUBBLES);
    const count = readings.length;

    readings.forEach((r, i) => {
      // 橫向均勻分布，縱向錯開
      const xBase = (100 / (count + 1)) * (i + 1);
      const yBase = 10 + (i % 2) * 15; // 10% 或 25%

      this._bubbles.push({
        id: ++this._bubbleIdCounter,
        text: r.zhuyin,
        label: r.label || r.zhuyin,
        words: r.words || [],
        isCorrect: r.zhuyin === q.targetPronunciation,
        x: xBase,
        y: yBase,
        vy: 0.008 + Math.random() * 0.004, // 緩慢下沉速度（%/ms）
        phase: Math.random() * Math.PI * 2, // 左右擺動相位
        exploded: false,
        hit: false,
      });
    });

    this._renderBubbles();
  }

  // ════════════════════════════════════════════
  // _renderBubbles — 渲染所有泡泡到 DOM
  // ════════════════════════════════════════════
  _renderBubbles() {
    const layer = document.getElementById('pp-bubbles-layer');
    if (!layer) return;

    layer.innerHTML = this._bubbles
      .filter(b => !b.exploded)
      .map(b => `
        <div class="pp-bubble ${b.isCorrect ? 'pp-bubble--correct-hint' : ''} ${b.hit ? 'pp-bubble--hit' : ''}"
             id="pp-bubble-${b.id}"
             style="left:${b.x}%;top:${b.y}%"
             data-id="${b.id}">
          <span class="pp-bubble-text">${b.text}</span>
        </div>
      `).join('');
  }

  // ════════════════════════════════════════════
  // _gameLoop — 主動畫迴圈
  // ════════════════════════════════════════════
  _gameLoop(timestamp) {
    if (!this._gameAnimRunning) return;

    if (this._lastTs === null) this._lastTs = timestamp;
    const delta = Math.min(timestamp - this._lastTs, 50); // 最大 50ms 避免卡頓後跳躍
    this._lastTs = timestamp;

    // ── 更新飛機位置（鍵盤控制）──
    if (!this._planeLanded) {
      if (this._keysDown['ArrowLeft'] || this._keysDown['Left']) {
        this._planeX -= this._planeSpeed * delta;
      }
      if (this._keysDown['ArrowRight'] || this._keysDown['Right']) {
        this._planeX += this._planeSpeed * delta;
      }
      this._planeX = Math.max(3, Math.min(95, this._planeX));

      const planeEl = document.getElementById('pp-plane');
      if (planeEl) planeEl.style.left = this._planeX + '%';
    }

    // ── 更新泡泡位置（上下漂浮 + 緩慢下沉）──
    let anyBubble = false;
    for (const b of this._bubbles) {
      if (b.exploded) continue;
      anyBubble = true;

      // 左右擺動（正弦波）
      b.phase += 0.001 * delta;
      const swayX = Math.sin(b.phase) * 1.5;

      // 緩慢下沉
      b.y += b.vy * delta;

      // 超出下方邊界→回到頂部
      if (b.y > 75) b.y = 5;

      const el = document.getElementById(`pp-bubble-${b.id}`);
      if (el) {
        el.style.left = (b.x + swayX) + '%';
        el.style.top = b.y + '%';
      }
    }

    // 如果沒有泡泡了（全部答完），不需特別處理（GameEngine 管流程）

    requestAnimationFrame(ts => this._gameLoop(ts));
  }

  // ════════════════════════════════════════════
  // _bindInputEvents — 綁定鍵盤與觸控事件
  // ════════════════════════════════════════════
  _bindInputEvents() {
    // 鍵盤
    this._onKeyDown = (e) => {
      this._keysDown[e.key] = true;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        this._fireMissile();
      }
    };
    this._onKeyUp = (e) => {
      delete this._keysDown[e.key];
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    // 觸控（手機左右滑動）
    const sky = document.getElementById('pp-sky');
    if (sky) {
      this._onTouchStart = (e) => {
        this._touchStartX = e.touches[0].clientX;
        this._lastTouchX = this._touchStartX;
      };
      this._onTouchMove = (e) => {
        if (this._lastTouchX === null) return;
        const dx = e.touches[0].clientX - this._lastTouchX;
        this._lastTouchX = e.touches[0].clientX;
        // 換算為%（假設場景寬度約 400px）
        const skyWidth = sky.clientWidth || 400;
        this._planeX += (dx / skyWidth) * 100;
        this._planeX = Math.max(3, Math.min(95, this._planeX));
        e.preventDefault();
      };
      this._onTouchEnd = (e) => {
        // 短暫點擊（非滑動）→ 發射
        if (this._touchStartX !== null && Math.abs(e.changedTouches[0].clientX - this._touchStartX) < 10) {
          this._fireMissile();
        }
        this._touchStartX = null;
        this._lastTouchX = null;
      };
      sky.addEventListener('touchstart', this._onTouchStart, { passive: false });
      sky.addEventListener('touchmove', this._onTouchMove, { passive: false });
      sky.addEventListener('touchend', this._onTouchEnd);
    }

    // 提示按鈕
    window.__ppHint = () => this.useHint();
  }

  // ════════════════════════════════════════════
  // _removeInputListeners — 移除所有輸入監聽器
  // ════════════════════════════════════════════
  _removeInputListeners() {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp);

    const sky = document.getElementById('pp-sky');
    if (sky && this._onTouchStart) {
      sky.removeEventListener('touchstart', this._onTouchStart);
      sky.removeEventListener('touchmove', this._onTouchMove);
      sky.removeEventListener('touchend', this._onTouchEnd);
    }

    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onTouchStart = null;
    this._onTouchMove = null;
    this._onTouchEnd = null;
    this._keysDown = {};
  }

  // ════════════════════════════════════════════
  // _fireMissile — 發射飛彈，檢測命中哪個泡泡
  // ════════════════════════════════════════════
  _fireMissile() {
    if (this.isAnswering || this._planeLanded) return;

    // 找最近的泡泡（飛機正上方 X 範圍內）
    let closest = null;
    let minDist = Infinity;

    for (const b of this._bubbles) {
      if (b.exploded) continue;
      const dist = Math.abs(b.x - this._planeX);
      if (dist < 12 && dist < minDist) { // 12% 範圍內視為命中
        minDist = dist;
        closest = b;
      }
    }

    if (!closest) {
      // 沒有命中任何泡泡，飛彈空射
      this._showMissileEffect(this._planeX, 60);
      return;
    }

    // 命中泡泡
    this._showMissileEffect(closest.x, closest.y);
    this.submitAnswer(closest.text);
  }

  // ════════════════════════════════════════════
  // _showMissileEffect — 顯示飛彈飛行動畫（視覺）
  // ════════════════════════════════════════════
  _showMissileEffect(targetX, targetY) {
    const missile = document.getElementById('pp-missile');
    if (!missile) return;
    missile.style.display = 'block';
    setTimeout(() => {
      if (missile) missile.style.display = 'none';
    }, 300);
  }

  // ════════════════════════════════════════════
  // judgeAnswer
  // ════════════════════════════════════════════
  async judgeAnswer(selectedText) {
    return selectedText === this._correctPronunciation;
  }

  // ════════════════════════════════════════════
  // onCorrectAnswer（覆寫）— 連續模式：飛機不降落
  // ════════════════════════════════════════════
  async onCorrectAnswer() {
    const q = this.getCurrentQuestion();

    // 標記命中的泡泡爆炸
    const hitBubble = this._bubbles.find(b => b.text === this._correctPronunciation);
    if (hitBubble) {
      hitBubble.exploded = true;
      this._showExplosion(hitBubble.x, hitBubble.y);
    }

    // 連續模式：飛機維持飛行（不降落）
    // → 呼叫父類處理星星、遺忘曲線等
    await super.onCorrectAnswer();
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation — 爆炸特效
  // ════════════════════════════════════════════
  async playCorrectAnimation() {
    const feedback = document.getElementById('pp-feedback');
    if (feedback) {
      feedback.innerHTML = '<div class="pp-correct-text">💥 命中！</div>';
      feedback.classList.add('pp-feedback--show');
    }
    await this._delay(800);
    if (feedback) feedback.classList.remove('pp-feedback--show');
  }

  // ════════════════════════════════════════════
  // playWrongAnimation — 飛機彈開（shake）
  // ════════════════════════════════════════════
  async playWrongAnimation() {
    this._wrongCount++;
    const planeEl = document.getElementById('pp-plane');
    if (planeEl) {
      planeEl.classList.add('pp-plane--shake');
      await this._delay(500);
      planeEl.classList.remove('pp-plane--shake');
    }
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer — 答錯兩次：飛機降落，顯示正確讀音
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    // 飛機降落動畫
    this._planeLanded = true;
    const planeEl = document.getElementById('pp-plane');
    if (planeEl) {
      planeEl.classList.add('pp-plane--land');
    }

    // 高亮正確泡泡
    const correctBubble = this._bubbles.find(b => b.isCorrect);
    if (correctBubble) {
      const el = document.getElementById(`pp-bubble-${correctBubble.id}`);
      el?.classList.add('pp-bubble--reveal');
    }

    // 顯示正確答案說明
    const hintArea = document.getElementById('pp-hint-area');
    if (hintArea) {
      const reading = q.allReadings.find(r => r.zhuyin === this._correctPronunciation);
      hintArea.innerHTML = `
        <div class="pp-answer-reveal">
          ✅ 「${q.char}」在「${q.exampleWord}」中念
          <strong>${this._correctPronunciation}</strong>
          ${reading?.label ? `（${reading.label}）` : ''}
        </div>
      `;
    }

    await this._delay(400);
  }

  // ════════════════════════════════════════════
  // getHint
  //   提示一：顯示其他讀音的詞語（讓學生對比）
  //   提示二：高亮正確聲調
  // ════════════════════════════════════════════
  getHint() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const hintArea = document.getElementById('pp-hint-area');
    if (!hintArea) return;

    if (this.usedHints === 0) {
      // 提示一：列出其他讀音及其代表詞語
      const otherReadings = q.allReadings
        .filter(r => r.zhuyin !== this._correctPronunciation)
        .map(r => `${r.zhuyin}（${r.words?.[0] || r.label || ''}）`)
        .join('、');

      hintArea.innerHTML = `
        <div class="pp-hint pp-hint--1">
          💡 其他讀音：${otherReadings || '無'}
          <br>→ 本題詞語「${q.exampleWord}」的讀音不是這些
        </div>
      `;
    } else if (this.usedHints === 1) {
      // 提示二：高亮正確聲調
      const tone = this._extractTone(this._correctPronunciation);
      const toneLabels = { '': '一聲（平調）', 'ˊ': '二聲（上揚）', 'ˇ': '三聲（先降後升）', 'ˋ': '四聲（下降）' };
      const toneDesc = toneLabels[tone] || '輕聲';

      // 高亮含正確聲調的泡泡
      for (const b of this._bubbles) {
        if (b.exploded) continue;
        const t = this._extractTone(b.text);
        const el = document.getElementById(`pp-bubble-${b.id}`);
        if (el && t === tone) {
          el.classList.add('pp-bubble--tone-hint');
        }
      }

      hintArea.innerHTML = `
        <div class="pp-hint pp-hint--2">
          🔑 正確答案是<strong>${toneDesc}</strong>
        </div>
      `;
    }
  }

  // ════════════════════════════════════════════
  // _showExplosion — 爆炸特效
  // ════════════════════════════════════════════
  _showExplosion(x, y) {
    const exp = document.getElementById('pp-explosion');
    if (!exp) return;
    exp.style.left = x + '%';
    exp.style.top = y + '%';
    exp.style.display = 'block';
    setTimeout(() => { if (exp) exp.style.display = 'none'; }, 600);
  }

  // ════════════════════════════════════════════
  // _extractTone — 從注音取出聲調符號
  // ════════════════════════════════════════════
  _extractTone(pron) {
    if (!pron) return '';
    if (pron.includes('ˋ')) return 'ˋ';
    if (pron.includes('ˇ')) return 'ˇ';
    if (pron.includes('ˊ')) return 'ˊ';
    return '';
  }

  // ════════════════════════════════════════════
  // _updateHintButton
  // ════════════════════════════════════════════
  _updateHintButton() {
    const btn = document.getElementById('pp-hint-btn');
    if (!btn) return;
    const remaining = 2 - (this.usedHints || 0);
    btn.textContent = `💡 提示（剩 ${remaining} 次）`;
    btn.disabled = remaining <= 0;
  }

  // ════════════════════════════════════════════
  // _renderProgressBar
  // ════════════════════════════════════════════
  _renderProgressBar() {
    const fill = document.getElementById('pp-progress-fill');
    if (!fill || !this.questions) return;
    const pct = (this.currentIndex / this.questions.length) * 100;
    fill.style.width = pct + '%';
  }

  // ════════════════════════════════════════════
  // _stopAllAnimations
  // ════════════════════════════════════════════
  _stopAllAnimations() {
    this._gameAnimRunning = false;
    this._lastTs = null;
  }

  // ════════════════════════════════════════════
  // destroy
  // ════════════════════════════════════════════
  destroy() {
    this._stopAllAnimations();
    this._removeInputListeners();
    delete window.__ppHint;
    super.destroy();
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─────────────────────────────────────────────
// CSS 動態注入
// ─────────────────────────────────────────────
(function injectPolyphoneStyles() {
  if (document.getElementById('pp-game-styles')) return;
  const style = document.createElement('style');
  style.id = 'pp-game-styles';
  style.textContent = `
    /* ── 整體 ── */
    .pp-game {
      position: relative;
      width: 100%;
      min-height: 100vh;
      background: linear-gradient(180deg, #87ceeb 0%, #b0e0ff 40%, #e0f0ff 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: 'Noto Serif TC', serif;
      color: #1a237e;
      overflow: hidden;
    }

    /* ── 頂部 ── */
    .pp-header {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px 6px;
      background: rgba(255,255,255,0.6);
      backdrop-filter: blur(4px);
      flex-wrap: wrap;
      gap: 8px;
    }

    .pp-word-display {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }

    .pp-word-text {
      font-size: 2rem;
      font-weight: 900;
      color: #1565c0;
      letter-spacing: 4px;
    }

    .pp-char-highlight {
      font-size: 1rem;
      color: #37474f;
    }

    .pp-badges { display: flex; gap: 6px; }
    .pp-badge {
      padding: 3px 10px;
      border-radius: 16px;
      font-size: 0.75rem;
      font-weight: bold;
    }
    .pp-badge--hard       { background: #c62828; color: #fff; }
    .pp-badge--medium     { background: #e65100; color: #fff; }
    .pp-badge--easy       { background: #2e7d32; color: #fff; }
    .pp-badge--easy_plus  { background: #1565c0; color: #fff; }

    /* ── 進度條 ── */
    .pp-progress-bar {
      width: 90%; height: 6px;
      background: rgba(0,0,0,0.1);
      border-radius: 3px;
      margin: 6px 0;
      overflow: hidden;
    }
    .pp-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #1565c0, #42a5f5);
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* ── 天空場景 ── */
    .pp-sky {
      position: relative;
      width: 100%;
      height: 340px;
      overflow: hidden;
      /* 雲朵背景 */
      background:
        radial-gradient(ellipse 80px 40px at 15% 20%, rgba(255,255,255,0.8) 0%, transparent 70%),
        radial-gradient(ellipse 60px 30px at 70% 15%, rgba(255,255,255,0.7) 0%, transparent 70%),
        radial-gradient(ellipse 100px 50px at 85% 35%, rgba(255,255,255,0.6) 0%, transparent 70%),
        linear-gradient(180deg, #87ceeb 0%, #b8d4f0 100%);
    }

    /* ── 泡泡（答案選項） ── */
    #pp-bubbles-layer {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
    }

    .pp-bubble {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 68px; height: 68px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%,
        rgba(255,255,255,0.9) 0%,
        rgba(135,206,235,0.7) 50%,
        rgba(100,180,220,0.5) 100%
      );
      border: 2px solid rgba(255,255,255,0.8);
      box-shadow: 0 4px 16px rgba(0,100,200,0.2),
                  inset 0 0 12px rgba(255,255,255,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: box-shadow 0.2s;
      backdrop-filter: blur(2px);
    }

    .pp-bubble-text {
      font-size: 1rem;
      font-weight: bold;
      color: #0d47a1;
      text-shadow: 0 1px 2px rgba(255,255,255,0.8);
      font-family: 'BpmfIVS', serif;
    }

    /* 聲調提示高亮 */
    .pp-bubble--tone-hint {
      box-shadow: 0 0 20px 4px rgba(255,200,0,0.7);
      border-color: #ffd700;
    }

    /* 答錯二次後正確泡泡顯示 */
    .pp-bubble--reveal {
      box-shadow: 0 0 30px 8px rgba(0,255,100,0.8);
      border-color: #00e676;
      animation: pp-glow 0.6s ease infinite alternate;
    }
    @keyframes pp-glow {
      from { box-shadow: 0 0 20px rgba(0,255,100,0.6); }
      to   { box-shadow: 0 0 40px rgba(0,255,100,1); }
    }

    /* ── 飛機 ── */
    .pp-plane {
      position: absolute;
      font-size: 2.5rem;
      transform: translate(-50%, -50%);
      transition: top 0.5s ease; /* Y 位置變化（降落）有過渡 */
      z-index: 10;
      cursor: default;
      user-select: none;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
    }

    .pp-plane--shake {
      animation: pp-shake 0.4s ease;
    }
    @keyframes pp-shake {
      0%, 100% { transform: translate(-50%, -50%) rotate(0); }
      20%       { transform: translate(-50%, -50%) rotate(-10deg) translateX(-8px); }
      60%       { transform: translate(-50%, -50%) rotate(10deg) translateX(8px); }
    }

    .pp-plane--land {
      top: 95% !important;
      transition: top 0.8s ease;
    }

    /* 飛彈 */
    .pp-missile {
      position: absolute;
      top: -24px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 1.2rem;
      animation: pp-missile-fly 0.3s ease forwards;
    }
    @keyframes pp-missile-fly {
      from { top: -10px; opacity: 1; }
      to   { top: -80px; opacity: 0; }
    }

    /* 爆炸 */
    .pp-explosion {
      position: absolute;
      font-size: 3rem;
      transform: translate(-50%, -50%);
      z-index: 20;
      animation: pp-explode 0.6s ease forwards;
      pointer-events: none;
    }
    @keyframes pp-explode {
      0%   { transform: translate(-50%,-50%) scale(0.5); opacity: 1; }
      50%  { transform: translate(-50%,-50%) scale(2);   opacity: 1; }
      100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; }
    }

    /* ── 提示區 ── */
    .pp-hint-area {
      width: 92%; min-height: 40px;
      margin: 6px 0;
    }
    .pp-hint {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.92rem;
      animation: pp-appear 0.3s ease;
    }
    .pp-hint--1 { background: rgba(255,193,7,0.2); border-left: 4px solid #ffc107; }
    .pp-hint--2 { background: rgba(33,150,243,0.15); border-left: 4px solid #2196f3; }

    .pp-answer-reveal {
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(76,175,80,0.15);
      border-left: 4px solid #4caf50;
      font-size: 0.92rem;
      animation: pp-appear 0.3s ease;
    }

    /* ── 控制說明 ── */
    .pp-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
      padding: 8px 16px;
    }

    .pp-control-tip {
      font-size: 0.8rem;
      color: #546e7a;
    }

    .pp-btn {
      padding: 8px 20px;
      border: none;
      border-radius: 20px;
      font-size: 0.9rem;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.15s;
    }
    .pp-btn:active { transform: scale(0.95); }
    .pp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pp-btn--hint { background: #1565c0; color: #fff; }

    /* ── 回饋 ── */
    .pp-feedback {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 50;
    }
    .pp-feedback--show { opacity: 1; }
    .pp-correct-text {
      font-size: 3rem;
      font-weight: 900;
      color: #ffd700;
      text-shadow: 0 0 20px rgba(255,215,0,0.8);
      animation: pp-appear 0.3s ease;
    }

    @keyframes pp-appear {
      from { opacity: 0; transform: scale(0.8); }
      to   { opacity: 1; transform: scale(1); }
    }

    /* ── RWD ── */
    @media (max-width: 480px) {
      .pp-word-text { font-size: 1.6rem; }
      .pp-sky { height: 280px; }
      .pp-bubble { width: 58px; height: 58px; }
      .pp-bubble-text { font-size: 0.88rem; }
    }
    
      /* ── RWD 平板（≥600px）── */
      @media (min-width: 600px) {
        .pp-sky           { max-width: 520px; margin: 0 auto; }
        .pp-choices       { max-width: 520px; margin: 0 auto; }
      }
/* ── RWD 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .pp-game { max-width: 760px; margin: 0 auto; }
    }
  `;
  document.head.appendChild(style);
})();

export default PolyphoneGame;
