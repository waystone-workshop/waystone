import { _electron as electron, expect } from '@playwright/test';
import { startBackend } from '../test/support/backend.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Layout fixtures use the real renderer and controls, without requesting a camera
// or connecting to a production call. Media transport is covered by audio.mjs.
const backend = await startBackend();
const profile = await mkdtemp(join(tmpdir(), 'waystone-lobby-'));
const output = fileURLToPath(new URL('../../tmp/lobby-review/', import.meta.url));
await mkdir(output, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [fileURLToPath(new URL('../main.cjs', import.meta.url)), `--user-data-dir=${profile}`], env: { ...process.env, WAYSTONE_E2E: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  await page.locator('#connection-settings summary').click();
  await page.locator('#server').fill(backend.origin);
  await page.locator('#name').fill('Ada');
  await page.locator('#password').fill('test-password-long');
  await page.locator('#join-form button').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.evaluate(() => {
    const $ = id => document.getElementById(id);
    $('lobby').hidden = false;
    $('lobby-name').textContent = 'Late night party';
    $('lobby-count').textContent = '4 here';
    $('join-audio').hidden = true;
    $('lobby-actions').append($('call-panel'));
    $('call-panel').hidden = false;
    $('call-channel').textContent = 'Late night party';
    $('call-count').textContent = '4';
    for (const [i, name] of ['Ada · you', 'Grace', 'Lin', 'Rowan · muted'].entries()) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'lobby-person' + (i === 1 ? ' speaking' : '');
      button.textContent = name;
      li.append(button); $('lobby-people').append(li);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(output, 'audio.png') });
  await page.evaluate(() => {
    const $ = id => document.getElementById(id);
    $('call-media').hidden = false;
    const tile = (name, share) => {
      const node = document.createElement('div'); node.className = 'call-tile'; node.dataset.share = share ? '1' : '0';
      const button = document.createElement('button'); button.className = 'call-focus'; button.setAttribute('aria-label', `Show ${name}`);
      const video = document.createElement('video');
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = share ? '#22312c' : '#383027'; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#b9cba8'; ctx.font = '32px sans-serif'; ctx.fillText(share ? 'Shared screen — layout fixture' : name, 56, 90);
      if (share) { ctx.fillStyle = '#31483e'; for (let i = 0; i < 5; i++) ctx.fillRect(56 + i * 235, 150, 210, 490); }
      video.srcObject = canvas.captureStream(1); video.muted = true; video.play();
      const caption = document.createElement('span'); caption.textContent = name;
      button.append(video, caption); node.append(button); return node;
    };
    $('call-stage').append(tile('Grace · sharing', true));
    $('call-cameras').append(tile('Grace', false), tile('Ada · you', false));
  });
  for (const [width, height] of [[1440, 900], [1100, 900], [850, 650], [700, 760]]) {
    await page.setViewportSize({ width, height });
    if (width <= 760) await page.locator('#members-collapse').click();
    await page.screenshot({ path: join(output, `screen-${width}.png`) });
    {
      const issues = await page.evaluate(() => {
        const $ = id => document.getElementById(id);
        const stage = $('call-stage').getBoundingClientRect();
        const lobby = $('lobby').getBoundingClientRect();
        const controls = $('call-panel').getBoundingClientRect();
        const composer = $('composer').getBoundingClientRect();
        const failures = [];
        if (document.documentElement.scrollWidth > innerWidth) failures.push('window overflows');
        if (controls.right > lobby.right + 1 || controls.left < lobby.left - 1) failures.push('call controls escape lobby');
        if (controls.top < lobby.top || controls.bottom > lobby.bottom + 1) failures.push('call controls clipped');
        if (stage.height < 100 || stage.width < 240) failures.push('shared screen collapsed');
        if (composer.bottom > innerHeight + 1) failures.push('composer clipped');
        const title = $('lobby-name').getBoundingClientRect();
        if (title.bottom > controls.top) failures.push('controls overlap room heading');
        for (const id of ['call-mute', 'call-camera', 'call-share', 'call-leave']) {
          const button = $(id).getBoundingClientRect();
          if (button.right > lobby.right || button.bottom > lobby.bottom || button.left < lobby.left) failures.push(id + ' clipped');
        }
        if ($('body').getBoundingClientRect().width < 200) failures.push('message input too narrow');
        return failures;
      });
      expect(issues, `layout at ${width}px`).toEqual([]);
    }
  }
  await page.evaluate(() => document.getElementById('call-stage').replaceChildren());
  await page.screenshot({ path: join(output, 'cameras.png') });
  console.log(`Lobby layout checks passed. Screenshots: ${output}`);
} finally {
  await app?.close();
  await backend.close();
  await rm(profile, { recursive: true, force: true });
}
