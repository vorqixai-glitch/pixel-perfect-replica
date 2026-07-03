import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getArtifact } from "@/lib/artifacts.functions";
import { Button } from "@/components/ui/button";
import { Copy, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export function ArtifactPane({
  artifactId,
  onClose,
}: {
  artifactId: string;
  onClose: () => void;
}) {
  const getFn = useServerFn(getArtifact);
  const q = useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: () => getFn({ data: { id: artifactId } }),
    refetchInterval: 2000, // pick up updates while streaming
  });

  const artifact = q.data;
  const ext = useMemo(() => {
    if (!artifact) return "txt";
    if (artifact.kind === "markdown") return "md";
    if (artifact.kind === "html") return "html";
    return artifact.language || "txt";
  }, [artifact]);

  function copy() {
    if (!artifact) return;
    navigator.clipboard.writeText(artifact.content);
    toast.success("Copied");
  }

  function download() {
    if (!artifact) return;
    const blob = new Blob([artifact.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title.replace(/[^\w.-]+/g, "_")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="w-[45%] min-w-[380px] max-w-[720px] shrink-0 border-l border-border bg-card flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {artifact?.kind ?? "artifact"}
            {artifact?.version ? ` · v${artifact.version}` : ""}
          </div>
          <h2 className="font-medium truncate text-sm">
            {artifact?.title ?? "Loading…"}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={copy} disabled={!artifact} aria-label="Copy">
          <Copy className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={download} disabled={!artifact} aria-label="Download">
          <Download className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto">
        {q.isLoading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {artifact && <ArtifactBody artifact={artifact} />}
      </div>
    </aside>
  );
}

type Artifact = {
  kind: string;
  language: string | null;
  content: string;
  title: string;
};

function ArtifactBody({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "markdown") {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none px-6 py-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
      </div>
    );
  }
  if (artifact.kind === "html") {
    return (
      <div className="h-full flex flex-col">
        <iframe
          title={artifact.title}
          sandbox="allow-scripts allow-forms"
          srcDoc={artifact.content}
          className="flex-1 w-full bg-white"
        />
      </div>
    );
  }
  return (
    <SyntaxHighlighter
      language={artifact.language ?? "text"}
      style={oneDark}
      customStyle={{ margin: 0, padding: "1rem", background: "transparent", fontSize: 13 }}
      wrapLongLines
    >
      {artifact.content}
    </SyntaxHighlighter>
  );
}
