/**
 * listen.js — 聽音選字 × 🎣 釣魚遊戲
 * Task 18：繼承 GameEngine，實作兩種模式
 *
 * 遊戲規則（SECTION 9 D.10）：
 *   模式比例：60% 模式一（聽發音選漢字）/ 40% 模式二（聽詞語選注音）
 *   選項：1個正確 + 3個干擾（字形相近或同音異字）
 *   魚游速度：hard=4000ms / medium=3000ms / easy=2000ms / easy_plus=1500ms
 *   答對：🎉 魚跳出水面動畫
 *   答錯兩次：正確魚發光浮出，再播一次音效（soundOn=true 時）
 *   提示一：高亮正確聲調；提示二：「聲母是ㄉ」或「無聲母」
 *   靜音時（v4）：播放按鈕顯示「🔇 無聲」，同時顯示注音文字替代，遊戲仍可進行
 *
 * 依賴模組：
 *   GameEngine.js（T14）、GameConfig.js（T15）
 *   state.js（T02）、audio.js（T08）
 *   forgetting.js（T09）、stars.js（T10）
 */

import { GameEngine } from './GameEngine.js';
import { AppState } from '../state.js';
import { AudioManager } from '../audio.js';

// ─────────────────────────────────────────────
// 魚游速度對應表（毫秒/完整來回）
// hard 最慢（魚游慢，難以點選），easy_plus 最快
// ─────────────────────────────────────────────
const FISH_SPEEDS = {
  hard:       4000,
  medium:     3000,
  easy:       2000,
  easy_plus:  1500,
};

// 固定4條魚，各有不同基礎速度倍率（增加趣味性）
const FISH_SPEED_MULTIPLIERS = [1.0, 0.85, 1.15, 0.95];

// 魚的圖示（4種顏色/樣式）
const FISH_EMOJIS = ['🐠', '🐟', '🐡', '🦈'];

// 每題選項數量（1正確 + 3干擾）
const OPTION_COUNT = 4;

export class ListenGame extends GameEngine {
  constructor() {
    super('listen');

    // ── 遊戲狀態 ──
    this._mode = 1;              // 1=聽發音選漢字；2=聽詞語選注音
    this._wrongCount = 0;        // 本題答錯次數
    this._fishAnimRunning = false;
    this._lastTimestamp = null;
    this._fishPositions = [];    // 每條魚的 X 位置（%）
    this._fishDirections = [];   // 每條魚的移動方向（+1/-1）
    this._fishSpeeds = [];       // 每條魚的速度（%/ms）
    this._fishAnswers = [];      // 每條魚對應的選項文字
    this._correctFishIndex = -1; // 正確魚的索引
    this._currentAudioZhuyin = '';// 當前題目的注音（供播放用）
    this._currentWord = '';      // 模式二：詞語
  }

  // ════════════════════════════════════════════
  // loadQuestions
  // ════════════════════════════════════════════
  async loadQuestions() {
    const chars = this.questionChars;
    if (!chars || chars.length === 0) {
      throw new Error('listen: 題目字元為空');
    }

    const allChars = AppState.characters || [];
    const questions = [];

    for (const char of chars) {
      const charData = allChars.find(c => c.char === char);
      if (!charData) continue;

      // 決定模式（60/40）
      const mode = Math.random() < 0.6 ? 1 : 2;

      // 產生干擾選項（字形相近或同音）
      const distractors = this._buildDistractors(char, charData, allChars, mode);

      questions.push({
        char,
        pronunciation: charData.pronunciation || '',
        words: charData.words || [],
        level: charData.level || 'medium',
        mode,
        distractors, // 3個干擾
      });
    }

    this.questions = questions;
    return questions;
  }

  // ════════════════════════════════════════════
  // _buildDistractors — 產生3個干擾選項
  // 模式一（選漢字）：同音或形近字
  // 模式二（選注音）：相似注音（同聲母或同韻母）
  // ════════════════════════════════════════════
  _buildDistractors(char, charData, allChars, mode) {
    const result = [];
    const used = new Set([char]);

    if (mode === 1) {
      // 模式一：優先找同音字，補充形近/隨機
      const sameSound = allChars.filter(c =>
        c.char !== char &&
        c.pronunciation === charData.pronunciation
      );
      for (const c of sameSound) {
        if (result.length >= 3) break;
        if (!used.has(c.char)) {
          result.push(c.char);
          used.add(c.char);
        }
      }
      // 補充隨機字
      const shuffled = [...allChars].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (result.length >= 3) break;
        if (!used.has(c.char)) {
          result.push(c.char);
          used.add(c.char);
        }
      }
    } else {
      // 模式二：找相似注音（替換聲調或聲母）
      const correctPron = charData.pronunciation || '';
      const similar = allChars
        .filter(c => c.char !== char && c.pronunciation && c.pronunciation !== correctPron)
        .sort((a, b) => {
          // 優先選聲母相同但聲調不同的（干擾性更強）
          const aScore = a.pronunciation[0] === correctPron[0] ? 1 : 0;
          const bScore = b.pronunciation[0] === correctPron[0] ? 1 : 0;
          return bScore - aScore + Math.random() * 0.4 - 0.2;
        });

      for (const c of similar) {
        if (result.length >= 3) break;
        if (!used.has(c.pronunciation)) {
          result.push(c.pronunciation);
          used.add(c.pronunciation);
        }
      }
      // 補充
      for (const c of allChars.sort(() => Math.random() - 0.5)) {
        if (result.length >= 3) break;
        if (c.pronunciation && !used.has(c.pronunciation) && c.pronunciation !== correctPron) {
          result.push(c.pronunciation);
          used.add(c.pronunciation);
        }
      }
    }

    return result.slice(0, 3);
  }

  // ════════════════════════════════════════════
  // renderQuestion
  // ════════════════════════════════════════════
  renderQuestion() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    this._mode = q.mode;
    this._wrongCount = 0;

    // 停止舊動畫
    this._stopFishAnimation();

    const appEl = document.getElementById('app');
    if (!appEl) return;

    // 正確答案文字（模式一=漢字，模式二=注音）
    const correctAnswer = q.mode === 1 ? q.char : q.pronunciation;

    // 組合4個選項（含1正確+3干擾），打亂順序
    const options = this._shuffleOptions(correctAnswer, q.distractors);
    this._fishAnswers = options;
    this._correctFishIndex = options.indexOf(correctAnswer);
    this._currentAudioZhuyin = q.pronunciation;

    // 模式二的詞語（取第一個詞）
    this._currentWord = (q.words && q.words.length > 0) ? q.words[0] : q.char;

    appEl.innerHTML = this._buildHTML(q, options);
    this._initFishAnimation(q.level);
    this._bindEvents();
    this._updateHintButton();
    this._renderProgressBar();

    // 自動播放發音（soundOn=true 時）
    this._playCurrentAudio(q);
  }

  // ════════════════════════════════════════════
  // _buildHTML — 組建遊戲 HTML
  // ════════════════════════════════════════════
  _buildHTML(q, options) {
    const soundOn = AppState.settings?.soundOn !== false;
    const level = q.level || 'medium';
    const levelLabel = { hard: '困難', medium: '中等', easy: '簡單', easy_plus: '加強' }[level] || '中等';

    // 題目說明文字
    const questionText = q.mode === 1
      ? `聽發音，選出正確的國字`
      : `聽詞語「${this._currentWord}」，選出正確的注音`;

    // 靜音時顯示注音替代文字
    const zhuyinFallback = !soundOn
      ? `<div class="ls-zhuyin-fallback">
           <ruby>${q.char}<rt>${q.pronunciation}</rt></ruby>
         </div>`
      : '';

    return `
      <div class="ls-game" id="ls-game-root">
        <!-- 頂部 -->
        <div class="ls-header">
          <div class="ls-question-text">${questionText}</div>
          <div class="ls-badge ls-badge--${level}">${levelLabel}</div>
        </div>

        <!-- 進度條 -->
        <div class="ls-progress-bar">
          <div class="ls-progress-fill" id="ls-progress-fill"></div>
        </div>

        <!-- 播放按鈕 -->
        <div class="ls-play-area">
          <button class="ls-play-btn ${!soundOn ? 'ls-play-btn--muted' : ''}"
                  id="ls-play-btn"
                  onclick="window.__lsPlay()"
                  aria-label="${soundOn ? '播放發音' : '靜音模式'}">
            ${soundOn ? '🔊 播放' : '🔇 無聲'}
          </button>
          ${zhuyinFallback}
        </div>

        <!-- 水族館（魚游動區域） -->
        <div class="ls-aquarium" id="ls-aquarium" aria-label="水族館">
          <!-- 水波裝飾 -->
          <div class="ls-water-waves">
            <div class="ls-wave ls-wave--1"></div>
            <div class="ls-wave ls-wave--2"></div>
          </div>
          <!-- 4條魚 -->
          ${this._buildFishHTML(options)}
        </div>

        <!-- 提示區 -->
        <div class="ls-hint-area" id="ls-hint-area"></div>

        <!-- 提示按鈕 -->
        <div class="ls-controls">
          <button class="ls-btn ls-btn--hint" id="ls-hint-btn"
                  onclick="window.__lsHint()">
            💡 提示（剩 ${2 - (this.usedHints || 0)} 次）
          </button>
        </div>

        <!-- 回饋遮罩 -->
        <div class="ls-feedback" id="ls-feedback"></div>
      </div>
    `;
  }

  // ════════════════════════════════════════════
  // _buildFishHTML — 組建4條魚的 HTML
  // ════════════════════════════════════════════
  _buildFishHTML(options) {
    let html = '';
    // 魚在不同水深行（4行）
    const depths = [15, 35, 55, 75]; // top % in aquarium

    for (let i = 0; i < OPTION_COUNT; i++) {
      html += `
        <div class="ls-fish-row" style="top: ${depths[i]}%;">
          <div class="ls-fish" id="ls-fish-${i}"
               data-index="${i}"
               style="left: ${20 + i * 15}%"
               role="button" tabindex="0"
               aria-label="選項 ${options[i]}">
            <span class="ls-fish-emoji">${FISH_EMOJIS[i]}</span>
            <span class="ls-fish-label" id="ls-fish-label-${i}">${options[i]}</span>
          </div>
        </div>
      `;
    }
    return html;
  }

  // ════════════════════════════════════════════
  // _shuffleOptions — 打亂選項順序
  // ════════════════════════════════════════════
  _shuffleOptions(correct, distractors) {
    const arr = [correct, ...distractors.slice(0, 3)];
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ════════════════════════════════════════════
  // _initFishAnimation — 初始化魚的游動動畫
  // ════════════════════════════════════════════
  _initFishAnimation(level) {
    const baseSpeedMs = FISH_SPEEDS[level] || FISH_SPEEDS.medium;

    this._fishPositions = [20, 35, 55, 70];
    this._fishDirections = [1, -1, 1, -1];
    this._fishSpeeds = FISH_SPEED_MULTIPLIERS.map(m => (100 / baseSpeedMs) * m);

    this._fishAnimRunning = true;
    this._lastTimestamp = null;
    requestAnimationFrame(ts => this._animateFish(ts));
  }

  // ════════════════════════════════════════════
  // _animateFish — rAF 動畫：魚左右游動
  // ════════════════════════════════════════════
  _animateFish(timestamp) {
    if (!this._fishAnimRunning) return;

    if (this._lastTimestamp === null) this._lastTimestamp = timestamp;
    const delta = timestamp - this._lastTimestamp;
    this._lastTimestamp = timestamp;

    for (let i = 0; i < OPTION_COUNT; i++) {
      const fishEl = document.getElementById(`ls-fish-${i}`);
      if (!fishEl) continue;

      this._fishPositions[i] += this._fishDirections[i] * this._fishSpeeds[i] * delta;

      // 邊界反彈（5%~85%）
      if (this._fishPositions[i] >= 85) {
        this._fishPositions[i] = 85;
        this._fishDirections[i] = -1;
        fishEl.style.transform = 'scaleX(-1)'; // 魚反轉方向
      } else if (this._fishPositions[i] <= 5) {
        this._fishPositions[i] = 5;
        this._fishDirections[i] = 1;
        fishEl.style.transform = 'scaleX(1)';
      }

      fishEl.style.left = this._fishPositions[i] + '%';
    }

    requestAnimationFrame(ts => this._animateFish(ts));
  }

  // ════════════════════════════════════════════
  // _stopFishAnimation
  // ════════════════════════════════════════════
  _stopFishAnimation() {
    this._fishAnimRunning = false;
    this._lastTimestamp = null;
  }

  // ════════════════════════════════════════════
  // _playCurrentAudio — 播放當前題目發音
  // ════════════════════════════════════════════
  async _playCurrentAudio(q) {
    const soundOn = AppState.settings?.soundOn !== false;
    if (!soundOn) return;

    if (this._mode === 1) {
      // 模式一：播放單字發音
      await AudioManager.play(q.pronunciation).catch(() => {});
    } else {
      // 模式二：播放詞語（逐字播放）
      for (const c of this._currentWord) {
        const charData = (AppState.characters || []).find(ch => ch.char === c);
        if (charData?.pronunciation) {
          await AudioManager.play(charData.pronunciation).catch(() => {});
          await new Promise(r => setTimeout(r, 100)); // 字間停頓
        }
      }
    }
  }

  // ════════════════════════════════════════════
  // _bindEvents — 綁定魚的點擊事件
  // ════════════════════════════════════════════
  _bindEvents() {
    const q = this.getCurrentQuestion();

    window.__lsSelectFish = (index) => {
      if (this.isAnswering) return;
      const selected = this._fishAnswers[index];
      this.submitAnswer(selected);
    };

    window.__lsPlay = () => {
      this._playCurrentAudio(q);
    };

    window.__lsHint = () => {
      this.useHint();
    };

    for (let i = 0; i < OPTION_COUNT; i++) {
      const fishEl = document.getElementById(`ls-fish-${i}`);
      if (!fishEl) continue;

      // 重建節點以清除舊監聽器
      const newFish = fishEl.cloneNode(true);
      fishEl.parentNode.replaceChild(newFish, fishEl);

      const idx = i;
      document.getElementById(`ls-fish-${i}`)?.addEventListener('click', () => {
        window.__lsSelectFish(idx);
      });
      document.getElementById(`ls-fish-${i}`)?.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') window.__lsSelectFish(idx);
      });
    }
  }

  // ════════════════════════════════════════════
  // judgeAnswer — 判斷答案是否正確
  // ════════════════════════════════════════════
  async judgeAnswer(selected) {
    const q = this.getCurrentQuestion();
    if (!q) throw new Error('judgeAnswer: 無當前題目');

    const correctAnswer = q.mode === 1 ? q.char : q.pronunciation;
    return selected === correctAnswer;
  }

  // ════════════════════════════════════════════
  // onWrongAnswer — 覆寫：答錯兩次後顯示正確魚+再播音效
  // ════════════════════════════════════════════
  async onWrongAnswer(selected) {
    this._wrongCount++;

    // 高亮被點擊的錯誤魚
    const wrongIdx = this._fishAnswers.indexOf(selected);
    if (wrongIdx !== -1) {
      document.getElementById(`ls-fish-${wrongIdx}`)?.classList.add('ls-fish--wrong');
      setTimeout(() => {
        document.getElementById(`ls-fish-${wrongIdx}`)?.classList.remove('ls-fish--wrong');
      }, 700);
    }

    if (this._wrongCount >= 2) {
      // 正確魚發光浮出
      const correctFish = document.getElementById(`ls-fish-${this._correctFishIndex}`);
      correctFish?.classList.add('ls-fish--glow');

      // 再播一次音效（soundOn=true 時）
      const q = this.getCurrentQuestion();
      if (AppState.settings?.soundOn !== false && q) {
        await this._playCurrentAudio(q);
      }
    }

    await super.onWrongAnswer ? super.onWrongAnswer(selected) : null;
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation — 答對：魚跳出水面
  // ════════════════════════════════════════════
  async playCorrectAnimation() {
    this._stopFishAnimation();

    const correctFish = document.getElementById(`ls-fish-${this._correctFishIndex}`);
    if (correctFish) {
      correctFish.classList.add('ls-fish--jump');
    }

    const feedback = document.getElementById('ls-feedback');
    if (feedback) {
      feedback.innerHTML = '<div class="ls-correct-text">🎉 釣到了！</div>';
      feedback.classList.add('ls-feedback--show');
    }

    await this._delay(1000);

    if (feedback) feedback.classList.remove('ls-feedback--show');
  }

  // ════════════════════════════════════════════
  // playWrongAnimation
  // ════════════════════════════════════════════
  async playWrongAnimation() {
    const feedback = document.getElementById('ls-feedback');
    if (feedback) {
      feedback.innerHTML = '<div class="ls-wrong-text">❌ 答錯了</div>';
      feedback.classList.add('ls-feedback--show');
      await this._delay(600);
      feedback.classList.remove('ls-feedback--show');
    }
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer — 答錯兩次後顯示正確答案
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    this._stopFishAnimation();
    const q = this.getCurrentQuestion();
    if (!q) return;

    // 正確魚持續發光
    document.getElementById(`ls-fish-${this._correctFishIndex}`)
      ?.classList.add('ls-fish--glow', 'ls-fish--reveal');

    const hintArea = document.getElementById('ls-hint-area');
    if (hintArea) {
      const correctAnswer = q.mode === 1 ? q.char : q.pronunciation;
      hintArea.innerHTML = `
        <div class="ls-answer-reveal">
          ✅ 正確答案：<strong>${correctAnswer}</strong>
          ${q.mode === 2 ? `（${q.char} = ${q.pronunciation}）` : ''}
        </div>
      `;
    }
  }

  // ════════════════════════════════════════════
  // getHint — 提示邏輯
  //   提示一：高亮正確聲調（在注音上標記聲調）
  //   提示二：「聲母是ㄉ」或「無聲母」
  // ════════════════════════════════════════════
  getHint() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    const hintArea = document.getElementById('ls-hint-area');
    if (!hintArea) return;

    const pron = q.pronunciation || '';

    if (this.usedHints === 0) {
      // 提示一：顯示聲調資訊
      const tone = this._extractTone(pron);
      const toneLabels = { '': '一聲（平調）', 'ˊ': '二聲（上揚）', 'ˇ': '三聲（先降後升）', 'ˋ': '四聲（下降）' };
      const toneDesc = toneLabels[tone] || '輕聲';
      hintArea.innerHTML = `
        <div class="ls-hint ls-hint--1">
          💡 聲調提示：這個字是<strong>${toneDesc}</strong>
        </div>
      `;
    } else if (this.usedHints === 1) {
      // 提示二：聲母提示
      const initial = this._extractInitial(pron);
      const initialDesc = initial
        ? `聲母是「<strong>${initial}</strong>」`
        : `這個字<strong>無聲母</strong>（以韻母開頭）`;
      hintArea.innerHTML = `
        <div class="ls-hint ls-hint--2">
          🔑 ${initialDesc}
        </div>
      `;
    }
  }

  // ════════════════════════════════════════════
  // _extractTone — 從注音字串取出聲調符號
  // ════════════════════════════════════════════
  _extractTone(pron) {
    if (pron.includes('ˋ')) return 'ˋ';
    if (pron.includes('ˇ')) return 'ˇ';
    if (pron.includes('ˊ')) return 'ˊ';
    return ''; // 一聲無符號
  }

  // ════════════════════════════════════════════
  // _extractInitial — 從注音字串取出聲母
  // 注音聲母：ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ
  // ════════════════════════════════════════════
  _extractInitial(pron) {
    const initials = 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ';
    if (pron && initials.includes(pron[0])) {
      return pron[0];
    }
    return ''; // 無聲母
  }

  // ════════════════════════════════════════════
  // _updateHintButton
  // ════════════════════════════════════════════
  _updateHintButton() {
    const btn = document.getElementById('ls-hint-btn');
    if (!btn) return;
    const remaining = 2 - (this.usedHints || 0);
    btn.textContent = `💡 提示（剩 ${remaining} 次）`;
    btn.disabled = remaining <= 0;
  }

  // ════════════════════════════════════════════
  // _renderProgressBar
  // ════════════════════════════════════════════
  _renderProgressBar() {
    const fill = document.getElementById('ls-progress-fill');
    if (!fill || !this.questions) return;
    const pct = (this.currentIndex / this.questions.length) * 100;
    fill.style.width = pct + '%';
  }

  // ════════════════════════════════════════════
  // destroy — 清理資源
  // ════════════════════════════════════════════
  destroy() {
    this._stopFishAnimation();
    delete window.__lsSelectFish;
    delete window.__lsPlay;
    delete window.__lsHint;
    super.destroy();
  }

  // ════════════════════════════════════════════
  // _delay — Promise 延遲
  // ════════════════════════════════════════════
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─────────────────────────────────────────────
// CSS 動態注入
// ─────────────────────────────────────────────
(function injectListenStyles() {
  if (document.getElementById('ls-game-styles')) return;
  const style = document.createElement('style');
  style.id = 'ls-game-styles';
  style.textContent = `
    /* ── 整體佈局 ── */
    .ls-game {
      position: relative;
      width: 100%;
      min-height: 100vh;
      background: linear-gradient(180deg, #001f3f 0%, #003d7a 30%, #0077b6 70%, #00b4d8 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: 'Noto Serif TC', serif;
      color: #e0f7ff;
      overflow: hidden;
    }

    /* ── 頂部 ── */
    .ls-header {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px 8px;
      background: rgba(0,0,0,0.3);
      backdrop-filter: blur(4px);
      gap: 12px;
      flex-wrap: wrap;
    }

    .ls-question-text {
      font-size: 1.05rem;
      flex: 1;
      min-width: 180px;
    }

    .ls-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: bold;
    }
    .ls-badge--hard       { background: #c62828; color: #fff; }
    .ls-badge--medium     { background: #e65100; color: #fff; }
    .ls-badge--easy       { background: #2e7d32; color: #fff; }
    .ls-badge--easy_plus  { background: #1565c0; color: #fff; }

    /* ── 進度條 ── */
    .ls-progress-bar {
      width: 90%;
      height: 6px;
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
      margin: 8px 0;
      overflow: hidden;
    }
    .ls-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00e5ff, #0077ff);
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    /* ── 播放區 ── */
    .ls-play-area {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 12px 0;
      flex-wrap: wrap;
      justify-content: center;
    }

    .ls-play-btn {
      padding: 12px 32px;
      border: none;
      border-radius: 30px;
      font-size: 1.1rem;
      cursor: pointer;
      font-family: inherit;
      background: linear-gradient(135deg, #0096c7, #00b4d8);
      color: #fff;
      box-shadow: 0 4px 16px rgba(0,150,200,0.4);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .ls-play-btn:active { transform: scale(0.95); }
    .ls-play-btn--muted {
      background: linear-gradient(135deg, #546e7a, #78909c);
      box-shadow: none;
    }

    /* 靜音時注音替代文字 */
    .ls-zhuyin-fallback {
      font-size: 1.5rem;
      color: #b3e5fc;
      background: rgba(255,255,255,0.1);
      padding: 8px 16px;
      border-radius: 8px;
    }
    .ls-zhuyin-fallback ruby rt {
      font-size: 0.6em;
      color: #e0f7ff;
    }

    /* ── 水族館 ── */
    .ls-aquarium {
      position: relative;
      width: 95%;
      height: 280px;
      margin: 8px 0;
      background: linear-gradient(180deg,
        rgba(0,119,182,0.5) 0%,
        rgba(0,77,130,0.7) 60%,
        rgba(0,30,60,0.9) 100%
      );
      border-radius: 16px;
      overflow: hidden;
      border: 2px solid rgba(0,229,255,0.3);
      box-shadow: 0 0 30px rgba(0,150,255,0.2) inset;
    }

    /* 水波裝飾 */
    .ls-water-waves {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 12px;
      overflow: hidden;
    }
    .ls-wave {
      position: absolute;
      width: 200%;
      height: 12px;
      background: rgba(255,255,255,0.15);
      border-radius: 50%;
      animation: ls-wave-anim 3s linear infinite;
    }
    .ls-wave--2 {
      animation-delay: -1.5s;
      opacity: 0.6;
    }
    @keyframes ls-wave-anim {
      from { transform: translateX(0); }
      to   { transform: translateX(-50%); }
    }

    /* ── 魚行 ── */
    .ls-fish-row {
      position: absolute;
      left: 0; right: 0;
      height: 60px;
    }

    /* ── 魚 ── */
    .ls-fish {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      transition: left 0s; /* 位置由 JS 控制 */
      user-select: none;
    }

    .ls-fish-emoji {
      font-size: 2rem;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
      transition: transform 0.3s;
    }

    .ls-fish-label {
      font-size: 1.1rem;
      font-weight: bold;
      background: rgba(0,30,60,0.7);
      color: #e0f7ff;
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid rgba(0,229,255,0.5);
      white-space: nowrap;
      backdrop-filter: blur(2px);
      transition: background 0.2s, box-shadow 0.2s;
    }

    .ls-fish:hover .ls-fish-label,
    .ls-fish:focus .ls-fish-label {
      background: rgba(0,100,200,0.8);
      box-shadow: 0 0 12px rgba(0,229,255,0.6);
    }

    /* 答對：魚跳出水面 */
    .ls-fish--jump {
      animation: ls-fish-jump 0.8s ease forwards;
    }
    @keyframes ls-fish-jump {
      0%   { transform: translateY(0) scale(1); }
      40%  { transform: translateY(-80px) scale(1.3) rotate(-15deg); }
      70%  { transform: translateY(-60px) scale(1.2); }
      100% { transform: translateY(0) scale(1); }
    }

    /* 答錯高亮 */
    .ls-fish--wrong .ls-fish-label {
      background: rgba(180,0,0,0.7);
      box-shadow: 0 0 16px rgba(255,0,0,0.8);
    }

    /* 正確魚發光（答錯兩次提示） */
    .ls-fish--glow .ls-fish-label {
      background: rgba(0,150,60,0.8);
      box-shadow: 0 0 20px rgba(0,255,100,0.8);
      animation: ls-glow-pulse 0.6s ease infinite alternate;
    }
    .ls-fish--reveal {
      z-index: 10;
    }
    @keyframes ls-glow-pulse {
      from { box-shadow: 0 0 20px rgba(0,255,100,0.6); }
      to   { box-shadow: 0 0 40px rgba(0,255,100,1); }
    }

    /* ── 提示區 ── */
    .ls-hint-area {
      width: 90%;
      min-height: 44px;
      margin: 8px 0;
    }

    .ls-hint {
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 0.95rem;
      animation: ls-appear 0.3s ease;
    }
    .ls-hint--1 { background: rgba(255,215,0,0.15); border-left: 4px solid #ffd700; }
    .ls-hint--2 { background: rgba(0,200,255,0.15); border-left: 4px solid #00c8ff; }

    .ls-answer-reveal {
      padding: 10px 16px;
      border-radius: 8px;
      background: rgba(0,255,100,0.15);
      border-left: 4px solid #00ff64;
      font-size: 0.95rem;
      animation: ls-appear 0.3s ease;
    }

    @keyframes ls-appear {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── 控制按鈕 ── */
    .ls-controls {
      display: flex;
      gap: 12px;
      margin: 8px 0;
    }
    .ls-btn {
      padding: 10px 24px;
      border: none;
      border-radius: 24px;
      font-size: 0.95rem;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.15s, opacity 0.15s;
    }
    .ls-btn:active { transform: scale(0.95); }
    .ls-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .ls-btn--hint {
      background: linear-gradient(135deg, #1e3a5f, #2d6a9f);
      color: #e0f0ff;
      border: 1px solid #4a90d0;
    }

    /* ── 回饋遮罩 ── */
    .ls-feedback {
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
    .ls-feedback--show { opacity: 1; }

    .ls-correct-text, .ls-wrong-text {
      font-size: 2.5rem;
      font-weight: 900;
      text-shadow: 0 0 20px rgba(255,255,255,0.8);
      animation: ls-appear 0.3s ease;
    }
    .ls-correct-text { color: #ffd700; }
    .ls-wrong-text   { color: #ff6b6b; }

    /* ── RWD ── */
    @media (max-width: 480px) {
      .ls-aquarium { height: 220px; }
      .ls-fish-emoji { font-size: 1.6rem; }
      .ls-fish-label { font-size: 0.95rem; }
      .ls-question-text { font-size: 0.92rem; }
    }
  `;
  document.head.appendChild(style);
})();

export default ListenGame;
