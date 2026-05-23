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
import { JSONLoader } from '../json_loader.js';

// ─────────────────────────────────────────────
// 飛機移動速度（px/ms，依遺忘等級）
// hard 最慢（飛機難以精準操控），easy_plus 最快
// ─────────────────────────────────────────────
// 炮台角速度（deg/幀）
const CANNON_ANG_SPEEDS = {
  hard:      1.0,
  medium:    1.4,
  easy:      1.8,
  easy_plus: 2.2,
};

// 泡泡（答案選項）的數量上限
const MAX_BUBBLES = 5;

// 泡泡漂浮區高度（相對於遊戲區域）
const BUBBLE_AREA_HEIGHT_RATIO = 0.6;

export class PolyphoneGame extends GameEngine {
  constructor() {
    super('polyphone');

    // ── 炮台狀態 ──
    this._cannonAngle = 90;      // 炮台角度（度，90=直上）
    this._cannonX     = 50;      // 炮台 X（%，可左右移動）
    this._missiles    = [];      // 飛行中子彈
    this._missileId   = 0;
    this._planeLanded = false;   // GameEngine 相容

    // ── 泡泡狀態 ──
    this._bubbles = [];
    this._bubbleIdCounter = 0;

    // ── 輸入狀態 ──
    this._keysDown    = {};
    this._touchStartX = null;
    this._lastTouchX  = null;
    this._wrongCount  = 0;

    // ── 題目資料 ──
    this._correctPronunciation = '';
    this._allReadings = [];

    // ── 動畫狀態 ──
    this._gameAnimRunning = false;
    this._lastTs = null;

    // ── 事件監聽器參考 ──
    this._onKeyDown = null;
    this._onKeyUp   = null;
    this._onTouchStart = null;
    this._onTouchMove  = null;
    this._onTouchEnd = null;
  }

  // ════════════════════════════════════════════
  // _renderBubbleZhuyin — 泡泡注音 HTML（pv2 系統）
  // 與 CardPage._renderZhuyinVerticalInline 完全一致
  // ════════════════════════════════════════════
  _renderBubbleZhuyin(pron) {
    if (!pron) return '';

    const INITIALS = new Set('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ');
    const MEDIALS  = new Set('ㄧㄨㄩ');
    const TONES    = new Set(['ˊ','ˇ','ˋ','˙']);
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;');

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

    const count  = [initial, medial, final].filter(Boolean).length;
    const hasDot = tone === '˙';
    const dotHtml  = hasDot
      ? `<span class="pv2-dot">${esc(tone)}</span>` : '';
    const toneHtml = (tone && !hasDot)
      ? `<span class="pv2-tone">${esc(tone)}</span>`
      : `<span class="pv2-tone pv2-empty"></span>`;
    const toneCol  = `<span class="pv2-tone-col">` +
      `<span class="pv2-empty pv2-tone-spacer"></span>` +
      toneHtml +
      `<span class="pv2-empty pv2-tone-spacer"></span></span>`;
    const dotCls = hasDot ? ' pv2--dot' : '';

    if (count <= 1) {
      const sym = initial || medial || final || src;
      return `<span class="pv2 pv2-a${dotCls}">${dotHtml}` +
        `<span class="pv2-col"><span class="pv2-r1 pv2-empty"></span>` +
        `<span class="pv2-r2">${esc(sym)}</span>` +
        `<span class="pv2-r3 pv2-empty"></span></span>${toneCol}</span>`;
    }
    if (count === 2) {
      const slots = [initial, medial, final].filter(Boolean);
      return `<span class="pv2 pv2-b${dotCls}">${dotHtml}` +
        `<span class="pv2-col"><span class="pv2-r1">${esc(slots[0])}</span>` +
        `<span class="pv2-r2 pv2-empty"></span>` +
        `<span class="pv2-r3">${esc(slots[1])}</span></span>${toneCol}</span>`;
    }
    return `<span class="pv2 pv2-c${dotCls}">${dotHtml}` +
      `<span class="pv2-col"><span class="pv2-r1">${esc(initial)}</span>` +
      `<span class="pv2-r2">${esc(medial)}</span>` +
      `<span class="pv2-r3">${esc(final)}</span></span>${toneCol}</span>`;
  }

  // ════════════════════════════════════════════
  // loadQuestions — 從 polyphones.json 載入多音字資料
  // ════════════════════════════════════════════
  async loadQuestions() {
    // 取得多音字資料（polyphones.json 為陣列格式 [{字, pronunciations}]）
    // 優先從 JSONLoader 快取取得；若未載入則先觸發載入
    let rawPolyArr = JSONLoader.get('polyphones') || [];
    if (!Array.isArray(rawPolyArr) || rawPolyArr.length === 0) {
      await JSONLoader.load('polyphones');
      rawPolyArr = JSONLoader.get('polyphones') || [];
    }

    if (rawPolyArr.length === 0) {
      throw new Error('polyphone: 無多音字資料');
    }

    // 將陣列轉換為字典：{ 中: { readings: [...] }, ... }
    // polyphones.json 欄位為 pronunciations，統一對應到 readings
    const polyData = {};
    for (const entry of rawPolyArr) {
      const ch = entry['字'] || entry.char;
      const readings = entry.pronunciations || entry.readings;
      if (ch && Array.isArray(readings) && readings.length >= 2) {
        polyData[ch] = { readings };
      }
    }

    const allPolyKeys = Object.keys(polyData);

    if (allPolyKeys.length === 0) {
      throw new Error('polyphone: 無有效多音字資料');
    }

    // 候選字：先從生字簿中過濾出多音字
    const chars = (this.questionChars || []).filter(c => polyData[c]);

    // 若生字簿中無多音字，改用所有多音字隨機取樣
    const sourceChars = chars.length > 0 ? chars : allPolyKeys;

    const TOTAL = this.totalQuestions || 10;
    const MIN_PER_READING = 2; // 每個讀音最少出幾題

    // 先為每個字的每個讀音各建至少 MIN_PER_READING 題
    const pool = [];
    for (const char of sourceChars) {
      const poly = polyData[char];
      if (!poly || !poly.readings || poly.readings.length < 2) continue;

      for (const reading of poly.readings) {
        for (let i = 0; i < MIN_PER_READING; i++) {
          // 每次從該讀音的詞語中隨機選一個，增加多樣性
          const words = reading.words || [];
          const exampleWord = words[i % Math.max(words.length, 1)] || char;
          pool.push({
            char,
            targetPronunciation: reading.zhuyin,
            exampleWord,
            allReadings: poly.readings,
            level: 'medium',
          });
        }
      }
    }

    // 打亂題庫
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // 若不足 TOTAL 題，循環補足
    const questions = [];
    let idx = 0;
    while (questions.length < TOTAL) {
      questions.push({ ...pool[idx % pool.length] });
      idx++;
    }
    questions.length = TOTAL;

    this.questions = questions;
    return this.questions;
  }

  // ══════════════════════════════════════════════════════
  // 炮台 Bubble Shooter 架構
  // ══════════════════════════════════════════════════════

  // constructor 欄位（覆蓋飛機相關，改為炮台）
  _cannonAngle = 90;   // 炮台角度（度，90=直上，0=右，180=左）
  _cannonX     = 50;   // 炮台 X 位置（%，可左右移動）
  _missiles    = [];   // 飛行中的子彈 [{x,y,vx,vy,id}]
  _missileId   = 0;
  _bubbles     = [];
  _bubbleIdCounter = 0;
  _gameAnimRunning = false;
  _lastTs      = null;
  _wrongCount  = 0;
  _correctPronunciation = '';
  _allReadings = [];
  _keysDown    = {};
  _onKeyDown   = null;
  _onKeyUp     = null;
  _onTouchStart= null;
  _onTouchMove = null;
  _onTouchEnd  = null;
  _planeLanded = false;  // GameEngine 相容欄位

  // ════════════════════════════════════════════
  // renderQuestion
  // ════════════════════════════════════════════
  renderQuestion() {
    const q = this.currentQuestion;
    if (!q) return;

    this._stopAllAnimations();
    this._removeInputListeners();

    this._wrongCount = 0;
    this._planeLanded = false;
    this._correctPronunciation = q.targetPronunciation;
    this._allReadings = q.allReadings;
    this._cannonAngle = 90;
    this._missiles = [];

    const appEl = this._getContainer();
    if (!appEl) return;

    appEl.innerHTML = this._buildHTML(q);
    this._renderProgressBar();
    this._updateHintButton();
    this._initBubbles(q);

    this._gameAnimRunning = true;
    this._lastTs = null;
    requestAnimationFrame(ts => this._gameLoop(ts));
    this._bindInputEvents();
  }

  // ════════════════════════════════════════════
  // _buildHTML
  // ════════════════════════════════════════════
  _buildHTML(q) {
    const levelLabel = { hard: '困難', medium: '中等', easy: '簡單', easy_plus: '加強' }[q.level] || '中等';
    return `
      <div class="pp-game" id="pp-game-root">
        <div class="pp-header">
          <div class="pp-word-display">
            <span class="pp-word-text" id="pp-word-text">${q.exampleWord}</span>
            <span class="pp-char-highlight">「${q.char}」怎麼念？</span>
          </div>
          <div class="pp-badges">
            <span class="pp-badge pp-badge--${q.level}">${levelLabel}</span>
          </div>
        </div>

        <div class="pp-progress-bar">
          <div class="pp-progress-fill" id="pp-progress-fill"></div>
        </div>

        <!-- 遊戲天空 -->
        <div class="pp-sky" id="pp-sky">
          <div id="pp-bubbles-layer"></div>
          <canvas id="pp-cannon-canvas" class="pp-cannon-canvas"></canvas>
        </div>

        <!-- 提示區 -->
        <div class="pp-hint-area" id="pp-hint-area"></div>

        <!-- 操控說明 -->
        <div class="pp-controls">
          <span class="pp-control-tip">
            📱 左右拖動，點擊發射 &nbsp;|&nbsp; ⌨️ ←→ 移動，空白鍵發射
          </span>
          <button class="pp-btn pp-btn--hint" id="pp-hint-btn"
                  onclick="window.__ppHint()">
            💡 提示（剩 ${2 - (this.usedHints || 0)} 次）
          </button>
        </div>

        <div class="pp-feedback" id="pp-feedback"></div>
      </div>
    `;
  }

  // ════════════════════════════════════════════
  // _initBubbles
  // ════════════════════════════════════════════
  _initBubbles(q) {
    this._bubbles = [];
    const readings = q.allReadings.slice(0, MAX_BUBBLES);
    // 打亂順序，避免正確答案每次同位置
    for (let i = readings.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [readings[i], readings[j]] = [readings[j], readings[i]];
    }
    const count = readings.length;

    readings.forEach((r, i) => {
      const xBase = (100 / (count + 1)) * (i + 1);
      const yBase = 8 + (i % 3) * 14;
      this._bubbles.push({
        id: ++this._bubbleIdCounter,
        text: r.zhuyin,
        label: r.label || r.zhuyin,
        words: r.words || [],
        isCorrect: r.zhuyin === q.targetPronunciation,
        x: xBase,   // %
        y: yBase,   // %
        vy: 0.006 + Math.random() * 0.004,
        phase: Math.random() * Math.PI * 2,
        radius: 38, // px，用於碰撞
        exploded: false,
      });
    });

    this._renderBubbles();
  }

  // ════════════════════════════════════════════
  // _renderBubbles — 注音泡泡 DOM
  // ════════════════════════════════════════════
  _renderBubbles() {
    const layer = document.getElementById('pp-bubbles-layer');
    if (!layer) return;
    layer.innerHTML = this._bubbles
      .filter(b => !b.exploded)
      .map(b => `
        <div class="pp-bubble ${b.isCorrect ? 'pp-bubble--correct-hint' : ''}"
             id="pp-bubble-${b.id}"
             style="left:${b.x}%;top:${b.y}%"
             data-id="${b.id}">
          <div class="pp-bubble-text bpmf-font">${this._renderBubbleZhuyin(b.text)}</div>
        </div>
      `).join('');
  }

  // ════════════════════════════════════════════
  // _gameLoop
  // ════════════════════════════════════════════
  _gameLoop(timestamp) {
    if (!this._gameAnimRunning) return;

    if (this._lastTs === null) this._lastTs = timestamp;
    const delta = Math.min(timestamp - this._lastTs, 50);
    this._lastTs = timestamp;

    const sky = document.getElementById('pp-sky');
    const skyW = sky?.clientWidth  || 300;
    const skyH = sky?.clientHeight || 340;

    // ── 更新泡泡漂浮 ──
    for (const b of this._bubbles) {
      if (b.exploded) continue;
      b.phase += 0.001 * delta;
      b.y += b.vy * delta;
      if (b.y > 70) b.y = 5;
      const swayX = Math.sin(b.phase) * 1.8;
      const el = document.getElementById(`pp-bubble-${b.id}`);
      if (el) {
        el.style.left = (b.x + swayX) + '%';
        el.style.top  = b.y + '%';
      }
    }

    // ── 更新子彈飛行 + 碰撞 ──
    const toRemove = [];
    for (const m of this._missiles) {
      m.x += m.vx * delta;
      m.y += m.vy * delta;

      const el = document.getElementById(`pp-m-${m.id}`);
      if (el) {
        el.style.left = m.x + '%';
        el.style.top  = m.y + '%';
        // 保持旋轉方向
        const rot = (m.angle || 90) - 90;
        el.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
      }

      // 出界移除
      if (m.y < -5 || m.x < -5 || m.x > 105) {
        toRemove.push(m.id);
        el?.remove();
        continue;
      }

      // 碰撞偵測
      for (const b of this._bubbles) {
        if (b.exploded) continue;
        const bEl = document.getElementById(`pp-bubble-${b.id}`);
        const bxActual = bEl ? parseFloat(bEl.style.left) : b.x;
        const byActual = bEl ? parseFloat(bEl.style.top)  : b.y;
        const dx = m.x - bxActual;
        const dy = (m.y / 100 * skyH) - (byActual / 100 * skyH);
        // 以 % 計算距離閾值（泡泡半徑約 38px / skyW）
        const threshold = (38 / skyW) * 100 + 3;
        if (Math.abs(dx) < threshold && Math.abs(dy) < 38) {
          toRemove.push(m.id);
          el?.remove();
          this.submitAnswer(b.text);
          break;
        }
      }
    }
    this._missiles = this._missiles.filter(m => !toRemove.includes(m.id));

    // ── 繪製炮台 ──
    this._drawCannon(skyW, skyH);

    requestAnimationFrame(ts => this._gameLoop(ts));
  }

  // ════════════════════════════════════════════
  // _drawCannon — 用 Canvas 畫炮台
  // ════════════════════════════════════════════
  _drawCannon(skyW, skyH) {
    const canvas = document.getElementById('pp-cannon-canvas');
    if (!canvas) return;
    canvas.width  = skyW;
    canvas.height = skyH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, skyW, skyH);

    const cx = skyW * (this._cannonX / 100);
    const cy = skyH * 0.88;
    const angleRad = ((this._cannonAngle - 90) * Math.PI) / 180;

    // 炮台底座
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    const baseGrad = ctx.createRadialGradient(cx-5, cy-5, 2, cx, cy, 22);
    baseGrad.addColorStop(0, '#60a5fa');
    baseGrad.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 炮管
    const barrelLen = 42;
    const barrelW   = 10;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);
    const barrelGrad = ctx.createLinearGradient(-barrelW/2, 0, barrelW/2, 0);
    barrelGrad.addColorStop(0, '#1e40af');
    barrelGrad.addColorStop(0.5, '#60a5fa');
    barrelGrad.addColorStop(1, '#1e40af');
    ctx.fillStyle = barrelGrad;
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-barrelW/2, -barrelLen, barrelW, barrelLen, [4, 4, 2, 2]);
    ctx.fill();
    ctx.stroke();

    // 炮口發光
    ctx.beginPath();
    ctx.arc(0, -barrelLen, 5, 0, Math.PI * 2);
    const muzzleGrad = ctx.createRadialGradient(0, -barrelLen, 0, 0, -barrelLen, 8);
    muzzleGrad.addColorStop(0, 'rgba(147,197,253,1)');
    muzzleGrad.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = muzzleGrad;
    ctx.fill();
    ctx.restore();

    // 瞄準虛線
    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(147,197,253,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const dx = Math.cos(angleRad - Math.PI/2);
    const dy = Math.sin(angleRad - Math.PI/2);
    ctx.moveTo(cx + dx * 50, cy + dy * 50);
    ctx.lineTo(cx + dx * skyH, cy + dy * skyH);
    ctx.stroke();
    ctx.restore();
  }

  // ════════════════════════════════════════════
  // _fireMissile — 發射子彈
  // ════════════════════════════════════════════
  _fireMissile() {
    if (this.isAnswering) return;

    AudioManager.playEffect('fight').catch(() => {});

    const sky = document.getElementById('pp-sky');
    const skyW = sky?.clientWidth  || 300;
    const skyH = sky?.clientHeight || 340;

    // 子彈初始位置：炮口
    const cx = this._cannonX;
    const cy = 88; // % — 炮台 Y

    // cannonAngle: 90=直上, 0=右, 180=左（與 Canvas 定義一致）
    // 轉換到螢幕方向：x% 和 y% 直接計算
    // angle=90 → sin(90°)=1向右，cos(90°)=0，但我們要直上
    // 使用標準數學角：從"上"算起，順時針為正
    const angleDeg = this._cannonAngle; // 90=up, <90=left, >90=right
    const rad = (angleDeg - 90) * Math.PI / 180; // 0 = straight up

    // 天空寬高比（px），補正 x/y % 到實際距離比
    const aspectX = skyW / 100; // px per %x
    const aspectY = skyH / 100; // px per %y
    const speed = 0.13; // px/ms（實際像素速度，加速版）

    const vx = Math.sin(rad) * speed / aspectX; // %/ms
    const vy = -Math.cos(rad) * speed / aspectY; // %/ms，負=向上

    const id = ++this._missileId;
    this._missiles.push({ id, x: cx, y: cy, vx, vy, angle: angleDeg });

    // 建立子彈 DOM
    const missileEl = document.createElement('div');
    missileEl.id = `pp-m-${id}`;
    missileEl.className = 'pp-shot';
    missileEl.style.left = cx + '%';
    missileEl.style.top  = cy + '%';
    // 旋轉子彈方向，與炮管方向一致
    const shotRot = angleDeg - 90; // 0=直上
    missileEl.style.transform = `translate(-50%, -50%) rotate(${shotRot}deg)`;
    sky?.appendChild(missileEl);
  }

  // ════════════════════════════════════════════
  // _bindInputEvents
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
    this._onKeyUp = (e) => { delete this._keysDown[e.key]; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);

    // 連續按鍵移動炮台底座
    const BASE_SPEED = 0.25; // %/frame — 底座橫移速度
    const keyLoop = () => {
      if (!this._gameAnimRunning) return;
      if (this._keysDown['ArrowLeft']  || this._keysDown['Left'])
        this._cannonX = Math.max(8,  this._cannonX - BASE_SPEED);
      if (this._keysDown['ArrowRight'] || this._keysDown['Right'])
        this._cannonX = Math.min(92, this._cannonX + BASE_SPEED);
      requestAnimationFrame(keyLoop);
    };
    requestAnimationFrame(keyLoop);

    // 觸控：滑動改角度，點擊發射
    const sky = document.getElementById('pp-sky');
    if (sky) {
      this._onTouchStart = (e) => {
        this._touchStartX = e.touches[0].clientX;
        this._lastTouchX  = this._touchStartX;
        this._touchStartTime = Date.now();
      };
      this._onTouchMove = (e) => {
        if (this._lastTouchX === null) return;
        const dx = e.touches[0].clientX - this._lastTouchX;
        this._lastTouchX = e.touches[0].clientX;
        const sky2 = document.getElementById('pp-sky');
        const skyW2 = sky2?.clientWidth || 300;
        // 觸控拖移底座橫向移動
        const dxPct = (dx / skyW2) * 100;
        this._cannonX = Math.max(8, Math.min(92, this._cannonX + dxPct));
        e.preventDefault();
      };
      this._onTouchEnd = (e) => {
        const totalDx = Math.abs(e.changedTouches[0].clientX - (this._touchStartX || 0));
        if (totalDx < 10) this._fireMissile(); // 短點擊 = 發射
        this._touchStartX = null;
        this._lastTouchX  = null;
      };
      sky.addEventListener('touchstart', this._onTouchStart, { passive: false });
      sky.addEventListener('touchmove',  this._onTouchMove,  { passive: false });
      sky.addEventListener('touchend',   this._onTouchEnd);
    }

    window.__ppHint = () => this.useHint();
  }

  // ════════════════════════════════════════════
  // _removeInputListeners
  // ════════════════════════════════════════════
  _removeInputListeners() {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp)   window.removeEventListener('keyup',   this._onKeyUp);
    const sky = document.getElementById('pp-sky');
    if (sky && this._onTouchStart) {
      sky.removeEventListener('touchstart', this._onTouchStart);
      sky.removeEventListener('touchmove',  this._onTouchMove);
      sky.removeEventListener('touchend',   this._onTouchEnd);
    }
    this._onKeyDown = this._onKeyUp = this._onTouchStart =
    this._onTouchMove = this._onTouchEnd = null;
    this._keysDown = {};
  }

  // ════════════════════════════════════════════
  // _showMissileEffect (空射視覺，炮台模式已由 DOM 子彈處理)
  // ════════════════════════════════════════════
  _showMissileEffect() {}

  // ════════════════════════════════════════════
  // _stopAllAnimations
  // ════════════════════════════════════════════
  _stopAllAnimations() {
    this._gameAnimRunning = false;
    this._lastTs = null;
    // 清除所有飛行中子彈 DOM
    const sky = document.getElementById('pp-sky');
    sky?.querySelectorAll('.pp-shot').forEach(el => el.remove());
    this._missiles = [];
  }

  // ════════════════════════════════════════════
  // destroy
  // ════════════════════════════════════════════
  destroy() {
    this._stopAllAnimations();
    this._removeInputListeners();
  }

  async judgeAnswer(selectedText) {
    const correct = selectedText === this._correctPronunciation;
    return { correct };
  }

  // ════════════════════════════════════════════
  // onCorrect（覆寫）— 不需額外動作，由 playCorrectAnimation 處理爆炸
  // ════════════════════════════════════════════
  async onCorrect(result) {
    // 直接呼叫父類；爆炸效果由 playCorrectAnimation() 覆寫處理
    await super.onCorrect(result);
    // 多音判斷專屬 bonus：連續對 10 題 +1★
    const c = this.consecutiveCorrect;
    if (c > 0 && c % 10 === 0) {
      try {
        const { StarsManager } = await import('../stars.js');
        await StarsManager.add(1, 'yellow');
      } catch (_e) {}
      // 顯示 bonus 提示
      const bonusBar = document.getElementById('game-bonus-bar');
      if (bonusBar) {
        bonusBar.textContent = `連續答對：${c} 題 bonus★+1 🎉`;
        bonusBar.style.display = 'block';
      }
    }
  }

  // 覆寫 updateProgress：多音判斷不使用預設連續3/5/10題bonus顯示，只在10倍數顯示
  updateProgress() {
    super.updateProgress();
    // 蓋掉 GameEngine 預設 bonus bar（只有 10 的倍數才在 onCorrect 裡顯示）
    const bonusBar = document.getElementById('game-bonus-bar');
    if (bonusBar) {
      const c = this.consecutiveCorrect;
      if (c > 0 && c % 10 === 0) {
        // 剛好 10 倍數：保留 onCorrect 設的文字
      } else {
        bonusBar.style.display = 'none';
      }
    }
  }

  // ════════════════════════════════════════════
  // playCorrectAnimation — 爆炸特效（由 GameEngine.onCorrect 呼叫）
  // ════════════════════════════════════════════
  async playCorrectAnimation() {
    // 標記命中的泡泡爆炸
    const hitBubble = this._bubbles.find(b => b.text === this._correctPronunciation);
    if (hitBubble) {
      hitBubble.exploded = true;
      this._showExplosion(hitBubble.x, hitBubble.y);
      AudioManager.playEffect('bubble').catch(() => {});
    }

    const feedback = document.getElementById('pp-feedback');
    if (feedback) {
      feedback.innerHTML = '<div class="pp-correct-text">💥 命中！</div>';
      feedback.classList.add('pp-feedback--show');
    }
    await this._delay(600);
    if (feedback) feedback.classList.remove('pp-feedback--show');
  }

  // ════════════════════════════════════════════
  // playWrongAnimation — 飛機彈開（shake）
  // ════════════════════════════════════════════
  async playWrongAnimation() {
    this._wrongCount++;
    const canvas = document.getElementById('pp-cannon-canvas');
    if (canvas) {
      canvas.style.filter = 'hue-rotate(180deg) brightness(2)';
      await this._delay(300);
      canvas.style.filter = '';
    }
  }

  // ════════════════════════════════════════════
  // showCorrectAnswer — 答錯兩次：飛機降落，顯示正確讀音
  // ════════════════════════════════════════════
  async showCorrectAnswer() {
    const q = this.currentQuestion;
    if (!q) return;

    this._planeLanded = true; // 暫停發射

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

    await this._delay(2000);
    this._planeLanded = false;
    await this.nextQuestion();
  }

  // ════════════════════════════════════════════
  // getHint
  //   提示一：顯示其他讀音的詞語（讓學生對比）
  //   提示二：高亮正確聲調
  // ════════════════════════════════════════════
  getHint() {
    const q = this.currentQuestion;
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
    const sky = document.getElementById('pp-sky');
    if (!sky) return;
    const exp = document.createElement('div');
    exp.className = 'pp-explosion-particle';
    exp.style.left = x + '%';
    exp.style.top  = y + '%';
    exp.textContent = '💥';
    sky.appendChild(exp);
    setTimeout(() => exp.remove(), 650);
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

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// CSS 動態注入
// ─────────────────────────────────────────────
(function injectPolyphoneStyles() {
  if (document.getElementById('pp-game-styles')) return;
  const style = document.createElement('style');
  style.id = 'pp-game-styles';
  style.textContent = `
    /* ── 整體容器 ── */
    .pp-game {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-family: var(--font-main, 'Noto Sans TC', sans-serif);
      user-select: none;
      -webkit-user-select: none;
    }

    /* ── 題目標頭 ── */
    .pp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      gap: 8px;
    }
    .pp-word-display {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pp-word-text {
      font-size: 1.6rem;
      font-weight: 900;
      color: #1e3a8a;
      letter-spacing: 0.05em;
    }
    .pp-char-highlight {
      font-size: 0.9rem;
      color: #475569;
    }
    .pp-badge {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 2px 10px;
      border-radius: 99px;
      color: #fff;
    }
    .pp-badge--hard      { background: #ef4444; }
    .pp-badge--medium    { background: #f97316; }
    .pp-badge--easy      { background: #22c55e; }
    .pp-badge--easy_plus { background: #3b82f6; }

    /* ── 進度條 ── */
    .pp-progress-bar {
      height: 5px;
      background: #e2e8f0;
      border-radius: 3px;
      overflow: hidden;
      margin: 0 6px;
    }
    .pp-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      border-radius: 3px;
      transition: width 0.5s ease;
    }

    /* ── 天空遊戲場景 ── */
    .pp-sky {
      position: relative;
      width: 100%;
      height: 340px;
      overflow: hidden;
      border-radius: 14px;
      background:
        radial-gradient(ellipse 80px 40px at 12% 18%, rgba(255,255,255,0.7) 0%, transparent 70%),
        radial-gradient(ellipse 60px 30px at 68% 12%, rgba(255,255,255,0.6) 0%, transparent 70%),
        radial-gradient(ellipse 100px 50px at 88% 32%, rgba(255,255,255,0.5) 0%, transparent 70%),
        linear-gradient(180deg, #0f172a 0%, #1e3a8a 40%, #1d4ed8 100%);
      box-shadow: 0 4px 20px rgba(0,0,50,0.3);
    }

    /* Canvas 炮台（覆蓋整個天空，pointer-events:none 讓觸控穿透到 sky） */
    .pp-cannon-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    }

    /* ── 泡泡 ── */
    #pp-bubbles-layer {
      position: absolute;
      inset: 0;
      z-index: 5;
    }
    .pp-bubble {
      position: absolute;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 35% 35%,
        rgba(255,255,255,0.9) 0%,
        rgba(147,197,253,0.6) 40%,
        rgba(30,64,175,0.5) 100%);
      border: 2.5px solid rgba(147,197,253,0.8);
      box-shadow:
        0 0 12px rgba(0,180,255,0.4),
        inset 0 2px 4px rgba(255,255,255,0.6);
      cursor: pointer;
      transition: box-shadow 0.2s, transform 0.15s;
    }
    .pp-bubble:hover {
      transform: translate(-50%, -50%) scale(1.08);
      box-shadow: 0 0 20px rgba(0,200,255,0.7), inset 0 2px 4px rgba(255,255,255,0.6);
    }
    .pp-bubble-text {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 2.4rem;
      color: #1e3a8a;
    }

    /* 提示：高亮正確聲調 */
    .pp-bubble--tone-hint {
      box-shadow: 0 0 24px 6px rgba(255,215,0,0.9);
      border-color: #ffd700;
    }

    /* 答錯二次顯示正確答案 */
    .pp-bubble--reveal {
      box-shadow: 0 0 30px 10px rgba(0,255,100,0.8);
      border-color: #00ff64;
    }

    /* ── 子彈（發射後的 DOM 元素）── */
    .pp-shot {
      position: absolute;
      width: 12px;
      height: 28px;
      border-radius: 6px 6px 3px 3px;
      transform: translate(-50%, -50%);
      background: linear-gradient(to top,
        rgba(0,229,255,0.4) 0%,
        rgba(0,229,255,1)   20%,
        #b0f0ff             50%,
        #ffffff             65%,
        rgba(0,229,255,1)   85%
      );
      box-shadow:
        0 0 10px 4px rgba(0,229,255,1),
        0 0 24px 8px rgba(0,160,255,0.8),
        0 0 40px 12px rgba(0,100,255,0.4);
      z-index: 15;
      pointer-events: none;
    }

    /* ── 爆炸 ── */
    .pp-explosion-particle {
      position: absolute;
      pointer-events: none;
      font-size: 2rem;
      transform: translate(-50%, -50%);
      animation: pp-explode 0.6s ease-out forwards;
      z-index: 20;
    }
    @keyframes pp-explode {
      0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      60%  { transform: translate(-50%, -50%) scale(1.4); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(2);   opacity: 0; }
    }

    /* ── 提示區 ── */
    .pp-hint-area {
      min-height: 32px;
      padding: 0 8px;
    }
    .pp-hint, .pp-answer-reveal {
      padding: 6px 12px;
      border-radius: 10px;
      font-size: 0.82rem;
      font-weight: 600;
      line-height: 1.5;
    }
    .pp-hint--1 { background: #fef9c3; color: #713f12; border: 1px solid #fde047; }
    .pp-hint--2 { background: #dbeafe; color: #1e3a8a; border: 1px solid #93c5fd; }
    .pp-answer-reveal { background: #dcfce7; color: #14532d; border: 1px solid #86efac; }

    /* ── 操控說明 ── */
    .pp-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pp-control-tip { font-size: 0.72rem; color: #64748b; }
    .pp-btn--hint {
      padding: 5px 12px;
      border-radius: 20px;
      border: none;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: #fff;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .pp-btn--hint:hover { opacity: 0.85; }

    /* ── 回饋 ── */
    .pp-feedback {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 100;
    }
    .pp-feedback--show { animation: pp-feedback-pop 0.5s ease forwards; }
    @keyframes pp-feedback-pop {
      0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
      40%  { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1);   }
    }
    .pp-correct-text {
      font-size: 2.5rem;
      filter: drop-shadow(0 0 12px rgba(255,200,0,0.9));
    }

    /* 手機小螢幕 */
    @media (max-height: 600px) {
      .pp-sky { height: 260px; }
    }
    @media (min-width: 600px) {
      .pp-sky           { max-width: 520px; margin: 0 auto; }
      .pp-cannon-canvas { max-width: 520px; }
    }

    /* ── pv2 注音系統（泡泡用）── */
    .pp-bubble .pv2 {
      display: inline-flex;
      flex-direction: row;
      align-items: flex-end;
      white-space: nowrap;
      line-height: 1;
      position: relative;
    }
    .pp-bubble .pv2--dot { padding-top: 0.45em; }
    .pp-bubble .pv2-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      height: 2.4rem;
    }
    .pp-bubble .pv2-tone-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 2.4rem;
    }
    .pp-bubble .pv2-r1,
    .pp-bubble .pv2-r2,
    .pp-bubble .pv2-r3 {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 700;
      line-height: 1;
      color: #1e3a8a;
      min-width: 0.8em;
      flex: 1;
    }
    .pp-bubble .pv2-tone {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.65rem;
      font-weight: 700;
      color: #1e3a8a;
    }
    .pp-bubble .pv2-tone-spacer { flex: 1; visibility: hidden; }
    .pp-bubble .pv2-dot {
      position: absolute;
      top: 0; left: 0; right: 0;
      text-align: center;
      font-size: 0.65rem;
      font-weight: 900;
      color: #1e3a8a;
      line-height: 1;
      pointer-events: none;
    }
    .pp-bubble .pv2-b .pv2-r2 { visibility: hidden; }
    .pp-bubble .pv2-empty      { visibility: hidden; }
  `;
  document.head.appendChild(style);
})();

export default PolyphoneGame;
