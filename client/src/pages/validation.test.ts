import { describe, expect, it } from 'vitest';
import { defaults, validateForm } from './validation';
describe('configuration validation', () => {
  it('accepts the default and zero-request workloads', () => {
    expect(validateForm(defaults)).toEqual({});
    expect(validateForm({ ...defaults, requests: '0', minimum: '0', maximum: '0', producer: '0', consumer: '0' })).toEqual({});
  });
  it('rejects empty, fractional and nonnumeric inputs', () => {
    expect(validateForm({ ...defaults, streams: '', requests: '1.5', seed: 'abc' })).toMatchObject({ streams: expect.any(String), requests: expect.any(String), seed: expect.any(String) });
  });
  it('enforces per-stream and global request bounds', () => {
    expect(validateForm({ ...defaults, requests: '10001' }).requests).toBeTruthy();
    expect(validateForm({ ...defaults, streams: '16', requests: '10000', budget: '128' }).requests).toContain('100,000');
    expect(validateForm({ ...defaults, streams: '10', requests: '10000', budget: '80' })).toEqual({});
  });
  it('enforces physical capacity and budget constraints', () => {
    expect(validateForm({ ...defaults, capacity: '65' }).capacity).toBeTruthy();
    expect(validateForm({ ...defaults, capacity: '32', budget: '63' }).budget).toContain('initial capacity');
    expect(validateForm({ ...defaults, budget: '1025' }).budget).toBeTruthy();
  });
  it('validates payload order and one MiB maximum', () => {
    expect(validateForm({ ...defaults, minimum: '100', maximum: '99' }).maximum).toContain('minimum');
    expect(validateForm({ ...defaults, maximum: '1048577' }).maximum).toBeTruthy();
  });
  it('validates sampling frequency and metrics window', () => {
    expect(validateForm({ ...defaults, interval: '9' }).interval).toBeTruthy();
    expect(validateForm({ ...defaults, interval: '1000', window: '999' }).window).toContain('sampling interval');
    expect(validateForm({ ...defaults, window: '60001' }).window).toBeTruthy();
  });
  it('accepts uint32 maximum seed and rejects overflow', () => {
    expect(validateForm({ ...defaults, seed: '4294967295' })).toEqual({});
    expect(validateForm({ ...defaults, seed: '4294967296' }).seed).toBeTruthy();
  });
});
