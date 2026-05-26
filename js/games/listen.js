/**
 * listen.js — 聽音選字 × 🎣 釣魚遊戲（重製版）
 * Task 18：繼承 GameEngine，實作兩種模式
 *
 * 玩法：
 *   釣竿固定在頂部，魚鉤懸掛。
 *   點擊畫面 → 魚鉤投下 → 碰到魚即釣起判斷答案
 *   魚左右游動，速度依難易度調整
 */

import { GameEngine } from './GameEngine.js';
import { AppState }   from '../state.js';
import { JSONLoader } from '../json_loader.js';
import { AudioManager } from '../audio.js';

// ─── 魚游速度（毫秒/完整來回）hard慢 easy_plus快 ───
const FISH_SPEEDS = { hard: 5000, medium: 3500, easy: 2500, easy_plus: 1800 };
const FISH_SPEED_MULTIPLIERS = [1.0, 0.8, 1.2, 0.9];
const FISH_EMOJIS = ['🐠','🐟','🐡','🦈'];
const OPTION_COUNT = 4;

// 魚的水深層（%，相對水域高度）
const FISH_DEPTHS = [18, 36, 55, 74];

export class ListenGame extends GameEngine {
  constructor() {
    super('listen');
    this._mode           = 1;
    this._wrongCount     = 0;
    this._fishAnimRunning= false;
    this._lastTimestamp  = null;
    this._fishPositions  = [];
    this._fishDirections = [];
    this._fishSpeeds     = [];
    this._fishAnswers    = [];
    this._correctFishIndex = -1;
    this._currentAudioZhuyin = '';
    this._currentWord    = '';
    this._waterAudio     = null;

    // 魚鉤狀態
    this._hookActive     = false;  // 鉤子是否正在下降
    this._hookY          = 0;     // 鉤子當前 Y（px，相對水域頂部）
    this._hookX          = 50;    // 鉤子 X（%）
    this._hookSpeed      = 0.35;  // px/ms
    this._hookAnimId     = null;
    this._hookTimestamp  = null;
    this._aquariumHeight = 0;
  }

  // ════════════════════════════════════════════
  // loadQuestions
  // ════════════════════════════════════════════
  async loadQuestions() {
    const chars = this.questionChars;
    if (!chars || chars.length === 0) throw new Error('listen: 題目字元為空');

    const allChars = JSONLoader.get('characters') || [];
    const questions = [];

    for (const char of chars) {
      const charData = allChars.find(c => (c['字'] || c.char) === char);
      if (!charData) continue;

      const mode = Math.random() < 0.6 ? 1 : 2;
      const distractors = this._buildDistractors(char, charData, allChars, mode);

      questions.push({
        char,
        pronunciation: charData.pronunciations?.[0]?.zhuyin || '',
        words: charData.pronunciations?.[0]?.words || charData.words || [],
        level: { 1:'easy', 2:'medium' }[charData.grade] || 'medium',
        mode,
        distractors,
      });
    }

    if (questions.length === 0) throw new Error('listen: 無法取得題目資料');
    this.questions = questions;
    return questions;
  }

  // ════════════════════════════════════════════
  // _buildDistractors
  // ════════════════════════════════════════════
  _buildDistractors(char, charData, allChars, mode) {
    const result = [];
    const used   = new Set([char]);

    if (mode === 1) {
      // 模式一：干擾字「發音必須不同」
      const correctPron = charData.pronunciations?.[0]?.zhuyin || '';
      const shuffled = [...allChars].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (result.length >= 3) break;
        const cChar = c['字'] || c.char;
        const cPron = c.pronunciations?.[0]?.zhuyin || '';
        if (!used.has(cChar) && cPron !== correctPron) {
          result.push(cChar); used.add(cChar);
        }
      }
    } else {
      // 模式二：找聲母相同但聲調不同的注音
      const correctPron = charData.pronunciations?.[0]?.zhuyin || '';
      const similar = [...allChars]
        .filter(c => {
          const p = c.pronunciations?.[0]?.zhuyin || '';
          return (c['字'] || c.char) !== char && p && p !== correctPron;
        })
        .sort((a, b) => {
          const ap = a.pronunciations?.[0]?.zhuyin || '';
          const bp = b.pronunciations?.[0]?.zhuyin || '';
          const as = correctPron && ap[0] === correctPron[0] ? 1 : 0;
          const bs = correctPron && bp[0] === correctPron[0] ? 1 : 0;
          return bs - as + Math.random() * 0.4 - 0.2;
        });
      for (const c of similar) {
        if (result.length >= 3) break;
        const p = c.pronunciations?.[0]?.zhuyin || '';
        if (!used.has(p)) { result.push(p); used.add(p); }
      }
      for (const c of allChars.sort(() => Math.random() - 0.5)) {
        if (result.length >= 3) break;
        const p = c.pronunciations?.[0]?.zhuyin || '';
        if (p && !used.has(p) && p !== correctPron) { result.push(p); used.add(p); }
      }
    }
    return result.slice(0, 3);
  }

  // ════════════════════════════════════════════
  // renderQuestion
  // ════════════════════════════════════════════
  renderQuestion() {
    const q = this.currentQuestion;
    if (!q) return;

    this._mode = q.mode;
    this._wrongCount = 0;
    this._stopFishAnimation();
    this._retractHook();

    const appEl = this._getContainer();
    if (!appEl) return;

    const correctAnswer = q.mode === 1 ? q.char : q.pronunciation;
    const options = this._shuffleOptions(correctAnswer, q.distractors);
    this._fishAnswers    = options;
    this._correctFishIndex = options.indexOf(correctAnswer);
    this._currentAudioZhuyin = q.pronunciation;
    this._currentWord = (q.words && q.words.length > 0) ? q.words[0] : q.char;

    appEl.innerHTML = this._buildHTML(q, options);

    // 取得水域實際高度（for 鉤子碰撞）
    requestAnimationFrame(() => {
      const aq = document.getElementById('ls-aquarium');
      this._aquariumHeight = aq ? aq.clientHeight : 300;
    });

    this._initFishAnimation(q.level);
    this._bindEvents();
    this._updateHintButton();
    this._renderProgressBar();
    this._startWaterLoop();
    this._playCurrentAudio(q);
  }

  // ════════════════════════════════════════════
  // _buildHTML
  // ════════════════════════════════════════════
  _buildHTML(q, options) {
    const soundOn = AppState.settings?.soundOn !== false;
    const level = q.level || 'medium';
    const levelLabel = { hard:'困難', medium:'中等', easy:'簡單', easy_plus:'加強' }[level] || '中等';
    const questionText = q.mode === 1
      ? `聽發音，選出正確的國字`
      : `聽詞語「${this._currentWord}」，選出正確的注音`;
    const zhuyinFallback = !soundOn
      ? `<div class="ls-zhuyin-fallback"><ruby>${q.char}<rt>${q.pronunciation}</rt></ruby></div>`
      : '';

    return `
      <div class="ls-game" id="ls-game-root">
        <div class="ls-header">
          <div class="ls-question-text">${questionText}</div>
          <div class="ls-badge ls-badge--${level}">${levelLabel}</div>
        </div>

        <div class="ls-progress-bar">
          <div class="ls-progress-fill" id="ls-progress-fill"></div>
        </div>

        <div class="ls-play-area">
          <button class="ls-play-btn ${!soundOn ? 'ls-play-btn--muted' : ''}"
                  id="ls-play-btn" onclick="window.__lsPlay()"
                  aria-label="${soundOn ? '播放發音' : '靜音模式'}">
            ${soundOn ? '🔊 播放' : '🔇 無聲'}
          </button>
          ${zhuyinFallback}
        </div>

        <!-- 釣魚場景 -->
        <div class="ls-scene" id="ls-scene">

          <!-- 釣竿 + 魚線 + 鉤子 -->
          <div class="ls-rod-wrap" id="ls-rod-wrap">
            <img src="./images/fish_rod.png" class="ls-rod-img" alt="釣竿" />
            <div class="ls-line-wrap" id="ls-line-wrap">
              <div class="ls-line" id="ls-hook-line"></div>
              <div class="ls-hook" id="ls-hook">🪝</div>
            </div>
          </div>

          <!-- 水面分隔線 -->
          <div class="ls-water-surface"></div>

          <!-- 水域（魚游動） -->
          <div class="ls-aquarium" id="ls-aquarium">
            <div class="ls-water-waves">
              <div class="ls-wave ls-wave--1"></div>
              <div class="ls-wave ls-wave--2"></div>
            </div>
            ${this._buildFishHTML(options)}
          </div>
        </div>

        <div class="ls-hint-area" id="ls-hint-area"></div>

        <div class="ls-controls">
          <button class="ls-btn ls-btn--hint" id="ls-hint-btn"
                  onclick="window.__lsHint()">
            💡 提示（剩 ${2 - (this.usedHints || 0)} 次）
          </button>
        </div>

        <div class="ls-feedback" id="ls-feedback"></div>
      </div>
    `;
  }

  // ════════════════════════════════════════════
  // _buildFishHTML
  // ════════════════════════════════════════════
  _renderZhuyinLabel(text) {
    return /[ㄅ-ㄩˊˇˋ˙]/.test(text)
      ? `<span class="ls-fish-zhuyin" lang="zh-TW">${text}</span>`
      : `<span class="ls-fish-label-text">${text}</span>`;
  }

  _buildFishHTML(options) {
    let html = '';
    for (let i = 0; i < OPTION_COUNT; i++) {
      const labelHTML = this._renderZhuyinLabel(options[i]);
      html += `
        <div class="ls-fish-row" style="top:${FISH_DEPTHS[i]}%;">
          <div class="ls-fish" id="ls-fish-${i}" data-index="${i}"
               style="left:${15 + i * 18}%" role="button" tabindex="0"
               aria-label="選項 ${options[i]}">
            <span class="ls-fish-emoji">${FISH_EMOJIS[i]}</span>
            <span class="ls-fish-label" id="ls-fish-label-${i}">${labelHTML}</span>
          </div>
        </div>`;
    }
    return html;
  }

  _shuffleOptions(correct, distractors) {
    const arr = [correct, ...distractors.slice(0, 3)];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ════════════════════════════════════════════
  // 魚游動畫
  // ════════════════════════════════════════════
  _initFishAnimation(level) {
    const base = FISH_SPEEDS[level] || FISH_SPEEDS.medium;
    this._fishPositions  = [15, 30, 50, 65];
    this._fishDirections = [1, -1, 1, -1];
    this._fishSpeeds     = FISH_SPEED_MULTIPLIERS.map(m => (100 / base) * m);
    this._fishAnimRunning = true;
    this._lastTimestamp   = null;
    requestAnimationFrame(ts => this._animateFish(ts));
  }

  _animateFish(timestamp) {
    if (!this._fishAnimRunning) return;
    if (this._lastTimestamp === null) this._lastTimestamp = timestamp;
    const delta = timestamp - this._lastTimestamp;
    this._lastTimestamp = timestamp;

    for (let i = 0; i < OPTION_COUNT; i++) {
      const fishEl = document.getElementById(`ls-fish-${i}`);
      if (!fishEl) continue;
      this._fishPositions[i] += this._fishDirections[i] * this._fishSpeeds[i] * delta;
      if (this._fishPositions[i] >= 82) {
        this._fishPositions[i] = 82;
        this._fishDirections[i] = -1;
        fishEl.style.transform = 'scaleX(-1)';
      } else if (this._fishPositions[i] <= 3) {
        this._fishPositions[i] = 3;
        this._fishDirections[i] = 1;
        fishEl.style.transform = 'scaleX(1)';
      }
      fishEl.style.left = this._fishPositions[i] + '%';
    }
    requestAnimationFrame(ts => this._animateFish(ts));
  }

  _stopFishAnimation() {
    this._fishAnimRunning = false;
    this._lastTimestamp   = null;
  }

  // ════════════════════════════════════════════
  // 魚鉤控制
  // ════════════════════════════════════════════
  _castHook(xPercent) {
    if (this._hookActive || this.isAnswering) return;
    this._hookActive = true;
    this._hookY = 0;
    this._hookX = xPercent;
    this._hookTimestamp = null;

    // 把線起點對準 X
    const lineWrap = document.getElementById('ls-line-wrap');
    if (lineWrap) lineWrap.style.left = xPercent + '%';

    this._hookAnimId = requestAnimationFrame(ts => this._animateHook(ts));
  }

  _animateHook(timestamp) {
    if (!this._hookActive) return;
    if (this._hookTimestamp === null) this._hookTimestamp = timestamp;
    const delta = timestamp - this._hookTimestamp;
    this._hookTimestamp = timestamp;

    this._hookY += this._hookSpeed * delta;

    const lineEl = document.getElementById('ls-hook-line');
    const hookEl = document.getElementById('ls-hook');
    const aqEl   = document.getElementById('ls-aquarium');
    if (!lineEl || !hookEl || !aqEl) { this._hookActive = false; return; }

    lineEl.style.height = this._hookY + 'px';
    hookEl.style.top    = this._hookY + 'px';

    // 碰撞檢測：計算鉤子在水域內的Y位置
    const aqRect   = aqEl.getBoundingClientRect();
    const hookRect = hookEl.getBoundingClientRect();

    // 鉤子進入水域後才偵測
    if (hookRect.top >= aqRect.top) {
      const hookCenterX = hookRect.left + hookRect.width / 2;
      const hookCenterY = hookRect.top  + hookRect.height / 2;

      for (let i = 0; i < OPTION_COUNT; i++) {
        const fishEl = document.getElementById(`ls-fish-${i}`);
        if (!fishEl) continue;
        const fRect = fishEl.getBoundingClientRect();
        const hit = hookCenterX > fRect.left && hookCenterX < fRect.right &&
                    hookCenterY > fRect.top  && hookCenterY < fRect.bottom;
        if (hit) {
          this._hookActive = false;
          this._onFishCaught(i, fishEl, hookEl, lineEl);
          return;
        }
      }
    }

    // 超出水域底部 → 收回
    if (this._hookY > this._aquariumHeight + 80) {
      this._retractHook();
      return;
    }

    this._hookAnimId = requestAnimationFrame(ts => this._animateHook(ts));
  }

  _onFishCaught(idx, fishEl, hookEl, lineEl) {
    // 播放音效
    this._stopWaterLoop();
    this._playMp3('fishing');

    // 魚跟著鉤子浮起動畫
    fishEl.classList.add('ls-fish--hooked');
    setTimeout(() => this._playMp3('waterup'), 200);

    // 0.7s 後提交答案
    setTimeout(() => {
      fishEl.classList.remove('ls-fish--hooked');
      this._retractHook();
      const selected = this._fishAnswers[idx];
      if (!this.isAnswering) this.submitAnswer(selected);
    }, 700);
  }

  _retractHook() {
    this._hookActive = false;
    if (this._hookAnimId) { cancelAnimationFrame(this._hookAnimId); this._hookAnimId = null; }
    this._hookY = 0;
    const lineEl = document.getElementById('ls-hook-line');
    const hookEl = document.getElementById('ls-hook');
    if (lineEl) lineEl.style.height = '0px';
    if (hookEl) hookEl.style.top    = '0px';
  }

  // ════════════════════════════════════════════
  // _bindEvents
  // ════════════════════════════════════════════
  _bindEvents() {
    const scene = document.getElementById('ls-scene');

    window.__lsPlay  = () => this._playCurrentAudio(this.currentQuestion);
    window.__lsHint  = () => this.useHint();

    // 點擊場景任意位置 → 投出鉤子
    if (scene) {
      scene._lsClick = (e) => {
        if (this.isAnswering || this._hookActive) return;
        const rect = scene.getBoundingClientRect();
        const xPct = ((e.clientX - rect.left) / rect.width) * 100;
        this._playMp3('water');  // 投線音效
        this._castHook(xPct);
      };
      scene.addEventListener('click', scene._lsClick);
    }
  }

  // ════════════════════════════════════════════
  // _playCurrentAudio
  // ════════════════════════════════════════════
  async _playCurrentAudio(q) {
    if (!q || AppState.settings?.soundOn === false) return;
    if (this._mode === 1) {
      await AudioManager.play(q.pronunciation).catch(() => {});
    } else {
      for (const c of this._currentWord) {
        const charData = (JSONLoader.get('characters') || []).find(ch => (ch['字'] || ch.char) === c);
        const pron = charData?.pronunciations?.[0]?.zhuyin || '';
        if (pron) { await AudioManager.play(pron).catch(() => {}); await new Promise(r => setTimeout(r, 100)); }
      }
    }
  }

  // ════════════════════════════════════════════
  // judgeAnswer
  // ════════════════════════════════════════════
  async judgeAnswer(selected) {
    const q = this.currentQuestion;
    if (!q) throw new Error('judgeAnswer: 無當前題目');
    const correctAnswer = q.mode === 1 ? q.char : q.pronunciation;
    return { correct: selected === correctAnswer };
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation
  // ════════════════════════════════════════════
  async playCorrectAnimation() {
    this._stopFishAnimation();
    this._stopWaterLoop();
    AudioManager.playEffect('correct').catch(() => {});

    const correctFish = document.getElementById(`ls-fish-${this._correctFishIndex}`);
    if (correctFish) correctFish.classList.add('ls-fish--jump');

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
    this._stopWaterLoop();
    AudioManager.playEffect('wrong').catch(() => {});

    const feedback = document.getElementById('ls-feedback');
    if (feedback) {
      feedback.innerHTML = '<div class="ls-wrong-text">❌ 答錯了</div>';
      feedback.classList.add('ls-feedback--show');
      await this._delay(600);
      feedback.classList.remove('ls-feedback--show');
    }
    // 答錯後恢復水聲，讓玩家繼續釣
    this._startWaterLoop();
  }

  // ════════════════════════════════════════════
  // onWrongAnswer（答錯兩次：正確魚發光+再播音）
  // ════════════════════════════════════════════
  async onWrongAnswer(selected) {
    this._wrongCount++;
    if (this._wrongCount >= 2) {
      const correctFish = document.getElementById(`ls-fish-${this._correctFishIndex}`);
      correctFish?.classList.add('ls-fish--glow');
      if (AppState.settings?.soundOn !== false && this.currentQuestion) {
        await this._playCurrentAudio(this.currentQuestion);
      }
    }
    await super.onWrongAnswer ? super.onWrongAnswer(selected) : null;
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    this._stopFishAnimation();
    const q = this.currentQuestion;
    if (!q) return;
    document.getElementById(`ls-fish-${this._correctFishIndex}`)
      ?.classList.add('ls-fish--glow', 'ls-fish--reveal');
    const hintArea = document.getElementById('ls-hint-area');
    if (hintArea) {
      const correctAnswer = q.mode === 1 ? q.char : q.pronunciation;
      hintArea.innerHTML = `
        <div class="ls-answer-reveal">
          ✅ 正確答案：<strong>${correctAnswer}</strong>
          ${q.mode === 2 ? `（${q.char} = ${q.pronunciation}）` : ''}
        </div>`;
    }
  }

  // ════════════════════════════════════════════
  // getHint
  // ════════════════════════════════════════════
  getHint() {
    const q = this.currentQuestion;
    if (!q) return;
    const hintArea = document.getElementById('ls-hint-area');
    if (!hintArea) return;
    const pron = q.pronunciation || '';
    if (this.usedHints === 0) {
      // 提示一：聲調
      const tone = pron.match(/[ˊˇˋ˙]$/)?.[0] || '（一聲）';
      const toneNames = { 'ˊ':'二聲', 'ˇ':'三聲', 'ˋ':'四聲', '˙':'輕聲', '（一聲）':'一聲' };
      hintArea.innerHTML = `<div class="ls-hint-text">💡 提示一：聲調是「${toneNames[tone] || tone}」</div>`;
    } else if (this.usedHints === 1) {
      // 提示二：聲母
      const initial = pron.match(/^[ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ]/)?.[0];
      hintArea.innerHTML = initial
        ? `<div class="ls-hint-text">💡 提示二：聲母是「${initial}」</div>`
        : `<div class="ls-hint-text">💡 提示二：這個字沒有聲母（介音開頭）</div>`;
    }
  }

  // ════════════════════════════════════════════
  // _updateHintButton
  // ════════════════════════════════════════════
  _updateHintButton() {
    const btn = document.getElementById('ls-hint-btn');
    if (!btn) return;
    const remaining = 2 - (this.usedHints || 0);
    btn.textContent = remaining > 0 ? `💡 提示（剩 ${remaining} 次）` : '💡 提示（已用完）';
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
  // _getContainer
  // ════════════════════════════════════════════
  _getContainer() {
    return document.getElementById('app') || document.getElementById('game-container');
  }

  // ════════════════════════════════════════════
  // _startWaterLoop / _stopWaterLoop
  // ════════════════════════════════════════════
  _startWaterLoop() {
    this._stopWaterLoop();
    if (AppState.settings?.soundOn === false) return;
    const prefix = location.pathname.startsWith('/happy-learning') ? '/happy-learning' : '';
    const audio = new Audio(`${prefix}/audio/effects/water.mp3`);
    audio.loop   = true;
    audio.volume = 0.35;
    audio.play().catch(() => {});
    this._waterAudio = audio;
  }

  _stopWaterLoop() {
    if (this._waterAudio) {
      this._waterAudio.pause();
      this._waterAudio.currentTime = 0;
      this._waterAudio = null;
    }
  }

  // ════════════════════════════════════════════
  // _playMp3
  // ════════════════════════════════════════════
  _playMp3(name) {
    if (AppState.settings?.soundOn === false) return;
    const prefix = location.pathname.startsWith('/happy-learning') ? '/happy-learning' : '';
    new Audio(`${prefix}/audio/effects/${name}.mp3`).play().catch(() => {});
  }

  // ════════════════════════════════════════════
  // destroy
  // ════════════════════════════════════════════
  destroy() {
    this._stopFishAnimation();
    this._retractHook();
    this._stopWaterLoop();
    // 移除場景點擊監聽
    const scene = document.getElementById('ls-scene');
    if (scene && scene._lsClick) scene.removeEventListener('click', scene._lsClick);
    delete window.__lsPlay;
    delete window.__lsHint;
    super.destroy();
  }

  // ════════════════════════════════════════════
  // _delay
  // ════════════════════════════════════════════
  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─────────────────────────────────────────────
// CSS 動態注入
// ─────────────────────────────────────────────
(function injectListenStyles() {
  if (document.getElementById('ls-game-styles')) return;
  const style = document.createElement('style');
  style.id = 'ls-game-styles';
  style.textContent = `
    /* ── 基礎容器 ── */
    .ls-game {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      min-height: 100vh;
      background: linear-gradient(180deg, #1a2a4a 0%, #0d1b2e 100%);
      color: #e0f7ff;
      font-family: 'BpmfIVS', '微軟正黑體', sans-serif;
      padding: 0 0 16px;
      box-sizing: border-box;
      overflow: hidden;
    }

    /* ── 頂部 ── */
    .ls-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      padding: 10px 16px 6px;
      box-sizing: border-box;
    }
    .ls-question-text { font-size: 1rem; font-weight: bold; color: #b0e0ff; }
    .ls-badge {
      padding: 2px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: bold;
    }
    .ls-badge--hard      { background: #c0392b; color:#fff; }
    .ls-badge--medium    { background: #e67e22; color:#fff; }
    .ls-badge--easy      { background: #27ae60; color:#fff; }
    .ls-badge--easy_plus { background: #2980b9; color:#fff; }

    /* ── 進度條 ── */
    .ls-progress-bar  { width:90%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; margin:4px 0 6px; }
    .ls-progress-fill { height:100%; background:linear-gradient(90deg,#00c6ff,#0072ff); border-radius:3px; transition:width .4s; }

    /* ── 播放區 ── */
    .ls-play-area { margin: 4px 0 6px; display:flex; flex-direction:column; align-items:center; gap:4px; }
    .ls-play-btn {
      padding: 8px 24px; border-radius: 30px; border: none; cursor: pointer;
      background: linear-gradient(135deg,#00c6ff,#0072ff);
      color: #fff; font-size: 1rem; font-weight: bold;
      box-shadow: 0 4px 15px rgba(0,114,255,0.4);
      transition: transform .15s, box-shadow .15s;
    }
    .ls-play-btn:hover  { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,114,255,0.6); }
    .ls-play-btn--muted { background: linear-gradient(135deg,#555,#333); }
    .ls-zhuyin-fallback { font-size:1.2rem; color:#b0e0ff; }
    .ls-zhuyin-fallback ruby rt { font-size:.6em; color:#e0f7ff; }

    /* ── 場景（釣竿 + 水域） ── */
    .ls-scene {
      position: relative;
      width: 95%;
      cursor: crosshair;
      user-select: none;
    }

    /* ── 釣竿區 ── */
    .ls-rod-wrap {
      position: relative;
      width: 100%;
      height: 90px;
      display: flex;
      justify-content: flex-end;
      align-items: flex-end;
    }
    .ls-rod-img {
      width: 160px;
      height: auto;
      opacity: 0.92;
      filter: drop-shadow(0 2px 8px rgba(0,150,255,0.5));
      pointer-events: none;
    }

    /* ── 釣魚線 + 鉤子 ── */
    .ls-line-wrap {
      position: absolute;
      top: 10px;          /* 從竿尖出發 */
      right: 22px;        /* 竿尖 X 對齊 */
      width: 2px;
      pointer-events: none;
    }
    .ls-line {
      width: 2px;
      height: 0;
      background: linear-gradient(180deg, rgba(150,200,255,0.8), rgba(100,180,255,0.4));
      transition: height 0s;
    }
    .ls-hook {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      font-size: 1.2rem;
      filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));
    }

    /* ── 水面 ── */
    .ls-water-surface {
      width: 100%;
      height: 6px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(0,200,255,0.6) 20%,
        rgba(0,229,255,0.8) 50%,
        rgba(0,200,255,0.6) 80%,
        transparent 100%);
      border-radius: 3px;
    }

    /* ── 水族館 ── */
    .ls-aquarium {
      position: relative;
      width: 100%;
      height: 320px;
      background: linear-gradient(180deg,
        rgba(0,80,140,0.7) 0%,
        rgba(0,50,100,0.8) 60%,
        rgba(0,20,50,0.95) 100%);
      border-radius: 0 0 16px 16px;
      overflow: visible;
      box-shadow: 0 8px 30px rgba(0,100,200,0.3) inset;
    }

    /* ── 水波 ── */
    .ls-water-waves { position:absolute; top:0; left:0; right:0; height:20px; overflow:hidden; }
    .ls-wave {
      position:absolute; width:200%; height:12px;
      background: rgba(0,229,255,0.15); border-radius:50%;
    }
    .ls-wave--1 { animation: ls-wave-anim 3s linear infinite; top:-4px; }
    .ls-wave--2 { animation: ls-wave-anim 4.5s linear infinite reverse; top:-2px; opacity:.5; }
    @keyframes ls-wave-anim { 0%{left:-50%} 100%{left:0%} }

    /* ── 魚排 ── */
    .ls-fish-row {
      position: absolute;
      left: 0; right: 0;
      height: 64px;
    }
    .ls-fish {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .ls-fish-emoji {
      font-size: 2rem;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }
    .ls-fish-label {
      font-size: 1.05rem; font-weight: bold;
      background: rgba(0,20,50,0.75);
      color: #e0f7ff;
      padding: 2px 8px; border-radius: 12px;
      border: 1px solid rgba(0,229,255,0.5);
      white-space: nowrap;
      backdrop-filter: blur(2px);
      display: inline-flex; align-items: center;
    }

    /* 直式注音 */
    .ls-fish-zhuyin {
      writing-mode: vertical-rl;
      text-orientation: upright;
      font-family: 'BpmfIVS', sans-serif;
      font-size: 1rem; font-weight: bold;
      color: #e0f7ff;
      letter-spacing: .05em;
      min-height: 3em;
      display: flex; align-items: center; justify-content: center;
    }

    /* 魚被鉤中 */
    @keyframes ls-fish-hooked {
      0%   { transform: translateY(0) rotate(0deg); }
      30%  { transform: translateY(-20px) rotate(-20deg); }
      60%  { transform: translateY(-40px) rotate(-30deg) scaleX(1.3); }
      100% { transform: translateY(-60px) rotate(-40deg) scale(1.5); opacity: 0; }
    }
    .ls-fish--hooked { animation: ls-fish-hooked 0.7s ease forwards; z-index:20; pointer-events:none; }

    /* 答對跳起 */
    @keyframes ls-fish-jump {
      0%   { transform: translateY(0) scale(1); }
      40%  { transform: translateY(-80px) scale(1.4) rotate(-15deg); }
      70%  { transform: translateY(-60px) scale(1.2); }
      100% { transform: translateY(0) scale(1); }
    }
    .ls-fish--jump { animation: ls-fish-jump 0.9s ease forwards; }

    /* 答錯高亮 */
    .ls-fish--wrong .ls-fish-label { background:rgba(180,0,0,0.7); box-shadow:0 0 16px rgba(255,0,0,0.8); }

    /* 正確魚發光 */
    .ls-fish--glow .ls-fish-label { background:rgba(0,150,60,0.8); box-shadow:0 0 20px rgba(0,255,100,0.8); }
    .ls-fish--reveal { z-index:10; }

    /* ── 提示/控制 ── */
    .ls-hint-area {
      width: 90%; min-height: 36px;
      background: rgba(0,40,80,0.6);
      border-radius: 8px; padding: 6px 12px;
      margin: 6px 0; font-size:.9rem; color:#a0d8ef;
      display: flex; align-items: center; justify-content: center;
    }
    .ls-hint-text { color:#ffd700; }
    .ls-answer-reveal { color:#7fff7f; font-size:1rem; }

    .ls-controls { margin: 4px 0; }
    .ls-btn--hint {
      padding: 8px 20px; border-radius: 30px; border: none; cursor: pointer;
      background: rgba(0,60,120,0.8);
      color: #b0e0ff; font-size: .9rem;
      border: 1px solid rgba(0,150,255,0.4);
      transition: background .2s;
    }
    .ls-btn--hint:hover  { background: rgba(0,80,160,0.9); }
    .ls-btn--hint:disabled { opacity: .4; cursor: not-allowed; }

    /* ── 回饋 ── */
    .ls-feedback {
      position: fixed; top: 40%; left: 50%; transform: translate(-50%,-50%);
      pointer-events: none; opacity: 0; transition: opacity .2s; z-index: 100;
    }
    .ls-feedback--show { opacity: 1; }
    .ls-correct-text, .ls-wrong-text {
      font-size: 2rem; font-weight: bold;
      text-shadow: 0 2px 8px rgba(0,0,0,0.5);
      background: rgba(0,0,0,0.5); padding: 8px 20px; border-radius: 16px;
    }
    .ls-correct-text { color: #ffd700; }
    .ls-wrong-text   { color: #ff6b6b; }

    /* ── 投線提示 ── */
    .ls-cast-hint {
      text-align: center; color: rgba(180,220,255,0.6);
      font-size: .85rem; margin: 2px 0 6px;
      animation: ls-hint-blink 2s ease-in-out infinite;
    }
    @keyframes ls-hint-blink { 0%,100%{opacity:.4} 50%{opacity:1} }

    /* ── RWD ── */
    @media (max-width: 480px) {
      .ls-aquarium  { height: 260px; }
      .ls-rod-img   { width: 120px; }
      .ls-fish-emoji { font-size: 1.6rem; }
      .ls-fish-label { font-size: .9rem; }
    }
    @media (min-width: 600px) {
      .ls-aquarium  { height: 360px; }
      .ls-rod-img   { width: 180px; }
      .ls-fish-emoji { font-size: 2.2rem; }
    }
  `;
  document.head.appendChild(style);
})();

export default ListenGame;
