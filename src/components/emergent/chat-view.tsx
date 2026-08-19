import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";

import { useServerFn } from "@tanstack/react-start";
import { getThreadMessages } from "@/lib/chat.functions";
import { PERSONAS } from "@/lib/personas";
import { CHAT_MODELS } from "@/lib/models";
import { AttachmentsBar } from "@/components/emergent/attachments-bar";
import { PromptLibrary } from "@/components/emergent/prompt-library";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  Github,
  Globe,
  ImageIcon,
  Link2,
  Loader2,
  Paperclip,
  Settings2,
  Sparkles,
  Square,
  Users,
  Wand2,
  Wrench,
  Youtube,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const TOGGLEABLE_TOOLS: ReadonlyArray<{
  id: string;
  label: string;
  icon: typeof Globe;
  desc: string;
  disabled?: boolean;
}> = [
  { id: "web_search", label: "Web search", icon: Globe, desc: "DuckDuckGo + Wikipedia lookups" },
  { id: "fetch_url", label: "Fetch URL", icon: Link2, desc: "Read a webpage's text content" },
  { id: "youtube_transcript", label: "YouTube transcript", icon: Youtube, desc: "Pull captions from a video" },
  { id: "run_javascript", label: "Run JavaScript", icon: Code2, desc: "Sandboxed JS execution (3s limit)" },
  { id: "generate_image", label: "Generate image", icon: ImageIcon, desc: "Text-to-image via Gemini" },
  { id: "read_uploaded_file", label: "Read attachments", icon: Paperclip, desc: "Read PDFs and files you attach" },
  { id: "github", label: "GitHub", icon: Github, desc: "Search repos, read files, open issues" },
  { id: "save_lead", label: "Save leads", icon: Users, desc: "Write prospects into your CRM" },
];

const DEFAULT_TOOLS = TOGGLEABLE_TOOLS.filter((t) => !t.disabled).map((t) => t.id);
const TOOLS_STORAGE_KEY = "emergent:enabled-tools";

function loadEnabledTools(): string[] {
  if (typeof window === "undefined") return DEFAULT_TOOLS;
  try {
    const raw = window.localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return DEFAULT_TOOLS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : DEFAULT_TOOLS;
  } catch {
    return DEFAULT_TOOLS;
  }
}

type DbMessage = { id: string; role: string; content: string; created_at: string };

const MODELS = CHAT_MODELS.map((m) => ({ id: m.id, label: m.name, hint: m.blurb }));

function toUIMessage(row: DbMessage): UIMessage {
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: [{ type: "text", text: row.content }],
  };
}

export function ChatView({
  threadId,
  onOpenArtifact,
  activeArtifactId,
}: {
  threadId: string;
  onOpenArtifact: (id: string) => void;
  activeArtifactId: string | null;
}) {
  const getMsgs = useServerFn(getThreadMessages);
  const messagesQ = useQuery({
    queryKey: ["thread-messages", threadId],
    queryFn: () => getMsgs({ data: { threadId } }),
  });

  useRealtime(
    [
      { table: "thread_files", keys: [["thread-files", threadId]] },
      { table: "artifacts", keys: [["artifact"]] },
    ],
    `thread-${threadId}`,
  );


  const initialMessages = useMemo<UIMessage[]>(
    () => (messagesQ.data?.messages ?? []).map(toUIMessage),
    [messagesQ.data],
  );

  if (messagesQ.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (messagesQ.error) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        Failed to load conversation.
      </div>
    );
  }

  return (
    <ChatViewInner
      threadId={threadId}
      title={messagesQ.data?.thread.title ?? "New chat"}
      initialModel={messagesQ.data?.thread.model ?? MODELS[0].id}
      initialPersona={messagesQ.data?.thread.persona_id ?? "default"}
      initialMessages={initialMessages}
      onOpenArtifact={onOpenArtifact}
      activeArtifactId={activeArtifactId}
    />
  );
}

function ChatViewInner({
  threadId,
  title,
  initialModel,
  initialPersona,
  initialMessages,
  onOpenArtifact,
  activeArtifactId,
}: {
  threadId: string;
  title: string;
  initialModel: string;
  initialPersona: string;
  initialMessages: UIMessage[];
  onOpenArtifact: (id: string) => void;
  activeArtifactId: string | null;
}) {
  const [model, setModel] = useState(initialModel);
  const [personaId, setPersonaId] = useState(initialPersona);
  const [enabledTools, setEnabledTools] = useState<string[]>(() => loadEnabledTools());
  const modelRef = useRef(model);
  const personaRef = useRef(personaId);
  const toolsRef = useRef(enabledTools);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    personaRef.current = personaId;
  }, [personaId]);
  useEffect(() => {
    toolsRef.current = enabledTools;
    try {
      window.localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(enabledTools));
    } catch {
      /* ignore */
    }
  }, [enabledTools]);

  function toggleTool(id: string) {
    setEnabledTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages, id }) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers: Record<string, string> = {};
          if (token) headers.Authorization = `Bearer ${token}`;
          return {
            body: {
              threadId: id,
              messages,
              model: modelRef.current,
              personaId: personaRef.current,
              enabledTools: toolsRef.current,
            },
            headers,
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (e) => toast.error(e.message || "Chat error"),
  });

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  // Auto-open newly created artifacts
  const openedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      for (const part of m.parts ?? []) {
        const p = part as { type: string; toolName?: string; output?: unknown };
        if (
          typeof p.type === "string" &&
          p.type.startsWith("tool-create_artifact") &&
          p.output &&
          typeof p.output === "object"
        ) {
          const out = p.output as { id?: string };
          if (out.id && !openedRef.current.has(out.id)) {
            openedRef.current.add(out.id);
            onOpenArtifact(out.id);
          }
        }
      }
    }
  }, [messages, onOpenArtifact]);

  const [input, setInput] = useState("");
  const [showPrompts, setShowPrompts] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId, status]);

  const isLoading = status === "submitted" || status === "streaming";

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="flex-1 flex min-h-0">
    <div className="flex-1 flex flex-col min-h-0">
      <header className="border-b border-border px-6 py-3 flex items-center gap-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h1 className="font-medium truncate flex-1">{title}</h1>
        <Button
          type="button"
          variant={showPrompts ? "secondary" : "outline"}
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => setShowPrompts((v) => !v)}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Prompts
        </Button>
        <Select value={personaId} onValueChange={setPersonaId}>
          <SelectTrigger className="h-8 w-auto gap-1 text-xs">
            <Users className="h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="max-h-96">
            {PERSONAS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="mr-1.5">{p.emoji}</span>
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{p.tagline}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              aria-label="Tool permissions"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Tools
              <span className="ml-1 rounded bg-muted px-1 text-[10px] tabular-nums">
                {enabledTools.filter((t) => DEFAULT_TOOLS.includes(t)).length}/{DEFAULT_TOOLS.length}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="p-3 border-b border-border">
              <div className="text-sm font-medium">Tool permissions</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Toggle which tools the agent (and swarm sub-agents) may call.
              </p>
            </div>
            <div className="p-2 max-h-96 overflow-y-auto">
              {TOGGLEABLE_TOOLS.map((tool) => {
                const on = enabledTools.includes(tool.id);
                const Icon = tool.icon;
                return (
                  <label
                    key={tool.id}
                    className={cn(
                      "flex items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/50 cursor-pointer",
                      tool.disabled && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <Icon className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        {tool.label}
                        {tool.disabled && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            soon
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{tool.desc}</div>
                    </div>
                    <Switch
                      checked={on}
                      disabled={tool.disabled}
                      onCheckedChange={() => !tool.disabled && toggleTool(tool.id)}
                    />
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-border p-2 text-xs">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground px-2 py-1"
                onClick={() => setEnabledTools([])}
              >
                Disable all
              </button>
              <button
                type="button"
                className="text-primary hover:underline px-2 py-1"
                onClick={() => setEnabledTools(DEFAULT_TOOLS)}
              >
                Reset defaults
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          {messages.length === 0 && <EmptyState />}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onOpenArtifact={onOpenArtifact}
              activeArtifactId={activeArtifactId}
            />
          ))}
          {status === "submitted" && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl px-6 py-4">
          <div className="rounded-2xl border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Message vorqix.ai…"
              rows={1}
              className="min-h-[52px] max-h-48 resize-none border-0 bg-transparent focus-visible:ring-0 shadow-none"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="h-8 w-auto shrink-0 border-0 bg-transparent shadow-none focus:ring-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-96">
                    {MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="font-medium">{m.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{m.hint}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <AttachmentsBar threadId={threadId} />
              </div>

              {isLoading ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  onClick={() => stop()}
                  aria-label="Stop"
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={!input.trim()}
                  aria-label="Send"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground text-center">
            Attach PDFs and files, search the web, run code, generate images — all wired in.
          </p>
        </form>
      </div>
    </div>
    {showPrompts && (
      <PromptLibrary
        onClose={() => setShowPrompts(false)}
        onUse={(text) => {
          setInput(text);
          inputRef.current?.focus();
        }}
      />
    )}
    </div>
  );
}

function EmptyState() {
  const items = [
    { icon: FileText, title: "Draft a plan", hint: '"Write a launch plan as a markdown artifact"' },
    { icon: Globe, title: "Search the web", hint: '"What happened in AI this week?"' },
    { icon: ImageIcon, title: "Generate an image", hint: '"An isometric spaceship illustration"' },
    { icon: Wrench, title: "Build & preview HTML", hint: '"A landing page for a coffee brand"' },
  ];
  return (
    <div className="pt-8">
      <div className="text-center mb-8">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 mb-3">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">How can I help?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ask, research, generate — with tools baked in.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <div
            key={it.title}
            className="rounded-xl border border-border p-3 hover:bg-accent/50 transition"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <it.icon className="h-4 w-4 text-primary" /> {it.title}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{it.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type ToolPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function MessageBubble({
  message,
  onOpenArtifact,
  activeArtifactId,
}: {
  message: UIMessage;
  onOpenArtifact: (id: string) => void;
  activeArtifactId: string | null;
}) {
  const isUser = message.role === "user";
  const parts = message.parts ?? [];

  if (isUser) {
    const text = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap text-[15px] leading-relaxed rounded-2xl bg-primary text-primary-foreground px-4 py-2.5">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div
              key={i}
              className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-pre:my-2 prose-headings:mt-4"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        const p = part as ToolPart;
        if (typeof p.type === "string" && p.type.startsWith("tool-")) {
          const name = p.type.slice("tool-".length);
          return (
            <ToolCallBlock
              key={i}
              name={name}
              part={p}
              onOpenArtifact={onOpenArtifact}
              activeArtifactId={activeArtifactId}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function toolMeta(name: string) {
  switch (name) {
    case "create_artifact":
      return { label: "Creating artifact", Icon: FileText };
    case "update_artifact":
      return { label: "Updating artifact", Icon: FileText };
    case "web_search":
      return { label: "Searching the web", Icon: Globe };
    case "generate_image":
      return { label: "Generating image", Icon: ImageIcon };
    case "fetch_url":
      return { label: "Reading URL", Icon: Link2 };
    case "youtube_transcript":
      return { label: "Fetching YouTube transcript", Icon: Youtube };
    case "run_javascript":
      return { label: "Running JavaScript", Icon: Code2 };
    case "delegate_to_agent":
      return { label: "Delegating to sub-agent", Icon: Users };
    case "read_uploaded_file":
      return { label: "Reading attachment", Icon: Paperclip };
    case "github":
      return { label: "Calling GitHub", Icon: Github };
    case "save_lead":
      return { label: "Saving lead", Icon: Users };
    default:
      return { label: name, Icon: Wrench };
  }
}

function ToolCallBlock({
  name,
  part,
  onOpenArtifact,
  activeArtifactId,
}: {
  name: string;
  part: ToolPart;
  onOpenArtifact: (id: string) => void;
  activeArtifactId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { label, Icon } = toolMeta(name);
  const isDone = part.state === "output-available" || part.state === "output-error";
  const isError =
    part.state === "output-error" ||
    Boolean(part.output && typeof part.output === "object" && "error" in (part.output as object));

  // Special rich renderers for known outputs
  const output = part.output as
    | { id?: string; title?: string; kind?: string; version?: number; url?: string; prompt?: string; results?: Array<{ title: string; url: string; snippet: string }>; error?: string }
    | undefined;

  return (
    <div className="rounded-lg border border-border bg-muted/40 text-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/60"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Icon className="h-4 w-4 text-primary" />
        <span className="flex-1 text-left truncate">
          {label}
          {output?.title ? ` — ${output.title}` : ""}
          {output?.results ? ` — ${output.results.length} result${output.results.length === 1 ? "" : "s"}` : ""}
        </span>
        {!isDone && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {isError && <span className="text-xs text-destructive">error</span>}
      </button>

      {/* Rich inline preview for artifact/image regardless of open */}
      {(name === "create_artifact" || name === "update_artifact") && output?.id && (
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => onOpenArtifact(output.id!)}
            className={cn(
              "w-full text-left rounded-md border border-border p-3 bg-background hover:border-primary transition",
              activeArtifactId === output.id && "border-primary ring-1 ring-primary/40",
            )}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {output.kind}{output.version ? ` · v${output.version}` : ""}
            </div>
            <div className="font-medium">{output.title}</div>
            <div className="text-xs text-primary mt-1">Open in side panel →</div>
          </button>
        </div>
      )}

      {name === "generate_image" && output?.url && (
        <div className="px-3 pb-3">
          <img
            src={output.url}
            alt={output.prompt ?? "generated"}
            className="rounded-md border border-border max-h-96"
          />
        </div>
      )}

      {name === "web_search" && output?.results && output.results.length > 0 && (
        <div className="px-3 pb-3 space-y-2">
          {output.results.slice(0, 4).map((r, i) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md border border-border p-2 hover:border-primary bg-background"
            >
              <div className="text-sm font-medium truncate">{r.title}</div>
              <div className="text-xs text-muted-foreground truncate">{r.url}</div>
              <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{r.snippet}</div>
            </a>
          ))}
        </div>
      )}

      {open && (
        <div className="px-3 pb-3 border-t border-border/60 pt-2 space-y-2">
          {part.input != null && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Input
              </div>
              <pre className="text-xs bg-background rounded p-2 overflow-auto max-h-40">
                {JSON.stringify(part.input, null, 2)}
              </pre>
            </div>
          )}
          {part.output != null && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Output
              </div>
              <pre className="text-xs bg-background rounded p-2 overflow-auto max-h-60">
                {JSON.stringify(part.output, null, 2)}
              </pre>
            </div>
          )}
          {part.errorText && (
            <div className="text-xs text-destructive">{part.errorText}</div>
          )}
        </div>
      )}
    </div>
  );
}
