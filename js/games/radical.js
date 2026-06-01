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
 *  - 提示一：「部首有N劃」（不顯示正確答案）
 *  - 提示二：「部首佔全字N/M劃」
 *
 * 蓋房子動畫流程（v2）：
 *  1. 初始：進度列只有4個空灰框（無圖案）
 *  2. 答對 → 畫布展開成全螢幕建築場景
 *  3. 展示對應階段大圖（含人物 + 煙霧效果）
 *  4. 播放 built.mp3
 *  5. 場景縮小收回進度列（對應圖案亮起）
 *  6. 進度列刷新後出新題
 *  7. 第 4 題完成 → 完整房屋場景 + ★+0.5 獎勵
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
// 蓋房子各階段定義（emoji + SVG場景 + 說明）
// ────────────────────────────────────────────────
const HOUSE_STAGES = [
  {
    label: '打地基',
    emoji: '🧱',
    // SVG場景：地基階段 —— 工人挖地、磚塊、煙霧
    scene: `
      <svg viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg" class="rg-scene-svg">
        <!-- 天空 -->
        <rect width="320" height="180" fill="#87CEEB"/>
        <!-- 雲 -->
        <ellipse cx="60" cy="40" rx="35" ry="18" fill="white" opacity=".9"/>
        <ellipse cx="85" cy="30" rx="28" ry="16" fill="white" opacity=".9"/>
        <ellipse cx="240" cy="55" rx="28" ry="14" fill="white" opacity=".85"/>
        <!-- 地面 -->
        <rect y="180" width="320" height="80" fill="#8B6914"/>
        <rect y="180" width="320" height="12" fill="#A0784A"/>
        <!-- 地基磚塊 -->
        <rect x="60" y="155" width="200" height="28" rx="4" fill="#CC8844"/>
        <line x1="110" y1="155" x2="110" y2="183" stroke="#AA6622" stroke-width="2"/>
        <line x1="160" y1="155" x2="160" y2="183" stroke="#AA6622" stroke-width="2"/>
        <line x1="210" y1="155" x2="210" y2="183" stroke="#AA6622" stroke-width="2"/>
        <line x1="60" y1="169" x2="260" y2="169" stroke="#AA6622" stroke-width="1.5"/>
        <!-- 工人（右側） -->
        <circle cx="265" cy="140" r="13" fill="#FFDAB9"/>
        <rect x="255" cy="152" width="20" height="26" rx="4" fill="#FF6B35" y="152"/>
        <rect x="252" y="170" width="8" height="16" rx="3" fill="#4169E1"/>
        <rect x="264" y="170" width="8" height="16" rx="3" fill="#4169E1"/>
        <!-- 安全帽 -->
        <ellipse cx="265" cy="131" rx="14" ry="8" fill="#FFD700"/>
        <!-- 工具 -->
        <line x1="255" y1="162" x2="235" y2="150" stroke="#888" stroke-width="3" stroke-linecap="round"/>
        <!-- 煙霧粒子 -->
        <circle cx="180" cy="148" r="8" fill="#CCC" opacity=".5" class="rg-smoke rg-smoke1"/>
        <circle cx="195" cy="138" r="6" fill="#DDD" opacity=".4" class="rg-smoke rg-smoke2"/>
        <circle cx="165" cy="136" r="7" fill="#BBB" opacity=".45" class="rg-smoke rg-smoke3"/>
        <!-- 完成標語 -->
        <text x="160" y="222" text-anchor="middle" font-size="18" font-weight="bold" fill="#FFF" font-family="Noto Sans TC,sans-serif">🧱 地基完成！</text>
      </svg>`,
  },
  {
    label: '砌牆壁',
    emoji: '🏗️',
    scene: `
      <svg viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg" class="rg-scene-svg">
        <rect width="320" height="180" fill="#87CEEB"/>
        <ellipse cx="70" cy="45" rx="38" ry="18" fill="white" opacity=".9"/>
        <ellipse cx="98" cy="33" rx="30" ry="16" fill="white"/>
        <ellipse cx="230" cy="50" rx="32" ry="15" fill="white" opacity=".85"/>
        <!-- 地面 -->
        <rect y="180" width="320" height="80" fill="#8B6914"/>
        <rect y="180" width="320" height="12" fill="#A0784A"/>
        <!-- 地基 -->
        <rect x="60" y="155" width="200" height="28" rx="4" fill="#CC8844"/>
        <!-- 牆壁 -->
        <rect x="75" y="85" width="170" height="72" rx="3" fill="#E8C89A"/>
        <!-- 磚紋 -->
        <line x1="75" y1="103" x2="245" y2="103" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="75" y1="121" x2="245" y2="121" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="75" y1="139" x2="245" y2="139" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="120" y1="85" x2="120" y2="103" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="170" y1="85" x2="170" y2="103" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="100" y1="103" x2="100" y2="121" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="155" y1="103" x2="155" y2="121" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="205" y1="103" x2="205" y2="121" stroke="#C8A070" stroke-width="1.5"/>
        <!-- 鷹架 -->
        <line x1="58" y1="75" x2="58" y2="183" stroke="#888" stroke-width="4"/>
        <line x1="262" y1="75" x2="262" y2="183" stroke="#888" stroke-width="4"/>
        <line x1="50" y1="105" x2="270" y2="105" stroke="#888" stroke-width="3"/>
        <!-- 工人 -->
        <circle cx="268" cy="88" r="12" fill="#FFDAB9"/>
        <rect x="258" y="99" width="18" height="24" rx="4" fill="#E74C3C"/>
        <rect x="256" y="116" width="7" height="14" rx="3" fill="#4169E1"/>
        <rect x="267" y="116" width="7" height="14" rx="3" fill="#4169E1"/>
        <ellipse cx="268" cy="80" rx="13" ry="7" fill="#FFD700"/>
        <!-- 煙霧 -->
        <circle cx="145" cy="80" r="9" fill="#DDD" opacity=".5" class="rg-smoke rg-smoke1"/>
        <circle cx="162" cy="70" r="7" fill="#CCC" opacity=".4" class="rg-smoke rg-smoke2"/>
        <circle cx="128" cy="68" r="8" fill="#BBB" opacity=".45" class="rg-smoke rg-smoke3"/>
        <text x="160" y="222" text-anchor="middle" font-size="18" font-weight="bold" fill="#FFF" font-family="Noto Sans TC,sans-serif">🏗️ 牆壁砌好！</text>
      </svg>`,
  },
  {
    label: '蓋屋頂',
    emoji: '🏚️',
    scene: `
      <svg viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg" class="rg-scene-svg">
        <rect width="320" height="180" fill="#87CEEB"/>
        <ellipse cx="80" cy="38" rx="38" ry="18" fill="white" opacity=".9"/>
        <ellipse cx="108" cy="27" rx="30" ry="16" fill="white"/>
        <ellipse cx="245" cy="48" rx="30" ry="14" fill="white" opacity=".85"/>
        <rect y="180" width="320" height="80" fill="#8B6914"/>
        <rect y="180" width="320" height="12" fill="#A0784A"/>
        <!-- 地基 -->
        <rect x="60" y="155" width="200" height="28" rx="4" fill="#CC8844"/>
        <!-- 牆壁 -->
        <rect x="75" y="100" width="170" height="58" rx="3" fill="#E8C89A"/>
        <line x1="75" y1="118" x2="245" y2="118" stroke="#C8A070" stroke-width="1.5"/>
        <line x1="75" y1="136" x2="245" y2="136" stroke="#C8A070" stroke-width="1.5"/>
        <!-- 屋頂 -->
        <polygon points="50,100 160,48 270,100" fill="#B22222"/>
        <line x1="50" y1="100" x2="160" y2="48" stroke="#8B0000" stroke-width="2"/>
        <line x1="270" y1="100" x2="160" y2="48" stroke="#8B0000" stroke-width="2"/>
        <!-- 煙囪 -->
        <rect x="190" y="56" width="18" height="30" rx="2" fill="#888"/>
        <ellipse cx="199" cy="56" rx="9" ry="4" fill="#666"/>
        <!-- 煙霧從煙囪冒出 -->
        <circle cx="199" cy="45" r="8" fill="#DDD" opacity=".55" class="rg-smoke rg-smoke1"/>
        <circle cx="205" cy="33" r="7" fill="#CCC" opacity=".45" class="rg-smoke rg-smoke2"/>
        <circle cx="192" cy="25" r="9" fill="#BBB" opacity=".4" class="rg-smoke rg-smoke3"/>
        <!-- 工人在屋頂 -->
        <circle cx="125" cy="66" r="12" fill="#FFDAB9"/>
        <rect x="116" y="77" width="17" height="22" rx="4" fill="#27AE60"/>
        <ellipse cx="125" cy="58" rx="13" ry="7" fill="#FFD700"/>
        <!-- 鷹架 -->
        <line x1="58" y1="90" x2="58" y2="183" stroke="#888" stroke-width="4"/>
        <line x1="262" y1="90" x2="262" y2="183" stroke="#888" stroke-width="4"/>
        <text x="160" y="222" text-anchor="middle" font-size="18" font-weight="bold" fill="#FFF" font-family="Noto Sans TC,sans-serif">🏚️ 屋頂蓋好！</text>
      </svg>`,
  },
  {
    label: '完成！',
    emoji: '🏠',
    scene: `
      <svg viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg" class="rg-scene-svg">
        <!-- 晴天 -->
        <rect width="320" height="180" fill="#87CEEB"/>
        <!-- 太陽 -->
        <circle cx="40" cy="38" r="22" fill="#FFD700" opacity=".9"/>
        <line x1="40" y1="8" x2="40" y2="0" stroke="#FFD700" stroke-width="3"/>
        <line x1="40" y1="68" x2="40" y2="76" stroke="#FFD700" stroke-width="3"/>
        <line x1="10" y1="38" x2="2" y2="38" stroke="#FFD700" stroke-width="3"/>
        <line x1="70" y1="38" x2="78" y2="38" stroke="#FFD700" stroke-width="3"/>
        <line x1="19" y1="17" x2="13" y2="11" stroke="#FFD700" stroke-width="3"/>
        <line x1="61" y1="59" x2="67" y2="65" stroke="#FFD700" stroke-width="3"/>
        <line x1="61" y1="17" x2="67" y2="11" stroke="#FFD700" stroke-width="3"/>
        <line x1="19" y1="59" x2="13" y2="65" stroke="#FFD700" stroke-width="3"/>
        <!-- 白雲 -->
        <ellipse cx="190" cy="38" rx="38" ry="18" fill="white" opacity=".9"/>
        <ellipse cx="218" cy="28" rx="30" ry="16" fill="white"/>
        <ellipse cx="270" cy="48" rx="28" ry="14" fill="white" opacity=".85"/>
        <!-- 地面 草地 -->
        <rect y="180" width="320" height="80" fill="#5D8A3C"/>
        <rect y="180" width="320" height="10" fill="#6AAF44"/>
        <!-- 完成房子 -->
        <!-- 地基 -->
        <rect x="65" y="158" width="190" height="25" rx="4" fill="#CC8844"/>
        <!-- 牆壁 -->
        <rect x="78" y="103" width="164" height="58" rx="3" fill="#FAE5C0"/>
        <!-- 窗戶 -->
        <rect x="92" y="115" width="34" height="30" rx="4" fill="#AEE0F5" stroke="#888" stroke-width="2"/>
        <line x1="109" y1="115" x2="109" y2="145" stroke="#888" stroke-width="1.5"/>
        <line x1="92" y1="130" x2="126" y2="130" stroke="#888" stroke-width="1.5"/>
        <!-- 門 -->
        <rect x="146" y="122" width="28" height="39" rx="4" fill="#8B4513" stroke="#5C2E00" stroke-width="2"/>
        <circle cx="168" cy="142" r="3" fill="#FFD700"/>
        <!-- 窗戶右 -->
        <rect x="194" y="115" width="34" height="30" rx="4" fill="#AEE0F5" stroke="#888" stroke-width="2"/>
        <line x1="211" y1="115" x2="211" y2="145" stroke="#888" stroke-width="1.5"/>
        <line x1="194" y1="130" x2="228" y2="130" stroke="#888" stroke-width="1.5"/>
        <!-- 屋頂 -->
        <polygon points="52,103 160,46 268,103" fill="#C0392B"/>
        <line x1="52" y1="103" x2="160" y2="46" stroke="#922B21" stroke-width="2.5"/>
        <line x1="268" y1="103" x2="160" y2="46" stroke="#922B21" stroke-width="2.5"/>
        <!-- 煙囪 -->
        <rect x="195" y="58" width="16" height="28" rx="2" fill="#888"/>
        <ellipse cx="203" cy="58" rx="8" ry="4" fill="#666"/>
        <!-- 煙霧（慶祝煙霧） -->
        <circle cx="203" cy="46" r="9" fill="#FFF" opacity=".6" class="rg-smoke rg-smoke1"/>
        <circle cx="210" cy="34" r="8" fill="#FFF" opacity=".5" class="rg-smoke rg-smoke2"/>
        <circle cx="196" cy="26" r="10" fill="#FFF" opacity=".45" class="rg-smoke rg-smoke3"/>
        <!-- 工人（旁邊慶祝） -->
        <circle cx="282" cy="152" r="13" fill="#FFDAB9"/>
        <rect x="272" y="164" width="20" height="18" rx="4" fill="#E74C3C"/>
        <rect x="270" y="178" width="7" height="12" rx="3" fill="#4169E1"/>
        <rect x="283" y="178" width="7" height="12" rx="3" fill="#4169E1"/>
        <!-- 舉手慶祝 -->
        <line x1="272" y1="168" x2="258" y2="155" stroke="#FFDAB9" stroke-width="4" stroke-linecap="round"/>
        <line x1="292" y1="168" x2="305" y2="155" stroke="#FFDAB9" stroke-width="4" stroke-linecap="round"/>
        <!-- 彩帶 -->
        <circle cx="100" cy="185" r="4" fill="#E74C3C" opacity=".8"/>
        <circle cx="130" cy="192" r="3" fill="#3498DB" opacity=".8"/>
        <circle cx="155" cy="187" r="4" fill="#F39C12" opacity=".8"/>
        <circle cx="180" cy="193" r="3" fill="#2ECC71" opacity=".8"/>
        <circle cx="210" cy="186" r="4" fill="#9B59B6" opacity=".8"/>
        <circle cx="240" cy="191" r="3" fill="#E74C3C" opacity=".8"/>
        <text x="160" y="225" text-anchor="middle" font-size="20" font-weight="bold" fill="#FFF" font-family="Noto Sans TC,sans-serif">🏠 房子蓋完了！★+0.5</text>
      </svg>`,
  },
];

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

    /** 記錄最後點擊的選項（供 playWrongAnimation 使用） */
    this._lastClickedOption = null;

    /** built 音效 Audio 物件 */
    this._builtAudio = null;
  }

  // ──────────────────────────────────────────────
  // 遊戲設定
  // ──────────────────────────────────────────────
  get config() {
    return GameConfig.radical;
  }

  // ──────────────────────────────────────────────
  // loadQuestions
  // ──────────────────────────────────────────────
  async loadQuestions(config) {
    const { JSONLoader } = await import('../json_loader.js');
    const allCharsDict = JSONLoader.get('characters') || [];

    const myChars = AppState.characters || [];
    if (myChars.length === 0) {
      this.questions = [];
      return this.questions;
    }

    const count = config?.count || 10;

    const myCharKeys = myChars.map(c => c['字'] || c.char || '').filter(Boolean);
    const myMapped = myCharKeys
      .map(ch => {
        const full = allCharsDict.find(c => (c['字'] || c.char) === ch);
        if (!full || !full.radical) return null;
        const radical = full.radical;
        const zhuyin  = this._lookupZhuyin(radical);
        return {
          char:           ch,
          correctRadical: radical,
          correctZhuyin:  zhuyin,
          // radical_strokes 存的是「剩餘筆畫」，部首筆畫 = total - 剩餘
          radicalStrokes: (full.total_strokes > 0 && full.radical_strokes >= 0)
            ? Math.max(1, full.total_strokes - full.radical_strokes)
            : 1,
          totalStrokes:   full.total_strokes || 1,
          firstStroke:    '',
          definition:     full.pronunciations?.[0]?.meaning || '',
        };
      })
      .filter(Boolean);

    if (myMapped.length === 0) {
      this.questions = [];
      return this.questions;
    }

    const allRadicals = new Map();
    for (const c of allCharsDict) {
      if (c.radical) allRadicals.set(c.radical, this._lookupZhuyin(c.radical));
    }

    const shuffled = this._shuffle(myMapped).slice(0, count);
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
    const app = this._getContainer();
    if (!app) return;

    app.innerHTML = `
      ${this._styles()}
      <div class="rg-wrap">

        <!-- 蓋房子進度列（4個灰框，答對後亮起） -->
        <div class="rg-house-bar" id="rg-house-bar">
          ${this._houseBarHTML()}
        </div>

        <!-- 建築場景覆蓋層（答對時展開，預設隱藏） -->
        <div class="rg-scene-overlay" id="rg-scene-overlay" style="display:none">
          <div class="rg-scene-inner" id="rg-scene-inner"></div>
        </div>

        <!-- 題目字 -->
        <div class="rg-char">${question.char}</div>
        <div class="rg-prompt">這個字的部首是？</div>

        <!-- 選項（永遠帶注音體；小字已隱藏） -->
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
    const correct = answer === this.currentQuestion?.correctRadical;
    return { correct };
  }

  // ──────────────────────────────────────────────
  // playCorrectAnimation
  //   流程：高亮選項 → 播放建築場景動畫 → 進度列更新
  // ──────────────────────────────────────────────
  async playCorrectAnimation() {
    const q = this.currentQuestion;
    if (!q) return;

    this._highlightOpt(q.correctRadical, 'correct');
    this._playSound('correct');

    // 計算當前是第幾步（0-3）
    const stageIdx = this._houseProgress % 4; // 0=地基,1=牆壁,2=屋頂,3=完成

    // 更新蓋房子進度計數
    this._houseProgress += 1;

    const isComplete = (this._houseProgress % 4 === 0);

    // 播放建築場景動畫
    await this._playBuildScene(stageIdx, isComplete);

    // 刷新進度列（場景收回後才更新）
    this._refreshHouseBar();

    // 若完成一棟，加獎勵
    if (isComplete) {
      await this._addHouseBonus();
    }

    await this._delay(400);
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
  // getHint（不顯示正確答案，只給間接提示）
  // ──────────────────────────────────────────────
  getHint(hintLevel) {
    const q = this.currentQuestion;
    if (!q) return '';

    const hintEl = document.getElementById('rg-hint');

    if (hintLevel === 1) {
      // 只說筆劃數，不點名哪個是答案
      const text = `💡 提示：部首有 ${q.radicalStrokes} 劃`;
      if (hintEl) hintEl.textContent = text;

      // 解鎖提示二
      const btn2 = document.getElementById('rg-hint2');
      if (btn2) btn2.disabled = false;
      return text;
    }

    if (hintLevel === 2) {
      // 說部首佔全字比例，仍不直接給出答案
      const text = `💡 提示：部首佔全字 ${q.radicalStrokes} / ${q.totalStrokes} 劃`;
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
    if (this._builtAudio) {
      this._builtAudio.pause();
      this._builtAudio = null;
    }
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

    const pool = [...allRadicals.entries()]
      .filter(([r]) => r !== correctRadical)
      .map(([r, z]) => ({ radical: r, zhuyin: z }));

    const shuffled = this._shuffle(pool);
    const distractors = shuffled.slice(0, 3);

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

  /**
   * 蓋房子進度列 HTML
   * 初始：4個空灰框（無 emoji），答對後逐一亮起
   */
  _houseBarHTML() {
    const done = this._houseProgress % 4;
    // _houseProgress 剛好是4的倍數時（含0）：全滅重置；非倍數：lit = done
    const lit = (this._houseProgress > 0 && done === 0) ? 4 : done;
    return HOUSE_STAGES.map((s, i) =>
      `<span class="rg-stage ${i < lit ? 'on' : ''}" id="rg-stage-${i}" title="${s.label}">${i < lit ? s.emoji : '□'}</span>`
    ).join('');
  }

  /** 刷新進度列 */
  _refreshHouseBar() {
    const bar = document.getElementById('rg-house-bar');
    if (!bar) return;
    bar.innerHTML = this._houseBarHTML();
  }

  /**
   * 播放建築場景動畫
   *  1. 覆蓋層展開（填滿畫面）
   *  2. 顯示對應階段的 SVG 場景
   *  3. 播放 built.mp3
   *  4. 等待用戶看清後，覆蓋層縮小收回進度列位置
   */
  async _playBuildScene(stageIdx, isComplete) {
    const overlay = document.getElementById('rg-scene-overlay');
    const inner   = document.getElementById('rg-scene-inner');
    if (!overlay || !inner) return;

    const stage = HOUSE_STAGES[stageIdx];

    // 填入 SVG 場景
    inner.innerHTML = stage.scene;

    // 展開覆蓋層
    overlay.style.display = 'flex';
    overlay.classList.remove('rg-scene-shrink');
    overlay.classList.add('rg-scene-expand');

    // 播放 built 音效
    this._playBuiltSound();

    // 等待展開動畫完成後停留展示
    await this._delay(300); // 等展開

    // 觸發煙霧動畫
    inner.querySelectorAll('.rg-smoke').forEach((el, i) => {
      el.style.animationDelay = `${i * 0.15}s`;
      el.classList.add('rg-smoke-rise');
    });

    // 完成階段多等一點
    await this._delay(isComplete ? 2200 : 1600);

    // 縮小收回
    overlay.classList.remove('rg-scene-expand');
    overlay.classList.add('rg-scene-shrink');

    await this._delay(500); // 等縮小動畫
    overlay.style.display = 'none';
    overlay.classList.remove('rg-scene-shrink');
  }

  /** 播放 built.mp3 */
  _playBuiltSound() {
    try {
      if (!AppState?.settings?.soundOn) return;
      if (!this._builtAudio) {
        this._builtAudio = new Audio('./audio/effects/built.mp3');
      }
      this._builtAudio.currentTime = 0;
      this._builtAudio.play().catch(() => {});
    } catch (_) { /* 靜默 */ }
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
        font-family:'Noto Sans TC',sans-serif;
        user-select:none; box-sizing:border-box;
        position:relative; overflow:hidden;
      }

      /* ── 進度條 ── */
      .rg-house-bar {
        display:flex; gap:10px; padding:8px 20px;
        background:rgba(255,255,255,.7); border-radius:24px;
        margin-bottom:14px; z-index:2; position:relative;
      }
      .rg-stage {
        font-size:28px; opacity:.25; transition:opacity .35s, transform .3s;
        display:inline-flex; align-items:center; justify-content:center;
        width:36px; height:36px;
      }
      .rg-stage.on { opacity:1; transform:scale(1.25); }

      @keyframes rgShake {
        0%,100%{transform:rotate(0)} 25%{transform:rotate(-6deg)} 75%{transform:rotate(6deg)}
      }
      .rg-shake { animation:rgShake .5s ease; }

      /* ── 建築場景覆蓋層 ── */
      .rg-scene-overlay {
        position:fixed; z-index:100;
        display:flex; align-items:center; justify-content:center;
        background:linear-gradient(160deg,#1a3c5e 0%,#2d6a9f 100%);
        border-radius:24px;
        box-shadow:0 8px 40px rgba(0,0,0,.4);
        /* 初始位置：進度列附近（頂部中央小框） */
        top:16px; left:50%; transform:translateX(-50%);
        width:240px; height:56px;
        overflow:hidden;
      }
      .rg-scene-inner {
        width:100%; height:100%;
        display:flex; align-items:center; justify-content:center;
      }
      .rg-scene-svg {
        width:100%; height:100%;
        display:block;
      }

      /* 展開動畫：從進度列小框展開到大場景 */
      @keyframes rgSceneExpand {
        0%   { top:16px; left:50%; transform:translateX(-50%); width:240px; height:56px; border-radius:24px; }
        100% { top:50%; left:50%; transform:translate(-50%,-50%); width:min(340px,92vw); height:min(280px,70vw); border-radius:20px; }
      }
      .rg-scene-expand {
        animation:rgSceneExpand .35s cubic-bezier(.4,0,.2,1) forwards;
      }

      /* 縮小收回動畫 */
      @keyframes rgSceneShrink {
        0%   { top:50%; left:50%; transform:translate(-50%,-50%); width:min(340px,92vw); height:min(280px,70vw); border-radius:20px; }
        100% { top:16px; left:50%; transform:translateX(-50%); width:240px; height:56px; border-radius:24px; }
      }
      .rg-scene-shrink {
        animation:rgSceneShrink .4s cubic-bezier(.4,0,.2,1) forwards;
      }

      /* ── 煙霧粒子上升動畫 ── */
      @keyframes rgSmokeRise {
        0%   { transform:translateY(0) scale(1);   opacity:.55; }
        100% { transform:translateY(-28px) scale(1.5); opacity:0; }
      }
      .rg-smoke { transition:none; }
      .rg-smoke-rise { animation:rgSmokeRise 1.4s ease-out infinite; }
      .rg-smoke1.rg-smoke-rise { animation-delay:0s; }
      .rg-smoke2.rg-smoke-rise { animation-delay:.15s; }
      .rg-smoke3.rg-smoke-rise { animation-delay:.3s; }

      /* ── 題目字 ── */
      .rg-char   { font-size:100px; line-height:1.1; color:#2c3e50; margin-bottom:4px; font-family:'Noto Sans TC','PingFang TC',sans-serif; }
      .rg-prompt { font-size:17px; color:#666; margin-bottom:20px; font-family:'Noto Sans TC',sans-serif; }

      /* ── 選項 ── */
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

      /* 注音小字隱藏（上次修正保留） */
      .rg-opt-zhuyin { display:none; }
      .rg-opt-char   { font-size:38px; color:#2c3e50; font-family:'BpmfIVS','Noto Sans TC',sans-serif; }

      .rg-opt.correct {
        background:#2ecc71; border-color:#27ae60;
        animation:rgCorrect .45s ease;
      }
      .rg-opt.correct .rg-opt-char { color:#fff; }
      @keyframes rgCorrect {
        0%,100%{transform:scale(1)} 50%{transform:scale(1.1)}
      }

      .rg-opt.wrong {
        background:#e74c3c; border-color:#c0392b;
        animation:rgWrong .4s ease;
      }
      .rg-opt.wrong .rg-opt-char { color:#fff; }
      @keyframes rgWrong {
        0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)}
      }

      .rg-opt.reveal {
        background:#f39c12; border-color:#e67e22;
      }
      .rg-opt.reveal .rg-opt-char { color:#fff; }
      .rg-opt.disabled { pointer-events:none; opacity:.5; }

      /* ── 提示與結果 ── */
      .rg-hint   { min-height:30px; font-size:15px; color:#7f8c8d; text-align:center; margin-bottom:4px; }
      .rg-result { min-height:28px; font-size:15px; text-align:center; margin-bottom:10px; }

      /* ── 按鈕列 ── */
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

      /* ── RWD 平板（≥600px）── */
      @media (min-width:600px) {
        .rg-char    { font-size:130px; }
        .rg-options { max-width:460px; }
        .rg-opt     { min-height:104px; }
        .rg-opt-char { font-size:46px; }
        @keyframes rgSceneExpand {
          0%   { top:16px; left:50%; transform:translateX(-50%); width:240px; height:56px; border-radius:24px; }
          100% { top:50%; left:50%; transform:translate(-50%,-50%); width:400px; height:300px; border-radius:20px; }
        }
        @keyframes rgSceneShrink {
          0%   { top:50%; left:50%; transform:translate(-50%,-50%); width:400px; height:300px; border-radius:20px; }
          100% { top:16px; left:50%; transform:translateX(-50%); width:240px; height:56px; border-radius:24px; }
        }
      }

      /* ── RWD 桌面（≥1024px）── */
      @media (min-width:1024px) {
        .rg-wrap { max-width:760px; margin:0 auto; }
      }
    </style>`;
  }
}
