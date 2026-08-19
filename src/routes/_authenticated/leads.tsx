import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { deleteLead, listLeads, upsertLead } from "@/lib/leads.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { useRealtime } from "@/hooks/use-realtime";

export const Route = createFileRoute("/_authenticated/leads")({
  component: LeadsPage,
  head: () => ({
    meta: [
      { title: "Leads CRM — vorqix.ai" },
      {
        name: "description",
        content:
          "Track prospects your agents find: score, status, notes, and contact details in one live CRM.",
      },
      { property: "og:title", content: "Leads CRM — vorqix.ai" },
      {
        property: "og:description",
        content: "Score, status, notes, and contacts for every prospect your agents find.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type LeadForm = {
  id?: string;
  name: string;
  company: string;
  role_title: string;
  email: string;
  website: string;
  notes: string;
  score: number;
  status: string;
};

const EMPTY: LeadForm = {
  name: "",
  company: "",
  role_title: "",
  email: "",
  website: "",
  notes: "",
  score: 50,
  status: "new",
};

function LeadsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLeads);
  const upsertFn = useServerFn(upsertLead);
  const deleteFn = useServerFn(deleteLead);

  const leadsQ = useQuery({ queryKey: ["leads"], queryFn: () => listFn() });
  useRealtime([{ table: "leads", keys: [["leads"]] }], "leads");

  const [form, setForm] = useState<LeadForm | null>(null);

  const save = useMutation({
    mutationFn: (v: LeadForm) =>
      upsertFn({
        data: {
          ...(v.id ? { id: v.id } : {}),
          name: v.name,
          company: v.company || null,
          role_title: v.role_title || null,
          email: v.email || null,
          website: v.website || null,
          notes: v.notes || null,
          score: v.score,
          status: v.status,
        },
      }),
    onSuccess: () => {
      setForm(null);
      toast.success("Lead saved");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/chat">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Leads</h1>
            <p className="text-sm text-muted-foreground">
              Every prospect you or your agents save, updated live.
            </p>
          </div>
          <Button onClick={() => setForm({ ...EMPTY })}>
            <Plus className="mr-2 h-4 w-4" /> New lead
          </Button>
        </div>

        {leadsQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading leads…
          </div>
        )}

        <div className="divide-y rounded-lg border">
          {(leadsQ.data ?? []).map((l) => (
            <div key={l.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{l.name}</span>
                  <Badge variant="secondary">{l.status}</Badge>
                  <span className="text-xs text-muted-foreground">score {l.score}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[l.role_title, l.company, l.email, l.website].filter(Boolean).join(" · ")}
                </div>
                {l.notes && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{l.notes}</p>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setForm({
                    id: l.id,
                    name: l.name,
                    company: l.company ?? "",
                    role_title: l.role_title ?? "",
                    email: l.email ?? "",
                    website: l.website ?? "",
                    notes: l.notes ?? "",
                    score: l.score ?? 50,
                    status: l.status ?? "new",
                  })
                }
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive"
                onClick={() => remove.mutate(l.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {(leadsQ.data ?? []).length === 0 && !leadsQ.isLoading && (
            <p className="p-4 text-sm text-muted-foreground">
              No leads yet. Run the “Find customers” workflow or add one manually.
            </p>
          )}
        </div>
      </div>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit lead" : "New lead"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <Input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <Input
                placeholder="Company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
              <Input
                placeholder="Role / title"
                value={form.role_title}
                onChange={(e) => setForm({ ...form, role_title: e.target.value })}
              />
              <Input
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <Input
                placeholder="Website"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
              <div className="flex gap-3">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Score"
                  value={form.score}
                  onChange={(e) =>
                    setForm({ ...form, score: Number(e.target.value || 0) })
                  }
                />
                <Input
                  placeholder="Status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                />
              </div>
              <Textarea
                placeholder="Notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || !form?.name.trim()}
              onClick={() => form && save.mutate(form)}
            >
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
