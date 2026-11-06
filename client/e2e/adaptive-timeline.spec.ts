import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const evidence = path.resolve('../build_phase15/phase2-browser', new Date().toISOString().replace(/[:.]/g, '-'));
test('real fixed/adaptive timelines and keyboard marker correspondence', async ({ page, request }) => {
  test.setTimeout(90000);
  const owned: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(evidence, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
  const fits = async (target: Page) => {
    try {
      await expect.poll(() => target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } catch (error) {
      await writeFile(path.join(evidence, 'overflow.json'), JSON.stringify(await target.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, outside: [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 25).map(e => ({ tag: e.tagName, cls: e.getAttribute('class'), right: e.getBoundingClientRect().right })) })), null, 2));
      await shot('overflow'); throw error;
    }
  };
  try {
    for (const strategy of ['fixed', 'adaptive']) {
      const created = await request.post('/api/v1/runs', { data: { strategy, config: { num_streams: 2, buffer_capacity: 2, global_buffer_budget: 32, num_requests: 200, producer_interval_ms: 0, consumer_processing_ms: 5, min_payload_bytes: 64, max_payload_bytes: 128, random_seed: 42 }, metrics: { interval_ms: 50, window_ms: 100 } } });
      expect(created.status()).toBe(202); const { id } = await created.json(); owned.push(id);
      await page.goto(`/runs/${id}`);
      await expect(page.locator('.run-strip')).toContainText('Completed', { timeout: 25000 });
      await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
      const timeline = page.getByRole('region', { name: 'Adaptive decision timeline' });
      await expect(timeline).toBeVisible();
      if (strategy === 'fixed') {
        await expect(timeline).toContainText('No adaptive resize events are expected');
        await expect(page.locator('.chart-resize-buttons button')).toHaveCount(0);
      } else {
        const telemetry = await (await request.get(`/api/v1/runs/${id}/telemetry?after=0&limit=100`)).json();
        const events = telemetry.records.filter((e: { record: { type: string } }) => e.record.type === 'buffer_resize');
        expect(events.length).toBeGreaterThan(0);
        expect(events.some((event: { record: { success: boolean } }) => event.record.success)).toBe(true);
        for (const event of events) {
          const outcome = event.record.success ? 'Applied' : [event.record.deferred ? 'Deferred' : '', event.record.stale ? 'Stale' : ''].filter(Boolean).join(' · ') || 'Rejected';
          const item = timeline.getByLabel(`Resize event ${event.index}: ${outcome}`, { exact: true });
          await expect(item).toContainText(event.record.reason);
          for (const stream of event.record.streams) {
            await expect(item).toContainText(`Previous: ${stream.previous_capacity} slots`);
            await expect(item).toContainText(`Requested: ${stream.requested_capacity} slots`);
            await expect(item).toContainText(`Actual: ${stream.actual_capacity} slots`);
          }
          const trigger = telemetry.records.find((e: { record: { type: string; sequence?: number } }) => e.record.type === 'metrics_snapshot' && e.record.sequence === event.record.snapshot_sequence);
          if (trigger) {
            const buttons = page.getByRole('button', { name: new RegExp(`^Resize #${event.index}: ${outcome}, trigger sample`) });
            await expect(buttons).toHaveCount(2);
            await page.locator(`[data-resize-index="${event.index}"]`).first().locator('line').last().click({ force: true });
            await expect(item).toBeFocused();
            await buttons.first().focus(); await buttons.first().press('Enter');
            await expect(item).toBeFocused();
            await expect(item.locator('details')).toHaveAttribute('open', '');
            await expect(item).toContainText('Next retained sample');
            await expect(page.locator(`[data-resize-index="${event.index}"]`)).toHaveCount(2);
          }
        }
        await shot('adaptive-timeline-desktop');
        await page.mouse.move(10, 10);
        for (const width of [1280, 1024, 768, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 }); await fits(page);
        }
        await shot('adaptive-timeline-mobile');
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(page.getByRole('region', { name: 'Live buffer occupancy' }).getByRole('meter')).toHaveCount(2);
      }
      await page.getByRole('link', { name: 'Configuration', exact: true }).click(); await expect(page.locator('pre')).toContainText('global_buffer_budget');
      await page.getByRole('link', { name: 'Result', exact: true }).click(); await expect(page.getByRole('region', { name: 'Adaptive decision timeline' })).toBeVisible();
    }
    for (const [url, name] of [['/', 'dashboard'], ['/simulations/new', 'new'], ['/history', 'history']]) {
      await page.goto(url); await expect(page.locator('h1')).toBeVisible();
      if (name === 'dashboard') await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
      await shot(`${name}-desktop`);
      if (name !== 'history') { await page.setViewportSize({ width: 390, height: 844 }); await fits(page); await shot(`${name}-mobile`); await page.setViewportSize({ width: 1440, height: 900 }); }
    }
    expect(errors).toEqual([]);
    await writeFile(path.join(evidence, 'observations.json'), JSON.stringify({ ids: owned, errors }, null, 2));
  } finally {
    for (const id of owned) {
      const response = await request.get(`/api/v1/runs/${id}`);
      if (response.ok() && ['starting', 'running'].includes((await response.json()).status)) await request.post(`/api/v1/runs/${id}/cancel`);
    }
  }
});
