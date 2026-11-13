// Ephemeral, bounded trace of the vector hook. Nothing is written to storage.
const MAX_MESSAGES = 100;
const MAX_TEXT = 2_000_000;
let epoch = 0;
let trace = null;

export function recallIdentity(context) {
    if (!context?.chatId) return null;
    const owner = context.groupId ? ['group', String(context.groupId)] : ['character', context.characters?.[context.characterId]?.avatar];
    return owner[1] ? JSON.stringify([owner, String(context.chatId)]) : null;
}

export function clearRecallTrace() {
    epoch++;
    trace = null;
}

export function beginRecallTrace(context) {
    clearRecallTrace();
    return { epoch, identity: recallIdentity(context) };
}

/** Match copied, transformed generation messages to source messages only when unambiguous. */
export function sourceMessageIndex(message, sourceChat) {
    const candidates = sourceChat.flatMap((source, index) => {
        if (source.name !== message.name || source.is_user !== message.is_user || source.send_date !== message.send_date) return [];
        if (source.extra !== message.extra) return [];
        return [index];
    });
    return candidates.length === 1 ? candidates[0] : null;
}

export function recordRecallTrace(token, context, messages, insertedText) {
    if (!token.identity || token.epoch !== epoch || token.identity !== recallIdentity(context)) return;
    let size = insertedText.length;
    const selected = [];
    for (const message of messages) {
        size += message.text.length;
        if (selected.length >= MAX_MESSAGES || size > MAX_TEXT) break;
        selected.push(message);
    }
    // Omit overlarge insertion text, never keep a misleading truncated version.
    const storedInsertion = insertedText.length <= MAX_TEXT ? insertedText : null;
    trace = { identity: token.identity, messages: selected, insertedText: storedInsertion, limited: selected.length !== messages.length || storedInsertion === null };
}

export function getRecallTrace(context) {
    return trace?.identity === recallIdentity(context) ? trace : null;
}
