// Real renderer, synthetic microphone, isolated HTTP/WebSocket backend.
import { _electron as electron, expect } from '@playwright/test';
import { startBackend } from '../test/support/backend.mjs';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const backend = await startBackend();
const profile = await mkdtemp(join(tmpdir(), 'waystone-chat-audio-'));
const output = fileURLToPath(new URL('../../tmp/chat-audio-review/', import.meta.url));
await mkdir(output, { recursive: true });
let app;
try {
  for (const [name, kind] of [['campfire', 'emoji'], ['cheers', 'emoji'], ['mountain_party', 'sticker']]) {
    const response = await fetch(backend.origin + '/api/expressions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' }, body: JSON.stringify({ name, kind }) });
    expect(response.ok).toBeTruthy();
  }
  app = await electron.launch({ args: [fileURLToPath(new URL('../main.cjs', import.meta.url)), `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, WAYSTONE_E2E: '1' } });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('load');
  await page.locator('#connection-settings summary').click();
  await page.locator('#server').fill(backend.origin);
  await page.locator('#name').fill('Ada');
  await page.locator('#password').fill('test-password-long');
  await page.locator('#join-form button').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.setViewportSize({ width: 1234, height: 850 });
  await page.locator('#messages article').first().hover();
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await expect(page.locator('#composer-context')).toContainText('Replying to Grace');
  await page.locator('#cancel-context').click();
  for (const text of ['Anyone up for a game tonight?', 'I can hop in after dinner. Bring your questionable strategies.']) {
    await page.locator('#body').fill(text); await page.locator('#send').click();
    await expect(page.locator('#messages')).toContainText(text);
  }
  const own = page.locator('#messages article').last();
  await own.locator('.message-more summary').click();
  await page.screenshot({ path: join(output, 'message-actions.png') });
  await own.getByRole('button', { name: 'Edit message', exact: true }).click();
  await page.locator('#body').fill('I can hop in after dinner.');
  await page.locator('#send').click();
  await expect(own).toContainText('edited');
  await page.locator('#body').fill('Hello friend');
  await page.locator('#body').evaluate(area => area.setSelectionRange(6, 12));
  await page.locator('#expressions').click();
  await page.locator('#expression-search').fill('camp');
  await expect(page.locator('#expression-grid .expression-item')).toHaveCount(1);
  await page.screenshot({ path: join(output, 'emoji-picker.png') });
  await page.locator('#expression-grid button').click();
  await expect(page.locator('#body')).toHaveValue('Hello :campfire:');
  expect(await page.locator('#body').evaluate(area => area.selectionStart)).toBe('Hello :campfire:'.length);
  await page.locator('#expressions').click();
  await page.locator('#expression-search').fill('does_not_exist');
  await expect(page.locator('#expression-grid')).toContainText('No matches');
  await page.locator('#expression-search').fill('');
  await page.locator('#sticker-tab').click();
  await expect(page.locator('#expression-grid')).toHaveAttribute('data-kind', 'sticker');
  await page.locator('#expression-grid button').click();
  await expect(page.locator('#messages .sticker')).toHaveCount(1);
  await page.locator('#messages article').first().hover();
  await page.locator('#messages article').first().getByRole('button', { name: 'Add reaction' }).click();
  await expect(page.locator('#sticker-tab')).toBeHidden();
  await page.locator('#expression-search').fill('cheers');
  await page.locator('#expression-grid button').click();
  await expect(page.locator('#messages .reaction')).toHaveCount(1);
  await page.locator('#settings-open').click();
  await page.locator('[data-settings-page="audio"]').click();
  await page.evaluate(() => {
    const devices = navigator.mediaDevices; const original = devices.getUserMedia.bind(devices);
    window.testMicStreams = [];
    devices.getUserMedia = async (...args) => { const stream = await original(...args); window.testMicStreams.push(stream); return stream; };
  });
  await page.locator('#audio-test').click();
  await expect(page.locator('#audio-test-level')).toContainText('dB', { timeout: 20000 });
  await page.locator('#audio-input-mode').selectOption('manual');
  await expect(page.locator('#audio-threshold-row')).toBeVisible();
  await page.locator('#audio-threshold').fill('-42');
  await page.locator('#audio-threshold').dispatchEvent('change');
  await expect(page.locator('#audio-test-level')).toContainText('opens at -42 dB');
  await page.locator('#audio-test').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'audio-settings.png') });
  await page.locator('#audio-test').click();
  await expect(page.locator('#audio-test-state')).toHaveText('Microphone test is off');
  // Also exercise the gate-only path with suppression disabled.
  await page.locator('#audio-noise').selectOption('off');
  await page.locator('#audio-test').click();
  await expect(page.locator('#audio-test-level')).toContainText('dB');
  await page.locator('[data-settings-page="account"]').click();
  await expect(page.locator('#audio-test')).toHaveText('Test microphone');
  expect(await page.evaluate(() => window.testMicStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBeTruthy();
  expect(errors).toEqual([]);
  console.log('Chat actions, emoji/stickers, and real RNNoise/gate worklets passed. Screenshots: ' + output);
} finally {
  await app?.close(); await backend.close(); await rm(profile, { recursive: true, force: true });
}
