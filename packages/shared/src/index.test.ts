import { describe, expect, it } from 'vitest';

import { sharedPackageName } from './index.js';

describe('shared skeleton', () => {
  it('exports package name', () => {
    expect(sharedPackageName).toBe('@time-management/shared');
  });
});
