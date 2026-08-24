// ============================================================================
// playwright.config.js — E2E の実行設定（ORDER §3 テスト＝Playwright / §6 P0・P3・P4）
//
// 前提（別担当が用意する契約・CLAUDE.md「固定インターフェース」）:
//   - package.json は "type":"module"
//   - npm run serve  … node scripts/serve.mjs が public/ を :4173 で配信する
//   - npm run test:e2e … playwright test
//   - CI（.github/workflows/e2e.yml）は先に python tools/mock.py を回してから実行する
//
// ビューポートは2つ。360x800 は ORDER §5 デザイン憲章の基準幅（tools/audit.js の
// 判定もこの幅を前提にしている）。412x915 は現行 Android の実勢サイズ。
// どちらも「電話1枚」で、PC 幅は仕様上の対象外なので置かない。
// ============================================================================

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests',
  outputDir: 'test-results',

  // 各テストは独立（localStorage も Service Worker もコンテキストごとに真っさら）。
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: BASE_URL,

    // 言語判定（app.js の pickLang）は navigator.language を見る。CI とローカルで
    // 既定言語がぶれないようロケールを固定し、各テストは必要なら ?lang= で上書きする。
    locale: 'en-US',
    timezoneId: 'Asia/Tokyo',

    // テーマ既定は auto。prefers-color-scheme を light に固定して data-theme を決定論的にする。
    colorScheme: 'light',

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'phone-360',   // デザイン憲章の基準幅
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'phone-412',
      use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 915 } },
    },
  ],

  webServer: {
    command: 'npm run serve',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
