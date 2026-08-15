import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("leads")
      .select("id,name,company,role_title,email,website,source,notes,score,status,created_at")
      .order("score", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        company: z.string().max(200).nullish(),
        role_title: z.string().max(200).nullish(),
        email: z.string().max(200).nullish(),
        website: z.string().max(500).nullish(),
        source: z.string().max(500).nullish(),
        notes: z.string().max(5000).nullish(),
        score: z.number().int().min(0).max(100).optional(),
        status: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      name: data.name,
      company: data.company ?? null,
      role_title: data.role_title ?? null,
      email: data.email ?? null,
      website: data.website ?? null,
      source: data.source ?? null,
      notes: data.notes ?? null,
      score: data.score ?? 50,
      status: data.status ?? "new",
    };
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("leads")
        .update(payload)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("leads")
      .insert({ ...payload, user_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("leads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
