
## What we're building

A fully working "Emergent-style" AI chat workspace: users log in, create chat threads, and talk to an AI assistant with streaming responses. Layout mirrors the uploaded reference — left sidebar with threads, main chat panel, composer at the bottom. No fake data, real backend end to end.

Scope note: this is a chat-based AI assistant (not a full code-generating app builder — that's weeks of work). Everything wired here is real: real auth, real DB, real AI streaming.

## Stack

- **Frontend**: TanStack Start (existing), Tailwind v4, AI Elements components
- **Backend**: Lovable Cloud (Postgres + Auth) for users/threads/messages, TanStack server route `/api/chat` for AI streaming
- **AI**: Lovable AI Gateway via AI SDK, default model `google/gemini-3-flash-preview`

## Steps

1. **Enable Lovable Cloud** + provision `LOVABLE_API_KEY`.
2. **Auth**: enable Email/Password + Google. Add `/auth` public page (sign in + sign up tabs). Add managed `_authenticated` gate.
3. **Database migration**:
   - `profiles(id, display_name, avatar_url, created_at)` + trigger from `auth.users`
   - `threads(id, user_id, title, created_at, updated_at)` with RLS scoped to `auth.uid()`
   - `messages(id, thread_id, role, content, created_at)` with RLS via thread ownership
   - GRANTs to `authenticated`, `service_role`
4. **Server functions** (`src/lib/chat.functions.ts` with `requireSupabaseAuth`):
   - `listThreads`, `createThread`, `renameThread`, `deleteThread`
   - `getThreadMessages(threadId)`
   - `saveAssistantMessage(threadId, content)` (called after stream ends)
5. **Streaming route** `src/routes/api/chat.ts`: validates bearer token → loads thread messages → streams via AI SDK → persists user message + final assistant message.
6. **Routes**:
   - `/` → redirects to `/auth` or `/chat`
   - `/auth` — email + Google sign-in
   - `/_authenticated/chat/` — empty state, create-thread CTA
   - `/_authenticated/chat/$threadId` — the chat workspace
7. **UI** using AI Elements (`conversation`, `message`, `prompt-input`, `shimmer`):
   - Left sidebar: workspace header, "New chat" button, thread list (rename/delete on hover), user menu with sign-out at the bottom
   - Main: `Conversation` transcript, streaming assistant messages with markdown, `PromptInput` composer
   - Auto-title new thread from first user message (server-side, one-shot AI call)
8. **Metadata**: real title/description in `__root.tsx` ("Emergent — AI chat workspace" or similar), leaf head on `/auth`.
9. **Verify**: Playwright sign-up → create thread → send message → observe streamed reply → reload → messages persist → sign out.

## Technical details

- Bearer attach: append `attachSupabaseAuth` in `src/start.ts` functionMiddleware.
- Chat route reads bearer from `Authorization` header, calls `supabase.auth.getUser()` with a per-request client to authorize, then uses `supabaseAdmin` (loaded via `await import`) to insert messages.
- `useChat` transport posts to `/api/chat` with `Authorization: Bearer <access_token>` from `supabase.auth.getSession()`.
- Thread route keys the `useChat` instance on `threadId`; initial messages hydrated from `getThreadMessages` via `useQuery` in loader.
- Message rendering iterates `message.parts` and renders text parts through `MessageResponse` (markdown).
- Errors: surface 429 (rate limit) and 402 (credits) as toasts.

## Out of scope (explicit)

- No code generation / live preview pane / sandbox execution (that's a Lovable-scale build).
- No file uploads, no multi-modal input.
- No teams/orgs — single-user workspaces.

Ready to build on approval.
