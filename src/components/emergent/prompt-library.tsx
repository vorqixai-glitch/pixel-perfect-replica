import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { deletePrompt, improvePrompt, listPrompts, savePrompt } from "@/lib/prompts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";

export function PromptLibrary({
  onUse,
  onClose,
}: {
  onUse: (text: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listPrompts);
  const save = useServerFn(savePrompt);
  const del = useServerFn(deletePrompt);
  const improve = useServerFn(improvePrompt);

  const promptsQ = useQuery({ queryKey: ["prompts"], queryFn: () => list({}) });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [idea, setIdea] = useState("");

  const saveM = useMutation({
    mutationFn: () =>
      save({ data: { id: editingId ?? undefined, title: title.trim(), body: body.trim() } }),
    onSuccess: () => {
      toast.success(editingId ? "Prompt updated" : "Prompt saved");
      setEditingId(null);
      setTitle("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const improveM = useMutation({
    mutationFn: () => improve({ data: { idea: idea.trim() } }),
    onSuccess: (res) => {
      setBody(res.prompt);
      if (!title.trim()) setTitle(idea.trim().slice(0, 60));
      toast.success("Prompt generated — edit and save it");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const prompts = promptsQ.data ?? [];

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card/40">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="flex-1 text-sm font-medium">Prompt studio</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close prompt studio">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="space-y-2 border-b border-border p-3">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="prompt-idea">
          Text → prompt
        </label>
        <Textarea
          id="prompt-idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Rough idea, e.g. 'help me write cold emails for gyms'"
          rows={2}
          className="resize-none text-sm"
        />
        <Button
          type="button"
          size="sm"
          className="w-full gap-1.5"
          disabled={idea.trim().length < 3 || improveM.isPending}
          onClick={() => improveM.mutate()}
        >
          {improveM.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          Generate prompt
        </Button>
      </div>

      <div className="space-y-2 border-b border-border p-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Prompt title"
          className="h-8 text-sm"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Prompt text…"
          rows={5}
          className="resize-none text-sm"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5"
            disabled={!title.trim() || !body.trim() || saveM.isPending}
            onClick={() => saveM.mutate()}
          >
            {saveM.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {editingId ? "Update" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={!body.trim()}
            onClick={() => onUse(body)}
          >
            Use
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {promptsQ.isLoading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!promptsQ.isLoading && prompts.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No saved prompts yet.
          </p>
        )}
        {prompts.map((p) => (
          <div key={p.id} className="group rounded-md px-2 py-2 hover:bg-accent/50">
            <div className="flex items-start gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onUse(p.body)}
              >
                <div className="truncate text-sm font-medium">{p.title}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{p.body}</div>
              </button>
              <button
                type="button"
                aria-label={`Edit ${p.title}`}
                className="rounded p-1 text-xs text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                onClick={() => {
                  setEditingId(p.id);
                  setTitle(p.title);
                  setBody(p.body);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                aria-label={`Delete ${p.title}`}
                className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                onClick={() => delM.mutate(p.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
