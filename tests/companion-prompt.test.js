/* eslint-disable playwright/expect-expect */
import test from 'node:test';
import assert from 'node:assert/strict';
import { beginPromptTrace, clearPromptTrace, getPromptUsage, recordPromptTrace } from '../public/scripts/companion-shell/prompt-state.js';

function context(avatar, counter = async () => 12) {
    return { chatId: 'same', characterId: 0, characters: [{ avatar }], getTokenCountAsync: counter };
}
test('counts text components and omits images', async () => {
    let counted;
    const current = context('a.png', async text => { counted = text; return 12; });
    beginPromptTrace(current);
    await recordPromptTrace(current, { chat: [{ content: 'hello' }, { content: [{ type: 'text', text: 'world' }, { type: 'image_url', image_url: 'image' }] }], dryRun: false });
    assert.equal(counted, 'hello\nworld');
    assert.equal(getPromptUsage(current).tokens, 12);
    assert.equal(getPromptUsage(context('b.png')), null);
});
test('rejects dry runs and asynchronous results from a previous character with the same chat id', async () => {
    let finish;
    const first = context('a.png', () => new Promise(resolve => { finish = resolve; }));
    const second = context('b.png');
    beginPromptTrace(first);
    await recordPromptTrace(first, { chat: [{ content: 'dry' }], dryRun: true });
    assert.equal(getPromptUsage(first), null);
    const pending = recordPromptTrace(first, { chat: [{ content: 'old' }], dryRun: false });
    beginPromptTrace(second);
    finish(5);
    await pending;
    assert.equal(getPromptUsage(first), null);
    assert.equal(getPromptUsage(second), null);
    await recordPromptTrace(second, { chat: [{ content: 'new' }], dryRun: false });
    assert.equal(getPromptUsage(second).tokens, 12);
    clearPromptTrace();
    assert.equal(getPromptUsage(second), null);
});
