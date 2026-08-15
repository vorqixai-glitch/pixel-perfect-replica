import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  deleteThreadFile,
  getFileDownloadUrl,
  listThreadFiles,
  uploadThreadFile,
} from "@/lib/files.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, FileText, Loader2, Paperclip, X } from "lucide-react";

const MAX_BYTES = 20 * 1024 * 1024;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.slice(res.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function prettySize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsBar({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listThreadFiles);
  const upload = useServerFn(uploadThreadFile);
  const remove = useServerFn(deleteThreadFile);
  const download = useServerFn(getFileDownloadUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const filesQ = useQuery({
    queryKey: ["thread-files", threadId],
    queryFn: () => list({ data: { threadId } }),
  });

  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["thread-files", threadId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  async function onPick(fileList: FileList | null) {
    if (!fileList?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is larger than 20MB`);
          continue;
        }
        const dataBase64 = await toBase64(file);
        const res = await upload({
          data: {
            threadId,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            dataBase64,
          },
        });
        toast.success(
          res.has_text
            ? `${file.name} attached — ${res.text_chars.toLocaleString()} characters readable`
            : `${file.name} attached (no readable text)`,
        );
      }
      await qc.invalidateQueries({ queryKey: ["thread-files", threadId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDownload(id: string) {
    try {
      const { url } = await download({ data: { id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  const files = filesQ.data ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.txt,.md,.csv,.json,.yaml,.yml,.log,.html,.xml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.rb,.php,.sql,.css,.sh,image/*"
        onChange={(e) => onPick(e.target.files)}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Paperclip className="h-3.5 w-3.5" />
        )}
        Attach
      </Button>
      {files.map((f) => (
        <span
          key={f.id}
          className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pl-2 pr-1 text-xs"
          title={f.has_text ? "Readable by the agent" : "No extractable text"}
        >
          <FileText className={f.has_text ? "h-3 w-3 text-primary" : "h-3 w-3 opacity-50"} />
          <span className="max-w-[140px] truncate">{f.name}</span>
          <span className="text-muted-foreground">{prettySize(f.size_bytes)}</span>
          <button
            type="button"
            aria-label={`Download ${f.name}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onDownload(f.id)}
          >
            <Download className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={`Remove ${f.name}`}
            className="rounded p-0.5 text-muted-foreground hover:text-destructive"
            onClick={() => del.mutate(f.id)}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
