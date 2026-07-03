## Goal
Turn the chat clone into a genuinely differentiated AI workspace. Ship in 3 batches so each batch is fully working before the next.

## Batch 1 — Agentic + Artifacts (this turn)
The highest wow-factor per hour. Makes the product feel unlike ChatGPT immediately.

1. **Tool calling in the AI route**
   - `web_search` tool (via Lovable AI Gateway — Gemini native grounding, or fallback to a search API)
   - `generate_image` tool (Lovable AI image gen, renders inline)
   - `create_artifact` tool (opens the artifacts pane)
   - Render tool calls in chat with the AI Elements `Tool` component (collapsed by default)

2. **Artifacts pane**
   - Split-view: chat on left, artifact on right when open
   - Types: `markdown`, `code` (with syntax highlight), `html` (sandboxed iframe preview)
   - Stored in a new `artifacts` table, versioned, tied to a thread
   - Model can create/update artifacts via tool call; user sees live updates
   - Toggle open/close, copy, download

3. **Multi-model selector**
   - Dropdown in composer: Gemini 2.5 Flash (default, fast) / Gemini 2.5 Pro (smart) / GPT-5 (reasoning)
   - Persist per-thread; show which model answered each message

## Batch 2 — Projects + Memory (next turn, on request)
4. **Projects**: group threads under a project with shared system prompt + files
5. **Persistent memory**: model extracts user facts into a `memories` table, injected into every system prompt
6. **File uploads**: PDFs/images attached to messages, vision + doc parsing

## Batch 3 — Polish (final turn, on request)
7. Message editing + branching (fork conversation)
8. Public shareable read-only chat links
9. ⌘K command palette, slash commands, prompt library
10. Voice input (Web Speech API)

## Technical notes (Batch 1)
- New table `artifacts` (id, thread_id, user_id, kind, title, content, version, created_at)
- Extend `messages` with `model` column (text nullable)
- `/api/chat` route: register tools with AI SDK `tool()` + `stopWhen: stepCountIs(50)`; web_search calls Gemini grounding, create_artifact writes to DB and returns id
- New component `ArtifactPane` in chat layout, controlled by URL query param `?artifact=<id>`
- Model selector: small `<Select>` in `PromptInput` footer, value stored in thread row (`model` column)

## Out of scope for Batch 1
- Auth for shared links (Batch 3)
- File upload UI (Batch 2)
- Memory extraction (Batch 2)

Approving this plan runs Batch 1 only. I'll ping you to confirm before starting Batch 2.