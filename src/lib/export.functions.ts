import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildExport, pushFilesToGithub } from "./export.server";

const scopeSchema = z.union([
  z.object({ projectId: z.string().uuid() }),
  z.object({ threadId: z.string().uuid() }),
]);

export const buildProjectExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scopeSchema.parse(d))
  .handler(async ({ data, context }) => {
    return buildExport(context.supabase, data);
  });

export const pushExportToGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        projectId: z.string().uuid().optional(),
        threadId: z.string().uuid().optional(),
        repo: z
          .string()
          .min(1)
          .max(90)
          .regex(/^[\w.-]+$/, "Use letters, numbers, dashes, dots or underscores"),
        isPrivate: z.boolean().default(true),
        subdir: z.string().max(120).optional(),
      })
      .refine((v) => v.projectId || v.threadId, "Missing project or thread")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const scope = data.projectId
      ? { projectId: data.projectId }
      : { threadId: data.threadId! };
    const bundle = await buildExport(context.supabase, scope);
    return pushFilesToGithub({
      files: bundle.files,
      repo: data.repo,
      isPrivate: data.isPrivate,
      subdir: data.subdir ?? "",
    });
  });
