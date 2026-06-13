import { describe, expect, it } from 'vitest';

import { getHealthStatus } from './health.js';

describe('web health skeleton', () => {
  it('returns skeleton health status', () => {
    expect(getHealthStatus()).toEqual({ status: 'ok', stage: 'skeleton' });
  });
});
