import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { createLovableAi } from "@/lib/ai-gateway.server";
import { buildTools } from "@/lib/ai-tools.server";
import { getPersona } from "@/lib/personas";
import type { Database } from "@/integrations/supabase/types";

const ALLOWED_MODELS = new Set([
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
  "openai/gpt-5",
  "openai/gpt-5-mini",
]);

function extractText(msg: UIMessage): string {
  return (msg.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supabaseUrl = process.env.SUPABASE_URL;
        const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!supabaseUrl || !publishable) {
          return new Response("Backend not configured", { status: 500 });
        }
        if (!lovableKey) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const supabase = createClient<Database>(supabaseUrl, publishable, {
          global: { headers: { Authorization: `Bearer ${token}`, apikey: publishable } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData.user) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = userData.user.id;

        let body: { threadId?: string; messages?: UIMessage[]; model?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const threadId = body.threadId;
        const messages = body.messages;
        if (!threadId || !Array.isArray(messages)) {
          return new Response("Bad request", { status: 400 });
        }
        const model =
          body.model && ALLOWED_MODELS.has(body.model)
            ? body.model
            : "google/gemini-3-flash-preview";

        const { data: thread, error: tErr } = await supabase
          .from("threads")
          .select("id,title,model,project_id")
          .eq("id", threadId)
          .maybeSingle();
        if (tErr) return new Response(tErr.message, { status: 500 });
        if (!thread) return new Response("Thread not found", { status: 404 });

        let projectSystemPrompt: string | null = null;
        let projectName: string | null = null;
        if (thread.project_id) {
          const { data: proj } = await supabase
            .from("projects")
            .select("name,system_prompt")
            .eq("id", thread.project_id)
            .maybeSingle();
          if (proj) {
            projectName = proj.name;
            projectSystemPrompt = proj.system_prompt;
          }
        }

        // Persist last user message
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const text = extractText(lastUser);
          if (text) {
            await supabase.from("messages").insert({
              thread_id: threadId,
              role: "user",
              content: text,
            });
            const updates: { title?: string; model?: string } = {};
            if (thread.title === "New chat") updates.title = text.slice(0, 60);
            if (thread.model !== model) updates.model = model;
            if (Object.keys(updates).length > 0) {
              await supabase.from("threads").update(updates).eq("id", threadId);
            }
          }
        }

        const provider = createLovableAi(lovableKey);
        const tools = buildTools({ supabase, threadId, userId, lovableApiKey: lovableKey });

        const systemParts = [
          "You are Emergent, a fast, precise AI workspace assistant.",
          "Answer clearly in Markdown (headings, lists, code fences).",
          "You have tools:",
          "- create_artifact / update_artifact: for docs, code, HTML pages. Open in a side panel.",
          "- web_search: for current or uncertain facts. Cite the URLs you used.",
          "- generate_image: for visuals when asked.",
          "Prefer create_artifact over pasting long code blocks inline.",
        ];
        if (projectName) {
          systemParts.push(`This chat is part of the project "${projectName}".`);
        }
        if (projectSystemPrompt) {
          systemParts.push(`Project instructions:\n${projectSystemPrompt}`);
        }

        const result = streamText({
          model: provider(model),
          system: systemParts.join(" "),
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: finalMessages }) => {
            const last = finalMessages[finalMessages.length - 1];
            if (last?.role === "assistant") {
              const text = extractText(last);
              if (text) {
                await supabase.from("messages").insert({
                  thread_id: threadId,
                  role: "assistant",
                  content: text,
                  model,
                });
              }
            }
          },
        });
      },
    },
  },
});
