/* global globalThis */
/* eslint-disable playwright/expect-expect, playwright/no-conditional-in-test */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/scripts/companion-shell/resilience.js', import.meta.url), 'utf8'))
    .replace('import { getCurrentUserHandle } from \'../user.js\';', 'const getCurrentUserHandle = () => \'test-account\';');
let serial = 0;
async function moduleInstance() {
    return import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${serial++}`).toString('base64')}`);
}

test('identity separates accounts, characters, groups, and chat ids', async () => {
    const { getDraftIdentity } = await moduleInstance();
    const context = { chatId: 'chat', characterId: 0, characters: [{ avatar: 'a.png' }] };
    const key = getDraftIdentity(context, 'http://localhost', 'alice');
    assert.notEqual(key, getDraftIdentity(context, 'http://localhost', 'bob'));
    assert.notEqual(key, getDraftIdentity({ ...context, characters: [{ avatar: 'b.png' }] }, 'http://localhost', 'alice'));
    assert.notEqual(key, getDraftIdentity({ ...context, groupId: 'a.png' }, 'http://localhost', 'alice'));
    assert.notEqual(key, getDraftIdentity({ ...context, chatId: 'other' }, 'http://localhost', 'alice'));
    assert.equal(getDraftIdentity({ ...context, chatId: '' }, 'http://localhost', 'alice'), null);
});

test('only the first cooperating tab may write; rejected tab cannot silently acquire later', async () => {
    let held = false;
    globalThis.window = { location: { origin: 'http://localhost' } };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, _options, callback) => {
        if (held) return callback(null);
        held = true;
        return callback({});
    } } } });
    const first = await moduleInstance();
    const second = await moduleInstance();
    await Promise.all([first.assertCompanionWriteAllowed(), assert.rejects(second.assertCompanionWriteAllowed(), /Save blocked/)]);
    held = false;
    await assert.rejects(second.assertCompanionWriteAllowed(), /Save blocked/);
    delete globalThis.window;
    delete globalThis.navigator;
});


test('drafts follow the selected chat, clear when emptied, and preserve other nonempty text', async () => {
    const saved = new Map();
    globalThis.localStorage = {
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, value),
    };
    const input = new EventTarget();
    input.value = '';
    globalThis.document = { querySelector: () => input };
    globalThis.window = { location: { origin: 'http://localhost' }, addEventListener: () => {} };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, _options, callback) => callback({}) } } });
    const context = { chatId: 'one', characterId: 0, characters: [{ avatar: 'a.png' }] };
    const resilience = await moduleInstance();
    resilience.initializeResilience({ getContext: () => context });
    input.value = 'draft one';
    input.dispatchEvent(new Event('input'));
    context.chatId = 'two';
    resilience.restoreCompanionDraft();
    assert.equal(input.value, '');
    input.value = 'draft two';
    input.dispatchEvent(new Event('input'));
    context.chatId = 'one';
    resilience.restoreCompanionDraft();
    assert.equal(input.value, 'draft one');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    context.chatId = 'two';
    resilience.restoreCompanionDraft();
    assert.equal(input.value, 'draft two');
    input.value = 'app text';
    context.chatId = 'one';
    resilience.restoreCompanionDraft();
    assert.equal(input.value, 'app text');
    delete globalThis.localStorage;
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.navigator;
});

test('takeover saves the draft before requesting a fresh page and revokes the old owner', async () => {
    const saved = new Map();
    const session = new Map();
    const order = [];
    let heldReject;
    globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); order.push('draft'); } };
    globalThis.sessionStorage = { getItem: key => session.get(key) ?? null, setItem: (key, value) => { session.set(key, value); order.push('flag'); }, removeItem: key => session.delete(key) };
    const input = new EventTarget();
    input.value = '';
    globalThis.document = { querySelector: () => input };
    globalThis.window = { location: { origin: 'http://localhost', reload: () => order.push('reload') }, addEventListener: () => {} };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, options, callback) => {
        if (options.steal) {
            heldReject(Object.assign(new Error('stolen'), { name: 'AbortError' }));
            return new Promise(() => { callback({}); });
        }
        if (heldReject) return Promise.resolve(callback(null));
        return new Promise((_resolve, reject) => { heldReject = reject; callback({}); });
    } } } });
    const first = await moduleInstance();
    await first.assertCompanionWriteAllowed();
    const second = await moduleInstance();
    let status;
    const context = { chatId: 'chat', characterId: 0, characters: [{ avatar: 'a.png' }] };
    second.initializeResilience({ getContext: () => context, onStatus: value => { status = value; } });
    await assert.rejects(second.assertCompanionWriteAllowed(), /Save blocked/);
    input.value = 'unsent';
    order.length = 0;
    status.recover();
    assert.deepEqual(order, ['draft', 'flag', 'reload']);
    assert.match([...saved.values()][0], /unsent/);
    const fresh = await moduleInstance();
    await fresh.assertCompanionWriteAllowed();
    await assert.rejects(first.assertCompanionWriteAllowed(), /Save blocked/);
    assert.equal(session.size, 0);
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.navigator;
});

test('unavailable session storage does not reload or discard the draft', async () => {
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.sessionStorage = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    const input = new EventTarget();
    input.value = '';
    let reloaded = false;
    globalThis.document = { querySelector: () => input };
    globalThis.window = { location: { origin: 'http://localhost', reload: () => { reloaded = true; } }, addEventListener: () => {} };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name, _options, callback) => callback(null) } } });
    const tab = await moduleInstance();
    let status;
    tab.initializeResilience({ getContext: () => ({ chatId: 'chat', characterId: 0, characters: [{ avatar: 'a.png' }] }), onStatus: value => { status = value; } });
    await assert.rejects(tab.assertCompanionWriteAllowed(), /Save blocked/);
    input.value = 'unsent';
    status.recover();
    assert.equal(input.value, 'unsent');
    assert.equal(reloaded, false);
    assert.match(status.message, /Close the other tab/);
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.navigator;
});
