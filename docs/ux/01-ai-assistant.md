# UX audit — AI Assistant

**Module:** AI Assistant (`/[locale]/ai`)
**Investigated:** 2026-07-25 · live walkthrough on prod (forma360.io) + code review
**Primary code:** `apps/web/src/components/ai/ai-chat.tsx` (full page), `apps/web/src/components/ai/chat-bubble.tsx` (floating widget), `apps/web/src/components/ai/markdown-message.tsx` (renderer), `apps/web/app/api/ai/chat/route.ts` (SSE stream)

---

## How it works today

- Single client component `AiChat`. State: `messages`, `input`, `streaming`, `toolsActive`, `activeConvId`.
- **Input** is a `<textarea rows={1}>` with an `autoResize` handler (sets `height = min(scrollHeight, 160px)` on change). **Enter sends; Shift+Enter inserts a newline** (`onKeyDown`, ai-chat.tsx:172–177).
- **Send** POSTs to `/api/ai/chat` and reads a Server-Sent-Events stream (`conversation` / `text` / `tool_call` / `done` / `error`). Assistant text accumulates and re-renders through `MarkdownMessage` (react-markdown + remark-gfm).
- **Conversation history** lives in a right-hand `<aside>` (New-chat button + list + per-item delete). Conversations persist server-side (`aiAssistant.listConversations` / `getMessages`).
- Two layouts share one `inputBox` element: a centered "welcome" state (empty) and a bottom-pinned state (in-conversation).

**What's good:** streaming feels responsive; markdown tables + links render correctly once complete; conversations persist and are switchable; the empty state's suggested-prompt chips are a nice on-ramp; entity links in answers deep-link into the app.

---

## Findings

### 1. [High] Multi-line composition works but is undiscoverable — Enter sends
This is the reported issue. In testing, multi-line **does** work: Shift+Enter inserts a newline and the textarea auto-grows to show every line (verified live with a 3-line draft). **But nothing tells the user that.** The field looks like a one-line input, the placeholder ("Ask a question about your company data…") gives no hint, and **Enter submits immediately** (ai-chat.tsx:172–177). So a user who types a line and presses Enter — the natural "next line" gesture — fires off a partial message instead. Repeated, that reads exactly as *"I can only input one line at a time."* On touch keyboards there's no Shift+Enter at all, so multi-line is effectively impossible there.

**Root cause:** no affordance for the Shift+Enter convention; `rows={1}` makes the field read as single-line; Enter-to-send is undiscoverable.

**Suggestions (pick 1–2):**
- Add a subtle hint row under the input: **"Enter to send · Shift+Enter for new line"** (muted, 11px — you already use that treatment for the disclaimer).
- Start the textarea at **2 rows** (`rows={2}` or a taller `min-h`) so it visually reads as a composer, not a search box.
- Optional (touch): on narrow screens, switch to **Enter = newline, button = send** (a common mobile pattern) since there's no Shift there.

### 2. [Medium] The input doesn't shrink back after sending a multi-line message
After a multi-line send, `send()` clears the text (`setInput('')`, ai-chat.tsx:93) but never resets the imperatively-set `textarea.style.height`. `autoResize` only runs on `onChange`, so the now-empty box stays 2–7 rows tall with just a placeholder until the user types again.

**Suggestion:** reset `textareaRef.current.style.height = 'auto'` inside `send()` and `startNew()` (one line each).

### 3. [Medium] On < 1024px there is no history and no "New chat"
The entire conversation `<aside>` is `hidden w-64 … lg:flex` (ai-chat.tsx:313). Below the `lg` breakpoint (tablets + all phones) there is **no New-chat button and no history list anywhere on the page** — a user who lands in one conversation is stuck in it and cannot start a fresh one or reopen a past one.

**Suggestion:** on `< lg`, surface **New chat** + a **history** entry point in a top bar (e.g. a `+` button and a "History" button that opens a slide-over `Sheet`), reusing the same list.

### 4. [Medium] No "Stop generating" while a response streams
Once a response is streaming the Send button is disabled and there is no way to stop a long or off-track answer — even though the abort machinery already exists (`abortRef`). The user must wait it out (or start a new chat, which aborts as a side effect).

**Suggestion:** while `streaming`, swap the Send icon for a **Stop** control that calls `abortRef.current?.abort()` and finalizes the partial message.

### 5. [Low] Can't compose the next question while the AI is answering
The textarea is `disabled={streaming}` (ai-chat.tsx:200), so the user can't start typing their follow-up until the full answer finishes. Most chat UIs let you type during generation.

**Suggestion:** keep the field enabled during streaming; only gate the actual send (or queue it).

### 6. [Low] Tool-activity label leaks the internal tool name
While a tool runs, the status reads **"Looking up list_actions…"** — the raw internal identifier `list_actions` (ai-chat.tsx:290, `lookingUp` with `{tool}`). It's functional but unpolished and exposes implementation detail.

**Suggestion:** map tool ids → friendly labels ("Looking up your actions…", "Searching documents…").

### 7. [Low] Raw markdown flashes mid-stream
While streaming, an incomplete markdown token (e.g. a half-written `[label](/url` link, or a table before its rows arrive) renders as literal text for a moment, then snaps to formatted once the token completes. Cosmetic; the final render is always correct.

**Suggestion:** low priority. If desired, suppress obviously-incomplete link/table syntax during streaming, or render the streaming message as lightly-styled text and only run full markdown on the settled message.

### 8. [Low] No copy affordance on answers
Assistant answers (often a list or table worth reusing) have no copy button.

**Suggestion:** a hover "Copy" on assistant bubbles.

---

## Summary

| # | Severity | Finding | Fix size |
|---|---|---|---|
| 1 | High | Multi-line undiscoverable; Enter sends (the reported issue) | Small (hint + rows) |
| 2 | Medium | Input stays tall after sending a multi-line message | Tiny |
| 3 | Medium | No history / New-chat on < 1024px | Medium |
| 4 | Medium | No "Stop generating" during a stream | Small |
| 5 | Low | Field disabled while streaming | Tiny |
| 6 | Low | Raw tool name shown ("list_actions") | Tiny |
| 7 | Low | Raw markdown flash mid-stream | Small |
| 8 | Low | No copy on answers | Small |

**Recommended first pass:** #1 + #2 (the reported pain + its polish twin) and #3 (mobile can't start/see chats) — together they make the composer feel correct on every screen. #4 rounds out the "feels like a real chat app" set.

_Note: I could not reproduce a hard functional failure of multi-line input — Shift+Enter + auto-grow works on desktop. The report is fully explained by discoverability (#1) + the no-shrink polish bug (#2) + the touch-keyboard gap (#1, #3). If you saw it fail on a specific device/browser, tell me which and I'll repro there._
