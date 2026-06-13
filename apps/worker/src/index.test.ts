import { describe, expect, it } from 'vitest';

import { createWorkerStub } from './index.js';

describe('worker skeleton', () => {
  it('returns skeleton status', () => {
    expect(createWorkerStub()).toEqual({ status: 'skeleton' });
  });
});
