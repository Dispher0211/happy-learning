/**
 * words.js — 詞語填空 × 🏎️ 賽車跑道遊戲
 * Task 21：繼承 GameEngine，實作兩種模式
 *
 * 遊戲規則（SECTION 9 D.9）：
 *   題目來源：my_words（優先）→ characters.json 的 words 陣列
 *   模式比例：60% 模式一（賽車吃詞語）/ 40% 模式二（選擇題選正確生字）
 *
 *   模式一（賽車）：
 *     - 正確詞語（綠色框）+ 錯誤詞語（紅色框，confusables/形近字）在跑道上移動
 *     - 賽車在底部左右移動，碰到詞語即「吃」
 *     - 機會3次，吃錯機會-1；機會歸0 → 該題失敗（onWrongSecondTime）
 *     - 全部正確詞語吃完 → 額外 ★+0.5
 *
 *   模式二（選擇題）：
 *     - 顯示含空格的詞語，4個生字選項選出正確的字填入空格
 *
 *   注音：非生字簿字依注音開關；生字簿字永遠純文字
 *   提示一：「正確詞語包含字：第一個字是...」
 *   提示二：「詞語意思提示」
 *
 * 依賴模組：
 *   GameEngine.js（T14）、GameConfig.js（T15）
 *   state.js（T02）、audio.js（T08）
 */

import { GameEngine } from './GameEngine.js';
import { AppState } from '../state.js'
import { JSONLoader } from '../json_loader.js';

// ─────────────────────────────────────────────
// 賽車移動速度（px/ms）
// ─────────────────────────────────────────────
const CAR_SPEEDS = {
  hard:       0.22,
  medium:     0.30,
  easy:       0.38,
  easy_plus:  0.48,
};

// 詞語卡片在跑道上的下落速度（%/ms）
const WORD_FALL_SPEEDS = {
  hard:       0.010,
  medium:     0.014,
  easy:       0.018,
  easy_plus:  0.024,
};

export class WordsGame extends GameEngine {
  constructor() {
    super('words');

    // ── 模式一狀態 ──
    this._mode = 1;
    this._lives = 3;              // 剩餘機會
    this._correctWords = [];      // 本題正確詞語列表
    this._wrongWords = [];        // 本題錯誤詞語列表
    this._wordCards = [];         // 跑道上的詞語卡片 { id, word, isCorrect, x, y, eaten }
    this._carX = 50;              // 賽車 X 位置（%）
    this._cardIdCounter = 0;
    this._eatenCorrect = 0;       // 已吃到的正確詞語數
    this._allCorrectEaten = false;// 是否吃完所有正確詞語

    // ── 動畫 ──
    this._animRunning = false;
    this._lastTs = null;
    this._keysDown = {};

    // ── 輸入監聽器 ──
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onTouchStart = null;
    this._onTouchMove = null;
    this._lastTouchX = null;

    // ── 題目資料 ──
    this._currentQuestion = null;
    this._mode2Options = [];      // 模式二的4個選項
    this._mode2Correct = '';      // 模式二正確答案（生字）
  }

  // ════════════════════════════════════════════
  // loadQuestions
  // ════════════════════════════════════════════
  async loadQuestions() {
    const chars = this.questionChars;
    if (!chars || chars.length === 0) {
      throw new Error('words: 題目字元為空');
    }

    // 從 characters.json 全字典查詢完整資料（AppState.characters 只有簡單 {字,zhuyin}）
    const allChars = JSONLoader.get('characters') || [];
    // my_words 優先（家長自訂）
    const myWords = AppState.myWords || [];
    const questions = [];

    for (const char of chars) {
      const charData = allChars.find(c => (c['字'] || c.char) === char);
      if (!charData) continue;

      // 取得詞語：優先 my_words，其次 characters.json 的 words
      let words = myWords.filter(w => w.includes(char));
      if (words.length === 0) {
        words = (charData.pronunciations?.[0]?.words || charData.words || []).slice(0, 4); // 最多4個
      }
      if (words.length === 0) {
        words = [char + '字']; // 備用詞語
      }

      // 取得干擾詞語：來自 confusables 或形近字
      const confusables = charData.confusables || [];
      const wrongWords = this._buildWrongWords(char, words, confusables, allChars);

      // 模式決定
      const mode = Math.random() < 0.6 ? 1 : 2;

      questions.push({
        char,
        words: words.slice(0, 3),    // 最多3個正確詞語
        wrongWords: wrongWords.slice(0, 4),
        pronunciation: charData.pronunciation || '',
        level: charData.level || 'medium',
        definition: charData.definition || '',
        mode,
      });
    }

    this.questions = questions;
    return questions;
  }

  // ════════════════════════════════════════════
  // _buildWrongWords — 產生錯誤詞語
  // ════════════════════════════════════════════
  _buildWrongWords(char, correctWords, confusables, allChars) {
    const result = [];
    const used = new Set(correctWords);

    // 用 confusables 替換詞語中的字
    for (const conf of confusables) {
      if (result.length >= 4) break;
      const base = correctWords[0] || char + '字';
      const wrongWord = base.replace(char, conf);
      if (!used.has(wrongWord)) {
        result.push(wrongWord);
        used.add(wrongWord);
      }
    }

    // 補充：用隨機字取代
    const pool = allChars
      .filter(c => c.char !== char)
      .sort(() => Math.random() - 0.5);

    for (const c of pool) {
      if (result.length >= 4) break;
      const base = correctWords[0] || char + '字';
      const wrongWord = base.replace(char, c.char);
      if (!used.has(wrongWord)) {
        result.push(wrongWord);
        used.add(wrongWord);
      }
    }

    return result;
  }

  // ════════════════════════════════════════════
  // renderQuestion
  // ════════════════════════════════════════════
  renderQuestion() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    this._stopAllAnimations();
    this._removeInputListeners();

    this._mode = q.mode;
    this._lives = 3;
    this._eatenCorrect = 0;
    this._allCorrectEaten = false;
    this._correctWords = [...q.words];
    this._wrongWords = [...q.wrongWords];
    this._carX = 50;
    this._wordCards = [];
    this._currentQuestion = q;

    const appEl = this._getContainer();
    if (!appEl) return;

    appEl.innerHTML = this._buildHTML(q);
    this._renderProgressBar();
    this._updateHintButton();
    this._renderLives();

    if (q.mode === 1) {
      // 初始化詞語卡片並啟動動畫
      this._spawnWordCards(q);
      this._animRunning = true;
      this._lastTs = null;
      requestAnimationFrame(ts => this._gameLoop(ts));
      this._bindInputEvents();
    } else {
      // 模式二：顯示選擇題
      this._initMode2(q);
    }
  }

  // ════════════════════════════════════════════
  // _buildHTML
  // ════════════════════════════════════════════
  _buildHTML(q) {
    const levelLabel = { hard: '困難', medium: '中等', easy: '簡單', easy_plus: '加強' }[q.level] || '中等';
    const modeLabel = q.mode === 1 ? '賽車模式' : '選擇模式';

    return `
      <div class="wd-game" id="wd-game-root">
        <!-- 頂部 -->
        <div class="wd-header">
          <div class="wd-char">${q.char}</div>
          <div class="wd-meta">
            <div class="wd-title">
              ${q.mode === 1 ? `賽車吃到含「${q.char}」的詞語！` : `選出含「${q.char}」的正確詞語`}
            </div>
            <div class="wd-badges">
              <span class="wd-badge wd-badge--mode">${modeLabel}</span>
              <span class="wd-badge wd-badge--${q.level}">${levelLabel}</span>
            </div>
          </div>
          <!-- 機會（模式一）-->
          <div class="wd-lives" id="wd-lives" style="display:${q.mode === 1 ? 'flex' : 'none'}"></div>
        </div>

        <!-- 進度條 -->
        <div class="wd-progress-bar">
          <div class="wd-progress-fill" id="wd-progress-fill"></div>
        </div>

        ${q.mode === 1 ? `
        <!-- 模式一：賽車跑道 -->
        <div class="wd-track" id="wd-track">
          <!-- 跑道線條 -->
          <div class="wd-lane-lines">
            <div class="wd-line wd-line--1"></div>
            <div class="wd-line wd-line--2"></div>
          </div>
          <!-- 詞語卡片（動態產生） -->
          <div id="wd-cards-layer"></div>
          <!-- 賽車 -->
          <div class="wd-car" id="wd-car" style="left:${this._carX}%">🏎️</div>
        </div>
        <div class="wd-track-controls">
          <span class="wd-tip">📱 左右滑動 ｜ ⌨️ ←→ 鍵移動</span>
        </div>
        ` : `
        <!-- 模式二：選擇題 -->
        <div class="wd-choice-area" id="wd-choice-area">
          <!-- 由 JS 動態填入 -->
        </div>
        `}

        <!-- 進度（已吃到/全部） -->
        ${q.mode === 1 ? `
        <div class="wd-eaten-count" id="wd-eaten-count">
          吃到 <span id="wd-eaten-num">0</span>/${q.words.length} 個詞語
        </div>` : ''}

        <!-- 提示區 -->
        <div class="wd-hint-area" id="wd-hint-area"></div>

        <!-- 按鈕 -->
        <div class="wd-controls">
          <button class="wd-btn wd-btn--hint" id="wd-hint-btn"
                  onclick="window.__wdHint()">
            💡 提示（剩 ${2 - (this.usedHints || 0)} 次）
          </button>
        </div>

        <!-- 回饋 -->
        <div class="wd-feedback" id="wd-feedback"></div>
      </div>
    `;
  }

  // ════════════════════════════════════════════
  // _spawnWordCards — 在跑道上產生詞語卡片
  // ════════════════════════════════════════════
  _spawnWordCards(q) {
    const allWords = [
      ...q.words.map(w => ({ word: w, isCorrect: true })),
      ...q.wrongWords.map(w => ({ word: w, isCorrect: false })),
    ].sort(() => Math.random() - 0.5);

    // 每張卡片水平錯開
    const laneCount = allWords.length;
    allWords.forEach((item, i) => {
      const xPos = (100 / (laneCount + 1)) * (i + 1);
      this._wordCards.push({
        id: ++this._cardIdCounter,
        word: item.word,
        isCorrect: item.isCorrect,
        x: xPos,
        y: -10 - i * 20, // 錯開起始位置
        eaten: false,
      });
    });

    this._renderCards();
  }

  // ════════════════════════════════════════════
  // _renderCards — 渲染詞語卡片到 DOM
  // ════════════════════════════════════════════
  _renderCards() {
    const layer = document.getElementById('wd-cards-layer');
    if (!layer) return;
    layer.innerHTML = this._wordCards
      .filter(c => !c.eaten)
      .map(c => `
        <div class="wd-card ${c.isCorrect ? 'wd-card--correct' : 'wd-card--wrong'}"
             id="wd-card-${c.id}"
             style="left:${c.x}%;top:${c.y}%">
          ${c.word}
        </div>
      `).join('');
  }

  // ════════════════════════════════════════════
  // _gameLoop — 模式一主動畫迴圈
  // ════════════════════════════════════════════
  _gameLoop(timestamp) {
    if (!this._animRunning) return;

    if (this._lastTs === null) this._lastTs = timestamp;
    const delta = Math.min(timestamp - this._lastTs, 50);
    this._lastTs = timestamp;

    const q = this._currentQuestion;
    if (!q) return;

    // 更新賽車位置
    const speed = CAR_SPEEDS[q.level] || CAR_SPEEDS.medium;
    if (this._keysDown['ArrowLeft']) this._carX -= speed * delta;
    if (this._keysDown['ArrowRight']) this._carX += speed * delta;
    this._carX = Math.max(3, Math.min(94, this._carX));

    const carEl = document.getElementById('wd-car');
    if (carEl) carEl.style.left = this._carX + '%';

    // 更新卡片位置並偵測碰撞
    const fallSpeed = WORD_FALL_SPEEDS[q.level] || WORD_FALL_SPEEDS.medium;
    let cardsUpdated = false;

    for (const card of this._wordCards) {
      if (card.eaten) continue;
      card.y += fallSpeed * delta;

      // 碰撞偵測：卡片 Y 接近賽車 Y（88%），且 X 在賽車範圍內（±8%）
      if (card.y >= 80 && card.y <= 95 && Math.abs(card.x - this._carX) < 8) {
        // 吃到卡片
        card.eaten = true;
        cardsUpdated = true;

        if (card.isCorrect) {
          this._eatenCorrect++;
          this._showCardFeedback(card.x, '✅');
          // 更新吃到計數
          const numEl = document.getElementById('wd-eaten-num');
          if (numEl) numEl.textContent = this._eatenCorrect;

          // 全部正確詞語都吃完？
          if (this._eatenCorrect >= this._correctWords.length) {
            this._allCorrectEaten = true;
            this._stopAllAnimations();
            // 給予額外 ★+0.5（由 GameEngine onCorrect 處理 bonus）
            this.submitAnswer('__all_correct__');
            return;
          }
        } else {
          // 吃到錯誤詞語
          this._lives--;
          this._renderLives();
          this._showCardFeedback(card.x, '❌');

          if (this._lives <= 0) {
            // 機會用完 → 該題失敗
            this._stopAllAnimations();
            this.submitAnswer('__lives_out__');
            return;
          }
        }
      }

      // 卡片超出下方邊界 → 循環回頂部
      if (card.y > 105) {
        card.y = -15;
      }
    }

    if (cardsUpdated) this._renderCards();
    else {
      // 只更新卡片位置（不重建 DOM，提升效能）
      for (const card of this._wordCards) {
        if (card.eaten) continue;
        const el = document.getElementById(`wd-card-${card.id}`);
        if (el) el.style.top = card.y + '%';
      }
    }

    requestAnimationFrame(ts => this._gameLoop(ts));
  }

  // ════════════════════════════════════════════
  // _initMode2 — 初始化模式二選擇題
  // ════════════════════════════════════════════
  _initMode2(q) {
    // 取一個正確詞語，去掉目標字，讓學生選字填空
    const word = q.words[0] || q.char + '＿';
    const charIdx = word.indexOf(q.char);
    const blank = charIdx !== -1
      ? word.substring(0, charIdx) + '＿' + word.substring(charIdx + 1)
      : '＿' + word;

    this._mode2Correct = q.char;

    // 4個選項：1正確 + 3形近字
    const confusables = (q.words[0] ? [] : []).concat(
      (AppState.characters || [])
        .filter(c => c.char !== q.char)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3)
        .map(c => c.char)
    );
    // 補充到3個干擾
    const distractors = confusables.slice(0, 3);
    while (distractors.length < 3) distractors.push('？');

    this._mode2Options = [q.char, ...distractors].sort(() => Math.random() - 0.5);

    const area = document.getElementById('wd-choice-area');
    if (!area) return;

    // 注音顯示（非生字簿字依 soundOn 開關）
    const showZhuyin = AppState.settings?.soundOn !== false &&
                       AppState.settings?.showZhuyin !== false;

    area.innerHTML = `
      <div class="wd-blank-word">
        ${this._renderWordWithZhuyin(word, q.char, blank, showZhuyin)}
      </div>
      <div class="wd-options-grid" id="wd-options-grid">
        ${this._mode2Options.map((opt, i) => `
          <button class="wd-option-btn" data-index="${i}"
                  onclick="window.__wdSelectOption(${i})"
                  aria-label="${opt}">
            <span class="wd-opt-char">${opt}</span>
          </button>
        `).join('')}
      </div>
    `;

    window.__wdSelectOption = (index) => {
      if (this.isAnswering) return;
      this.submitAnswer(this._mode2Options[index]);
    };
  }

  // ════════════════════════════════════════════
  // _renderWordWithZhuyin — 顯示含空格的詞語（注音開關）
  // ════════════════════════════════════════════
  _renderWordWithZhuyin(word, targetChar, blank, showZhuyin) {
    // 生字簿字永遠純文字，非生字簿字依注音開關顯示
    return `<span class="wd-blank-display">${blank}</span>`;
  }

  // ════════════════════════════════════════════
  // _bindInputEvents — 模式一鍵盤/觸控
  // ════════════════════════════════════════════
  _bindInputEvents() {
    this._onKeyDown = (e) => {
      this._keysDown[e.key] = true;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
    };
    this._onKeyUp = (e) => { delete this._keysDown[e.key]; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    // 觸控
    const track = document.getElementById('wd-track');
    if (track) {
      this._onTouchStart = (e) => { this._lastTouchX = e.touches[0].clientX; };
      this._onTouchMove = (e) => {
        if (this._lastTouchX === null) return;
        const dx = e.touches[0].clientX - this._lastTouchX;
        this._lastTouchX = e.touches[0].clientX;
        const trackW = track.clientWidth || 400;
        this._carX += (dx / trackW) * 100;
        this._carX = Math.max(3, Math.min(94, this._carX));
        e.preventDefault();
      };
      track.addEventListener('touchstart', this._onTouchStart, { passive: true });
      track.addEventListener('touchmove', this._onTouchMove, { passive: false });
    }

    window.__wdHint = () => this.useHint();
  }

  // ════════════════════════════════════════════
  // _removeInputListeners
  // ════════════════════════════════════════════
  _removeInputListeners() {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp)   window.removeEventListener('keyup', this._onKeyUp);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._keysDown = {};
  }

  // ════════════════════════════════════════════
  // judgeAnswer
  // ════════════════════════════════════════════
  async judgeAnswer(answer) {
    if (this._mode === 1) {
      if (answer === '__all_correct__') return true;
      if (answer === '__lives_out__')  return false;
      return false;
    } else {
      return answer === this._mode2Correct;
    }
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation
  // ════════════════════════════════════════════
  async playCorrectAnimation() {
    const q = this._currentQuestion;
    const extra = (this._mode === 1 && this._allCorrectEaten) ? ' 🌟全吃完！+0.5' : '';
    const feedback = document.getElementById('wd-feedback');
    if (feedback) {
      feedback.innerHTML = `<div class="wd-correct-text">🏁 答對了！${extra}</div>`;
      feedback.classList.add('wd-feedback--show');
    }
    await this._delay(900);
    if (feedback) feedback.classList.remove('wd-feedback--show');
  }

  // ════════════════════════════════════════════
  // playWrongAnimation
  // ════════════════════════════════════════════
  async playWrongAnimation() {
    const carEl = document.getElementById('wd-car');
    if (carEl) {
      carEl.classList.add('wd-car--crash');
      await this._delay(500);
      carEl.classList.remove('wd-car--crash');
    }
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    const q = this._currentQuestion;
    if (!q) return;

    this._stopAllAnimations();

    const hintArea = document.getElementById('wd-hint-area');
    if (hintArea) {
      const wordList = q.words.join('、');
      hintArea.innerHTML = `
        <div class="wd-answer-reveal">
          ✅ 含「${q.char}」的詞語：<strong>${wordList}</strong>
        </div>
      `;
    }

    // 模式二：高亮正確選項
    if (this._mode === 2) {
      document.querySelectorAll('.wd-option-btn').forEach((btn, i) => {
        if (this._mode2Options[i] === this._mode2Correct) {
          btn.classList.add('wd-option--correct');
        }
      });
    }

    await this._delay(400);
  }

  // ════════════════════════════════════════════
  // getHint
  //   提示一：詞語中除目標字外的另一個字
  //   提示二：呼叫萌典 API 查詢詞語意思
  // ════════════════════════════════════════════
  getHint() {
    const q = this._currentQuestion;
    if (!q) return;
    const hintArea = document.getElementById('wd-hint-area');
    if (!hintArea) return;

    if (this.usedHints === 0) {
      // 提示一：提示詞語中除目標字外的另一個字
      const firstWord = q.words[0] || '';
      const hintChar = firstWord.split('').find(c => c !== q.char) || '？';
      hintArea.innerHTML = `
        <div class="wd-hint wd-hint--1">
          💡 提示：正確詞語含有「<strong>${hintChar}</strong>」字
        </div>
      `;
    } else if (this.usedHints === 1) {
      // 提示二：呼叫萌典 API 查詢第一個詞語的意思
      const word = q.words[0] || q.char;
      hintArea.innerHTML = `
        <div class="wd-hint wd-hint--2">
          🔍 查詢「${word}」的意思中...
        </div>
      `;
      this._fetchWordDefinition(word).then(def => {
        const area = document.getElementById('wd-hint-area');
        if (area) {
          area.innerHTML = `
            <div class="wd-hint wd-hint--2">
              🔑「<strong>${word}</strong>」：${def}
            </div>
          `;
        }
      });
    }
  }

  // ════════════════════════════════════════════
  // _fetchWordDefinition — 呼叫萌典 API 取得詞語釋義
  // API：https://www.moedict.tw/uni/{詞語}（已開放 CORS）
  // 回傳：釋義字串，失敗時回傳備用說明
  // ════════════════════════════════════════════
  async _fetchWordDefinition(word) {
    // 記憶體快取，避免重複查詢
    if (!this._defCache) this._defCache = {};
    if (this._defCache[word]) return this._defCache[word];

    try {
      const encoded = encodeURIComponent(word);
      const res = await fetch(`https://www.moedict.tw/uni/${encoded}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // 取第一個讀音的第一條釋義
      const def = data?.heteronyms?.[0]?.definitions?.[0]?.def
        || data?.heteronyms?.[0]?.definitions?.[0]?.quote?.[0]
        || '（查無釋義）';

      // 限制長度避免過長
      const shortDef = def.length > 50 ? def.substring(0, 50) + '...' : def;
      this._defCache[word] = shortDef;
      return shortDef;
    } catch (err) {
      console.warn(`words.js: 萌典查詢「${word}」失敗`, err);
      // 備援：從 vocabulary-data 取例句，將詞語挖空
      return this._getFallbackHint(word);
    }
  }

  // ════════════════════════════════════════════
  // _getFallbackHint — 萌典失敗時的備援提示
  // 從 AppState.vocabularyData 找到該詞語的例句，
  // 並將詞語本身挖空（顯示「＿」），讓學生猜測
  // ════════════════════════════════════════════
  _getFallbackHint(word) {
    // 嘗試從 vocabularyData（vocabulary-data.json）取例句
    const vocabData = AppState.vocabularyData || [];
    const entry = vocabData.find(v => v.word === word);

    if (entry && entry.phrases && entry.phrases.length > 0) {
      // 隨機取一個例句
      const phrase = entry.phrases[Math.floor(Math.random() * entry.phrases.length)];
      // 將詞語挖空（替換為底線）
      const blanked = phrase.replace(new RegExp(word, 'g'), '＿'.repeat(word.length));
      return `造句練習：「${blanked}」`;
    }

    // 完全備援：顯示詞語字數提示
    return `（這個詞語有 ${word.length} 個字）`;
  }

  // ════════════════════════════════════════════
  // _showCardFeedback — 顯示吃到卡片的短暫提示
  // ════════════════════════════════════════════
  _showCardFeedback(x, text) {
    const track = document.getElementById('wd-track');
    if (!track) return;
    const el = document.createElement('div');
    el.className = 'wd-eat-feedback';
    el.style.left = x + '%';
    el.style.top = '75%';
    el.textContent = text;
    track.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  // ════════════════════════════════════════════
  // _renderLives — 更新機會圖示
  // ════════════════════════════════════════════
  _renderLives() {
    const el = document.getElementById('wd-lives');
    if (!el) return;
    el.innerHTML = Array.from({ length: 3 }, (_, i) =>
      `<span class="wd-life ${i < this._lives ? 'wd-life--active' : 'wd-life--lost'}">❤️</span>`
    ).join('');
  }

  // ════════════════════════════════════════════
  // _updateHintButton
  // ════════════════════════════════════════════
  _updateHintButton() {
    const btn = document.getElementById('wd-hint-btn');
    if (!btn) return;
    const remaining = 2 - (this.usedHints || 0);
    btn.textContent = `💡 提示（剩 ${remaining} 次）`;
    btn.disabled = remaining <= 0;
  }

  // ════════════════════════════════════════════
  // _renderProgressBar
  // ════════════════════════════════════════════
  _renderProgressBar() {
    const fill = document.getElementById('wd-progress-fill');
    if (!fill || !this.questions) return;
    const pct = (this.currentIndex / this.questions.length) * 100;
    fill.style.width = pct + '%';
  }

  // ════════════════════════════════════════════
  // _stopAllAnimations
  // ════════════════════════════════════════════
  _stopAllAnimations() {
    this._animRunning = false;
    this._lastTs = null;
  }

  // ════════════════════════════════════════════
  // destroy
  // ════════════════════════════════════════════
  destroy() {
    this._stopAllAnimations();
    this._removeInputListeners();
    delete window.__wdHint;
    delete window.__wdSelectOption;
    super.destroy();
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─────────────────────────────────────────────
// CSS 動態注入
// ─────────────────────────────────────────────
(function injectWordsStyles() {
  if (document.getElementById('wd-game-styles')) return;
  const style = document.createElement('style');
  style.id = 'wd-game-styles';
  style.textContent = `
    .wd-game {
      position: relative;
      width: 100%;
      min-height: 100vh;
      background: linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: 'Noto Serif TC', serif;
      color: #e8f4f8;
      overflow: hidden;
    }

    /* ── 頂部 ── */
    .wd-header {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px 6px;
      background: rgba(0,0,0,0.3);
      backdrop-filter: blur(4px);
      flex-wrap: wrap;
    }
    .wd-char {
      font-size: 3rem;
      font-weight: 900;
      color: #f1c40f;
      text-shadow: 0 0 20px rgba(241,196,15,0.5);
      min-width: 3.5rem;
    }
    .wd-meta { flex: 1; }
    .wd-title { font-size: 0.95rem; margin-bottom: 4px; color: #bde0fe; }
    .wd-badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .wd-badge {
      padding: 3px 10px; border-radius: 16px;
      font-size: 0.75rem; font-weight: bold;
    }
    .wd-badge--mode       { background: #e67e22; color: #fff; }
    .wd-badge--hard       { background: #c62828; color: #fff; }
    .wd-badge--medium     { background: #e65100; color: #fff; }
    .wd-badge--easy       { background: #2e7d32; color: #fff; }
    .wd-badge--easy_plus  { background: #1565c0; color: #fff; }

    /* ── 機會 ── */
    .wd-lives {
      display: flex; gap: 4px; align-items: center;
    }
    .wd-life { font-size: 1.2rem; transition: opacity 0.3s; }
    .wd-life--lost { opacity: 0.25; filter: grayscale(1); }

    /* ── 進度條 ── */
    .wd-progress-bar {
      width: 90%; height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px; margin: 6px 0; overflow: hidden;
    }
    .wd-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #f1c40f, #e67e22);
      border-radius: 3px; transition: width 0.4s ease;
    }

    /* ── 賽車跑道 ── */
    .wd-track {
      position: relative;
      width: 95%; height: 300px;
      background: linear-gradient(180deg, #1a1a2e 0%, #2c3e50 100%);
      border-radius: 12px;
      border: 2px solid rgba(241,196,15,0.3);
      overflow: hidden;
      margin: 8px 0;
    }

    /* 跑道線條 */
    .wd-lane-lines {
      position: absolute; top: 0; bottom: 0;
      left: 0; right: 0; pointer-events: none;
    }
    .wd-line {
      position: absolute; top: 0; bottom: 0;
      width: 3px;
      background: repeating-linear-gradient(
        to bottom,
        rgba(255,255,255,0.3) 0px, rgba(255,255,255,0.3) 20px,
        transparent 20px, transparent 40px
      );
      animation: wd-lane-scroll 1s linear infinite;
    }
    .wd-line--1 { left: 33%; }
    .wd-line--2 { left: 66%; }
    @keyframes wd-lane-scroll {
      from { background-position: 0 0; }
      to   { background-position: 0 40px; }
    }

    /* ── 詞語卡片 ── */
    .wd-card {
      position: absolute;
      transform: translateX(-50%);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 1.1rem;
      font-weight: bold;
      border: 2px solid;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .wd-card--correct {
      background: rgba(39,174,96,0.85);
      border-color: #2ecc71;
      color: #fff;
    }
    .wd-card--wrong {
      background: rgba(192,57,43,0.85);
      border-color: #e74c3c;
      color: #fff;
    }

    /* ── 賽車 ── */
    .wd-car {
      position: absolute;
      bottom: 8%;
      transform: translateX(-50%);
      font-size: 2.5rem;
      z-index: 10;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
      transition: none;
    }
    .wd-car--crash {
      animation: wd-crash 0.5s ease;
    }
    @keyframes wd-crash {
      0%, 100% { transform: translateX(-50%) rotate(0); }
      25%       { transform: translateX(calc(-50% - 10px)) rotate(-10deg); }
      75%       { transform: translateX(calc(-50% + 10px)) rotate(10deg); }
    }

    /* ── 吃到提示 ── */
    .wd-eat-feedback {
      position: absolute;
      transform: translateX(-50%);
      font-size: 1.5rem;
      font-weight: bold;
      pointer-events: none;
      animation: wd-eat-anim 0.7s ease forwards;
      z-index: 20;
    }
    @keyframes wd-eat-anim {
      0%   { opacity: 1; transform: translateX(-50%) translateY(0); }
      100% { opacity: 0; transform: translateX(-50%) translateY(-40px); }
    }

    /* ── 模式二選擇題 ── */
    .wd-choice-area {
      width: 90%; max-width: 400px;
      margin: 16px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .wd-blank-word {
      font-size: 2rem;
      font-weight: bold;
      color: #f1c40f;
      background: rgba(255,255,255,0.05);
      padding: 12px 24px;
      border-radius: 12px;
      letter-spacing: 6px;
    }
    .wd-blank-display { color: #bde0fe; }

    .wd-options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      width: 100%;
    }
    .wd-option-btn {
      padding: 16px 8px;
      border: 2px solid rgba(241,196,15,0.4);
      border-radius: 12px;
      background: rgba(255,255,255,0.05);
      cursor: pointer;
      font-family: inherit;
      transition: border-color 0.2s, background 0.2s, transform 0.15s;
    }
    .wd-option-btn:hover, .wd-option-btn:focus {
      border-color: #f1c40f;
      background: rgba(241,196,15,0.15);
      transform: scale(1.03);
    }
    .wd-option-btn:active { transform: scale(0.97); }
    .wd-opt-char { font-size: 1.6rem; color: #e8f4f8; }
    .wd-option--correct {
      border-color: #2ecc71 !important;
      background: rgba(46,204,113,0.2) !important;
      box-shadow: 0 0 12px rgba(46,204,113,0.4);
    }

    /* ── 已吃到計數 ── */
    .wd-eaten-count {
      font-size: 0.85rem;
      color: #7f8c8d;
      margin: 4px 0;
    }

    /* ── 提示區 ── */
    .wd-hint-area { width: 90%; min-height: 40px; margin: 6px 0; }
    .wd-hint {
      padding: 10px 14px; border-radius: 8px;
      font-size: 0.92rem; animation: wd-appear 0.3s ease;
    }
    .wd-hint--1 { background: rgba(241,196,15,0.15); border-left: 4px solid #f1c40f; }
    .wd-hint--2 { background: rgba(52,152,219,0.15); border-left: 4px solid #3498db; }
    .wd-answer-reveal {
      padding: 10px 14px; border-radius: 8px;
      background: rgba(46,204,113,0.15);
      border-left: 4px solid #2ecc71;
      font-size: 0.92rem; animation: wd-appear 0.3s ease;
    }

    /* ── 控制提示 ── */
    .wd-track-controls { width: 90%; text-align: center; }
    .wd-tip { font-size: 0.78rem; color: #7f8c8d; }

    /* ── 控制按鈕 ── */
    .wd-controls {
      display: flex; gap: 10px; margin: 6px 0;
    }
    .wd-btn {
      padding: 10px 22px; border: none; border-radius: 22px;
      font-size: 0.9rem; cursor: pointer; font-family: inherit;
      transition: transform 0.15s;
    }
    .wd-btn:active { transform: scale(0.95); }
    .wd-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .wd-btn--hint { background: #e67e22; color: #fff; }

    /* ── 回饋 ── */
    .wd-feedback {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; opacity: 0;
      transition: opacity 0.2s; z-index: 50;
    }
    .wd-feedback--show { opacity: 1; }
    .wd-correct-text {
      font-size: 2.5rem; font-weight: 900;
      color: #f1c40f; text-shadow: 0 0 20px rgba(241,196,15,0.8);
      animation: wd-appear 0.3s ease;
    }

    @keyframes wd-appear {
      from { opacity: 0; transform: scale(0.8); }
      to   { opacity: 1; transform: scale(1); }
    }

    @media (max-width: 480px) {
      .wd-track { height: 240px; }
      .wd-char { font-size: 2.2rem; }
      .wd-blank-word { font-size: 1.6rem; }
    }
    
      /* ── RWD 平板（≥600px）── */
      @media (min-width: 600px) {
        .wd-char          { font-size: 3.8rem; }
        .wd-choice-area   { max-width: 520px; }
      }
/* ── RWD 桌面（≥1024px）── */
    @media (min-width: 1024px) {
      .wd-game { max-width: 760px; margin: 0 auto; }
    }
  `;
  document.head.appendChild(style);
})();

export default WordsGame;
