import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/input-requests.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, DOMException, Error });
const { validateInputRequest, collectInputAnswers, waitForInput } = module.exports;
const request = { title: 'Email details', questions: [
  { id: 'recipient', question: 'Who receives the email?', options: [] },
  { id: 'language', question: 'Which language?', options: ['English', 'فارسی'] },
  { id: 'tone', question: 'Tone?', options: ['Formal', 'Friendly', 'Brief', 'Warm'] },
  { id: 'purpose', question: 'Purpose?', options: [] },
] };

test('Input form validates multiple steps, choices and unique IDs', () => {
  assert.equal(validateInputRequest(request).questions.length, 4);
  assert.throws(() => validateInputRequest({ ...request, questions: [] }), /Invalid/);
  assert.throws(() => validateInputRequest({ ...request, questions: [request.questions[0], request.questions[0]] }), /duplicate/);
  assert.throws(() => validateInputRequest({ ...request, questions: [{ ...request.questions[0], options: Array(5).fill('Option') }] }), /Invalid/);
  assert.throws(() => validateInputRequest({ ...request, title: 'x'.repeat(101) }), /Invalid/);
});
test('Options allow custom free text and missing answers cannot complete the form', () => {
  assert.throws(() => collectInputAnswers(request, {}), /Answer each/);
  const answers = collectInputAnswers(request, { recipient: 'Sam', language: 'French', tone: 'Warm', purpose: 'Welcome' });
  assert.equal(answers[1].answer, 'French');
  assert.equal(answers[3].question, 'Purpose?');
});
test('Model call waits for all real answers; returning to earlier steps keeps data', async () => {
  const controller = new AbortController(); let session, finished = false;
  const pending = waitForInput(request, controller.signal, value => { session = value; }).then(result => { finished = true; return result; });
  await Promise.resolve(); assert.equal(finished, false);
  assert.throws(() => session.submit({ recipient: 'Sam' }), /Answer each/);
  assert.equal(finished, false);
  session.submit({ recipient: 'Updated Sam', language: 'English', tone: 'Formal', purpose: 'Welcome' });
  const answers = await pending;
  assert.equal(answers[0].answer, 'Updated Sam'); assert.equal(session, null);
});
test('Cancel, stop and already-aborted tasks close the form without leaking a pending promise', async () => {
  let session;
  const controller = new AbortController();
  const cancelled = waitForInput(request, controller.signal, value => { session = value; });
  session.cancel(); await assert.rejects(cancelled, /__NOVA_INPUT_CANCELLED__/); assert.equal(session, null);
  const stopped = waitForInput(request, controller.signal, value => { session = value; });
  controller.abort(); await assert.rejects(stopped, error => error.name === 'AbortError'); assert.equal(session, null);
  await assert.rejects(waitForInput(request, controller.signal, () => {}), error => error.name === 'AbortError');
});
