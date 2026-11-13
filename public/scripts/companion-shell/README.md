# Companion shell

A reversible presentation layer over stock SillyTavern. It adds a header, a portrait stage, and a side sheet. Native drawers, settings, and chat storage are unchanged.
Styles are in `public/css/companion-shell.css`.

## Layout modes

| Mode | How | Result |
| --- | --- | --- |
| Standard | default | Portrait stage on the left (width `--st-comp-stage`), chat on the right |
| Cinema | Settings → Companion view | Wider stage |
| Focus | header **Focus** | No stage, narrower reading column |
| Classic | `Ctrl+Shift+M`, **Use Classic SillyTavern**, or `?classic=1` | Companion UI hidden, stock layout restored |

Responsive behaviour:

- At 1100px and below there is no stage gutter. A compact portrait (`#st-header-portrait`) sits inline before **Conversations** in the header.
- At 760px and below the header wraps into two rows: portrait, Conversations and the optional Resume button, then Connect, Memory, Focus and Settings.
- `index.js` mirrors the header's measured height into `--st-comp-header`, so the chat and side sheet never sit under a wrapped header.
- With no character selected, the stage is hidden. Home shows only Recent Chats and Temporary Chat. Stock logo, links, and the Assistant hint are hidden.
- The Moonlit theme is turned off in companion mode. Its settings flag is set to disabled and its stylesheet is removed. A failure to load it only logs a warning.

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+K` | Open Conversations (companion mode) |
| `Ctrl+Shift+M` | Toggle companion/classic mode |
| `Esc` | Close the side sheet, or close an opened native drawer |
| `?classic=1` | URL parameter: start in classic mode for this load |

## Modules

| File | Role |
| --- | --- |
| `index.js` | Header, side sheet, conversation switching, events, preferences |
| `stage.js` | Portrait stage and header portrait. Sprites stay owned by the Expressions extension. |
| `memory.js` | Memory sheet: running summary editing, recalled memories, context estimate |
| `prompt-state.js` | Records the prepared chat-completion prompt for the Memory sheet |
| `recall-state.js` | Tracks which vector memories were recalled for the last reply |
| `resilience.js` | Single-writer tab lock, draft backup, stale-tab banner |
| `sessions.js` | Conversation listing and picking the continuing chat |
| `dom.js` | Small DOM and error-reporting helpers |

## Limits

- **Web Locks.** One tab at a time may save. Other tabs show a read-only banner with **Use this tab**, which takes the lock over and reloads with the draft. The lock is held until the page closes. Browsers without Web Locks disable saving from the companion UI.
- **Token estimates.** The context figure counts prompt text only. Message framing, images, tools, and provider overhead can add tokens. It is empty until a chat-completion prompt has been prepared.
- **Drafts.** Kept in `localStorage`: at most 100 drafts and about 2 MB total. The oldest are dropped first.
