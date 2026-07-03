import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type ToolCtx = {
  supabase: ReturnType<typeof createClient<Database>>;
  threadId: string;
  userId: string;
  lovableApiKey: string;
};

export function buildTools(ctx: ToolCtx) {
  return {
    create_artifact: tool({
      description:
        "Create a new artifact (document, code snippet, or HTML page) that appears in a side panel next to the chat. Use for anything the user might want to iterate on, copy, or reuse — docs, code, HTML/CSS, reports, plans. Prefer this over a huge inline code block. Returns the artifact id.",
      inputSchema: z.object({
        title: z.string().describe("Short human title, max ~60 chars"),
        kind: z
          .enum(["markdown", "code", "html"])
          .describe("markdown for docs, code for snippets, html for a runnable page"),
        language: z
          .string()
          .optional()
          .describe("If kind=code, the language, e.g. 'typescript', 'python'"),
        content: z.string().describe("Full artifact body"),
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
      description:
        "Replace the content of an existing artifact by id. Bumps the version. Use when the user asks to iterate on an artifact you already created.",
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
        "Search the public web for current information. Returns short results (title, url, snippet). Use for anything time-sensitive, news, or facts you're unsure about. Cite the urls in your reply.",
      inputSchema: z.object({
        query: z.string().min(1).max(300),
      }),
      execute: async ({ query }) => {
        try {
          // DuckDuckGo Instant Answer + Wikipedia summary — no API key required.
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
            if (t.Text && t.FirstURL) {
              results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
            }
          }

          // Wikipedia fallback for zero-result cases
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
              if (w.extract) {
                results.push({
                  title: w.title ?? query,
                  url: w.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
                  snippet: w.extract,
                });
              }
            }
          }

          return {
            query,
            results: results.slice(0, 6),
            note: results.length === 0 ? "No results found." : undefined,
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Search failed" };
        }
      },
    }),

    generate_image: tool({
      description:
        "Generate an image from a text prompt. Returns a data URL that will render inline. Use when the user asks for an image, illustration, logo idea, etc.",
      inputSchema: z.object({
        prompt: z.string().min(3).max(1000),
      }),
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
