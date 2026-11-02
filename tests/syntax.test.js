// インラインスクリプトの構文チェックと、起動時エラーが無いことの確認（ハナハナカウンターの tests/syntax.test.js から）
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp, extractScript } = require('./helpers');

test('インラインスクリプトが構文エラーなくパースできる', () => {
  assert.doesNotThrow(() => new vm.Script(extractScript()));
});

test('起動時に JS エラーが出ない', () => {
  const { errors } = loadApp();
  assert.deepEqual(errors, []);
});
