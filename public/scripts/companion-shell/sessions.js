/** Snapshot stable card identities before asynchronous history requests. */
export async function listConversations(context, getHistory) {
    const owners = context.characters.map((character, id) => ({ id, avatar: character.avatar, name: character.name }));
    const batches = await Promise.all(owners.map(async owner => {
        const chats = await getHistory(owner.id);
        return chats.filter(chat => chat.file_name).map(chat => ({
            identity: { avatar: owner.avatar, chat: chat.file_name.replace(/\.jsonl$/, '') },
            name: owner.name,
            card: owner.avatar.replace(/\.png$/i, ''),
            count: Number(chat.chat_items ?? chat.mes_count ?? 0),
            updated: typeof chat.last_mes === 'number' ? chat.last_mes : Date.parse(chat.last_mes) || 0,
        }));
    }));
    return batches.flat().sort((a, b) => b.updated - a.updated);
}

export function sameConversation(left, right) {
    return !!(left && right && left.chat === right.chat
        && (left.group ? left.group === right.group : left.avatar === right.avatar));
}

/** Prefer a continuing conversation over an untouched greeting. */
export function chooseContinuingConversation(entries) {
    return entries.find(entry => entry.count > 1) || entries[0];
}
