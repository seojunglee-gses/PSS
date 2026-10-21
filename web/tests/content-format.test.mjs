import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {parseSections,serializeSections,inlineHtml,imageList}=require(`${process.env.PSS_TEST_BUILD}/lib/content-format.js`);
test('legacy plain text and line breaks survive section serialization',()=>{
 const text='사업 배경\n주민 의견\n\n사업 목표';
 assert.equal(serializeSections(parseSections(text)),text);
 assert.equal(parseSections('')[0].text,'');
});
test('headings, bold, font sizes and multiple sections round trip',()=>{
 const sections=[{kind:'h2',size:24,text:'사업 목표'},{kind:'h3',size:20,text:'주민 의견'},{kind:'p',size:14,text:'**보행 환경**을 개선합니다.\n\n두 번째 줄'}];
 assert.deepEqual(parseSections(serializeSections(sections)),sections);
 assert.deepEqual(parseSections(serializeSections([{kind:'h2',size:16,text:'작은 제목'}])),[{kind:'h2',size:16,text:'작은 제목'}]);
 assert.equal(inlineHtml('**핵심**\n다음 문단'),'<strong>핵심</strong><br>다음 문단');
});
test('rich text escapes untrusted markup instead of executing HTML',()=>{
 const html=inlineHtml('<img src=x onerror=alert(1)> **자료** <script>alert(1)</script>');
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('<strong>자료</strong>'));
});
test('legacy single images and multiple HTTPS images share the existing string field',()=>{
 assert.deepEqual(imageList('https://example.org/a.jpg'),['https://example.org/a.jpg']);
 assert.deepEqual(imageList('https://example.org/a.jpg\nhttps://example.org/b.jpg'),['https://example.org/a.jpg','https://example.org/b.jpg']);
 assert.deepEqual(imageList('javascript:alert(1)\ndata:text/html,hello'),[]);
});
