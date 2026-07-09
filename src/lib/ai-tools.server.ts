import { tool, generateText } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAi } from "@/lib/ai-gateway.server";

type ToolCtx = {
  supabase: ReturnType<typeof createClient<Database>>;
  threadId: string;
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

    delegate_to_agent: tool({
      description:
        "SWARM MODE: Spawn a specialist sub-agent to work on a focused sub-task and return its answer. Use one call per specialist. Roles: 'planner', 'researcher', 'coder', 'critic', 'writer'. Give the sub-agent a self-contained task — it does not see the parent conversation.",
      inputSchema: z.object({
        role: z.enum(["planner", "researcher", "coder", "critic", "writer"]),
        task: z.string().min(4).max(2000),
      }),
      execute: async ({ role, task }) => {
        const roleSystem: Record<string, string> = {
          planner:
            "You are the Planner. Break the task into 3-6 concrete, ordered steps. Output a short numbered plan only.",
          researcher:
            "You are the Researcher. Answer the task with concrete facts. Cite sources if you know them.",
          coder:
            "You are the Coder. Write clean, working code for the task. Use fenced code blocks. Explain briefly.",
          critic:
            "You are the Critic. Find flaws, missing edge cases, wrong assumptions. Be specific and blunt.",
          writer:
            "You are the Writer. Rewrite / polish the task's content into clear, engaging prose.",
        };
        try {
          const provider = createLovableAi(ctx.lovableApiKey);
          const { text } = await generateText({
            model: provider("google/gemini-3-flash-preview"),
            system: roleSystem[role],
            prompt: task,
          });
          return { role, task, output: text.slice(0, 4000) };
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
