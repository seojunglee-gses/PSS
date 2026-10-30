import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { messagesByLocale, translate, localizeMessage, localizeDefaultContent } = require(`${process.env.PSS_TEST_BUILD}/lib/i18n.js`);

test('English and Korean have matching UI keys and interpolation parameters', () => {
  assert.deepEqual(Object.keys(messagesByLocale.en).sort(), Object.keys(messagesByLocale.ko).sort());
  for (const [key, english] of Object.entries(messagesByLocale.en)) {
    assert.doesNotMatch(english, /[가-힣]/, key);
    const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(parameters(english), parameters(messagesByLocale.ko[key]), key);
    assert.ok(messagesByLocale.ko[key].trim(), key);
  }
});

test('legacy notices and spatial summaries change language without modifying stored values', () => {
  assert.equal(localizeMessage('en', '분석 영역의 면적은 1,200m²입니다.'), 'The analysis area is 1,200m².');
  assert.equal(localizeMessage('ko', 'Alternative 3'), '계획안 3');
  assert.equal(localizeMessage('en', '이 프로젝트에 참여할 권한이 없습니다.'), 'You do not have access to this project.');
  assert.equal(localizeMessage('en', 'access.checkFailed'), translate('en', 'access.checkFailed'));
  assert.equal(localizeMessage('en', 'unrecognized SDK error', 'image.uploadFailed'), translate('en', 'image.uploadFailed'));
  // Project/case prose, original questions and publication titles are not machine-translated.
  const original = '주민이 직접 작성한 사업 내용';
  assert.equal(localizeMessage('en', original), original);
  assert.equal(localizeDefaultContent('ko', 'Save'), 'Save');
  assert.equal(localizeDefaultContent('ko', messagesByLocale.en['default.problemText']), messagesByLocale.ko['default.problemText']);
  assert.equal(translate('en', 'cases.deleteNamed', { name: '<Case 5>' }), 'Delete <Case 5>');
});

test('frontend JSX keeps fixed interface copy in the locale catalogs', () => {
  const files = [...readdirSync('components', { recursive: true }).filter(f => f.endsWith('.tsx')).map(f => `components/${f}`),
    'pages/index.tsx', 'pages/workspace/index.tsx', 'pages/setting/index.tsx', 'pages/report/index.tsx'];
  const allowed = new Set(['PPSS', 'DOI', 'OpenAlex', 'Kakao Maps', 'OpenStreetMap', 'Kakao Walking Route', 'WGS84 · EPSG:4326', 'Web Mercator · EPSG:3857', 'px', 'm']);
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      if (ts.isJsxText(node)) {
        const text = node.text.trim().replace(/\s+/g, ' ');
        if (/[A-Za-z가-힣]/.test(text)) assert.ok(allowed.has(text), `${file}: ${text}`);
      }
      if (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent) && ['aria-label', 'placeholder', 'alt', 'title'].includes(node.parent.name.text)) {
        assert.doesNotMatch(node.text, /[가-힣]|[a-z] [a-z]/i, `${file}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});
