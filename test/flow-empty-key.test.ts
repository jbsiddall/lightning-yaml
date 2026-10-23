import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';

describe('implicit empty key in flow mappings', () => {
  it('parses flow mappings with implicit empty key', () => {
    expect(parse('{ : v}')).toEqual({ '': 'v' });
    expect(parse('{: v}')).toEqual({ '': 'v' });
    expect(parse('{ : }')).toEqual({ '': null });
    expect(parse('{:}')).toEqual({ '': null });
  });

  it('parses flow mappings with implicit empty key and multiple entries', () => {
    expect(parse('{ : v, a: b }')).toEqual({ '': 'v', a: 'b' });
    expect(parse('{ a: b, : v }')).toEqual({ a: 'b', '': 'v' });
  });
});
