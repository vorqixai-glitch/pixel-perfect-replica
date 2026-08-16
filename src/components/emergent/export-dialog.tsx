import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { zipSync, strToU8 } from "fflate";
import { buildProjectExport, pushExportToGithub } from "@/lib/export.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Download, Github, Loader2, ExternalLink } from "lucide-react";

export type ExportTarget =
  | { kind: "project"; id: string; name: string }
  | { kind: "thread"; id: string; name: string };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function defaultRepoName(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "emergent-export"
  );
}

export function ExportDialog({
  target,
  open,
  onOpenChange,
}: {
  target: ExportTarget | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const buildFn = useServerFn(buildProjectExport);
  const pushFn = useServerFn(pushExportToGithub);

  const [busy, setBusy] = useState<"zip" | "github" | null>(null);
  const [repo, setRepo] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [subdir, setSubdir] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const scope =
    target?.kind === "project" ? { projectId: target.id } : target ? { threadId: target.id } : null;

  async function handleDownload() {
    if (!scope) return;
    setBusy("zip");
    try {
      const bundle = await buildFn({ data: scope });
      const entries: Record<string, Uint8Array> = {};
      for (const f of bundle.files) entries[f.path] = base64ToBytes(f.contentBase64);
      if (Object.keys(entries).length === 0) entries["README.md"] = strToU8("Empty export");
      const zipped = zipSync(entries, { level: 6 });
      const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bundle.name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Downloaded ${bundle.counts.chats} chat(s), ${bundle.counts.artifacts} artifact(s), ${bundle.counts.files} file(s)`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleGithub() {
    if (!target) return;
    const name = (repo || defaultRepoName(target.name)).trim();
    setBusy("github");
    setResult(null);
    try {
      const res = await pushFn({
        data: {
          ...(target.kind === "project" ? { projectId: target.id } : { threadId: target.id }),
          repo: name,
          isPrivate,
          subdir: subdir.trim() || undefined,
        },
      });
      setResult(res.url);
      toast.success(`Pushed ${res.written} file(s) to ${res.owner}/${res.repo}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "GitHub export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export {target?.kind === "project" ? "project" : "chat"}</DialogTitle>
          <DialogDescription className="truncate">
            {target?.name} — chats, artifacts and uploaded files.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="desktop">
          <TabsList className="w-full">
            <TabsTrigger value="desktop" className="flex-1">
              <Download className="mr-2 h-4 w-4" /> Desktop
            </TabsTrigger>
            <TabsTrigger value="github" className="flex-1">
              <Github className="mr-2 h-4 w-4" /> GitHub
            </TabsTrigger>
          </TabsList>

          <TabsContent value="desktop" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Downloads a ZIP with <code>README.md</code>, <code>chats/</code>,{" "}
              <code>artifacts/</code>, <code>files/</code> and <code>project.json</code>.
            </p>
            <Button onClick={handleDownload} disabled={busy !== null} className="w-full">
              {busy === "zip" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download ZIP
            </Button>
          </TabsContent>

          <TabsContent value="github" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="repo">Repository name</Label>
              <Input
                id="repo"
                value={repo}
                placeholder={target ? defaultRepoName(target.name) : "my-export"}
                onChange={(e) => setRepo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Created if it doesn&apos;t exist yet, otherwise files are committed into it.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subdir">Folder in repo (optional)</Label>
              <Input
                id="subdir"
                value={subdir}
                placeholder="exports/2026-08"
                onChange={(e) => setSubdir(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor="private" className="text-sm">
                Private repository
              </Label>
              <Switch id="private" checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>
            <Button onClick={handleGithub} disabled={busy !== null} className="w-full">
              {busy === "github" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Github className="mr-2 h-4 w-4" />
              )}
              Push to GitHub
            </Button>
            {result && (
              <a
                href={result}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" /> {result}
              </a>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
