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
const FISH_SPEEDS = { hard: 8000, medium: 6500, easy: 5000, easy_plus: 4000 };
const FISH_SPEED_MULTIPLIERS = [1.0, 0.8, 1.2, 0.9, 0.7, 1.3, 0.95, 1.1, 0.85, 1.05];
const FISH_EMOJIS = ['🐠','🐟','🐡','🦈','🐙','🦐','🐚','🦑','🐬','🦀'];
const OPTION_COUNT = 10;  // 10 隻魚

// 魚的水深層（%，相對水域高度）：10 隻均勻分布
const FISH_DEPTHS = [10, 22, 34, 46, 58, 12, 26, 40, 52, 64];

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

    // 魚鉤狀態（鉤子固定在中央，魚游向鉤子被釣起）
    this._hookActive     = false;
    this._hookY          = 0;
    this._hookSplashed   = false;
    this._hookX          = 50;    // 固定置中
    this._hookSpeed      = 0.35;
    this._hookAnimId     = null;
    this._hookTimestamp  = null;
    this._aquariumHeight = 0;
    // 「點魚游向鉤子」狀態
    this._swimTarget     = -1;    // 正在游向鉤子的魚 index
    this._swimAnimId     = null;  // 游向鉤子的 rAF id
    // hover 減速追蹤
    this._hoveredFish    = new Set();  // 目前滑鼠 hover 中的魚 index
  }

  // ════════════════════════════════════════════
  // loadQuestions
  // ════════════════════════════════════════════
  async loadQuestions() {
    const chars = this.questionChars;
    if (!chars || chars.length === 0) throw new Error('listen: 題目字元為空');

    const allChars  = JSONLoader.get('characters') || [];
    const polyphones = JSONLoader.get('polyphones') || [];
    const target    = this.totalQuestions || 10;

    // ── Step 1：每個生字出一題（不重複），決定模式 ──
    const baseQuestions = [];
    for (const char of chars) {
      const charData = allChars.find(c => (c['字'] || c.char) === char);
      if (!charData) continue;

      const isPolyphone = polyphones.some(p => (p['字'] || p.char) === char);
      const charWords   = charData.pronunciations?.[0]?.words || charData.words || [];
      // 多音字或無詞語都走模式一；有詞語且 40% 機率走模式二
      const mode = (isPolyphone || (!isPolyphone && Math.random() >= 0.6)) && charWords.length > 0
        ? 2 : 1;
      const correctWord = charWords[0] || char;

      baseQuestions.push({
        char,
        pronunciation: charData.pronunciations?.[0]?.zhuyin || '',
        words: charWords,
        correctWord,
        level: { 1:'easy', 2:'medium' }[charData.grade] || 'medium',
        mode,
        distractors: this._buildDistractors(char, charData, allChars, mode),
      });
    }

    // ── Step 2：若不夠題數，用生字的詞語補充（模式二）──
    const extraPool = [];
    if (baseQuestions.length < target) {
      for (const char of chars) {
        const charData = allChars.find(c => (c['字'] || c.char) === char);
        if (!charData) continue;
        const charWords = charData.pronunciations?.[0]?.words || charData.words || [];
        // 每個額外詞語出一題（模式二）
        for (const word of charWords) {
          if (!word || word === char) continue;
          extraPool.push({
            char,
            pronunciation: charData.pronunciations?.[0]?.zhuyin || '',
            words: charWords,
            correctWord: word,
            level: { 1:'easy', 2:'medium' }[charData.grade] || 'medium',
            mode: 2,
            distractors: this._buildDistractors(char, charData, allChars, 2),
          });
        }
      }
    }

    // ── Step 3：合併，打亂，截取 target 題 ──
    const shuffle = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    shuffle(baseQuestions);
    shuffle(extraPool);

    let questions = [...baseQuestions];

    // 用 extraPool 補到 target 題
    let ei = 0;
    while (questions.length < target && extraPool.length > 0) {
      questions.push(extraPool[ei % extraPool.length]);
      ei++;
    }

    // 若仍不足（詞語也沒有），循環 baseQuestions 補滿
    let bi = 0;
    while (questions.length < target && baseQuestions.length > 0) {
      questions.push({ ...baseQuestions[bi % baseQuestions.length] });
      bi++;
    }

    questions = questions.slice(0, target);

    if (questions.length === 0) throw new Error('listen: 無法取得題目資料');
    this.questions = questions;
    return questions;
  }

  // ════════════════════════════════════════════
  // _buildDistractors
  // ════════════════════════════════════════════
  _buildDistractors(char, charData, allChars, mode) {
    const result  = [];
    const used    = new Set([char]);
    const need    = OPTION_COUNT - 1;  // 9 個干擾選項

    if (mode === 1) {
      // 模式一：干擾字「發音必須與正確答案不同」
      const correctPron = charData.pronunciations?.[0]?.zhuyin || '';
      const shuffled = [...allChars].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (result.length >= need) break;
        const cChar = c['字'] || c.char;
        if (!cChar || used.has(cChar)) continue;
        // 確認所有讀音都與正確讀音不同
        const allProns = (c.pronunciations || []).map(p => p.zhuyin || '');
        if (allProns.length === 0) continue;
        if (!allProns.includes(correctPron)) {
          result.push(cChar); used.add(cChar);
        }
      }
    } else {
      // 模式二：干擾詞語「音節不能與正確詞語音節完全相同」
      const correctWord = charData.pronunciations?.[0]?.words?.[0] || charData.words?.[0] || char;
      const shuffled = [...allChars].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (result.length >= need) break;
        const cWords = (c.pronunciations?.[0]?.words || c.words || []);
        const cWord  = cWords[0] || (c['字'] || c.char);
        if (!cWord || cWord === correctWord || used.has(cWord)) continue;
        result.push(cWord); used.add(cWord);
      }
    }
    return result.slice(0, need);
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

    const correctAnswer = q.mode === 1 ? q.char : (q.correctWord || q.words?.[0] || q.char);
    const options = this._shuffleOptions(correctAnswer, q.distractors);
    this._fishAnswers    = options;
    this._correctFishIndex = options.indexOf(correctAnswer);
    this._currentAudioZhuyin = q.pronunciation;
    this._currentWord = q.correctWord || (q.words && q.words.length > 0 ? q.words[0] : q.char);

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

          <!-- 釣竿整體（跟著滑鼠移動） -->
          <div class="ls-rod-wrap" id="ls-rod-wrap">
            <img src="./images/fish_rod.png" class="ls-rod-img" alt="釣竿" />
            <!-- 魚線從竿尖垂下 -->
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
    if (!text && text !== 0) return '<span class="ls-fish-label-text">？</span>';
    // 清除 IVS/variation selector 字元（使用 Unicode category 方式避免 surrogate pair regex 問題）
    const clean = [...String(text)].filter(c => {
      const cp = c.codePointAt(0);
      // 排除 Variation Selectors (U+FE00–U+FE0F) 和 IVS (U+E0100–U+E01EF)
      return !(cp >= 0xFE00 && cp <= 0xFE0F) && !(cp >= 0xE0100 && cp <= 0xE01EF);
    }).join('');
    return /[ㄅ-ㄩˊˇˋ˙]/.test(clean)
      ? `<span class="ls-fish-pv2">${this._renderZhuyinPv2(clean)}</span>`
      : `<span class="ls-fish-label-text">${this._escapeHtml(clean)}</span>`;
  }

  // pv2 方格注音系統（從 CardPage._renderZhuyinVerticalInline 移植）
  _renderZhuyinPv2(pron) {
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

    const count   = [initial, medial, final].filter(Boolean).length;
    const hasDot  = tone === '˙';
    const dotCls  = hasDot ? ' pv2--dot' : '';
    const dotHtml = hasDot ? `<span class="pv2-dot">${this._escapeHtml(tone)}</span>` : '';
    const toneHtml = (tone && tone !== '˙')
      ? `<span class="pv2-tone">${this._escapeHtml(tone)}</span>`
      : `<span class="pv2-tone pv2-empty"></span>`;
    const toneCol = `<span class="pv2-tone-col">` +
      `<span class="pv2-empty pv2-tone-spacer"></span>` +
      toneHtml +
      `<span class="pv2-empty pv2-tone-spacer"></span>` +
      `</span>`;

    if (count === 1) {
      const sym = initial || medial || final;
      return `<span class="pv2 pv2-a${dotCls}">${dotHtml}` +
        `<span class="pv2-col">` +
        `<span class="pv2-r1 pv2-empty"></span>` +
        `<span class="pv2-r2">${this._escapeHtml(sym)}</span>` +
        `<span class="pv2-r3 pv2-empty"></span>` +
        `</span>${toneCol}</span>`;
    }
    if (count === 2) {
      const slots = [initial, medial, final].filter(Boolean);
      return `<span class="pv2 pv2-b${dotCls}">${dotHtml}` +
        `<span class="pv2-col">` +
        `<span class="pv2-r1">${this._escapeHtml(slots[0])}</span>` +
        `<span class="pv2-r2 pv2-empty"></span>` +
        `<span class="pv2-r3">${this._escapeHtml(slots[1])}</span>` +
        `</span>${toneCol}</span>`;
    }
    return `<span class="pv2 pv2-c${dotCls}">${dotHtml}` +
      `<span class="pv2-col">` +
      `<span class="pv2-r1">${this._escapeHtml(initial)}</span>` +
      `<span class="pv2-r2">${this._escapeHtml(medial)}</span>` +
      `<span class="pv2-r3">${this._escapeHtml(final)}</span>` +
      `</span>${toneCol}</span>`;
  }

  _escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  _buildFishHTML(options) {
    // 10 隻魚隨機初始 X（避免重疊）
    const initX = [5, 18, 32, 48, 62, 75, 10, 40, 55, 80];
    let html = '';
    for (let i = 0; i < OPTION_COUNT; i++) {
      const labelHTML = this._renderZhuyinLabel(options[i]);
      html += `
        <div class="ls-fish-row" style="top:${FISH_DEPTHS[i]}%;">
          <div class="ls-fish" id="ls-fish-${i}" data-index="${i}"
               style="left:${initX[i]}%" role="button" tabindex="0"
               aria-label="選項 ${options[i]}">
            <span class="ls-fish-emoji">${FISH_EMOJIS[i]}</span>
            <span class="ls-fish-label" id="ls-fish-label-${i}">${labelHTML}</span>
          </div>
        </div>`;
    }
    return html;
  }

  _shuffleOptions(correct, distractors) {
    // 取最多 OPTION_COUNT-1 個干擾選項，補足到 OPTION_COUNT 個
    const arr = [correct, ...distractors.slice(0, OPTION_COUNT - 1)];
    // 若不足 OPTION_COUNT，用正確答案補位（避免 undefined）
    while (arr.length < OPTION_COUNT) arr.push(correct);
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
    this._fishPositions   = [5, 18, 32, 48, 62, 75, 10, 40, 55, 80];
    this._fishDirections  = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
    this._fishBaseSpeeds  = FISH_SPEED_MULTIPLIERS.map(m => (100 / base) * m);
    this._fishSpeeds      = [...this._fishBaseSpeeds];
    this._hoveredFish     = new Set();
    this._fishAnimRunning = true;
    this._lastTimestamp   = null;

    // 綁定 hover 減速：滑鼠靠近時速度降為 15%
    for (let i = 0; i < OPTION_COUNT; i++) {
      const el = document.getElementById(`ls-fish-${i}`);
      if (!el) continue;
      el.addEventListener('mouseenter', () => {
        this._hoveredFish.add(i);
        this._fishSpeeds[i] = this._fishBaseSpeeds[i] * 0.08;  // hover 近乎靜止
      });
      el.addEventListener('mouseleave', () => {
        this._hoveredFish.delete(i);
        this._fishSpeeds[i] = this._fishBaseSpeeds[i];
      });
    }

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
        // 只翻魚 emoji，字卡反向抵消保持正向
        const emojiEl = fishEl.querySelector('.ls-fish-emoji');
        const labelEl = fishEl.querySelector('.ls-fish-label');
        if (emojiEl) emojiEl.style.transform = 'scaleX(-1)';
        if (labelEl) labelEl.style.transform = 'scaleX(1)';
      } else if (this._fishPositions[i] <= 3) {
        this._fishPositions[i] = 3;
        this._fishDirections[i] = 1;
        const emojiEl = fishEl.querySelector('.ls-fish-emoji');
        const labelEl = fishEl.querySelector('.ls-fish-label');
        if (emojiEl) emojiEl.style.transform = 'scaleX(1)';
        if (labelEl) labelEl.style.transform = 'scaleX(1)';
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
    this._hookActive    = true;
    this._hookY         = 0;
    this._hookX         = xPercent;
    this._hookTimestamp = null;
    this._hookSplashed  = false;  // 重置入水音效 flag
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

    // 鉤子入水時播放音效（只播一次）
    if (!this._hookSplashed && hookRect.top >= aqRect.top) {
      this._hookSplashed = true;
      this._playMp3('fishing');
    }

    // 鉤子進入水域後才偵測碰撞
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
    // 魚跟著鉤子浮起動畫（入水音效已在 _animateHook 播過）
    this._stopWaterLoop();
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
    this._hookActive    = false;
    this._hookSplashed  = false;  // 重置入水音效，下次投鉤可再播
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
    window.__lsPlay  = () => this._playCurrentAudio(this.currentQuestion);
    window.__lsHint  = () => this.useHint();

    // 點魚 → 魚游向鉤子被釣起
    const aquarium = document.getElementById('ls-aquarium');
    if (aquarium) {
      aquarium._lsClick = (e) => {
        if (this.isAnswering || this._hookActive || this._swimTarget >= 0) return;
        const fishEl = e.target.closest('.ls-fish');
        if (!fishEl) return;
        const idx = parseInt(fishEl.dataset.index, 10);
        if (isNaN(idx)) return;
        this._startFishSwimToHook(idx);
      };
      aquarium.addEventListener('click', aquarium._lsClick);
    }
  }

  // _moveRod — 釣竿固定置中（不再跟滑鼠）
  // ════════════════════════════════════════════
  _moveRod(xPct) {
    this._hookX = xPct;
  }

  // ════════════════════════════════════════════
  // _startFishSwimToHook — 點魚後，魚直線游向鉤子，到達後被釣起
  // ════════════════════════════════════════════
  _startFishSwimToHook(idx) {
    if (this._swimTarget >= 0 || this._hookActive) return;
    this._swimTarget   = idx;
    this._hookActive   = true;   // 鎖定，防止重複點擊
    this._hookSplashed = false;

    const fishEl = document.getElementById(`ls-fish-${idx}`);
    if (!fishEl) return;

    // 播放投鉤入水音效
    this._playMp3('water');

    // 鉤子下降動畫：先讓線延伸到魚所在深度
    this._dropHookToFish(idx, fishEl);
  }

  // 鉤子快速落到魚的位置（依魚的 top% 算目標 Y）
  _dropHookToFish(idx, fishEl) {
    const aqEl = document.getElementById('ls-aquarium');
    if (!aqEl || !fishEl) { this._hookActive = false; this._swimTarget = -1; return; }

    const aqH = aqEl.clientHeight || 320;
    const depthPct = FISH_DEPTHS[idx] || 30;
    const targetY  = (depthPct / 100) * aqH;  // 目標 Y px

    const lineEl = document.getElementById('ls-hook-line');
    const hookEl = document.getElementById('ls-hook');

    let startTs = null;
    const HOOK_DURATION = 400;  // ms，快速落下

    const animate = (ts) => {
      if (!startTs) startTs = ts;
      const prog = Math.min((ts - startTs) / HOOK_DURATION, 1);
      const curY = prog * targetY;

      if (lineEl) lineEl.style.height = curY + 'px';
      if (hookEl) hookEl.style.top    = curY + 'px';

      // 入水音效（到達水域頂部 ~10px 時）
      if (!this._hookSplashed && curY >= 10) {
        this._hookSplashed = true;
        this._playMp3('fishing');
      }

      if (prog < 1) {
        requestAnimationFrame(animate);
      } else {
        // 鉤子到位，魚游向鉤子
        this._swimFishToHook(idx, fishEl);
      }
    };
    requestAnimationFrame(animate);
  }

  // 魚放大並移動到魚鉤位置，到達後被釣起
  _swimFishToHook(idx, fishEl) {
    const aqEl  = document.getElementById('ls-aquarium');
    const hookEl = document.getElementById('ls-hook');
    if (!aqEl || !fishEl) { this._finishSwim(); return; }

    const aqRect   = aqEl.getBoundingClientRect();
    const fishRect = fishEl.getBoundingClientRect();
    const hookRect = hookEl ? hookEl.getBoundingClientRect() : null;

    // 目標：移動到魚鉤正下方（鉤子的 X，深度約 40% 水域）
    const aqW     = aqRect.width || 600;
    const aqH     = aqRect.height || 320;
    const hookXPx = hookRect
      ? (hookRect.left + hookRect.width / 2) - aqRect.left
      : aqW * 0.50;
    const hookYPx = hookRect
      ? (hookRect.bottom) - aqRect.top
      : aqH * 0.35;

    // 魚目前中心位置（px，相對 aquarium）
    const startXPx = (fishRect.left + fishRect.width / 2) - aqRect.left;
    const startYPx = (fishRect.top + fishRect.height / 2) - aqRect.top;

    // 游向鉤子的持續時間（依距離計算）
    const dist    = Math.sqrt((hookXPx - startXPx) ** 2 + (hookYPx - startYPx) ** 2);
    const SPEED   = 0.45;  // px/ms
    const duration = Math.max(400, dist / SPEED);

    // 使用絕對定位覆蓋讓魚脫離 ls-fish-row 流
    const startLeft = parseFloat(fishEl.style.left) || 0;
    const startTop  = parseFloat(fishEl.closest('.ls-fish-row')?.style.top || '0') +
                      (fishRect.top - fishRect.top);
    // 改用 transform translate 做動畫（保持原位置的相對計算）
    fishEl.style.transformOrigin = 'center center';
    fishEl.style.zIndex = '50';
    fishEl.style.pointerEvents = 'none';

    let startTs = null;
    const animate = (ts) => {
      if (!startTs) startTs = ts;
      const prog = Math.min((ts - startTs) / duration, 1);
      // easeInOut
      const ease = prog < 0.5 ? 2 * prog * prog : -1 + (4 - 2 * prog) * prog;

      const dx = (hookXPx - startXPx) * ease;
      const dy = (hookYPx - startYPx) * ease;
      // 放大到 2x，中途達到最大，到達後縮回
      const scale = 1 + Math.sin(ease * Math.PI) * 1.2;

      fishEl.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;

      // 魚頭朝向鉤子方向
      const emojiEl = fishEl.querySelector('.ls-fish-emoji');
      if (emojiEl) emojiEl.style.transform = hookXPx > startXPx ? 'scaleX(-1)' : 'scaleX(1)';

      if (prog < 1) {
        this._swimAnimId = requestAnimationFrame(animate);
      } else {
        // 到達鉤子，觸發被釣起音效與判斷
        this._playMp3('waterup');
        const lineEl = document.getElementById('ls-hook-line');
        this._onFishCaught(idx, fishEl, hookEl, lineEl);
      }
    };
    this._swimAnimId = requestAnimationFrame(animate);
  }

  _finishSwim() {
    this._swimTarget = -1;
    this._hookActive = false;
    this._retractHook();
  }

  // ════════════════════════════════════════════
  // _playCurrentAudio
  // ════════════════════════════════════════════
  async _playCurrentAudio(q) {
    if (!q || AppState.settings?.soundOn === false) return;
    if (this._mode === 1) {
      await AudioManager.play(q.pronunciation).catch(() => {});
    } else {
      // 模式二：逐字播放詞語，350ms 間隔語速自然
      for (const c of this._currentWord) {
        const charData = (JSONLoader.get('characters') || []).find(ch => (ch['字'] || ch.char) === c);
        const pron = charData?.pronunciations?.[0]?.zhuyin || '';
        if (pron) {
          AudioManager.play(pron).catch(() => {});
          await new Promise(r => setTimeout(r, 350));
        }
      }
    }
  }

  // ════════════════════════════════════════════
  // judgeAnswer
  // ════════════════════════════════════════════
  async judgeAnswer(selected) {
    const q = this.currentQuestion;
    if (!q) throw new Error('judgeAnswer: 無當前題目');
    const correctAnswer = q.mode === 1 ? q.char : (q.correctWord || q.words?.[0] || q.char);
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
    // 收回鉤子，恢復水聲，讓玩家繼續釣
    this._retractHook();
    this._startWaterLoop();
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer（答錯兩次：正確魚發光 + 再播音 + 顯示答案 → 自動下一題）
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    this._stopFishAnimation();
    this._retractHook();
    const q = this.currentQuestion;
    if (!q) return;

    // 正確魚發光浮出
    document.getElementById(`ls-fish-${this._correctFishIndex}`)
      ?.classList.add('ls-fish--glow', 'ls-fish--reveal');

    // 再播一次音效
    if (AppState.settings?.soundOn !== false) {
      await this._playCurrentAudio(q);
    }
    const hintArea = document.getElementById('ls-hint-area');
    if (hintArea) {
      const correctAnswer = q.mode === 1 ? q.char : (q.correctWord || q.words?.[0] || q.char);
      hintArea.innerHTML = `
        <div class="ls-answer-reveal">
          ✅ 正確答案：<strong>${correctAnswer}</strong>
          ${q.mode === 2 ? `（聽「${q.char}」的詞語）` : ''}
        </div>`;
    }

    // 顯示 2 秒後自動進下一題
    await this._delay(2000);
    this.nextQuestion();
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
    if (this.usedHints === 1) {
      // 提示一：聲調（usedHints 在 GameEngine.useHint() 遞增後才呼叫此方法）
      // 輕聲˙可能在開頭或末尾
      let tone = pron.match(/[ˊˇˋ˙]/)?.[0] || '（一聲）';
      const toneNames = { 'ˊ':'二聲', 'ˇ':'三聲', 'ˋ':'四聲', '˙':'輕聲', '（一聲）':'一聲' };
      hintArea.innerHTML = `<div class="ls-hint-text">💡 提示一：聲調是「${toneNames[tone] || tone}」</div>`;
    } else if (this.usedHints === 2) {
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
    return document.getElementById('game-content')
      || document.getElementById('app')
      || document.getElementById('game-container');
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
    if (this._swimAnimId) { cancelAnimationFrame(this._swimAnimId); this._swimAnimId = null; }
    this._swimTarget = -1;
    const aquarium = document.getElementById('ls-aquarium');
    if (aquarium && aquarium._lsClick) {
      aquarium.removeEventListener('click', aquarium._lsClick);
    }
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
      min-height: 100%;
      background: linear-gradient(180deg, #1a2a4a 0%, #0d1b2e 100%);
      color: #e0f7ff;
      font-family: '微軟正黑體', 'Noto Sans TC', 'PingFang TC', sans-serif;
      padding: 0 0 16px;
      box-sizing: border-box;
      overflow: hidden;
    }

    /* ── 頂部難度標籤 ── */
    .ls-top-bar {
      display: flex;
      justify-content: flex-end;
      width: 100%;
      padding: 6px 12px 2px;
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
      padding-top: 95px;    /* 為釣竿留出空間 */
      cursor: default;
      user-select: none;
    }

    /* ── 釣竿整體（跟著滑鼠） ── */
    .ls-rod-wrap {
      position: absolute;
      top: 0;
      left: 50%;                    /* 預設置中，由 JS 更新 */
      transform: translateX(-50%);
      width: 160px;
      height: 90px;
      pointer-events: none;
      will-change: left;
    }
    .ls-rod-img {
      width: 160px;
      height: auto;
      opacity: 0.92;
      filter: drop-shadow(0 2px 8px rgba(0,150,255,0.5));
      pointer-events: none;
      display: block;
    }

    /* ── 釣魚線 + 鉤子（從竿尖垂下） ── */
    .ls-line-wrap {
      position: absolute;
      top: 8px;           /* 竿尖大約位置 */
      left: 72%;          /* 竿尖 X（竿子右端約 72%） */
      width: 2px;
      pointer-events: none;
    }
    .ls-line {
      width: 2px;
      height: 0;
      background: linear-gradient(180deg, rgba(150,200,255,0.9), rgba(100,180,255,0.4));
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
      height: 380px;
      cursor: default;
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
      font-weight: bold;
      background: rgba(0,20,50,0.75);
      color: #e0f7ff;
      padding: 4px 10px; border-radius: 12px;
      border: 1px solid rgba(0,229,255,0.5);
      white-space: nowrap;
      backdrop-filter: blur(2px);
      display: inline-flex; align-items: center;
    }

    /* 漢字選項：大字不加注音 */
    .ls-fish-label-text {
      font-size: 1.8rem;
      line-height: 1;
      letter-spacing: 0.05em;
      font-family: 'Noto Sans TC', '微軟正黑體', 'PingFang TC', Arial, sans-serif !important;
    }

    /* 直式注音 */
    /* pv2 注音包裝容器 */
    .ls-fish-pv2 {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* pv2 方格注音系統（移植自 card.css） */
    .ls-fish-pv2 .pv2 {
      display: inline-flex;
      flex-direction: row;
      align-items: flex-end;
      vertical-align: bottom;
      white-space: nowrap;
      line-height: 1;
      position: relative;
      color: #e0f7ff;
    }
    .ls-fish-pv2 .pv2--dot { padding-top: 0.15em; }
    .ls-fish-pv2 .pv2-col {
      display: flex; flex-direction: column;
      align-items: center; justify-content: space-between;
      height: 2.4rem;
    }
    .ls-fish-pv2 .pv2-tone-col {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      height: 2.4rem;
    }
    .ls-fish-pv2 .pv2-r1, .ls-fish-pv2 .pv2-r2, .ls-fish-pv2 .pv2-r3,
    .ls-fish-pv2 .pv2-tone, .ls-fish-pv2 .pv2-tone-spacer {
      display: flex; align-items: center; justify-content: center;
      font-family: 'Noto Sans TC', sans-serif;
      font-size: 0.78rem; font-weight: 700; line-height: 1;
      min-width: 0.85em; color: #e0f7ff;
    }
    .ls-fish-pv2 .pv2-tone-spacer { flex: 1; visibility: hidden; }
    .ls-fish-pv2 .pv2-dot {
      position: absolute; top: 0; left: 0; right: 0;
      text-align: center;
      font-family: 'Noto Sans TC', sans-serif;
      font-size: 0.78rem; font-weight: 900; line-height: 1;
      color: #e0f7ff; pointer-events: none;
    }
    .ls-fish-pv2 .pv2-b .pv2-r2 { visibility: hidden; }
    .ls-fish-pv2 .pv2-empty { visibility: hidden; }

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
      .ls-aquarium  { height: 320px; }
      .ls-rod-img   { width: 120px; }
      .ls-fish-emoji { font-size: 1.6rem; }
      .ls-fish-label-text { font-size: 1.5rem; }
    }
    @media (min-width: 600px) {
      .ls-aquarium  { height: 420px; }
      .ls-rod-img   { width: 180px; }
      .ls-fish-emoji { font-size: 2.2rem; }
    }
  `;
  document.head.appendChild(style);
})();

export default ListenGame;
