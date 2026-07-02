import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAi } from "@/lib/ai-gateway.server";
import type { Database } from "@/integrations/supabase/types";

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

        let body: { threadId?: string; messages?: UIMessage[] };
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

        const { data: thread, error: tErr } = await supabase
          .from("threads")
          .select("id,title")
          .eq("id", threadId)
          .maybeSingle();
        if (tErr) return new Response(tErr.message, { status: 500 });
        if (!thread) return new Response("Thread not found", { status: 404 });

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
            if (thread.title === "New chat") {
              await supabase
                .from("threads")
                .update({ title: text.slice(0, 60) })
                .eq("id", threadId);
            }
          }
        }

        const provider = createLovableAi(lovableKey);
        const result = streamText({
          model: provider("google/gemini-3-flash-preview"),
          system:
            "You are Emergent, a fast, precise AI assistant. Answer clearly and use Markdown (headings, lists, code fences) when it helps readability. Keep replies focused.",
          messages: convertToModelMessages(messages),
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
                });
              }
            }
          },
        });
      },
    },
  },
});
