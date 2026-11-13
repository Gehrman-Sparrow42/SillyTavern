import { eventSource, event_types } from '../events.js';
import { getPastCharacterChats, is_send_press } from '../../script.js';
import { button, element, nativeAction, reportError, section } from './dom.js';
import { renderMemory } from './memory.js';
import { initializeStage } from './stage.js';
import { initializeResilience, restoreCompanionDraft } from './resilience.js';
import { clearRecallTrace } from './recall-state.js';
import { listConversations, sameConversation, chooseContinuingConversation } from './sessions.js';
import { beginPromptTrace, clearPromptTrace, recordPromptTrace } from './prompt-state.js';

const getContext = () => globalThis.SillyTavern.getContext();
let shell;
let sheet;
let sheetBody;
let sheetKind;
let renderVersion = 0;
let refreshStage = () => {};
let busy = false;
let restoreFocus;
let preferences;

function savePreferences() {
    getContext().saveSettingsDebounced();
}

function hasUnsavedSummary() {
    return !!(sheet?.open && sheet.querySelector('[data-unsaved="true"]'));
}

function closeSheet(force = false) {
    if (!force && hasUnsavedSummary()) {
        throw new Error('Save or cancel your summary edit before closing Memory.');
    }
    sheet?.close();
}

function setMode(enabled) {
    closeSheet();
    preferences.enabled = enabled;
    document.body.classList.toggle('st-companion-mode', enabled);
    document.body.classList.remove('st-companion-studio-open');
    document.body.dataset.companionView = preferences.view;
    document.body.dataset.companionFit = preferences.fit;
    savePreferences();
    refresh();
}

function openNative(selector, focusSelector) {
    closeSheet();
    document.body.classList.add('st-companion-studio-open');
    const drawer = document.querySelector(selector);
    if (!drawer) throw new Error('This tool is still loading. Try again in a moment.');
    if (!drawer.closest('.drawer')?.querySelector('.drawer-content.openDrawer')) nativeAction(selector);
    if (focusSelector) {
        const target = document.querySelector(focusSelector);
        target?.scrollIntoView({ block: 'center' });
    }
}

function assertCanNavigate() {
    if (is_send_press) throw new Error('Stop the current reply before switching conversations.');
    if (sheet.querySelector('[data-unsaved="true"]')) throw new Error('Save or cancel your summary edit before switching conversations.');
}

function currentIdentity() {
    const context = getContext();
    if (context.groupId) return { group: context.groupId, chat: context.chatId };
    const character = context.characters[context.characterId];
    return character && context.chatId ? { avatar: character.avatar, chat: context.chatId } : null;
}

async function openConversation(identity) {
    assertCanNavigate();
    const context = getContext();
    if (identity.group) {
        await context.openGroupChat(identity.group, identity.chat);
    } else {
        const id = context.characters.findIndex(character => character.avatar === identity.avatar);
        if (id < 0) throw new Error('The character for this conversation is unavailable. Choose another in Conversations.');
        await context.selectCharacterById(id, { switchMenu: false });
        if (getContext().getCurrentChatId() !== identity.chat) await getContext().openCharacterChat(identity.chat);
    }
    closeSheet();
    refresh();
}

function pinConversation(identity) {
    preferences.primary = identity;
    savePreferences();
    refresh();
}

async function conversations(container, version) {
    const context = getContext();
    const search = element('input', 'text_pole');
    search.type = 'search';
    search.placeholder = 'Find a conversation or character';
    search.setAttribute('aria-label', 'Find a conversation or character');
    container.append(search);
    const primary = preferences.primary;
    if (primary) {
        const pinned = section('Continuing conversation');
        pinned.append(button('Resume ' + primary.chat, () => openConversation(primary), 'st-action st-primary'));
        container.append(pinned);
    }
    const list = section('Conversations');
    const loading = element('p', 'st-muted', 'Loading saved conversations…');
    list.append(loading);
    container.append(list);
    const characters = section('Characters');
    for (const character of context.characters) {
        const avatar = character.avatar;
        const row = button(`${character.name} · ${avatar.replace(/\.png$/i, '')}`, async () => {
            assertCanNavigate();
            const currentId = getContext().characters.findIndex(card => card.avatar === avatar);
            if (currentId < 0) throw new Error('This character is no longer available. Reopen Conversations.');
            await getContext().selectCharacterById(currentId, { switchMenu: false });
            closeSheet();
            refresh();
        }, 'st-session-open');
        row.dataset.search = character.name.toLocaleLowerCase();
        row.title = character.avatar;
        characters.append(row);
    }
    container.append(characters);
    search.addEventListener('input', () => {
        const query = search.value.toLocaleLowerCase();
        container.querySelectorAll('[data-search]').forEach(row => { row.hidden = !row.dataset.search.includes(query); });
    });
    {
        const chats = await listConversations(context, getPastCharacterChats);
        if (version !== renderVersion) return;
        loading.remove();
        if (!chats.length) list.append(element('p', 'st-empty', 'No saved conversations yet. Choose a character to begin.'));
        for (const chat of chats) {
            const { identity } = chat;
            const file = identity.chat;
            const row = element('div', 'st-session-row');
            row.dataset.search = `${chat.name} ${chat.card} ${file}`.toLocaleLowerCase();
            const open = button(`${chat.name} · ${file}`, () => openConversation(identity), 'st-session-open');
            const meta = element('small', 'st-muted', `${chat.card} · ${chat.count} messages`);
            open.append(meta);
            const pin = button(sameConversation(primary, identity) ? 'Main chat' : 'Set as main', async () => {
                pinConversation(identity);
                await openSheet('conversations');
            }, 'st-session-pin');
            row.append(open, pin);
            list.append(row);
        }
    }
    const tools = section('Chat tools');
    tools.append(button('Manage chat files', () => { closeSheet(); nativeAction('#option_select_chat'); }),
        button('Pin current conversation', () => {
            const identity = currentIdentity();
            if (!identity) throw new Error('Open a conversation first.');
            pinConversation(identity);
            closeSheet();
        }));
    container.append(tools);
}

function studio(container) {
    const tools = [
        ['Connection & model', '#sys-settings-button .drawer-toggle'],
        ['Response settings', '#ai-config-button .drawer-toggle'],
        ['Memory, expressions & extensions', '#extensions-settings-button .drawer-toggle'],
        ['Characters', '#rightNavHolder .drawer-toggle'],
        ['Persona', '#persona-management-button .drawer-toggle'],
        ['Lorebooks', '#WI-SP-button .drawer-toggle'],
        ['Prompt formatting', '#advanced-formatting-button .drawer-toggle'],
        ['Appearance & user settings', '#user-settings-button .drawer-toggle'],
        ['Backgrounds', '#backgrounds-button .drawer-toggle'],
    ];
    const native = section('SillyTavern tools', 'These open the original controls with your existing settings.');
    tools.forEach(([label, selector]) => native.append(button(label, () => openNative(selector))));
    container.append(native);
    const appearance = section('Companion view');
    const views = element('div', 'st-button-row');
    for (const view of ['standard', 'cinema', 'focus']) {
        const action = button(view[0].toUpperCase() + view.slice(1), () => {
            preferences.view = view;
            document.body.dataset.companionView = view;
            savePreferences();
            refresh();
        });
        action.setAttribute('aria-pressed', String(preferences.view === view));
        views.append(action);
    }
    appearance.append(views, button('Use Classic SillyTavern', () => setMode(false)));
    container.append(appearance);
}

async function openSheet(kind) {
    if (hasUnsavedSummary()) throw new Error('Save or cancel your summary edit before opening another panel.');
    const version = ++renderVersion;
    restoreFocus = document.activeElement;
    sheetKind = kind;
    sheetBody.replaceChildren();
    document.getElementById('st-sheet-title').textContent = { conversations: 'Conversations', memory: 'Memory & context', studio: 'Settings' }[kind];
    if (!sheet.open) sheet.showModal();
    try {
        if (kind === 'conversations') await conversations(sheetBody, version);
        if (kind === 'studio') studio(sheetBody);
        if (kind === 'memory') await renderMemory(sheetBody, {
            getContext, openNative, identity: () => getContext().getCurrentChatId(), refresh,
            isActive: () => version === renderVersion && sheetKind === 'memory' && sheet.open,
        });
    } catch (error) {
        if (version === renderVersion) sheetBody.append(element('p', 'st-empty', error.message), button('Try again', () => openSheet(kind)));
    }
}

function refresh() {
    if (!shell) return;
    const context = getContext();
    const character = context.characters[context.characterId];
    const group = context.groups.find(group => group.id === context.groupId);
    const name = group?.name || character?.name || 'Your companion';
    const session = context.chatId || 'Choose a conversation';
    document.querySelector('.st-brand').textContent = name;
    document.getElementById('st-session-button').textContent = 'Conversations';
    document.getElementById('st-session-button').title = `${name} · ${session}`;
    const home = document.getElementById('st-home-button');
    home.textContent = preferences.primary ? 'Resume main chat' : 'Pin this chat';
    home.hidden = sameConversation(preferences.primary, currentIdentity());
    const connection = document.getElementById('st-connection-button');
    const ready = context.onlineStatus && context.onlineStatus !== 'no_connection';
    connection.dataset.state = busy ? 'busy' : ready ? 'ready' : 'offline';
    connection.textContent = busy ? 'Writing…' : ready ? 'Connected' : 'Connect';
    connection.title = context.mainApi === 'openai' ? context.chatCompletionSettings.custom_model || context.onlineStatus : context.onlineStatus;
    const summary = context.chat.some(message => message.extra?.memory);
    document.getElementById('st-memory-button').textContent = 'Memory';
    document.getElementById('st-memory-button').title = summary ? 'A running summary is available' : 'Inspect summary and recalled memories';
    document.getElementById('st-view-button').textContent = preferences.view === 'focus' ? 'Show companion' : 'Focus';
    refreshStage();
    if (document.body.classList.contains('st-companion-mode')) document.title = `${name} · ${context.chatId ? 'Conversation' : 'Home'} · SillyTavern`;
}

/**
 * The companion layout owns presentation. Keep the optional Moonlit checkout on
 * disk, but turn off its CSS and future loading. Failure here is never fatal.
 */
async function disableMoonlit(context) {
    const settings = context.extensionSettings;
    const moonlit = settings.SillyTavernMoonlitEchoesTheme;
    const disabled = settings.disabledExtensions ||= [];
    const wasActive = !!moonlit?.enabled;
    if (wasActive) {
        try {
            const theme = await import('../extensions/third-party/MoonlitEchoes/index.js');
            theme.toggleCss(false);
        } catch (error) {
            console.warn('Companion shell could not unload the Moonlit theme module', error);
        }
    }
    try {
        document.querySelectorAll('link[rel="stylesheet"][href*="MoonlitEchoes"]').forEach(link => { link.disabled = true; link.remove(); });
    } catch (error) {
        console.warn('Companion shell could not remove the Moonlit stylesheet', error);
    }
    if (wasActive || disabled.includes('third-party/MoonlitEchoes')) {
        if (moonlit) moonlit.enabled = false;
        if (!disabled.includes('third-party/MoonlitEchoes')) disabled.push('third-party/MoonlitEchoes');
        if (wasActive) context.saveSettingsDebounced();
    }
}

async function initialize() {
    const context = getContext();
    await disableMoonlit(context);
    preferences = context.extensionSettings.companion_shell ||= { enabled: true, view: 'standard', fit: 'contain' };
    preferences.view ||= 'standard';
    preferences.fit ||= 'contain';
    shell = element('header');
    shell.id = 'st-companion-header';
    const brand = element('span', 'st-brand', 'Companion');
    const compactPortrait = element('img');
    compactPortrait.id = 'st-header-portrait';
    compactPortrait.alt = '';
    compactPortrait.hidden = true;
    const definitions = [
        ['st-session-button', 'Conversations', () => openSheet('conversations')],
        ['st-home-button', 'Resume main chat', () => {
            if (preferences.primary) return openConversation(preferences.primary);
            const identity = currentIdentity();
            if (identity) pinConversation(identity);
            else return openSheet('conversations');
        }],
        ['st-connection-button', 'Connect', () => openNative('#sys-settings-button .drawer-toggle')],
        ['st-memory-button', 'Memory', () => openSheet('memory')],
        ['st-view-button', 'Focus', () => {
            preferences.view = preferences.view === 'focus' ? 'standard' : 'focus';
            document.body.dataset.companionView = preferences.view;
            savePreferences();
            refresh();
        }],
        ['st-studio-button', 'Settings', () => {
            document.body.classList.remove('st-companion-studio-open');
            return openSheet('studio');
        }],
    ];
    shell.append(compactPortrait, brand);
    for (const [id, label, handler] of definitions) {
        const control = button(label, handler);
        control.id = id;
        shell.append(control);
    }
    const stage = element('aside');
    stage.id = 'st-companion-stage';
    stage.setAttribute('aria-label', 'Companion portrait');
    const fallback = element('img');
    fallback.id = 'st-stage-fallback';
    const caption = element('p');
    caption.id = 'st-stage-caption';
    const fit = element('button');
    fit.id = 'st-stage-fit';
    fit.type = 'button';
    stage.append(fallback, caption, fit);
    sheet = element('dialog');
    sheet.id = 'st-companion-sheet';
    sheet.setAttribute('aria-labelledby', 'st-sheet-title');
    const heading = element('div', 'st-sheet-heading');
    const title = element('h2');
    title.id = 'st-sheet-title';
    const close = button('Close', closeSheet);
    close.id = 'st-sheet-close';
    heading.append(title, close);
    sheetBody = element('div');
    sheetBody.id = 'st-sheet-body';
    sheet.append(heading, sheetBody);
    sheet.addEventListener('cancel', event => {
        if (hasUnsavedSummary()) {
            event.preventDefault();
            reportError(new Error('Save or cancel your summary edit before closing Memory.'));
        }
    });
    sheet.addEventListener('close', () => { renderVersion++; sheet.returnValue = ''; restoreFocus?.focus(); });
    sheet.addEventListener('click', event => { if (event.target === sheet && event.clientX < sheet.getBoundingClientRect().left) closeSheet(); });
    const classic = button('Companion view', () => setMode(true));
    classic.id = 'st-classic-return';
    const banner = element('div');
    banner.id = 'st-companion-banner';
    banner.hidden = true;
    banner.setAttribute('role', 'status');
    document.body.append(shell, stage, sheet, classic, banner);
    // The header wraps on narrow screens; keep everything below it aligned to its real height.
    new ResizeObserver(() => {
        const height = Math.ceil(shell.getBoundingClientRect().height);
        if (height) document.body.style.setProperty('--st-comp-header', `${height}px`);
        else document.body.style.removeProperty('--st-comp-header');
    }).observe(shell);
    refreshStage = initializeStage(getContext, caption, fit, savePreferences);
    initializeResilience({ getContext, onStatus: ({ stale, message, recover, label }) => {
        banner.replaceChildren();
        banner.hidden = !message;
        if (message) banner.append(element('span', '', message));
        if (recover) banner.append(button(label || 'Reload current state', recover));
        document.body.classList.toggle('st-companion-stale', stale);
    } });
    const classicRequested = new URLSearchParams(location.search).get('classic') === '1';
    document.body.classList.toggle('st-companion-mode', preferences.enabled !== false && !classicRequested);
    document.body.dataset.companionView = preferences.view;
    document.body.dataset.companionFit = preferences.fit;
    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearRecallTrace();
        clearPromptTrace();
        closeSheet(true);
        restoreCompanionDraft();
        refresh();
    });
    for (const event of [event_types.ONLINE_STATUS_CHANGED, event_types.CHARACTER_EDITED, event_types.CONNECTION_PROFILE_LOADED,
        event_types.CHAT_RENAMED, event_types.CHATCOMPLETION_MODEL_CHANGED, event_types.SETTINGS_UPDATED]) eventSource.on(event, refresh);
    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        if (type !== 'quiet' && !dryRun) clearRecallTrace();
        if (type === 'quiet' || dryRun) clearPromptTrace();
        else beginPromptTrace(getContext());
        busy = true;
        refresh();
    });
    eventSource.on(event_types.GENERATION_ENDED, () => { busy = false; refresh(); });
    eventSource.on(event_types.GENERATION_STOPPED, () => { busy = false; refresh(); });
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, data => {
        void recordPromptTrace(getContext(), data).then(refresh).catch(reportError);
    });
    document.addEventListener('keydown', event => {
        if (event.ctrlKey && event.shiftKey && event.code === 'KeyM') {
            event.preventDefault();
            setMode(!document.body.classList.contains('st-companion-mode'));
        }
        if (!document.body.classList.contains('st-companion-mode')) return;
        if (event.ctrlKey && event.code === 'KeyK') { event.preventDefault(); openSheet('conversations'); }
        if (event.key === 'Escape') document.body.classList.remove('st-companion-studio-open');
    });
    refresh();
    if (!preferences.primary) {
        listConversations(context, getPastCharacterChats).then(entries => {
            if (!preferences.primary) {
                const primary = chooseContinuingConversation(entries);
                if (primary) pinConversation(primary.identity);
            }
        }).catch(reportError);
    }
}

eventSource.once(event_types.APP_READY, async () => {
    try { await initialize(); } catch (error) {
        document.body.classList.remove('st-companion-mode');
        reportError(error);
    }
});
