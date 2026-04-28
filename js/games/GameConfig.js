/**
 * GameConfig.js
 * 遊戲設定集中管理模組
 *
 * 負責定義所有 11 個遊戲的設定物件，包含：
 *   - name：中文名稱
 *   - icon：表情符號
 *   - stars：首次答對 / 再試答對 的星星數（部分遊戲有多模式）
 *   - difficulty：預設難度（'easy'|'medium'|'hard'）
 *   - needHandwriting：是否需要手寫辨識
 *
 * 依規格 SECTION 3.3 星星表定義，對應遊戲 ID：
 *   writing, stroke, zhuyin, polyphone, radical,
 *   strokes_count, typo, idiom, words, listen, sentence
 *
 * ⚠️ 本模組無任何依賴，純設定檔，不含邏輯
 */

/**
 * 所有遊戲設定表
 *
 * 星星規則說明：
 *   - first：首次答對（attemptCount === 1）獲得的星星數
 *   - retry：答錯一次後再試成功（attemptCount === 2）獲得的星星數
 *   - stroke 遊戲分兩模式：手寫(stroke_handwrite) 和 選擇(stroke_choice)
 *   - sentence 遊戲分兩模式：模式1/2(sentence_mode12) 和 模式3/4(sentence_mode34)
 *
 * 不倒扣星星：答錯後可再試一次，再試仍錯則不給星
 * 連續答對 bonus 僅限「隨機挑戰」遊戲（random.js 處理，非此處定義）
 */
export const GameConfig = {

  // ─────────────────────────────────────────────
  // Task 16（T19）：寫出注音 × 手寫動畫
  // writing.js
  // ─────────────────────────────────────────────
  writing: {
    id: 'writing',
    name: '寫出注音',
    icon: '✏️',
    stars: {
      first: 4,
      retry: 2,
    },
    difficulty: 'medium',
    needHandwriting: true,   // 需要手寫注音辨識
  },

  // ─────────────────────────────────────────────
  // Task 20（T20）：筆順練習 × 跟著畫
  // stroke.js（含兩個模式）
  // ─────────────────────────────────────────────
  stroke: {
    id: 'stroke',
    name: '筆順練習',
    icon: '🖊️',
    // 主設定：以 stroke_handwrite 為代表
    stars: {
      first: 2,
      retry: 1,
    },
    difficulty: 'medium',
    needHandwriting: true,   // 手寫跟著畫模式需要手寫
  },

  // stroke 手寫模式（供 GameEngine.calculateStars 使用）
  stroke_handwrite: {
    id: 'stroke_handwrite',
    name: '筆順練習（手寫）',
    icon: '🖊️',
    stars: {
      first: 2,
      retry: 1,
    },
    difficulty: 'medium',
    needHandwriting: true,
  },

  // stroke 選擇模式（供 GameEngine.calculateStars 使用）
  stroke_choice: {
    id: 'stroke_choice',
    name: '筆順練習（選擇）',
    icon: '🖊️',
    stars: {
      first: 1,
      retry: 0.5,
    },
    difficulty: 'easy',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 21（T21）：注音選擇 × 泡泡
  // zhuyin.js
  // ─────────────────────────────────────────────
  zhuyin: {
    id: 'zhuyin',
    name: '注音選擇',
    icon: '🫧',
    stars: {
      first: 2,
      retry: 1,
    },
    difficulty: 'easy',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 22（T22）：多音判斷 × 飛機
  // polyphone.js
  // ─────────────────────────────────────────────
  polyphone: {
    id: 'polyphone',
    name: '多音判斷',
    icon: '✈️',
    stars: {
      first: 4,
      retry: 2,
    },
    difficulty: 'hard',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 16：部首選擇 × 蓋房子
  // radical.js
  // ─────────────────────────────────────────────
  radical: {
    id: 'radical',
    name: '部首選擇',
    icon: '🏠',
    stars: {
      first: 1,
      retry: 0.5,
    },
    difficulty: 'easy',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 17：算出筆劃 × 射箭
  // strokes_count.js
  // ─────────────────────────────────────────────
  strokes_count: {
    id: 'strokes_count',
    name: '算出筆劃',
    icon: '🏹',
    stars: {
      first: 1,
      retry: 0.5,
    },
    difficulty: 'easy',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 23（T23）：改錯別字 × 打地鼠
  // typo.js
  // ─────────────────────────────────────────────
  typo: {
    id: 'typo',
    name: '改錯別字',
    icon: '🔨',
    stars: {
      first: 4,
      retry: 2,
    },
    difficulty: 'hard',
    needHandwriting: true,   // 模式二需要手寫正確字
  },

  // ─────────────────────────────────────────────
  // Task 24（T24）：成語填空 × 火車
  // idiom.js
  // ─────────────────────────────────────────────
  idiom: {
    id: 'idiom',
    name: '成語填空',
    icon: '🚂',
    stars: {
      first: 3,
      retry: 0.5,
    },
    difficulty: 'medium',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 25（T25）：詞語填空 × 賽車
  // words.js
  // ─────────────────────────────────────────────
  words: {
    id: 'words',
    name: '詞語填空',
    icon: '🏎️',
    stars: {
      first: 3,
      retry: 0.5,
    },
    difficulty: 'medium',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 18：聽音選字 × 釣魚
  // listen.js
  // ─────────────────────────────────────────────
  listen: {
    id: 'listen',
    name: '聽音選字',
    icon: '🎣',
    stars: {
      first: 1,
      retry: 0.5,
    },
    difficulty: 'easy',
    needHandwriting: false,
  },

  // ─────────────────────────────────────────────
  // Task 26（T26）：短句造詞 × 手寫/填空
  // sentence.js（含兩個模式組）
  // ─────────────────────────────────────────────
  sentence: {
    id: 'sentence',
    name: '短句造詞',
    icon: '📝',
    // 主設定：以 sentence_mode12 為代表
    stars: {
      first: 4,
      retry: 2,
    },
    difficulty: 'medium',
    needHandwriting: false,  // 模式1/2 不需手寫
  },

  // sentence 模式1/2（填空 / 拖曳排列，不需 AI，直接比對）
  sentence_mode12: {
    id: 'sentence_mode12',
    name: '短句造詞（模式1/2）',
    icon: '📝',
    stars: {
      first: 4,
      retry: 2,
    },
    difficulty: 'medium',
    needHandwriting: false,
  },

  // sentence 模式3/4（照樣造句 / 造句，需手寫 + Gemini 判斷）
  sentence_mode34: {
    id: 'sentence_mode34',
    name: '短句造詞（模式3/4）',
    icon: '📝',
    stars: {
      first: 5,
      retry: 2.5,
    },
    difficulty: 'hard',
    needHandwriting: true,   // 手寫輸入造句
  },

};

/**
 * 根據 gameId 取得遊戲設定
 * @param {string} gameId - 遊戲 ID（如 'writing', 'radical'）
 * @returns {Object|null} 遊戲設定物件，找不到時回傳 null
 */
export function getGameConfig(gameId) {
  return GameConfig[gameId] ?? null;
}

/**
 * 取得所有主要遊戲 ID 列表（不含子模式）
 * 共 11 個遊戲，供隨機挑戰（random.js）使用
 * @returns {string[]}
 */
export function getMainGameIds() {
  return [
    'writing',
    'stroke',
    'zhuyin',
    'polyphone',
    'radical',
    'strokes_count',
    'typo',
    'idiom',
    'words',
    'listen',
    'sentence',
  ];
}

/**
 * 根據遊戲 ID 取得對應的星星設定
 * 自動處理 stroke / sentence 的多模式情況
 *
 * @param {string} gameId        - 遊戲 ID
 * @param {string} [subMode]     - 子模式（如 'handwrite'|'choice' / 'mode12'|'mode34'）
 * @returns {{ first: number, retry: number }}
 */
export function getStarsConfig(gameId, subMode) {
  // stroke 雙模式
  if (gameId === 'stroke') {
    if (subMode === 'handwrite') return GameConfig.stroke_handwrite.stars;
    if (subMode === 'choice')    return GameConfig.stroke_choice.stars;
    return GameConfig.stroke_handwrite.stars; // 預設手寫模式
  }

  // sentence 雙模式
  if (gameId === 'sentence') {
    if (subMode === 'mode12') return GameConfig.sentence_mode12.stars;
    if (subMode === 'mode34') return GameConfig.sentence_mode34.stars;
    return GameConfig.sentence_mode12.stars;  // 預設模式1/2
  }

  // 其他遊戲
  const config = GameConfig[gameId];
  if (!config) {
    console.warn(`[GameConfig] 找不到遊戲設定：${gameId}，回傳預設值`);
    return { first: 1, retry: 0.5 };
  }

  return config.stars;
}
