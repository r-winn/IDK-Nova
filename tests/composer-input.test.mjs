import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function mount(value = '') {
  const events = [], values = [];
  let storageReads = 0;
  const commands = { exports: {} };
  const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compile('../src/lib/command-suggestions.ts'), { module: commands, exports: commands.exports });
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useId: () => 'commands', useRef: () => ({ current: null }),
      useState: initial => [initial, () => events.push('suggestion state')],
      isValidElement: item => Boolean(item?.props),
      cloneElement: (child, props) => ({ ...child, props: { ...child.props, ...props } }),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../lib/prompts': { savedPrompts: () => { storageReads++; return []; } },
    '../lib/extensions': { extensionCatalog: [], installedExtensions: () => { storageReads++; return []; } },
    '../agent/catalog': { providerTools: [] },
    '../lib/command-suggestions': commands.exports,
  };
  const component = { exports: {} };
  vm.runInNewContext(compile('../src/components/CommandSuggestions.tsx'), {
    module: component, exports: component.exports, require: name => modules[name],
  });
  const tree = component.exports.CommandSuggestions({ value, onChange: () => {}, children: jsx('textarea', {
    onChange: event => { events.push('controlled value'); values.push(event.currentTarget.value); },
    onSelect: () => events.push('original selection'),
  }) });
  return { root: tree.props, input: tree.props.children[1].props, events, values, reads: () => storageReads };
}

test('Composer never mutates state during input capture, before controlled onChange', () => {
  const { root, input, events } = mount();
  assert.equal(root.onInputCapture, undefined);
  assert.equal(root.onSelectCapture, undefined);
  input.onChange({ currentTarget: { value: 'a', selectionStart: 1 } });
  assert.equal(events[0], 'controlled value');
});

test('Every Latin/Persian character, mixed text and paste reaches the original input handler', () => {
  const { input, values } = mount();
  const text = 'abcdefghijklmnopqrstuvwxyz سلام دنیا English 123';
  const prefixes = Array.from(text, (_, index) => text.slice(0, index + 1));
  for (const value of prefixes) input.onChange({ currentTarget: { value, selectionStart: value.length } });
  const paste = 'متن طولانی\nsecond line @calculate 12*7';
  input.onChange({ currentTarget: { value: paste, selectionStart: paste.length } });
  assert.deepEqual(values, [...prefixes, paste]);
});

test('Caret selection preserves existing selection handler; ordinary input skips library reads', () => {
  const { input, events, reads } = mount('ordinary text');
  input.onSelect({ currentTarget: { selectionStart: 3 } });
  assert.equal(events[0], 'original selection');
  assert.equal(reads(), 0);
});

test('Composition and ordinary Enter are not intercepted by command suggestions', () => {
  const { root } = mount();
  let prevented = false;
  for (const isComposing of [true, false]) root.onKeyDownCapture({ nativeEvent: { isComposing }, key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
