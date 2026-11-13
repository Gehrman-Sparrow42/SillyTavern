import { recallIdentity } from './recall-state.js';

// Only a token estimate is retained; the prepared prompt stays in the event flow.
let epoch = 0;
let sequence = 0;
let activeIdentity = null;
let usage = null;

export function clearPromptTrace() {
    epoch++;
    activeIdentity = null;
    usage = null;
}

export function beginPromptTrace(context) {
    clearPromptTrace();
    activeIdentity = recallIdentity(context);
}

export async function recordPromptTrace(context, event) {
    const identity = recallIdentity(context);
    if (event?.dryRun || !identity || identity !== activeIdentity || !Array.isArray(event?.chat)) return;
    const currentEpoch = epoch;
    const currentSequence = ++sequence;
    const text = event.chat.flatMap(message => {
        if (typeof message?.content === 'string') return [message.content];
        if (!Array.isArray(message?.content)) return [];
        return message.content.flatMap(part => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []);
    }).join('\n');
    try {
        const tokens = text ? await context.getTokenCountAsync(text) : 0;
        if (epoch !== currentEpoch || sequence !== currentSequence || activeIdentity !== identity || !Number.isFinite(tokens) || tokens < 0) return;
        usage = { identity, tokens };
    } catch (error) {
        console.warn('Could not estimate prepared prompt text tokens', error);
    }
}

export function getPromptUsage(context) {
    return usage?.identity === recallIdentity(context) ? usage : null;
}
