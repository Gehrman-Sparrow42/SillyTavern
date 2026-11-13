import { getCurrentUserHandle } from '../user.js';

// A lock is held for the life of the page, including Classic mode. This only
// coordinates pages on the same origin that load this module; other clients
// still rely on SillyTavern's server-side integrity checks.
const LOCK_NAME = 'sillytavern-companion-writer';
const DRAFT_KEY = 'sillytavern-companion-drafts-v1';
const TAKEOVER_KEY = 'sillytavern-companion-takeover-v1';
const MAX_DRAFTS = 100;
const MAX_DRAFT_BYTES = 2_000_000;
let state = 'pending';
let report = () => {};
let getContext;
let textarea;
let activeKey;
let lastText = '';
let statusError = '';

function updateStatus() {
    const stale = state !== 'owner';
    report({
        stale,
        message: statusError || (state === 'unavailable'
            ? 'Tab locking is unavailable in this browser. Saving is disabled.'
            : stale ? 'This tab is read-only. Use this tab to reload current settings and enable saving.' : ''),
        recover: state === 'stale' ? reloadWithDraft : undefined,
        label: state === 'stale' ? 'Use this tab' : undefined,
    });
}

const ownership = typeof window === 'undefined' ? Promise.resolve() : acquireOwnership();

function acquireOwnership() {
    if (!navigator.locks?.request) {
        state = 'unavailable';
        return Promise.resolve();
    }
    let takeover = false;
    try {
        takeover = sessionStorage.getItem(TAKEOVER_KEY) === '1';
        if (takeover) sessionStorage.removeItem(TAKEOVER_KEY);
    } catch (error) {
        console.warn('Companion takeover state unavailable', error);
        takeover = false;
    }
    return new Promise(resolve => {
        navigator.locks.request(LOCK_NAME, takeover ? { steal: true } : { ifAvailable: true }, async lock => {
            state = lock ? 'owner' : 'stale';
            updateStatus();
            resolve();
            // The browser releases the lock when the page is destroyed.
            if (lock) await new Promise(() => {});
        }).catch(error => {
            if (state === 'owner' && error?.name === 'AbortError') {
                state = 'stale';
            } else {
                console.error('Companion tab ownership unavailable', error);
                state = 'unavailable';
            }
            updateStatus();
            resolve();
        });
    });
}

/** Throw before a central save if this page did not acquire ownership at startup. */
export async function assertCompanionWriteAllowed() {
    await ownership;
    if (state !== 'owner') {
        updateStatus();
        throw new Error('Save blocked: this tab is read-only or browser tab locking is unavailable.');
    }
}

/** Stable identity: do not use mutable character array indices as keys. */
export function getDraftIdentity(context, origin, account) {
    if (!context?.chatId || !account) return null;
    const owner = context.groupId
        ? ['group', String(context.groupId)]
        : ['character', context.characters?.[context.characterId]?.avatar];
    if (!owner[1] || owner[1] === 'none') return null;
    return JSON.stringify([origin, account, ...owner, String(context.chatId)]);
}

function readDrafts() {
    try {
        const data = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
        console.warn('Could not read companion drafts', error);
        return {};
    }
}

function saveDraft(key, value) {
    if (!key) return !value;
    try {
        const drafts = readDrafts();
        if (value) drafts[key] = { text: value, updated: Date.now() };
        else delete drafts[key];
        const entries = Object.entries(drafts).filter(([, draft]) => typeof draft?.text === 'string')
            .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0)).slice(0, MAX_DRAFTS);
        let serialized = JSON.stringify(Object.fromEntries(entries));
        while (serialized.length > MAX_DRAFT_BYTES && entries.length > 1) {
            entries.pop();
            serialized = JSON.stringify(Object.fromEntries(entries));
        }
        if (serialized.length > MAX_DRAFT_BYTES) throw new Error('Draft exceeds storage limit');
        localStorage.setItem(DRAFT_KEY, serialized);
        return true;
    } catch (error) {
        console.warn('Could not persist companion draft', error);
        return false;
    }
}

function currentKey() {
    return getDraftIdentity(getContext?.(), window.location.origin, getCurrentUserHandle());
}

function rememberCurrentDraft() {
    if (!textarea) return true;
    lastText = textarea.value;
    return saveDraft(activeKey, lastText);
}

/** Call after the application has finished selecting a chat. */
export function restoreCompanionDraft() {
    if (!textarea || !getContext) return;
    const nextKey = currentKey();
    if (nextKey === activeKey) return;
    // Only clear text that we know belonged to the previous chat. Never replace
    // a different, nonempty value supplied by the app or the user.
    if (activeKey && textarea.value === lastText) textarea.value = '';
    activeKey = nextKey;
    if (!textarea.value && nextKey) {
        const text = readDrafts()[nextKey]?.text;
        if (typeof text === 'string') textarea.value = text;
    }
    lastText = textarea.value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function reloadWithDraft() {
    if (!rememberCurrentDraft()) {
        statusError = 'The draft could not be saved. Copy it before reloading this tab.';
        updateStatus();
        return;
    }
    try {
        sessionStorage.setItem(TAKEOVER_KEY, '1');
    } catch (error) {
        console.warn('Companion takeover state unavailable', error);
        statusError = 'Cannot switch tabs here. Close the other tab, then reload this one.';
        updateStatus();
        return;
    }
    window.location.reload();
}

/** Initialize once at APP_READY; the save guard already runs during startup. */
export function initializeResilience(options) {
    if (textarea) return;
    getContext = options.getContext;
    report = options.onStatus || report;
    textarea = document.querySelector('#send_textarea');
    if (textarea) {
        textarea.addEventListener('input', rememberCurrentDraft);
        restoreCompanionDraft();
        window.addEventListener('pagehide', rememberCurrentDraft);
    }
    ownership.then(updateStatus);
}
