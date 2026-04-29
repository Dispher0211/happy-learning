/**
 * version.js — 快樂學習 Happy Learning
 * 版本號統一來源（Single Source of Truth）
 *
 * 規則：
 *   - 此檔案為純常數定義，不含任何邏輯
 *   - 不可引用其他模組
 *   - 所有需要版本號的模組（json_loader、service_worker 等）皆從此處 import
 *
 * 使用方式：
 *   import { APP_VERSION } from '../version.js'
 *
 * 注意：service_worker.js 因 SW 環境不支援 ES Module import，
 *       需手動將版本號同步為相同字串常數。
 */

// 應用程式版本號（遵循 Semantic Versioning：major.minor.patch）
export const APP_VERSION = '1.0.6'
