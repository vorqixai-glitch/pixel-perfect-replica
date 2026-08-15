import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getWorkflow } from "@/lib/workflows";

type StepRecord = {
  key: string;
  title: string;
  personaId: string;
  status: "pending" | "running" | "done" | "error";
  output: string;
  error?: string;
};

export const listWorkflowRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("workflow_runs")
      .select("id,workflow_key,title,status,current_step,steps,thread_id,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getWorkflowRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("workflow_runs")
      .select("id,workflow_key,title,status,current_step,steps,thread_id,created_at,updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Run not found");
    return row;
  });

export const createWorkflowRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workflowKey: z.string().min(1).max(64),
        brief: z.string().min(3).max(8000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const wf = getWorkflow(data.workflowKey);
    if (!wf) throw new Error("Unknown workflow");

    const steps: StepRecord[] = wf.steps.map((s) => ({
      key: s.key,
      title: s.title,
      personaId: s.personaId,
      status: "pending",
      output: "",
    }));

    const { data: row, error } = await context.supabase
      .from("workflow_runs")
      .insert({
        user_id: context.userId,
        workflow_key: wf.key,
        title: data.brief.slice(0, 80),
        status: "pending",
        current_step: 0,
        steps: JSON.parse(JSON.stringify({ brief: data.brief, steps })),
      })
      .select("id,workflow_key,title,status,current_step,steps,thread_id,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteWorkflowRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("workflow_runs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Execute exactly one step of a run. The UI calls this repeatedly so progress streams in. */
export const runWorkflowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), stepIndex: z.number().int().min(0).max(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured");

    const { data: run, error: rErr } = await context.supabase
      .from("workflow_runs")
      .select("id,workflow_key,steps,current_step")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!run) throw new Error("Run not found");

    const wf = getWorkflow(run.workflow_key);
    if (!wf) throw new Error("Unknown workflow");

    const state = run.steps as unknown as { brief: string; steps: StepRecord[] };
    const stepDef = wf.steps[data.stepIndex];
    if (!stepDef) throw new Error("Step out of range");

    const prev = state.steps
      .slice(0, data.stepIndex)
      .filter((s) => s.status === "done")
      .map((s) => `### ${s.title}\n${s.output}`)
      .join("\n\n");

    const prompt = stepDef.prompt
      .replace("{{brief}}", state.brief)
      .replace("{{prev}}", prev || "(no previous steps)");

    const { generateText, stepCountIs } = await import("ai");
    const { createLovableAi } = await import("@/lib/ai-gateway.server");
    const { buildTools } = await import("@/lib/ai-tools.server");
    const { getPersona } = await import("@/lib/personas");

    const persona = getPersona(stepDef.personaId);
    const provider = createLovableAi(key);

    const allTools = buildTools({
      supabase: context.supabase,
      threadId: null,
      userId: context.userId,
      lovableApiKey: key,
    });
    const tools = Object.fromEntries(
      Object.entries(allTools).filter(
        ([k]) =>
          k !== "create_artifact" &&
          k !== "update_artifact" &&
          (k !== "delegate_to_agent" || persona.swarm),
      ),
    );

    let output = "";
    let errMsg: string | null = null;
    try {
      const res = await generateText({
        model: provider("google/gemini-3-flash-preview"),
        system: `${persona.system}\n\nYou are executing the "${stepDef.title}" step of the "${wf.name}" workflow. Produce the deliverable for this step only, in Markdown. Be concrete and complete.`,
        prompt,
        tools,
        stopWhen: stepCountIs(50),
      });
      output = res.text;
    } catch (e) {
      errMsg = e instanceof Error ? e.message : "Step failed";
    }

    const nextSteps = state.steps.map((s, i) =>
      i === data.stepIndex
        ? {
            ...s,
            status: (errMsg ? "error" : "done") as StepRecord["status"],
            output,
            error: errMsg ?? undefined,
          }
        : s,
    );
    const allDone = nextSteps.every((s) => s.status === "done");

    const { data: updated, error: uErr } = await context.supabase
      .from("workflow_runs")
      .update({
        steps: JSON.parse(JSON.stringify({ brief: state.brief, steps: nextSteps })),
        current_step: Math.min(data.stepIndex + 1, wf.steps.length),
        status: errMsg ? "error" : allDone ? "done" : "running",
      })
      .eq("id", data.id)
      .select("id,workflow_key,title,status,current_step,steps,thread_id,created_at,updated_at")
      .single();
    if (uErr) throw new Error(uErr.message);

    return updated;
  });
