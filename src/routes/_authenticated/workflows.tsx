import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createWorkflowRun,
  deleteWorkflowRun,
  listWorkflowRuns,
  runWorkflowStep,
} from "@/lib/workflows.functions";
import { WORKFLOWS, getWorkflow } from "@/lib/workflows";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  CircleDashed,
  Loader2,
  Play,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRealtime } from "@/hooks/use-realtime";


export const Route = createFileRoute("/_authenticated/workflows")({
  component: WorkflowsPage,
  head: () => ({
    meta: [
      { title: "Workflows — Emergent" },
      {
        name: "description",
        content:
          "Run multi-agent workflows that plan, build, deploy, launch, and find customers for your product.",
      },
      { property: "og:title", content: "Workflows — Emergent" },
      {
        property: "og:description",
        content: "Multi-agent workflows: plan, build, deploy, launch, find leads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type StepRecord = {
  key: string;
  title: string;
  personaId: string;
  status: "pending" | "running" | "done" | "error";
  output: string;
  error?: string;
};

function WorkflowsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listWorkflowRuns);
  const create = useServerFn(createWorkflowRun);
  const runStep = useServerFn(runWorkflowStep);
  const del = useServerFn(deleteWorkflowRun);

  const runsQ = useQuery({ queryKey: ["workflow-runs"], queryFn: () => list({}) });
  useRealtime([{ table: "workflow_runs", keys: [["workflow-runs"]] }], "workflows");


  const [workflowKey, setWorkflowKey] = useState(WORKFLOWS[0].key);
  const [brief, setBrief] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runningStep, setRunningStep] = useState<number | null>(null);

  const createM = useMutation({
    mutationFn: () => create({ data: { workflowKey, brief: brief.trim() } }),
    onSuccess: (run) => {
      setBrief("");
      setActiveId(run.id);
      qc.invalidateQueries({ queryKey: ["workflow-runs"] });
      toast.success("Run created — hit Run next step");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      setActiveId(null);
      qc.invalidateQueries({ queryKey: ["workflow-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runs = runsQ.data ?? [];
  const active = runs.find((r) => r.id === activeId) ?? null;
  const activeWf = getWorkflow(active?.workflow_key);
  const activeState = active
    ? (active.steps as unknown as { brief: string; steps: StepRecord[] })
    : null;

  async function executeStep(index: number) {
    if (!active) return;
    setRunningStep(index);
    try {
      await runStep({ data: { id: active.id, stepIndex: index } });
      await qc.invalidateQueries({ queryKey: ["workflow-runs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Step failed");
    } finally {
      setRunningStep(null);
    }
  }

  async function runAll() {
    if (!active || !activeWf || !activeState) return;
    for (let i = 0; i < activeWf.steps.length; i++) {
      if (activeState.steps[i]?.status === "done") continue;
      setRunningStep(i);
      try {
        await runStep({ data: { id: active.id, stepIndex: i } });
        await qc.invalidateQueries({ queryKey: ["workflow-runs"] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Step failed");
        break;
      }
    }
    setRunningStep(null);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-72 shrink-0 overflow-y-auto border-r border-border p-3">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          New run
        </h2>
        <div className="space-y-1.5">
          {WORKFLOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWorkflowKey(w.key)}
              className={cn(
                "w-full rounded-lg border p-2.5 text-left transition",
                workflowKey === w.key
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent/50",
              )}
            >
              <div className="text-sm font-medium">
                <span className="mr-1.5">{w.emoji}</span>
                {w.name}
              </div>
              <div className="text-xs text-muted-foreground">{w.tagline}</div>
            </button>
          ))}
        </div>
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          placeholder="Describe the product / campaign…"
          className="mt-3 resize-none text-sm"
        />
        <Button
          className="mt-2 w-full gap-1.5"
          disabled={brief.trim().length < 3 || createM.isPending}
          onClick={() => createM.mutate()}
        >
          {createM.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Start run
        </Button>

        <h2 className="mb-2 mt-6 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Runs
        </h2>
        {runsQ.isLoading && <Loader2 className="mx-auto h-4 w-4 animate-spin" />}
        {runs.length === 0 && !runsQ.isLoading && (
          <p className="px-1 text-xs text-muted-foreground">No runs yet.</p>
        )}
        <div className="space-y-0.5">
          {runs.map((r) => (
            <div
              key={r.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5",
                activeId === r.id ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setActiveId(r.id)}
              >
                <div className="truncate text-sm">{r.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {getWorkflow(r.workflow_key)?.name ?? r.workflow_key} · {r.status}
                </div>
              </button>
              <button
                type="button"
                aria-label="Delete run"
                className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                onClick={() => delM.mutate(r.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {!active && (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Pick a workflow, write a brief, and start a run.
          </div>
        )}
        {active && activeWf && activeState && (
          <div className="mx-auto max-w-3xl p-6">
            <h1 className="text-xl font-semibold">
              {activeWf.emoji} {activeWf.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{activeState.brief}</p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                disabled={runningStep !== null}
                onClick={runAll}
              >
                {runningStep !== null ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Run all remaining
              </Button>
            </div>

            <div className="mt-6 space-y-3">
              {activeWf.steps.map((def, i) => {
                const st = activeState.steps[i];
                const running = runningStep === i;
                return (
                  <StepCard
                    key={def.key}
                    index={i}
                    title={def.title}
                    description={def.description}
                    status={running ? "running" : (st?.status ?? "pending")}
                    output={st?.output ?? ""}
                    error={st?.error}
                    onRun={() => executeStep(i)}
                    disabled={runningStep !== null}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({
  index,
  title,
  description,
  status,
  output,
  error,
  onRun,
  disabled,
}: {
  index: number;
  title: string;
  description: string;
  status: string;
  output: string;
  error?: string;
  onRun: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon =
    status === "done"
      ? Check
      : status === "error"
        ? TriangleAlert
        : status === "running"
          ? Loader2
          : CircleDashed;

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-3 p-3">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            status === "done" && "text-primary",
            status === "error" && "text-destructive",
            status === "running" && "animate-spin text-primary",
            status === "pending" && "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {index + 1}. {title}
          </div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        {output && (
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setOpen((v) => !v)}>
            <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
            {open ? "Hide" : "View"}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={disabled} onClick={onRun}>
          {status === "done" ? "Re-run" : "Run"}
        </Button>
      </div>
      {error && <p className="border-t border-border px-3 py-2 text-xs text-destructive">{error}</p>}
      {open && output && (
        <div className="prose prose-sm dark:prose-invert max-w-none border-t border-border p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
