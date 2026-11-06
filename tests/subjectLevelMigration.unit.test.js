import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Unit test for classification logic (extracted from migration script)
function extractNumericPart(code) {
  if (!code || typeof code !== 'string') return null;
  const s = code.trim();
  if (!s) return null;
  const matches = s.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  if (matches.length > 1) {
    return { numeric: null, ambiguous: true };
  }
  return { numeric: matches[0], ambiguous: false };
}

function classifyLevelFromCode(code) {
  const res = extractNumericPart(code);
  if (!res) return { expected: null, reason: 'no_numeric_component' };
  if (res.ambiguous) return { expected: null, reason: 'ambiguous_numeric_format' };
  if (!/^\d+$/.test(res.numeric)) return { expected: null, reason: 'invalid_numeric_format' };
  const first = res.numeric[0];
  if (first === '1') return { expected: '100', reason: 'numeric_starts_with_1' };
  if (first === '2') return { expected: '200', reason: 'numeric_starts_with_2' };
  if (first === '3') return { expected: '300', reason: 'numeric_starts_with_3' };
  if (first === '4') return { expected: '400', reason: 'numeric_starts_with_4' };
  if (first === '5') return { expected: '500', reason: 'numeric_starts_with_5' };
  if (first === '6') return { expected: '600', reason: 'numeric_starts_with_6' };
  return { expected: null, reason: `unsupported_first_digit_${first}` };
}

describe('Subject level classification from course code', () => {
  it('classifies 1xx as 100', () => {
    assert.equal(classifyLevelFromCode('ACC102').expected, '100');
    assert.equal(classifyLevelFromCode('AGG102').expected, '100');
    assert.equal(classifyLevelFromCode('BIO102').expected, '100');
    assert.equal(classifyLevelFromCode('CHM 102').expected, '100');
    assert.equal(classifyLevelFromCode('COS102').expected, '100');
    assert.equal(classifyLevelFromCode('CYB 102').expected, '100');
    assert.equal(classifyLevelFromCode('CYB102').expected, '100');
    assert.equal(classifyLevelFromCode('ECO102').expected, '100');
    assert.equal(classifyLevelFromCode('ENG102').expected, '100');
    assert.equal(classifyLevelFromCode('GST112').expected, '100');
    assert.equal(classifyLevelFromCode('CSC101').expected, '100');
    assert.equal(classifyLevelFromCode('MTH101').expected, '100');
  });
  it('classifies 2xx as 200', () => {
    assert.equal(classifyLevelFromCode('CHM202').expected, '200');
    assert.equal(classifyLevelFromCode('CHM208').expected, '200');
    assert.equal(classifyLevelFromCode('CSC201').expected, '200');
  });
  it('classifies 3xx/4xx', () => {
    assert.equal(classifyLevelFromCode('MTH302').expected, '300');
    assert.equal(classifyLevelFromCode('PHY401').expected, '400');
  });
  it('handles formatting', () => {
    assert.equal(classifyLevelFromCode('CHM-102').expected, '100');
    assert.equal(classifyLevelFromCode('CHM 102').expected, '100');
  });
  it('handles edge cases', () => {
    assert.equal(classifyLevelFromCode('').expected, null);
    assert.equal(classifyLevelFromCode(null).expected, null);
    assert.equal(classifyLevelFromCode('ABC').expected, null);
    assert.equal(classifyLevelFromCode('123-456').expected, null); // ambiguous
  });
  it('idempotent behavior conceptually supported (classification pure)', () => {
    const r1 = classifyLevelFromCode('ACC102');
    const r2 = classifyLevelFromCode('ACC102');
    assert.deepEqual(r1, r2);
  });
});
