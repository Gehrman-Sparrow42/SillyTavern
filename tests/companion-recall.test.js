/* eslint-disable playwright/expect-expect */
import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRecallTrace, clearRecallTrace, getRecallTrace, recordRecallTrace, sourceMessageIndex } from '../public/scripts/companion-shell/recall-state.js';

function context(avatar = 'a.png') {
    return { chatId: 'same', characterId: 0, characters: [{ avatar }] };
}
test('trace is bound to full identity and invalidated by generation or chat reset', () => {
    const original = context();
    const token = beginRecallTrace(original);
    recordRecallTrace(token, context('b.png'), [{ text: 'private' }], 'private');
    assert.equal(getRecallTrace(original), null);
    recordRecallTrace(token, original, [{ text: 'recalled' }], 'insertion');
    assert.equal(getRecallTrace(original).messages[0].text, 'recalled');
    assert.equal(getRecallTrace(context('b.png')), null);
    clearRecallTrace();
    recordRecallTrace(token, original, [{ text: 'stale' }], 'stale');
    assert.equal(getRecallTrace(original), null);
});
test('source index is provided only for an unambiguous copied message', () => {
    const extra = {};
    const original = { name: 'A', is_user: false, send_date: 'date', extra };
    const copied = { ...original, mes: 'transformed' };
    assert.equal(sourceMessageIndex(copied, [{ name: 'system' }, original]), 1);
    assert.equal(sourceMessageIndex(copied, [original, { ...original }]), null);
});
test('oversized trace remains bounded without truncating displayed messages', () => {
    const original = context();
    const token = beginRecallTrace(original);
    recordRecallTrace(token, original, Array.from({ length: 101 }, () => ({ text: 'x' })), 'x');
    assert.equal(getRecallTrace(original).messages.length, 100);
    assert.equal(getRecallTrace(original).limited, true);
});
