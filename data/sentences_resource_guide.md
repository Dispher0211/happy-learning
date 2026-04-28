# sentences 資源系列說明文件
# 快樂學習 Happy Learning v4.1.0
# 供開發者補充資料用

---

## 一、整體架構

```
/data/
  sentences.json              ← 索引入口（~11 KB）
  sentences_fill_b1.json      ← 第1冊（1上）fill 資料
  sentences_fill_b2.json      ← 第2冊（1下）fill 資料  ← 目前有測試資料
  sentences_fill_b3.json      ← 第3冊（2上）fill 資料
  sentences_fill_b4.json      ← 第4冊（2下）fill 資料
  sentences_compose_b1.json   ← 第1冊（1上）compose 資料
  sentences_compose_b2.json   ← 第2冊（1下）compose 資料  ← 目前有測試資料
  sentences_compose_b3.json   ← 第3冊（2上）compose 資料
  sentences_compose_b4.json   ← 第4冊（2下）compose 資料
  sentences_pattern.json      ← 句型庫（獨立一份，不分冊）
```

---

## 二、sentences.json（索引）

### 用途
- JSONLoader 的入口檔
- 告訴程式每個字屬於哪一冊 → 決定載入哪個分冊 JSON

### 結構
```json
{
  "_meta": {
    "version": "2.0.0",
    "fill_books": [1, 2, 3, 4],
    "compose_books": [1, 2, 3, 4],
    "pattern_file": "sentences_pattern",
    "total_chars": 729
  },
  "char_book": {
    "大": 1,
    "小": 1,
    "看": 2,
    "館": 4
    // ... 全部 729 字
  }
}
```

### 欄位說明
| 欄位 | 類型 | 說明 |
|------|------|------|
| `_meta.version` | string | 資料版本號，更新時遞增 |
| `_meta.fill_books` | array | 目前有哪幾冊的 fill 資料 |
| `_meta.compose_books` | array | 目前有哪幾冊的 compose 資料 |
| `_meta.pattern_file` | string | 句型庫的 JSON 名稱 |
| `char_book` | object | 字 → 冊次對照表（1=1上 2=1下 3=2上 4=2下） |

### 新增字的處理
若日後加入新字，只需在 `char_book` 加入 `"新字": 冊次` 即可，
JSONLoader 會自動路由到對應分冊。

---

## 三、sentences_fill_bN.json（填空資料）

### 用途
搭配遊戲：📖 短句造詞 **模式1（填空）** 和 **模式2（拖曳排列）**

### 資料來源
- 教育部國語小字典例句（含 [例] 格式的完整句子）
- 家長提供的 Excel 檔案（「一下第一課_看.xlsx」格式）
  - 必須包含完整句子（含填空符號 `(__)`）
  - **A 類（詞語片段如「(__)錢」）需補充完整句子才能使用**

### 結構
```json
[
  {
    "id": "fill_5929_01",
    "character": "天",
    "book": 2,
    "lesson": 1,
    "sentence": "蔚藍的天空飄著朵朵的白雲，好一幅美麗的景象。",
    "fill_position": [2],
    "answer": "天空",
    "correct_orders": [["蔚藍的", "天空", "飄著", "朵朵的", "白雲"]]
  }
]
```

### 欄位說明
| 欄位 | 類型 | 說明 | 搭配遊戲用途 |
|------|------|------|------------|
| `id` | string | `fill_{unicode}_{seq:02d}` 格式，例：`fill_5929_01` | 索引 / 防重複 |
| `character` | string | 本題要學習的目標字（單字） | 遊戲以此查詢 |
| `book` | number | 冊次（1/2/3/4 = 1上/1下/2上/2下） | 分冊載入路由 |
| `lesson` | number | 課次 | 排序 / 維護參考 |
| `sentence` | string | 完整句子（answer 已填入） | 模式1/2 顯示題目 |
| `fill_position` | array | 目標字在句子**漢字序列**中的索引（從0起算） | 模式1 挖空顯示 |
| `answer` | string | 正確答案（可能是單字或詞語） | 模式1 比對答案 |
| `correct_orders` | array | 句子的詞組分割（供模式2拖曳排列用） | 模式2 題目生成 |

### ID 編碼規則
`fill_{unicode}_{seq}`
- `unicode`：目標字的 Unicode 碼點（16進位，4位），例：天=5929
- `seq`：同一字的第幾句（兩位數字，從01開始）
- 新增句子：找到該字最後的 seq，直接 +1

### 開發者補充指引
1. 開啟對應冊次的 `sentences_fill_bN.json`
2. 找到或新增該字的區塊
3. 新增一筆 JSON 物件，id 用 `fill_{char_unicode}_{下一個seq}`
4. 確保 `fill_position` 正確（從0起算的漢字序列位置）
5. 使用程式工具驗證：`python3 validate_sentences.py fill`

---

## 四、sentences_compose_bN.json（指定字造句資料）

### 用途
搭配遊戲：📖 短句造詞 **模式4（指定詞語造句）**

遊戲流程：
1. 顯示 `prompt_word`（詞組）給學生
2. 學生手寫一個包含此詞組的完整句子
3. GeminiManager 判斷分數 ≥0.8 → 通過；<0.8 → 送家長審核

### 資料來源
- 家長提供的 Excel 檔案（「生字教學批次生成.xlsx」格式）
  - 欄位：生字 | 詞組 | 提示 | 造句

### 結構
```json
[
  {
    "id": "compose_5929_01",
    "character": "天",
    "book": 2,
    "lesson": 1,
    "prompt_word": "今天",
    "hint": "指的就是現在這一刻所在的這一天。",
    "example": "今天是我的生日，媽媽買了蛋糕。"
  }
]
```

### 欄位說明
| 欄位 | 類型 | 說明 | 搭配遊戲用途 |
|------|------|------|------------|
| `id` | string | `compose_{unicode}_{seq:02d}` | 索引 |
| `character` | string | 目標字（單字） | 遊戲以此查詢 |
| `book` | number | 冊次 | 分冊路由 |
| `lesson` | number | 課次 | 維護參考 |
| `prompt_word` | string | 給學生的詞組（必須包含 character）| 模式4 題目顯示 |
| `hint` | string | 詞義說明（提示一用） | 學生點「提示一」時顯示 |
| `example` | string | 參考答案（不給學生看，供家長審核頁面顯示）| 家長審核畫面參考 |

### ID 編碼規則
`compose_{unicode}_{seq}`
- unicode：目標字的 Unicode 碼點
- seq：同一字的第幾個詞組（從01開始）
- 每字通常有 3~5 個詞組

### prompt_word 選擇原則
- **必須**包含 character 這個字
- 選字典中真實存在的詞組（參考教育部國語小字典）
- 避免「很{char}」「{char}了」這類對名詞字無意義的拼法
- 名詞字（如：世、界、館）→ 用「世界」「各界」「圖書館」等真實詞組
- 動詞字（如：看、走、跑）→ 可用「看見」「看書」「看護」等

### 開發者補充指引
1. 準備 Excel 檔（格式同：生字教學批次生成.xlsx）
2. 確認每字至少 3 個不同詞組
3. 執行轉換腳本：`python3 excel_to_compose.py --book 2 --lesson 1`
4. 合併到對應 `sentences_compose_bN.json`

---

## 五、sentences_pattern.json（句型庫）

### 用途
搭配遊戲：📖 短句造詞 **模式3（照樣造句）**

⚠️ **重要：家長優先**
遊戲出題時的優先順序：
1. Firestore `users/{uid}.my_sentences`（家長在家長模式設定的句型）
2. `sentences_pattern.json`（預設句型庫）

家長可以在家長模式的「🔤造句範例」頁面自行新增/刪除句型。

### 資料來源
- 語文課本的「句型練習」單元
- 目前已收錄：4年級上學期語句練習（8個句型）
- 開發者需補充：1下、2上、2下的句型資料

### 結構
```json
[
  {
    "id": "pattern_001",
    "template": "有時……有時……有時……",
    "description": "並列複句，說明同一主題的幾種不同情況",
    "example": "放學後，他有時趕著去參加社團，有時趕著去學鋼琴，有時趕著回家寫作業。",
    "example_alt": "春天的天氣多變化，有時像夏天一樣炎熱，有時像冬天一樣寒冷，有時像颱風天一樣下大雨。",
    "source": "4上語句練習",
    "grade": 4
  }
]
```

### 欄位說明
| 欄位 | 類型 | 說明 | 搭配遊戲用途 |
|------|------|------|------------|
| `id` | string | `pattern_{seq:03d}` | 索引 |
| `template` | string | 句型結構，用「……」標示空格 | 模式3 顯示給學生 |
| `description` | string | 句型說明（教師引導語）| 提示一（家長可見）|
| `example` | string | 主要示範句 | 模式3 顯示給學生看範例 |
| `example_alt` | string | 備用示範句（隨機選一個顯示）| 模式3 換題時用 |
| `source` | string | 資料來源（4上語句練習、2下語句練習...）| 維護參考 |
| `grade` | number | 年級（1~6）| 難度篩選（未來功能）|

### ID 編碼規則
`pattern_{seq:03d}`
- seq：流水號，從001開始
- **sentence_pattern 與 character 無關**，不用 unicode 編碼
- 新增句型：在最後加上下一個流水號

### Gemini 評分提示（模式3 用）
GeminiManager._buildPrompt 會使用以下欄位：
```javascript
// mode=3 時的 prompt 結構：
// 句型：${question.template}
// 示範：${question.example}
// 學生答案：${answer}
```

### 目前需補充的句型（開發者待辦）
- [ ] 1下語句練習（約 5~8 個句型）
- [ ] 2上語句練習（約 5~8 個句型）
- [ ] 2下語句練習（約 5~8 個句型）
- [ ] 說明（description）欄位需手動填入

---

## 六、程式影響範圍

### 使用 sentences 的程式（都不需改動）

| 程式 | 使用方式 | 說明 |
|------|---------|------|
| `sentence.js`（Task 26）| `loadSentencesForChar(char)` + `getSentenceData(char)` | 遊戲主程式 |
| `json_loader.js` | 管理所有載入邏輯 | 已含分冊支援 |
| `service_worker.js` | `/data/*.json → SWR 快取` | 自動適用新檔名 |
| `ParentReviewPage.js` | 讀 `pending_reviews` from Firestore | 不依賴 JSON |

### Firestore 相關欄位（家長設定）

```
users/{uid}.my_sentences   array   家長自設句型範例
  → sentence.js 模式3 出題時優先使用此欄位
  → 若為空，才使用 sentences_pattern.json

users/{uid}.settings.parent_review_mode
  "notify"     → AI 信心 <0.8 才送審
  "all_ai"     → 全部 AI 判斷，不通知
  "all_parent" → 全部送家長審核（score=-1）
```

---

## 七、新增資料流程（完整步驟）

### 新增一個課次的 compose 資料

1. **準備 Excel**（格式同 `1776181398645_一下第一課_看生字教學批次生成.xlsx`）
   - 欄位順序：生字 | 詞組 | 提示 | 造句
   - 確認每字至少 3 個詞組，prompt_word 是真實詞語

2. **執行轉換**（未來腳本）
   ```
   python3 excel_to_compose.py \
     --input "一下第二課_xxx.xlsx" \
     --book 2 --lesson 2
   ```

3. **合併到分冊 JSON**
   - 將新筆數加入 `sentences_compose_b2.json`（1下=b2）
   - ID 格式：`compose_{unicode}_{下一個seq}`

4. **更新索引（通常不需要）**
   - `sentences.json` 的 `char_book` 只需更新**新字**
   - 既有字的冊次不會改變

### 新增 fill 資料

1. **補充 Excel A 類（需加完整句子欄）**
   - 在 `(__)錢` 這類詞語片段的行，補充第三欄「完整句子」
   - 例：`要 | (__)錢 | 他需要帶夠（要）錢去買文具。`

2. **執行轉換**（未來腳本）
   ```
   python3 excel_to_fill.py \
     --input "一下第一課_看_補充版.xlsx" \
     --book 2 --lesson 1
   ```

3. **合併到分冊 JSON**
   - 加入 `sentences_fill_b2.json`

### 新增 pattern 句型

1. **手動編輯** `sentences_pattern.json`
2. 依照格式新增一筆，id 用下一個流水號
3. 必填：`template`（必須含「……」）、`example`、`source`
4. 建議填：`description`、`example_alt`、`grade`

---

## 八、驗證工具（待開發）

```bash
# 驗證 fill 格式
python3 validate_sentences.py fill --book 2

# 驗證 compose 格式（確認 prompt_word 包含 character）
python3 validate_sentences.py compose --book 2

# 驗證 pattern 格式（確認 template 含 ……）
python3 validate_sentences.py pattern

# 檢查 fill_position 是否正確
python3 check_fill_position.py --book 2
```

---

## 九、目前資料狀態（2026-04-15）

| 檔案 | 狀態 | 筆數 | 備註 |
|------|------|------|------|
| sentences_fill_b2.json | 🟡 測試版 | 3 筆 | 僅 1下第1課 B 類例句 |
| sentences_compose_b2.json | 🟡 測試版 | 65 筆 | 1下第1課 13字 × 5詞組 |
| sentences_pattern.json | 🟡 部分完成 | 8 筆 | 僅 4上，缺1下/2上/2下 |
| sentences_fill_b1/b3/b4 | 🔴 空 | 0 筆 | 等家長提供 Excel |
| sentences_compose_b1/b3/b4 | 🔴 空 | 0 筆 | 等家長提供 Excel |

---

*本文件由 AI 自動生成，開發者可依專案需求修改*
