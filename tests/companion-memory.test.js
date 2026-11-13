/* global globalThis */
/* eslint-disable playwright/expect-expect */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/scripts/companion-shell/memory.js', import.meta.url), 'utf8'))
    .replace('import { button, element, nativeAction, section } from \'./dom.js\';', 'const { button, element, nativeAction, section } = globalThis.testDom;')
    .replace('import { getRecallTrace } from \'./recall-state.js\';', 'const getRecallTrace = () => null;')
    .replace('import { getPromptUsage } from \'./prompt-state.js\';', 'const getPromptUsage = () => null;');

function node(tag, text = '') {
    return { tag, textContent: text, children: [], dataset: {}, listeners: {}, append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener(type, handler) { this.listeners[type] = handler; } };
}
function setup() {
    globalThis.testDom = {
        element: (tag, _className, text) => node(tag, text),
        button: (label, handler) => ({ label, handler }),
        section: title => node('section', title),
        nativeAction: () => {},
    };
    globalThis.document = { createTextNode: value => value, querySelector: () => ({}) };
    const context = {
        chatId: 'same', characterId: 0, characters: [{ avatar: 'first.png' }],
        chat: [{ mes: 'message', extra: { memory: 'summary' } }],
        extensionPrompts: {}, extensionSettings: {}, maxContext: 1000,
        saveChat: async () => {},
    };
    return context;
}
async function memoryModule() {
    return import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${Math.random()}`).toString('base64')}`);
}
function controls(container) {
    const summary = container.children.find(child => child.textContent === 'Running summary');
    return { editor: summary.children.find(child => child.tag === 'textarea'), actions: summary.children.find(child => child.tag === 'div').children };
}

test('inactive sheet does not render or permit actions', async () => {
    const context = setup();
    const memory = await memoryModule();
    let active = false;
    const container = node('main');
    const options = { getContext: () => context, identity: () => context.chatId, isActive: () => active };
    await memory.renderMemory(container, options);
    assert.deepEqual(container.children, []);
    active = true;
    await memory.renderMemory(container, options);
    const save = controls(container).actions.find(child => child.label === 'Save summary');
    active = false;
    await assert.rejects(save.handler(), /panel changed/);
});

test('stale summary action cannot mutate another character with the same chat id', async () => {
    const context = setup();
    const memory = await memoryModule();
    const container = node('main');
    await memory.renderMemory(container, { getContext: () => context, identity: () => context.chatId });
    const save = controls(container).actions.find(child => child.label === 'Save summary');
    context.characters[0] = { avatar: 'second.png' };
    await assert.rejects(save.handler(), /conversation or panel changed/);
});

test('unsaved marker follows edits and cancel restores the summary', async () => {
    const context = setup();
    const memory = await memoryModule();
    const container = node('main');
    await memory.renderMemory(container, { getContext: () => context, identity: () => context.chatId });
    const { editor, actions } = controls(container);
    editor.value = 'changed';
    editor.listeners.input();
    assert.equal(editor.dataset.unsaved, 'true');
    actions.find(child => child.label === 'Cancel edit').handler();
    assert.equal(editor.value, 'summary');
    assert.equal(editor.dataset.unsaved, 'false');
});
