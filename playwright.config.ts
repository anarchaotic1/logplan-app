import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 60000, workers: 1, reporter: [['list']], outputDir: 'test-results',
  use: { baseURL: 'http://localhost:4173', serviceWorkers: 'block', launchOptions: { executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] }, channel: process.env.CHROME_PATH ? undefined : 'chrome' },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60000 },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'laptop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone-reduced-motion', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' } },
  ],
});
