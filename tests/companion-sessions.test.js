/* eslint-disable playwright/expect-expect */
import test from 'node:test';
import assert from 'node:assert/strict';
import { listConversations, sameConversation, chooseContinuingConversation } from '../public/scripts/companion-shell/sessions.js';

test('history keeps stable card owners across async array changes and duplicate names', async () => {
    const context = { characters: [{ name: 'Letta', avatar: 'a.png' }, { name: 'Letta', avatar: 'b.png' }] };
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const result = listConversations(context, async id => {
        await pending;
        return [{ file_name: 'same.jsonl', chat_items: id + 1, last_mes: id + 1 }];
    });
    context.characters.reverse();
    release();
    const entries = await result;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].identity.avatar, 'b.png');
    assert.equal(entries[1].identity.avatar, 'a.png');
    assert.equal(sameConversation(entries[0].identity, entries[1].identity), false);
});

test('continuing-chat default skips newer untouched greetings without losing them', () => {
    const entries = [{ count: 1 }, { count: 11 }, { count: 3 }];
    assert.equal(chooseContinuingConversation(entries), entries[1]);
    assert.equal(chooseContinuingConversation(entries.slice(0, 1)), entries[0]);
    assert.equal(chooseContinuingConversation([]), undefined);
    assert.equal(sameConversation({ group: 'g', chat: 'c' }, { avatar: 'g', chat: 'c' }), false);
});
