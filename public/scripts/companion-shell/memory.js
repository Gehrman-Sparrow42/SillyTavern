import { button, element, nativeAction, section } from './dom.js';
import { getRecallTrace } from './recall-state.js';
import { getPromptUsage } from './prompt-state.js';

function latestSummary(chat) {
    for (let index = chat.length - 1; index >= 0; index--) {
        if (chat[index].extra?.memory) return { text: chat[index].extra.memory, index };
    }
    return { text: '', index: -1 };
}

export function memorySnapshot(context) {
    const configuredContext = context.mainApi === 'openai'
        ? context.chatCompletionSettings.openai_max_context : context.maxContext;
    return {
        summary: latestSummary(context.chat),
        recall: getRecallTrace(context),
        usage: getPromptUsage(context),
        configuredContext,
    };
}

function chatIdentity(context) {
    const owner = context.groupId
        ? ['group', String(context.groupId)]
        : ['character', context.characters[context.characterId]?.avatar];
    return JSON.stringify([owner, context.chatId]);
}

export async function renderMemory(container, { getContext, openNative, identity, refresh, isActive = () => true }) {
    if (!isActive()) return;
    const context = getContext();
    if (!context.chatId || !context.chat.length) {
        container.append(element('p', 'st-empty', 'Open a conversation to inspect its memory.'));
        return;
    }
    const openedIdentity = chatIdentity(context);
    const openedChatId = identity();
    const isCurrentChat = () => isActive() && identity() === openedChatId && chatIdentity(getContext()) === openedIdentity;
    const requireCurrentChat = () => {
        if (!isCurrentChat()) throw new Error('The conversation or panel changed. Reopen Memory before continuing.');
    };
    const snapshot = memorySnapshot(context);
    const settings = context.extensionSettings;
    const info = section('Context', `Configured window: ${Number(snapshot.configuredContext).toLocaleString()} tokens.`);
    if (snapshot.usage) {
        const windowSize = Number(snapshot.configuredContext);
        info.append(element('p', '', `Prepared prompt text: approximately ${snapshot.usage.tokens.toLocaleString()} tokens.`));
        if (Number.isFinite(windowSize) && windowSize > 0) {
            const progress = element('progress', 'st-context-progress');
            progress.max = windowSize;
            progress.value = Math.min(snapshot.usage.tokens, windowSize);
            progress.setAttribute('aria-label', 'Estimated prompt text tokens in the configured context window');
            info.append(progress);
        }
        info.append(element('p', 'st-muted', 'Text estimate only; message framing, images, tools, and other provider overhead can add tokens.'));
    } else {
        info.append(element('p', 'st-muted', 'A prompt text estimate will appear after the next chat-completion prompt is prepared.'));
    }
    container.append(info);

    const summarySection = section('Running summary', snapshot.summary.index >= 0
        ? `Covers through message ${snapshot.summary.index + 1}. ${context.chat.length - snapshot.summary.index - 1} messages since then.`
        : 'A summary will appear once this conversation has been summarized.');
    const editor = element('textarea', 'st-memory-summary');
    editor.setAttribute('aria-label', 'Running conversation summary');
    let originalSummary = snapshot.summary.text;
    editor.value = originalSummary;
    editor.rows = 10;
    const status = element('p', 'st-muted');
    editor.addEventListener('input', () => {
        editor.dataset.unsaved = String(editor.value !== originalSummary);
    });
    const actions = element('div', 'st-button-row');
    actions.append(button('Save summary', async () => {
        requireCurrentChat();
        const original = document.querySelector('#memory_contents');
        if (!original) throw new Error('Enable the Summarize extension in Studio first.');
        const submitted = editor.value;
        globalThis.jQuery(original).val(submitted).trigger('input');
        await getContext().saveChat();
        if (!isCurrentChat()) return;
        originalSummary = submitted;
        editor.dataset.unsaved = String(editor.value !== originalSummary);
        status.textContent = 'Summary updated in this chat; native save requested.';
        refresh();
    }, 'st-action st-primary'));
    actions.append(button('Cancel edit', () => {
        requireCurrentChat();
        editor.value = originalSummary;
        editor.dataset.unsaved = 'false';
        status.textContent = 'Summary edit cancelled.';
    }));
    actions.append(button('Summarize now', () => {
        requireCurrentChat();
        nativeAction('#memory_force_summarize');
        status.textContent = 'Updating the summary. You can keep chatting; reopen Memory when the update finishes.';
    }));
    const paused = element('label', 'st-setting-row');
    const pause = element('input');
    pause.type = 'checkbox';
    pause.checked = !!settings.memory?.memoryFrozen;
    pause.addEventListener('change', () => {
        globalThis.jQuery('#memory_frozen').prop('checked', pause.checked).trigger('input');
    });
    paused.append(pause, document.createTextNode('Pause automatic summary updates'));
    const summarySettings = settings.memory;
    summarySection.append(editor, actions, status, paused,
        element('p', 'st-muted', `Target ${summarySettings?.promptWords || 200} words; update interval ${summarySettings?.promptInterval || 0} messages. Original messages stay in the chat archive.`));
    container.append(summarySection);

    const recall = section('Recalled passages', 'Selected for insertion by vector search. Inclusion in the final prompt has not been verified.');
    if (!snapshot.recall?.messages.length) recall.append(element('p', 'st-empty', 'No recalled passages are available for this conversation and generation.'));
    for (const message of snapshot.recall?.messages || []) {
        const article = element('article', 'st-memory-snippet');
        article.append(element('h4', '', `${message.name || 'Message'}${message.index === null ? '' : ` · Message ${message.index + 1}`}`));
        article.append(element('p', '', message.text));
        article.append(button('Find in conversation', () => {
            requireCurrentChat();
            const current = getContext().chat;
            const node = message.index !== null && current[message.index] === message.source
                ? document.querySelector(`#chat .mes[mesid="${message.index}"]`) : null;
            if (!node) {
                article.append(element('p', 'st-muted', 'This message is outside the loaded history or has changed. Its selected text is shown above.'));
                return;
            }
            document.getElementById('st-companion-sheet').close();
            node.scrollIntoView({ block: 'center', behavior: 'smooth' });
            node.animate([{ backgroundColor: '#d4a37340' }, { backgroundColor: 'transparent' }], { duration: 1200 });
        }));
        recall.append(article);
    }
    if (snapshot.recall?.limited) recall.append(element('p', 'st-muted', 'The trace exceeded its in-memory limit; only part of the selection is shown.'));
    container.append(recall);

    const index = section('Memory archive', `Embedding source: ${settings.vectors?.source || 'disabled'}${settings.vectors?.source === 'ollama' ? ` · ${settings.vectors.ollama_model}` : ''}.`);
    const indexStatus = element('p', 'st-muted');
    const controls = element('div', 'st-button-row');
    controls.append(button('Index this conversation', () => {
        requireCurrentChat();
        nativeAction('#vectors_vectorize_all');
        indexStatus.textContent = 'Indexing started. Progress is available in the Vector Storage panel.';
    }));
    controls.append(button('Vector settings & progress', () => openNative('#extensions-settings-button .drawer-toggle', '#vectors_settings')));
    index.append(element('p', 'st-muted', settings.vectors?.enabled_chats ? 'Chat indexing is enabled.' : 'Chat indexing is disabled. Enable it in Vector Storage to recall older messages.'), controls, indexStatus);
    container.append(index);
}
