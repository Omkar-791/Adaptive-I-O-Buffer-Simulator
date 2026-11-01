export const defaults = { streams: '2', requests: '200', seed: '42', capacity: '8', budget: '32', producer: '5', consumer: '10', minimum: '512', maximum: '4096', interval: '100', window: '1000' };
export type FormValues = typeof defaults;
export type FormErrors = Partial<Record<keyof FormValues, string>>;
export function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const bounds: Record<keyof FormValues, [number, number]> = { streams: [1, 16], requests: [0, 10000], seed: [0, 4294967295], capacity: [1, 64], budget: [1, 1024], producer: [0, 1000], consumer: [0, 1000], minimum: [0, 1048576], maximum: [0, 1048576], interval: [10, 1000], window: [10, 60000] };
  for (const key of Object.keys(bounds) as (keyof FormValues)[]) {
    const [min, max] = bounds[key]; const value = Number(values[key]);
    if (values[key].trim() === '' || !Number.isSafeInteger(value) || value < min || value > max) errors[key] = `Enter a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.`;
  }
  if (!errors.streams && !errors.requests && Number(values.streams) * Number(values.requests) > 100000) errors.requests = 'Total requests across all streams cannot exceed 100,000.';
  if (!errors.streams && !errors.capacity && !errors.budget && Number(values.streams) * Number(values.capacity) > Number(values.budget)) errors.budget = 'Budget must cover the initial capacity of every stream.';
  if (!errors.minimum && !errors.maximum && Number(values.minimum) > Number(values.maximum)) errors.maximum = 'Maximum payload must be at least the minimum payload.';
  if (!errors.interval && !errors.window && Number(values.window) < Number(values.interval)) errors.window = 'Metrics window must be at least the sampling interval.';
  return errors;
}
