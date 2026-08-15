import { tool, generateText } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAi } from "@/lib/ai-gateway.server";

type ToolCtx = {
  supabase: ReturnType<typeof createClient<Database>>;
  threadId: string | null;
  userId: string;
  lovableApiKey: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYouTubeId(input: string): string | null {
  const m =
    input.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})/) ??
    input.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

export function buildTools(ctx: ToolCtx) {
  return {
    create_artifact: tool({
      description:
        "Create a new artifact (document, code snippet, or HTML page) shown in a side panel. Prefer over huge inline code blocks. Returns the artifact id.",
      inputSchema: z.object({
        title: z.string(),
        kind: z.enum(["markdown", "code", "html"]),
        language: z.string().optional(),
        content: z.string(),
      }),
      execute: async ({ title, kind, language, content }) => {
        if (!ctx.threadId) return { error: "Artifacts are only available inside a chat thread." };
        const { data, error } = await ctx.supabase
          .from("artifacts")
          .insert({
            thread_id: ctx.threadId,
            user_id: ctx.userId,
            title,
            kind,
            language: language ?? null,
            content,
            version: 1,
          })
          .select("id,title,kind,version")
          .single();
        if (error) return { error: error.message };
        return { id: data.id, title: data.title, kind: data.kind, version: data.version };
      },
    }),

    update_artifact: tool({
      description: "Replace the content of an existing artifact by id. Bumps the version.",
      inputSchema: z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        content: z.string(),
      }),
      execute: async ({ id, title, content }) => {
        const { data: current, error: e1 } = await ctx.supabase
          .from("artifacts")
          .select("version,title")
          .eq("id", id)
          .maybeSingle();
        if (e1 || !current) return { error: "Artifact not found" };
        const { data, error } = await ctx.supabase
          .from("artifacts")
          .update({
            content,
            title: title ?? current.title,
            version: current.version + 1,
          })
          .eq("id", id)
          .select("id,title,version")
          .single();
        if (error) return { error: error.message };
        return { id: data.id, title: data.title, version: data.version };
      },
    }),

    web_search: tool({
      description:
        "Search the public web for current information. Returns short results. Cite the urls in your reply.",
      inputSchema: z.object({ query: z.string().min(1).max(300) }),
      execute: async ({ query }) => {
        try {
          const ddgRes = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
          );
          const ddg = (await ddgRes.json()) as {
            AbstractText?: string;
            AbstractURL?: string;
            Heading?: string;
            RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
          };
          const results: { title: string; url: string; snippet: string }[] = [];
          if (ddg.AbstractText && ddg.AbstractURL) {
            results.push({
              title: ddg.Heading || query,
              url: ddg.AbstractURL,
              snippet: ddg.AbstractText,
            });
          }
          for (const t of (ddg.RelatedTopics ?? []).slice(0, 5)) {
            if (t.Text && t.FirstURL)
              results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
          }
          if (results.length === 0) {
            const wikiRes = await fetch(
              `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
            );
            if (wikiRes.ok) {
              const w = (await wikiRes.json()) as {
                title?: string;
                extract?: string;
                content_urls?: { desktop?: { page?: string } };
              };
              if (w.extract)
                results.push({
                  title: w.title ?? query,
                  url:
                    w.content_urls?.desktop?.page ??
                    `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
                  snippet: w.extract,
                });
            }
          }
          return { query, results: results.slice(0, 6) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Search failed" };
        }
      },
    }),

    fetch_url: tool({
      description:
        "Fetch a public webpage and return its readable text content (HTML stripped, ~8k chars max). Use to read a specific URL a user gave you or a promising web_search result.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 EmergentBot/1.0" },
          });
          if (!res.ok) return { error: `HTTP ${res.status}`, url };
          const ct = res.headers.get("content-type") ?? "";
          const raw = await res.text();
          const text = ct.includes("html") ? stripHtml(raw) : raw;
          return {
            url,
            content_type: ct,
            text: text.slice(0, 8000),
            truncated: text.length > 8000,
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Fetch failed" };
        }
      },
    }),

    youtube_transcript: tool({
      description:
        "Get the transcript of a YouTube video by URL or 11-char video id. Returns plain text (up to ~10k chars).",
      inputSchema: z.object({ url_or_id: z.string() }),
      execute: async ({ url_or_id }) => {
        const id = extractYouTubeId(url_or_id);
        if (!id) return { error: "Could not parse YouTube video id" };
        try {
          // Try the public timedtext endpoint (works for videos with published captions).
          const langs = ["en", "en-US", "en-GB", ""];
          for (const lang of langs) {
            const url = `https://video.google.com/timedtext?lang=${lang}&v=${id}`;
            const r = await fetch(url);
            if (!r.ok) continue;
            const xml = await r.text();
            if (!xml || xml.length < 20) continue;
            const parts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
              m[1]
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/\n/g, " "),
            );
            const text = parts.join(" ").trim();
            if (text.length > 20) {
              return {
                video_id: id,
                lang: lang || "auto",
                transcript: text.slice(0, 10000),
                truncated: text.length > 10000,
              };
            }
          }
          return { error: "No transcript available for this video", video_id: id };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Transcript failed" };
        }
      },
    }),

    run_javascript: tool({
      description:
        "Execute a short JavaScript snippet in a sandboxed server context and return the return value + captured console output. Use for calculations, data transformations, quick verifications. No network, no imports. Snippet is wrapped as an async function body — use `return` to return a value.",
      inputSchema: z.object({ code: z.string().min(1).max(8000) }),
      execute: async ({ code }) => {
        const logs: string[] = [];
        const fakeConsole = {
          log: (...a: unknown[]) => logs.push(a.map(String).join(" ")),
          error: (...a: unknown[]) => logs.push("ERR: " + a.map(String).join(" ")),
          warn: (...a: unknown[]) => logs.push("WARN: " + a.map(String).join(" ")),
        };
        try {
          const fn = new Function("console", `return (async () => { ${code} })();`);
          const started = Date.now();
          const result = await Promise.race([
            fn(fakeConsole),
            new Promise((_r, rej) =>
              setTimeout(() => rej(new Error("Timeout (3s)")), 3000),
            ),
          ]);
          return {
            ok: true,
            ms: Date.now() - started,
            result:
              typeof result === "object" ? JSON.stringify(result).slice(0, 4000) : String(result ?? "undefined"),
            logs: logs.slice(0, 50),
          };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            logs: logs.slice(0, 50),
          };
        }
      },
    }),

    read_uploaded_file: tool({
      description:
        "Read the text content of a file the user uploaded to this chat (PDF, text, code, CSV, JSON). Call list first with no id to see what's available, then pass an id to read one.",
      inputSchema: z.object({
        file_id: z.string().uuid().optional(),
        offset: z.number().int().min(0).optional(),
      }),
      execute: async ({ file_id, offset }) => {
        if (!ctx.threadId) return { error: "No thread context" };
        if (!file_id) {
          const { data, error } = await ctx.supabase
            .from("thread_files")
            .select("id,name,mime_type,size_bytes,extracted_text")
            .eq("thread_id", ctx.threadId)
            .order("created_at", { ascending: false });
          if (error) return { error: error.message };
          return {
            files: (data ?? []).map((f) => ({
              id: f.id,
              name: f.name,
              mime_type: f.mime_type,
              size_bytes: f.size_bytes,
              readable: Boolean(f.extracted_text),
              chars: f.extracted_text?.length ?? 0,
            })),
          };
        }
        const { data, error } = await ctx.supabase
          .from("thread_files")
          .select("id,name,mime_type,extracted_text")
          .eq("id", file_id)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: "File not found" };
        if (!data.extracted_text)
          return {
            id: data.id,
            name: data.name,
            error: "No extractable text (binary or image file).",
          };
        const start = offset ?? 0;
        const chunk = data.extracted_text.slice(start, start + 12000);
        return {
          id: data.id,
          name: data.name,
          offset: start,
          text: chunk,
          next_offset: start + chunk.length < data.extracted_text.length ? start + chunk.length : null,
          total_chars: data.extracted_text.length,
        };
      },
    }),

    save_lead: tool({
      description:
        "Save a real prospect/lead you found into the user's CRM. Only save concrete, verifiable prospects — never invented ones. Include the source URL.",
      inputSchema: z.object({
        name: z.string(),
        company: z.string().optional(),
        role_title: z.string().optional(),
        email: z.string().optional(),
        website: z.string().optional(),
        source: z.string().optional(),
        notes: z.string().optional(),
        score: z.number().int().optional(),
      }),
      execute: async (input) => {
        const { data, error } = await ctx.supabase
          .from("leads")
          .insert({
            user_id: ctx.userId,
            name: input.name,
            company: input.company ?? null,
            role_title: input.role_title ?? null,
            email: input.email ?? null,
            website: input.website ?? null,
            source: input.source ?? null,
            notes: input.notes ?? null,
            score: Math.max(0, Math.min(100, input.score ?? 50)),
          })
          .select("id,name,company")
          .single();
        if (error) return { error: error.message };
        return { saved: true, id: data.id, name: data.name, company: data.company };
      },
    }),

    github: tool({
      description:
        "Call the GitHub REST API on the user's behalf. Use for searching repos/code, reading files, listing issues/PRs, and creating issues. `path` is a REST path without a leading host, e.g. 'search/repositories?q=ai+agent' or 'repos/owner/name/contents/README.md'.",
      inputSchema: z.object({
        method: z.enum(["GET", "POST", "PATCH"]),
        path: z.string().min(1).max(500),
        body: z.string().optional(),
      }),
      execute: async ({ method, path, body }) => {
        const connKey = process.env.GITHUB_API_KEY;
        if (!connKey)
          return {
            error:
              "GitHub is not connected yet. Ask the user to connect their GitHub account in the app's integrations settings.",
          };
        try {
          const res = await fetch(
            `https://connector-gateway.lovable.dev/github/${path.replace(/^\//, "")}`,
            {
              method,
              headers: {
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                Authorization: `Bearer ${ctx.lovableApiKey}`,
                "X-Connection-Api-Key": connKey,
              },
              body: method === "GET" ? undefined : (body ?? "{}"),
            },
          );
          const text = await res.text();
          if (!res.ok) return { error: `GitHub ${res.status}: ${text.slice(0, 500)}` };
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            return { status: res.status, text: text.slice(0, 8000) };
          }
          // Decode base64 file contents automatically.
          const obj = json as { content?: string; encoding?: string };
          if (obj?.encoding === "base64" && typeof obj.content === "string") {
            try {
              const decoded = atob(obj.content.replace(/\n/g, ""));
              return { status: res.status, path, text: decoded.slice(0, 12000) };
            } catch {
              /* fall through */
            }
          }
          return { status: res.status, data: JSON.parse(JSON.stringify(json)) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "GitHub request failed" };
        }
      },
    }),

    delegate_to_agent: tool({
      description:
        "SWARM MODE: Spawn a specialist sub-agent to work on a focused sub-task and return its answer. Use one call per specialist — call it multiple times to run a team in parallel. Give the sub-agent a self-contained task; it does not see the parent conversation.",
      inputSchema: z.object({
        role: z.enum([
          "planner",
          "researcher",
          "coder",
          "critic",
          "writer",
          "designer",
          "marketer",
          "analyst",
          "security",
          "devops",
        ]),
        task: z.string().min(4).max(4000),
      }),
      execute: async ({ role, task }) => {
        const roleSystem: Record<string, string> = {
          planner:
            "You are the Planner. Break the task into 3-6 concrete, ordered steps with owners and acceptance criteria. Output the plan only.",
          researcher:
            "You are the Researcher. Answer with concrete, verifiable facts. Cite source URLs. Say plainly when something is uncertain.",
          coder:
            "You are the Coder. Write clean, complete, working code. Use fenced code blocks. No TODO stubs. Explain briefly.",
          critic:
            "You are the Critic. Find flaws, missing edge cases, wrong assumptions, and security holes. Be specific and blunt. Rank issues by severity.",
          writer:
            "You are the Writer. Rewrite and polish into clear, engaging prose. Keep the author's intent; cut the padding.",
          designer:
            "You are the Designer. Specify layout, hierarchy, colour, type, spacing, and states concretely. Describe the UI so an engineer could build it without guessing.",
          marketer:
            "You are the Marketer. Positioning, hooks, and channel strategy. Benefit-first, human tone. Give 3 ranked angles.",
          analyst:
            "You are the Analyst. Quantify. Give the numbers, the method, the assumptions, and the sensitivity of the conclusion.",
          security:
            "You are the Security engineer. Threat-model the task: attack surface, auth/authz gaps, data exposure, injection, and concrete mitigations.",
          devops:
            "You are the DevOps engineer. Deployment topology, CI/CD, env config, observability, rollback plan, and exact commands.",
        };
        try {
          const provider = createLovableAi(ctx.lovableApiKey);
          const { text } = await generateText({
            model: provider("google/gemini-3-flash-preview"),
            system: roleSystem[role],
            prompt: task,
          });
          return { role, task, output: text.slice(0, 6000) };
        } catch (e) {
          return { role, error: e instanceof Error ? e.message : "Delegation failed" };
        }
      },
    }),

    generate_image: tool({
      description: "Generate an image from a text prompt. Returns a URL to render inline.",
      inputSchema: z.object({ prompt: z.string().min(3).max(1000) }),
      execute: async ({ prompt }) => {
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Lovable-API-Key": ctx.lovableApiKey,
              "X-Lovable-AIG-SDK": "vercel-ai-sdk",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-image",
              prompt,
              n: 1,
            }),
          });
          if (!res.ok) {
            const t = await res.text();
            return { error: `Image generation failed (${res.status}): ${t.slice(0, 200)}` };
          }
          const json = (await res.json()) as {
            data?: Array<{ url?: string; b64_json?: string }>;
          };
          const first = json.data?.[0];
          const url =
            first?.url ??
            (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined);
          if (!url) return { error: "No image returned" };
          return { url, prompt };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Image generation failed" };
        }
      },
    }),
  };
}
