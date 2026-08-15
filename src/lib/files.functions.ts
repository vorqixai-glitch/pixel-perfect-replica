import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "thread-files";
const MAX_BYTES = 20 * 1024 * 1024;

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function extractText(
  bytes: Uint8Array,
  mime: string,
  name: string,
): Promise<string | null> {
  const lower = name.toLowerCase();
  try {
    if (mime === "application/pdf" || lower.endsWith(".pdf")) {
      const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(bytes);
      const { text } = await pdfExtract(doc, { mergePages: true });
      return typeof text === "string" ? text.slice(0, 200_000) : null;
    }
    if (
      mime.startsWith("text/") ||
      mime === "application/json" ||
      /\.(txt|md|csv|json|ya?ml|tsv|log|html?|xml|ts|tsx|js|jsx|py|go|rs|java|rb|php|sql|css|sh)$/.test(
        lower,
      )
    ) {
      return new TextDecoder().decode(bytes).slice(0, 200_000);
    }
  } catch {
    return null;
  }
  return null;
}

export const listThreadFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("thread_files")
      .select("id,name,path,mime_type,size_bytes,created_at,extracted_text")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
      has_text: Boolean(r.extracted_text),
      preview: r.extracted_text ? r.extracted_text.slice(0, 240) : null,
    }));
  });

export const uploadThreadFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        threadId: z.string().uuid(),
        name: z.string().min(1).max(300),
        mimeType: z.string().max(200).optional(),
        dataBase64: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const bytes = decodeBase64(data.dataBase64);
    if (bytes.byteLength > MAX_BYTES) throw new Error("File is larger than 20MB");

    const mime = data.mimeType || "application/octet-stream";
    const safeName = data.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
    const path = `${context.userId}/${data.threadId}/${Date.now()}-${safeName}`;

    const { error: upErr } = await context.supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const text = await extractText(bytes, mime, data.name);

    const { data: row, error } = await context.supabase
      .from("thread_files")
      .insert({
        thread_id: data.threadId,
        user_id: context.userId,
        name: data.name.slice(0, 300),
        path,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        extracted_text: text,
      })
      .select("id,name,path,mime_type,size_bytes,created_at")
      .single();
    if (error) throw new Error(error.message);

    return { ...row, has_text: Boolean(text), text_chars: text?.length ?? 0 };
  });

export const deleteThreadFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("thread_files")
      .select("path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.path) await context.supabase.storage.from(BUCKET).remove([row.path]);
    const { error } = await context.supabase.from("thread_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getFileDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("thread_files")
      .select("path,name")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("File not found");
    const { data: signed, error: sErr } = await context.supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.path, 3600, { download: row.name });
    if (sErr) throw new Error(sErr.message);
    return { url: signed.signedUrl, name: row.name };
  });
