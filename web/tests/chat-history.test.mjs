import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const compiled = createRequire(path.join(process.env.PSS_TEST_BUILD, 'test-loader.cjs'));
const { mergeStepChatLogs } = compiled(path.join(process.env.PSS_TEST_BUILD, 'lib/chat-history.js'));
const message = (text, second, sender = 'user') => ({
  text, sender, provider: 'ChatGPT', createdAt: `2026-10-04T00:00:0${second}Z`,
});

test('stale device snapshots retain both devices questions and answers in either commit order', () => {
  const original = [message('Original question', 0), message('Original answer', 1, 'assistant')];
  const deviceA = [...original, message('Device A question', 2), message('Device A answer', 4, 'assistant')];
  const deviceB = [...original, message('Device B question', 3), message('Device B answer', 5, 'assistant')];
  const expected = [original[0], original[1], deviceA[2], deviceB[2], deviceA[3], deviceB[3]];
  assert.deepEqual(mergeStepChatLogs(mergeStepChatLogs(original, deviceA), deviceB), expected);
  assert.deepEqual(mergeStepChatLogs(mergeStepChatLogs(original, deviceB), deviceA), expected);
  assert.equal(original.length, 2);
});

test('retrying a snapshot is idempotent and preserves structured research evidence', () => {
  const log = { ...message('Research answer', 1, 'assistant'), analysis: {
    selectedSources: ['research'], answer: { researchFindings: [{ text: 'Finding', sourceIds: ['R:W1'] }] },
    evidence: { papers: [{ sourceId: 'R:W1', openAlexId: 'https://openalex.org/W1', title: 'Original paper' }] },
  } };
  const saved = mergeStepChatLogs([], [log]);
  assert.deepEqual(mergeStepChatLogs(saved, [log]), [log]);
  assert.deepEqual(saved[0].analysis, log.analysis);
  assert.equal(mergeStepChatLogs(saved, []).length, 1);
});

test('legacy repeated messages survive restoration with temporary timestamps without duplication', () => {
  const legacy = { provider: 'ChatGPT', sender: 'Planner', text: 'Repeated question' };
  const stored = [legacy, { ...legacy }];
  const normalized = [message('Repeated question', 1), message('Repeated question', 2)];
  const next = message('New question', 3);
  const merged = mergeStepChatLogs(stored, [...normalized, next]);
  assert.deepEqual(merged, [...stored, next]);
  assert.deepEqual(mergeStepChatLogs(merged, [...normalized, next]), merged);
});

test('identical text sent at different times remains separate messages', () => {
  const first = message('Please explain again', 1);
  const second = message('Please explain again', 2);
  assert.deepEqual(mergeStepChatLogs([first], [first, second]), [first, second]);
});
