import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listPrompts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("prompts")
      .select("id,title,body,tags,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const savePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(160),
        body: z.string().min(1).max(20000),
        tags: z.array(z.string().max(40)).max(12).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("prompts")
        .update({ title: data.title, body: data.body, tags: data.tags ?? [] })
        .eq("id", data.id)
        .select("id,title,body,tags,created_at,updated_at")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("prompts")
      .insert({
        user_id: context.userId,
        title: data.title,
        body: data.body,
        tags: data.tags ?? [],
      })
      .select("id,title,body,tags,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deletePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("prompts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Turn a rough idea into a polished, structured prompt. */
export const improvePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ idea: z.string().min(3).max(4000) }).parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured");
    const { generateText } = await import("ai");
    const { createLovableAi } = await import("@/lib/ai-gateway.server");
    const provider = createLovableAi(key);
    const { text } = await generateText({
      model: provider("google/gemini-3-flash-preview"),
      system:
        "You are a prompt engineer. Rewrite the user's rough idea into a single, high-quality prompt: explicit role, concrete task, required context, output format, and constraints. Output ONLY the finished prompt text — no preamble, no explanation, no code fences.",
      prompt: data.idea,
    });
    return { prompt: text.trim() };
  });
