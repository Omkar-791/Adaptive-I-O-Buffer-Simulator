import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const evidence = path.resolve('../build_phase15/phase1-browser', new Date().toISOString().replace(/[:.]/g, '-'));
const ownedRuns: string[] = [];
test.afterEach(async ({ request }) => {
  for (const id of ownedRuns) {
    const response = await request.get(`/api/v1/runs/${id}`);
    if (response.ok() && ['starting', 'running'].includes((await response.json()).status)) {
      await request.post(`/api/v1/runs/${id}/cancel`);
      await expect.poll(async () => (await (await request.get(`/api/v1/runs/${id}`)).json()).status).not.toMatch(/^(starting|running)$/);
    }
  }
});
async function shot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
}
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('real sampled buffers, native resize, cancellation and responsive evidence', async ({ page, request }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  expect((await (await request.get('/api/v1/health')).json()).native.available).toBe(true);
  const ids: string[] = [];
  for (const strategy of ['fixed', 'adaptive']) {
    const response = await request.post('/api/v1/runs', { data: { strategy,
      config: { num_streams: 2, buffer_capacity: 2, global_buffer_budget: 32,
        num_requests: 200, producer_interval_ms: 0, consumer_processing_ms: 5,
        min_payload_bytes: 64, max_payload_bytes: 128, random_seed: 42 },
      metrics: { interval_ms: 50, window_ms: 100 } } });
    expect(response.status()).toBe(202);
    const { id } = await response.json(); ids.push(id); ownedRuns.push(id);
    await page.goto(`/runs/${id}`);
    const region = page.getByRole('region', { name: 'Live buffer occupancy' });
    await expect(region.getByRole('meter')).toHaveCount(2);
    await expect(region).toContainText('Run state: Running');
    await shot(page, `${strategy}-live-desktop`);
    for (const width of [1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await noOverflow(page);
      if (width === 390) await shot(page, `${strategy}-live-mobile`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.run-strip')).toContainText('Completed', { timeout: 25000 });
    const telemetry = await (await request.get(`/api/v1/runs/${id}/telemetry?after=0&limit=100`)).json();
    const latest = telemetry.records.filter((event: { record: { type: string } }) => event.record.type === 'metrics_snapshot').at(-1).record;
    for (const stream of latest.streams) {
      const meter = region.getByRole('meter', { name: `Stream ${stream.stream_id} buffer occupancy` });
      await expect(meter).toHaveAttribute('aria-valuenow', String(stream.occupancy));
      await expect(meter).toHaveAttribute('aria-valuemax', String(stream.capacity));
    }
    if (strategy === 'adaptive') expect(telemetry.records.some((event: { record: { type: string; success?: boolean } }) => event.record.type === 'buffer_resize' && event.record.success)).toBe(true);
    await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
    await page.getByRole('link', { name: 'Configuration', exact: true }).click();
    await expect(page.locator('pre')).toContainText('global_buffer_budget');
    await page.getByRole('link', { name: 'Telemetry', exact: true }).click();
    await expect(page.locator('.event-log')).toContainText('metrics_snapshot');
    await page.getByRole('link', { name: 'Result', exact: true }).click();
    await expect(page.getByText('Successful result retrieved from the backend result endpoint. Whole-run summary.')).toBeVisible();
  }
  for (const [url, name] of [['/', 'dashboard'], ['/simulations/new', 'new'], ['/history', 'history']]) {
    await page.goto(url);
    await expect(page.locator('h1')).toBeVisible();
    if (name === 'dashboard') await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
    await noOverflow(page); await shot(page, `${name}-desktop`);
    if (name !== 'history') {
      await page.setViewportSize({ width: 390, height: 844 });
      await noOverflow(page); await shot(page, `${name}-mobile`);
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  const response = await request.post('/api/v1/runs', { data: { strategy: 'fixed',
    config: { num_streams: 2, buffer_capacity: 2, global_buffer_budget: 32, num_requests: 10000,
      producer_interval_ms: 0, consumer_processing_ms: 5 }, metrics: { interval_ms: 50, window_ms: 100 } } });
  expect(response.status()).toBe(202); const cancelled = await response.json(); ownedRuns.push(cancelled.id);
  await page.goto(`/runs/${cancelled.id}`);
  await expect(page.getByRole('meter')).toHaveCount(2);
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(page.locator('.run-strip')).toContainText('Cancelled', { timeout: 10000 });
  await expect(page.getByRole('region', { name: 'Live buffer occupancy' })).toContainText('Run ended; these are retained measurements');
  expect((await request.get(`/api/v1/runs/${cancelled.id}/result`)).status()).toBe(409);
  expect(errors).toEqual([]);
  await writeFile(path.join(evidence, 'observations.json'), JSON.stringify({ ids, cancelled: cancelled.id, errors }, null, 2));
});

