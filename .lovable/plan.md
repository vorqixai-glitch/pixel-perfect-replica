# Export a project to desktop or GitHub

Add an "Export" action to every project (and to a single chat) that packages everything the project produced — chats, artifacts, uploaded files, project instructions — and either downloads it as a ZIP or pushes it into a GitHub repository.

## What the user gets

- **Export menu** in the project dropdown in the sidebar (next to Rename/Delete), plus the same action on a single chat.
- **Download to desktop**: a ZIP containing
  - `README.md` — project name, description, instructions, chat index
  - `chats/<chat-title>.md` — full transcript per chat
  - `artifacts/<title>.<ext>` — each artifact as a real file (`.md`, `.html`, `.py`, `.ts`, …)
  - `files/<name>` — the originals the user uploaded
  - `project.json` — machine-readable manifest
- **Push to GitHub**: dialog asking for repo name, private/public toggle, and optional target folder. Creates the repo if it doesn't exist, then commits the same file tree. On success shows the repo link. If GitHub isn't connected, the dialog says so and offers the connect step instead of failing silently.
- Progress + toast feedback for both paths; disabled state while exporting.

## Technical approach

- New `src/lib/export.functions.ts` (auth-protected server functions):
  - `buildProjectExport({ projectId })` / `buildThreadExport({ threadId })` — reads `projects`, `threads`, `messages`, `artifacts`, `thread_files` (downloading blobs from the `thread-files` bucket via signed reads), returns an array of `{ path, contentBase64 }` plus a manifest. Shared builder used by both export targets.
  - `pushExportToGithub({ projectId, repo, private, subdir })` — calls the connector gateway (`connector-gateway.lovable.dev/github/...`, `GITHUB_API_KEY`, same pattern as the existing `github` tool): `GET /user`, `POST /user/repos` when missing, then `PUT /repos/:owner/:repo/contents/:path` per file (base64 content, `sha` when updating). Returns `html_url`.
- Zipping happens client-side to keep the Worker light: add `fflate` and build the ZIP in the browser from the returned file list, then trigger a Blob download.
- New `src/components/emergent/export-dialog.tsx` — one dialog with two tabs (Download / GitHub); wired into `chat-sidebar.tsx` project and thread dropdowns.
- Binary safety: everything transfers base64 so PDFs and images survive the round trip; per-export cap of ~50MB with a clear error above that.
- No schema changes needed.
