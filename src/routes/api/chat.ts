import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { createLovableAi } from "@/lib/ai-gateway.server";
import { buildTools } from "@/lib/ai-tools.server";
import { getPersona } from "@/lib/personas";
import type { Database } from "@/integrations/supabase/types";

import { ALLOWED_MODEL_IDS, DEFAULT_MODEL } from "@/lib/models";

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

        let body: { threadId?: string; messages?: UIMessage[]; model?: string; personaId?: string; enabledTools?: string[] };
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
          body.model && ALLOWED_MODEL_IDS.has(body.model) ? body.model : DEFAULT_MODEL;

        const { data: thread, error: tErr } = await supabase
          .from("threads")
          .select("id,title,model,project_id,persona_id")
          .eq("id", threadId)
          .maybeSingle();
        if (tErr) return new Response(tErr.message, { status: 500 });
        if (!thread) return new Response("Thread not found", { status: 404 });

        const personaId = body.personaId ?? thread.persona_id ?? "default";
        const persona = getPersona(personaId);

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

        // Persist last user message + persona/model changes + auto-title
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const text = extractText(lastUser);
          if (text) {
            await supabase.from("messages").insert({
              thread_id: threadId,
              role: "user",
              content: text,
            });
            const updates: { title?: string; model?: string; persona_id?: string } = {};
            if (thread.title === "New chat") updates.title = text.slice(0, 60);
            if (thread.model !== model) updates.model = model;
            if (thread.persona_id !== personaId) updates.persona_id = personaId;
            if (Object.keys(updates).length > 0) {
              await supabase.from("threads").update(updates).eq("id", threadId);
            }
          }
        }

        const provider = createLovableAi(lovableKey);
        const allTools = buildTools({ supabase, threadId, userId, lovableApiKey: lovableKey });
        // Always-on core tools (side-panel artifacts). Everything else is user-toggleable.
        const ALWAYS_ON = new Set(["create_artifact", "update_artifact"]);
        const requested = Array.isArray(body.enabledTools) ? new Set(body.enabledTools) : null;
        const tools = Object.fromEntries(
          Object.entries(allTools).filter(([k]) => {
            if (k === "delegate_to_agent") return persona.swarm;
            if (ALWAYS_ON.has(k)) return true;
            return requested ? requested.has(k) : true;
          }),
        );

        const enabledList = Object.keys(tools).join(", ");
        const systemParts = [
          persona.system,
          "Answer clearly in Markdown (headings, lists, code fences).",
          `Available tools this turn: ${enabledList}. If the user asks for something a disabled tool would do, say the tool is off and suggest enabling it in Tools settings. Prefer create_artifact over pasting long code inline.`,
        ];
        if (projectName) systemParts.push(`This chat is part of the project "${projectName}".`);
        if (projectSystemPrompt) systemParts.push(`Project instructions:\n${projectSystemPrompt}`);

        const result = streamText({
          model: provider(model),
          system: systemParts.join("\n\n"),
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
