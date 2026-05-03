/**
 * radical.js — 部首選擇 × 蓋房子
 * Task 16：繼承 GameEngine，實作部首選擇遊戲
 *
 * ⚠️ 資料格式說明（characters.json 實際欄位）：
 *   字欄位：  charObj['字']         （非 charObj.char）
 *   部首：    charObj.radical        （漢字，如 '氵'）
 *   部首筆劃：charObj.radical_strokes
 *   字義：    charObj.pronunciations[0].meaning
 *   ⚠️ 無 radical_zhuyin → 由 RADICAL_ZHUYIN_MAP 對照表反查
 *   ⚠️ 無 stroke_first   → 提示二改顯示「部首佔全字N/M劃」
 *
 * 遊戲規則（SECTION 9 D.5）：
 *  - 每題顯示一個生字，4個選項（正確部首 + 3個干擾）
 *  - 選項永遠顯示注音體，不受注音開關影響
 *  - 蓋房子進度（session 內累計）：
 *      答對1題→地基；2題→牆壁；3題→屋頂；4題→🏠完成！額外★+0.5
 *      第5題起重置（新一棟）
 *  - 答錯一次：房子搖晃動畫
 *  - 答錯二次：顯示正確部首 + 字義說明
 *  - 提示一：「部首有N劃」
 *  - 提示二：「部首佔全字N/M劃」
 */

import { GameEngine } from './GameEngine.js';
import { GameConfig } from './GameConfig.js';
import { AppState } from '../state.js';

// ────────────────────────────────────────────────
// 部首注音對照表（常用部首）
// 查不到時直接顯示部首漢字
// ────────────────────────────────────────────────
const RADICAL_ZHUYIN_MAP = {
  '一': 'ㄧ', '丨': 'ㄍㄨㄣ', '丶': 'ㄓㄨˇ', '丿': 'ㄆㄧㄝˇ', '乙': 'ㄧˇ',
  '二': 'ㄦˋ', '亠': 'ㄊㄡˊ', '人': 'ㄖㄣˊ', '亻': 'ㄖㄣˊ', '儿': 'ㄦˊ',
  '入': 'ㄖㄨˋ', '八': 'ㄅㄚ', '冂': 'ㄐㄩㄥ', '冖': 'ㄇㄧˋ', '冫': 'ㄅㄧㄥ',
  '几': 'ㄐㄧ', '刀': 'ㄉㄠ', '刂': 'ㄉㄠ', '力': 'ㄌㄧˋ', '勹': 'ㄅㄠ',
  '匕': 'ㄅㄧˇ', '十': 'ㄕˊ', '卜': 'ㄅㄨˇ', '卩': 'ㄐㄧㄝˊ', '厂': 'ㄏㄢˇ',
  '厶': 'ㄙ', '又': 'ㄧㄡˋ', '口': 'ㄎㄡˇ', '囗': 'ㄨㄟˊ', '土': 'ㄊㄨˇ',
  '士': 'ㄕˋ', '夕': 'ㄒㄧˋ', '大': 'ㄉㄚˋ', '女': 'ㄋㄩˇ', '子': 'ㄗˇ',
  '宀': 'ㄇㄧㄢˊ', '寸': 'ㄘㄨㄣˋ', '小': 'ㄒㄧㄠˇ', '尸': 'ㄕ', '山': 'ㄕㄢ',
  '川': 'ㄔㄨㄢ', '工': 'ㄍㄨㄥ', '己': 'ㄐㄧˇ', '巾': 'ㄐㄧㄣ', '干': 'ㄍㄢ',
  '幺': 'ㄧㄠ', '广': 'ㄧㄢˇ', '弓': 'ㄍㄨㄥ', '彡': 'ㄕㄢ', '彳': 'ㄔˋ',
  '心': 'ㄒㄧㄣ', '忄': 'ㄒㄧㄣ', '戈': 'ㄍㄜ', '戶': 'ㄏㄨˋ', '手': 'ㄕㄡˇ',
  '扌': 'ㄕㄡˇ', '文': 'ㄨㄣˊ', '斤': 'ㄐㄧㄣ', '方': 'ㄈㄤ', '日': 'ㄖˋ',
  '曰': 'ㄩㄝ', '月': 'ㄩㄝˋ', '木': 'ㄇㄨˋ', '止': 'ㄓˇ', '毛': 'ㄇㄠˊ',
  '水': 'ㄕㄨㄟˇ', '氵': 'ㄕㄨㄟˇ', '火': 'ㄏㄨㄛˇ', '灬': 'ㄏㄨㄛˇ', '父': 'ㄈㄨˋ',
  '牛': 'ㄋㄧㄡˊ', '犬': 'ㄑㄩㄢˇ', '犭': 'ㄑㄩㄢˇ', '玉': 'ㄩˋ', '王': 'ㄨㄤˊ',
  '田': 'ㄊㄧㄢˊ', '白': 'ㄅㄞˊ', '皮': 'ㄆㄧˊ', '皿': 'ㄇㄧㄣˇ', '目': 'ㄇㄨˋ',
  '石': 'ㄕˊ', '示': 'ㄕˋ', '礻': 'ㄕˋ', '禾': 'ㄏㄜˊ', '穴': 'ㄒㄩㄝˊ',
  '立': 'ㄌㄧˋ', '竹': 'ㄓㄨˊ', '米': 'ㄇㄧˇ', '糸': 'ㄇㄧˋ', '羊': 'ㄧㄤˊ',
  '羽': 'ㄩˇ', '老': 'ㄌㄠˇ', '耳': 'ㄦˇ', '肉': 'ㄖㄡˋ', '自': 'ㄗˋ',
  '舟': 'ㄓㄡ', '色': 'ㄙㄜˋ', '虫': 'ㄔㄨㄥˊ', '行': 'ㄒㄧㄥˊ', '衣': 'ㄧ',
  '衤': 'ㄧ', '見': 'ㄐㄧㄢˋ', '角': 'ㄐㄧㄠˇ', '言': 'ㄧㄢˊ', '豆': 'ㄉㄡˋ',
  '貝': 'ㄅㄟˋ', '走': 'ㄗㄡˇ', '足': 'ㄗㄨˊ', '身': 'ㄕㄣ', '車': 'ㄔㄜ',
  '辛': 'ㄒㄧㄣ', '金': 'ㄐㄧㄣ', '長': 'ㄔㄤˊ', '門': 'ㄇㄣˊ', '雨': 'ㄩˇ',
  '青': 'ㄑㄧㄥ', '非': 'ㄈㄟ', '革': 'ㄍㄜˊ', '音': 'ㄧㄣ', '頁': 'ㄧㄝˋ',
  '食': 'ㄕˊ', '馬': 'ㄇㄚˇ', '骨': 'ㄍㄨˇ', '高': 'ㄍㄠ', '魚': 'ㄩˊ',
  '鳥': 'ㄋㄧㄠˇ', '黑': 'ㄏㄟ', '鼻': 'ㄅㄧˊ', '齒': 'ㄔˇ', '龍': 'ㄌㄨㄥˊ',
};

// ────────────────────────────────────────────────
// 部首選擇遊戲主類別
// ────────────────────────────────────────────────
export class RadicalGame extends GameEngine {

  constructor() {
    super('radical');

    /** 蓋房子：session 內累計答對題數 */
    this._houseProgress = 0;

    /** 蓋房子完成獎勵 */
    this._HOUSE_BONUS = 0.5;

    /** 蓋房子各階段 */
    this._HOUSE_STAGES = [
      { label: '地基', emoji: '🧱' },
      { label: '牆壁', emoji: '🏗️' },
      { label: '屋頂', emoji: '🏚️' },
      { label: '完成', emoji: '🏠' },
    ];

    /** 記錄最後點擊的選項（供 playWrongAnimation 使用） */
    this._lastClickedOption = null;
  }

  // ──────────────────────────────────────────────
  // 遊戲設定
  // ──────────────────────────────────────────────
  get config() {
    return GameConfig.radical;
  }

  // ──────────────────────────────────────────────
  // loadQuestions
  //   GameEngine 傳入的每個元素格式（已預處理）：
  //   { char, radical, radicalStrokes, totalStrokes,
  //     firstStroke, radicalInfo: { zhuyin, meaning, strokes } }
  //
  //   ⚠️ config 參數由 GameEngine.init() 傳入，不是 characters 陣列
  //      需自行從 JSONLoader 取得生字清單
  // ──────────────────────────────────────────────
  async loadQuestions(config) {
    // 從 JSONLoader 取得已載入的生字資料
    const { JSONLoader } = await import('../json_loader.js');
    const rawChars = JSONLoader.get('characters');

    // 依 config.count 限制題目數，預設 10 題
    const count = config?.count || 10;

    // 轉換格式：同時支援原始 characters.json 格式與 GameEngine 預處理格式
    const allMapped = rawChars
      .filter(c => (c.char || c['字']) && c.radical)
      .map(c => {
        // GameEngine 預處理後的格式（char, radicalStrokes, radicalInfo）
        if (c.char) {
          return {
            char:           c.char,
            correctRadical: c.radical,
            correctZhuyin:  c.radicalInfo?.zhuyin || this._lookupZhuyin(c.radical),
            radicalStrokes: c.radicalStrokes || c.radicalInfo?.strokes || 1,
            totalStrokes:   c.totalStrokes || c.radicalStrokes || 1,
            firstStroke:    c.firstStroke || '',
            definition:     c.radicalInfo?.meaning || c.pronunciations?.[0]?.meaning || '',
          };
        }
        // 原始 characters.json 格式（'字' 欄位）
        const radical = c.radical;
        const zhuyin  = this._lookupZhuyin(radical);
        return {
          char:           c['字'],
          correctRadical: radical,
          correctZhuyin:  zhuyin,
          radicalStrokes: c.radical_strokes || 1,
          totalStrokes:   c.total_strokes || c.radical_strokes || 1,
          firstStroke:    '',
          definition:     c.pronunciations?.[0]?.meaning || '',
        };
      });

    // 收集所有部首供干擾選項
    const allRadicals = new Map(
      allMapped.map(m => [m.correctRadical, m.correctZhuyin])
    );

    // 洗牌後取前 count 題，並補上選項
    const shuffled = this._shuffle(allMapped).slice(0, count);
    this.questions = shuffled.map(q => ({
      ...q,
      options: this._buildOptions(q.correctRadical, q.correctZhuyin, allRadicals),
    }));
    return this.questions;
  }

  // ──────────────────────────────────────────────
  // renderQuestion：渲染題目 DOM
  // ──────────────────────────────────────────────
  renderQuestion(question) {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      ${this._styles()}
      <div class="rg-wrap">

        <!-- 蓋房子進度 -->
        <div class="rg-house-bar" id="rg-house-bar">
          ${this._houseBarHTML()}
        </div>

        <!-- 題目字 -->
        <div class="rg-char">${question.char}</div>
        <div class="rg-prompt">這個字的部首是？</div>

        <!-- 選項（永遠帶注音體） -->
        <div class="rg-options" id="rg-options">
          ${question.options.map((opt, i) => `
            <button class="rg-opt" id="rg-opt-${i}" data-value="${opt.radical}">
              <span class="rg-opt-zhuyin">${opt.zhuyin}</span>
              <span class="rg-opt-char">${opt.radical}</span>
            </button>
          `).join('')}
        </div>

        <!-- 提示文字 -->
        <div class="rg-hint" id="rg-hint"></div>

        <!-- 答錯二次後顯示正確答案 -->
        <div class="rg-result" id="rg-result"></div>

        <!-- 操作列 -->
        <div class="rg-actions">
          <button class="rg-btn-hint" id="rg-hint1">💡 提示一</button>
          <button class="rg-btn-hint" id="rg-hint2" disabled>💡 提示二</button>
          <button class="rg-btn-next" id="rg-next" style="display:none">⏭️ 下一題</button>
        </div>

      </div>
    `;

    // 綁定事件（addEventListener，避免 inline onclick）
    document.querySelectorAll('.rg-opt').forEach(btn => {
      btn.addEventListener('click', () => this._onOptionClick(btn.dataset.value));
    });
    document.getElementById('rg-hint1')
      ?.addEventListener('click', () => this._requestHint(1));
    document.getElementById('rg-hint2')
      ?.addEventListener('click', () => this._requestHint(2));
    document.getElementById('rg-next')
      ?.addEventListener('click', () => this.skipQuestion());
  }

  // ──────────────────────────────────────────────
  // judgeAnswer
  // ──────────────────────────────────────────────
  async judgeAnswer(answer) {
    // ⚠️ GameEngine.submitAnswer 預期回傳 { correct: boolean }
    const correct = answer === this.currentQuestion?.correctRadical;
    return { correct };
  }

  // ──────────────────────────────────────────────
  // playCorrectAnimation
  // ──────────────────────────────────────────────
  async playCorrectAnimation() {
    const q = this.currentQuestion;
    if (!q) return;

    this._highlightOpt(q.correctRadical, 'correct');
    this._playSound('correct');

    // 更新蓋房子進度
    this._houseProgress += 1;
    const stageIdx = (this._houseProgress - 1) % 4;
    this._refreshHouseBar(stageIdx);

    // 每 4 題完成一棟
    if (this._houseProgress % 4 === 0) {
      await this._playHouseComplete();
      await this._addHouseBonus();
    }

    await this._delay(600);
  }

  // ──────────────────────────────────────────────
  // playWrongAnimation（房子搖晃）
  // ──────────────────────────────────────────────
  async playWrongAnimation() {
    if (this._lastClickedOption) {
      this._highlightOpt(this._lastClickedOption, 'wrong');
      await this._delay(400);
      this._clearOptClass(this._lastClickedOption, 'wrong');
    }

    const bar = document.getElementById('rg-house-bar');
    if (bar) {
      bar.classList.add('rg-shake');
      setTimeout(() => bar.classList.remove('rg-shake'), 600);
    }

    this._playSound('wrong');
    await this._delay(500);
  }

  // ──────────────────────────────────────────────
  // showCorrectAnswer（答錯二次）
  // ──────────────────────────────────────────────
  async showCorrectAnswer() {
    const q = this.currentQuestion;
    if (!q) return;

    this._highlightOpt(q.correctRadical, 'reveal');
    this._disableAllOpts();

    const resultEl = document.getElementById('rg-result');
    if (resultEl) {
      resultEl.innerHTML = `
        <span style="color:#e67e22">
          正確部首是「${q.correctRadical}」（${q.correctZhuyin}）
          ${q.definition
            ? `<br><small style="color:#888">${q.definition.slice(0, 40)}</small>`
            : ''}
        </span>`;
    }

    const btnNext = document.getElementById('rg-next');
    if (btnNext) btnNext.style.display = 'inline-block';
  }

  // ──────────────────────────────────────────────
  // getHint
  // ──────────────────────────────────────────────
  getHint(hintLevel) {
    const q = this.currentQuestion;
    if (!q) return '';

    const hintEl = document.getElementById('rg-hint');

    if (hintLevel === 1) {
      const text = `💡 提示：部首「${q.correctRadical}」有 ${q.radicalStrokes} 劃`;
      if (hintEl) hintEl.textContent = text;

      // 解鎖提示二
      const btn2 = document.getElementById('rg-hint2');
      if (btn2) btn2.disabled = false;
      return text;
    }

    if (hintLevel === 2) {
      const text = q.firstStroke
        ? `💡 提示：部首第一筆是「${q.firstStroke}」`
        : `💡 提示：部首佔全字 ${q.radicalStrokes} / ${q.totalStrokes} 劃`;
      if (hintEl) hintEl.textContent = text;
      return text;
    }

    return '';
  }

  // ──────────────────────────────────────────────
  // destroy
  // ──────────────────────────────────────────────
  destroy() {
    this._houseProgress = 0;
    this._lastClickedOption = null;
    super.destroy();
  }

  // ══════════════════════════════════════════════
  // 私有輔助方法
  // ══════════════════════════════════════════════

  /** 選項點擊 → submitAnswer */
  _onOptionClick(radical) {
    this._lastClickedOption = radical;
    this.submitAnswer(radical).catch(err => {
      console.error('[RadicalGame] submitAnswer 失敗：', err);
    });
  }

  /** 請求提示（轉呼叫 GameEngine.useHint） */
  _requestHint(level) {
    this.useHint(level);
  }

  /** 查詢部首注音 */
  _lookupZhuyin(radical) {
    return RADICAL_ZHUYIN_MAP[radical] || radical;
  }

  /** 蒐集所有部首 Map（radical → zhuyin） */
  _collectAllRadicals(characters) {
    const map = new Map();
    for (const c of characters) {
      if (c.radical) {
        map.set(c.radical, this._lookupZhuyin(c.radical));
      }
    }
    return map;
  }

  /** 建立 4 個選項（1 正確 + 3 干擾），洗牌後回傳 */
  _buildOptions(correctRadical, correctZhuyin, allRadicals) {
    const correct = { radical: correctRadical, zhuyin: correctZhuyin };

    // 排除正確部首後隨機抽 3 個干擾
    const pool = [...allRadicals.entries()]
      .filter(([r]) => r !== correctRadical)
      .map(([r, z]) => ({ radical: r, zhuyin: z }));

    const shuffled = this._shuffle(pool);
    const distractors = shuffled.slice(0, 3);

    // 資料不足時補備用部首
    const fallbacks = ['口', '手', '木', '水', '火', '土', '金', '人', '目', '心'];
    for (const fb of fallbacks) {
      if (distractors.length >= 3) break;
      if (fb !== correctRadical && !distractors.some(d => d.radical === fb)) {
        distractors.push({ radical: fb, zhuyin: this._lookupZhuyin(fb) });
      }
    }

    return this._shuffle([correct, ...distractors.slice(0, 3)]);
  }

  /** Fisher-Yates 洗牌 */
  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 蓋房子進度條 HTML */
  _houseBarHTML() {
    const done = this._houseProgress % 4;
    return this._HOUSE_STAGES.map((s, i) =>
      `<span class="rg-stage ${i < done ? 'on' : ''}" id="rg-stage-${i}" title="${s.label}">${s.emoji}</span>`
    ).join('');
  }

  /** 刷新進度條（點亮新階段） */
  _refreshHouseBar(newIdx) {
    const bar = document.getElementById('rg-house-bar');
    if (!bar) return;
    bar.innerHTML = this._houseBarHTML();
    document.getElementById(`rg-stage-${newIdx}`)?.classList.add('on');
  }

  /** 房子完成大動畫 */
  async _playHouseComplete() {
    const bar = document.getElementById('rg-house-bar');
    if (bar) {
      bar.classList.add('rg-complete');
      setTimeout(() => bar.classList.remove('rg-complete'), 900);
    }
    const hint = document.getElementById('rg-hint');
    if (hint) {
      hint.innerHTML = `<b style="color:#f39c12;font-size:18px">🏠 房子蓋完！額外 ★+0.5</b>`;
      setTimeout(() => { if (hint) hint.textContent = ''; }, 2500);
    }
    await this._delay(900);
  }

  /** 加入房子完成獎勵 ★+0.5 */
  async _addHouseBonus() {
    try {
      if (window.StarsManager) {
        await window.StarsManager.add(this._HOUSE_BONUS, 'house_bonus');
      }
    } catch (e) {
      console.warn('[RadicalGame] 蓋房子加星失敗（非致命）：', e);
    }
  }

  /** 高亮選項 */
  _highlightOpt(radical, cls) {
    document.querySelectorAll('.rg-opt').forEach(btn => {
      if (btn.dataset.value === radical) btn.classList.add(cls);
    });
  }

  /** 清除選項特定 class */
  _clearOptClass(radical, cls) {
    document.querySelectorAll('.rg-opt').forEach(btn => {
      if (btn.dataset.value === radical) btn.classList.remove(cls);
    });
  }

  /** 停用所有選項 */
  _disableAllOpts() {
    document.querySelectorAll('.rg-opt').forEach(btn => {
      btn.classList.add('disabled');
      btn.disabled = true;
    });
  }

  /** 播放音效（委託 AudioManager，失敗靜默） */
  _playSound(type) {
    try {
      if (window.AudioManager && AppState?.settings?.soundOn) {
        if (type === 'correct') window.AudioManager.playCorrect?.();
        if (type === 'wrong')   window.AudioManager.playWrong?.();
      }
    } catch (_) { /* 靜默 */ }
  }

  /** 延遲工具 */
  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** 內嵌 CSS */
  _styles() {
    return `<style>
      .rg-wrap {
        display:flex; flex-direction:column; align-items:center;
        padding:16px; min-height:100vh;
        background:linear-gradient(180deg,#e8f4fd 0%,#fef9e7 100%);
        font-family:'BpmfIVS','Noto Sans TC',sans-serif;
        user-select:none; box-sizing:border-box;
      }
      /* 進度條 */
      .rg-house-bar {
        display:flex; gap:10px; padding:8px 20px;
        background:rgba(255,255,255,.7); border-radius:24px;
        margin-bottom:14px;
      }
      .rg-stage { font-size:28px; opacity:.2; transition:opacity .35s,transform .3s; }
      .rg-stage.on { opacity:1; transform:scale(1.2); }
      @keyframes rgShake {
        0%,100%{transform:rotate(0)} 25%{transform:rotate(-6deg)} 75%{transform:rotate(6deg)}
      }
      .rg-shake { animation:rgShake .5s ease; }
      @keyframes rgComplete {
        0%{transform:scale(1)} 40%{transform:scale(1.5) rotate(-12deg)}
        70%{transform:scale(1.5) rotate(12deg)} 100%{transform:scale(1)}
      }
      .rg-complete { animation:rgComplete .9s ease; }

      /* 題目字 */
      .rg-char { font-size:100px; line-height:1.1; color:#2c3e50; margin-bottom:4px; }
      .rg-prompt { font-size:17px; color:#666; margin-bottom:20px; }

      /* 選項 */
      .rg-options {
        display:grid; grid-template-columns:1fr 1fr; gap:12px;
        width:100%; max-width:340px; margin-bottom:14px;
      }
      .rg-opt {
        display:flex; flex-direction:column; align-items:center;
        justify-content:center; padding:12px 8px; min-height:88px;
        border:3px solid #3498db; border-radius:16px;
        background:#fff; cursor:pointer;
        transition:transform .15s, background .2s;
      }
      .rg-opt:hover:not(.disabled) { background:#eaf4fb; }
      .rg-opt:active:not(.disabled) { transform:scale(.93); }
      .rg-opt-zhuyin { font-size:13px; color:#aaa; margin-bottom:4px; }
      .rg-opt-char   { font-size:38px; color:#2c3e50; }

      .rg-opt.correct {
        background:#2ecc71; border-color:#27ae60;
        animation:rgCorrect .45s ease;
      }
      .rg-opt.correct .rg-opt-zhuyin,
      .rg-opt.correct .rg-opt-char { color:#fff; }
      @keyframes rgCorrect {
        0%,100%{transform:scale(1)} 50%{transform:scale(1.1)}
      }

      .rg-opt.wrong {
        background:#e74c3c; border-color:#c0392b;
        animation:rgWrong .4s ease;
      }
      .rg-opt.wrong .rg-opt-zhuyin,
      .rg-opt.wrong .rg-opt-char { color:#fff; }
      @keyframes rgWrong {
        0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)}
      }

      .rg-opt.reveal {
        background:#f39c12; border-color:#e67e22;
      }
      .rg-opt.reveal .rg-opt-zhuyin,
      .rg-opt.reveal .rg-opt-char { color:#fff; }
      .rg-opt.disabled { pointer-events:none; opacity:.5; }

      /* 提示與結果 */
      .rg-hint   { min-height:30px; font-size:15px; color:#7f8c8d; text-align:center; margin-bottom:4px; }
      .rg-result { min-height:28px; font-size:15px; text-align:center; margin-bottom:10px; }

      /* 按鈕列 */
      .rg-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
      .rg-btn-hint {
        padding:8px 16px; border-radius:20px;
        border:2px solid #bdc3c7; background:#ecf0f1;
        color:#555; font-size:14px; cursor:pointer;
      }
      .rg-btn-hint:disabled { opacity:.35; cursor:default; }
      .rg-btn-next {
        padding:8px 18px; border-radius:20px;
        border:2px solid #3498db; background:#3498db;
        color:#fff; font-size:14px; cursor:pointer;
      }
    </style>`;
  }
}
