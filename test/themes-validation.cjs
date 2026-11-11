'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILTIN_THEMES, validateTheme } = require('../shared/themes.cjs');

function theme() { return structuredClone({ ...BUILTIN_THEMES[0], id: 'test-design' }); }

test('all six built-in themes validate, are immutable, and use safe colors', () => {
  assert.deepEqual(BUILTIN_THEMES.map(item => item.id), ['glacier', 'graphite', 'obsidian', 'porcelain', 'midnight', 'rose']);
  for (const item of BUILTIN_THEMES) {
    assert.deepEqual(validateTheme(item), item);
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.colors));
  }
});

test('theme validation rejects executable content, extra fields, unsafe IDs, and invalid colors', () => {
  const invalid = [
    { ...theme(), css: 'body { display:none }' },
    { ...theme(), name: '<img src=x onerror=alert(1)>' },
    { ...theme(), description: 'url(https://tracker.example/pixel)' },
    { ...theme(), author: 'javascript:alert(1)' },
    { ...theme(), id: '../secrets' },
    { ...theme(), id: 'DUPPERCASE' },
    { ...theme(), radius: 99 },
    { ...theme(), radius: 12.5 },
    { ...theme(), appearance: 'system' },
    { ...theme(), colors: { ...theme().colors, accent: 'red; background:url(x)' } },
    { ...theme(), colors: { ...theme().colors, shadow: '#ffffff' } },
    { ...theme(), name: 'a'.repeat(49) },
    JSON.parse(JSON.stringify(theme()).replace('"id":', '"__proto__":{},"id":')),
  ];
  for (const value of invalid) assert.throws(() => validateTheme(value), { name: 'ThemeValidationError' });
});

test('validation returns an independent canonical object', () => {
  const source = theme();
  source.colors.accent = '#ABCDEF';
  source.name = '  Custom  ';
  const result = validateTheme(source);
  assert.equal(result.name, 'Custom');
  assert.equal(result.colors.accent, '#abcdef');
  result.colors.bg = '#ffffff';
  assert.notEqual(source.colors.bg, result.colors.bg);
});
