import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getThreadMessages } from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowUp, Loader2, Sparkles, Square } from "lucide-react";

type DbMessage = { id: string; role: string; content: string; created_at: string };

function toUIMessage(row: DbMessage): UIMessage {
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: [{ type: "text", text: row.content }],
  };
}

function textOf(m: UIMessage): string {
  return (m.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");
}

export function ChatView({ threadId }: { threadId: string }) {
  const getMsgs = useServerFn(getThreadMessages);
  const messagesQ = useQuery({
    queryKey: ["thread-messages", threadId],
    queryFn: () => getMsgs({ data: { threadId } }),
  });

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
      initialMessages={initialMessages}
    />
  );
}

function ChatViewInner({
  threadId,
  title,
  initialMessages,
}: {
  threadId: string;
  title: string;
  initialMessages: UIMessage[];
}) {
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
            body: { threadId: id, messages },
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

  const [input, setInput] = useState("");
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
    <div className="flex-1 flex flex-col min-h-0">
      <header className="border-b border-border px-6 py-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h1 className="font-medium truncate">{title}</h1>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              <p className="text-sm">Ask anything to get started.</p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
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
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl px-6 py-4"
        >
          <div className="relative rounded-2xl border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
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
              placeholder="Message Emergent…"
              rows={1}
              className="min-h-[52px] max-h-48 resize-none border-0 bg-transparent pr-14 focus-visible:ring-0 shadow-none"
            />
            <div className="absolute right-2 bottom-2">
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
            Emergent can make mistakes. Verify important information.
          </p>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const text = textOf(message);
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap text-[15px] leading-relaxed",
          isUser
            ? "rounded-2xl bg-primary text-primary-foreground px-4 py-2.5"
            : "text-foreground",
        )}
      >
        {text || (message.role === "assistant" ? "…" : "")}
      </div>
    </div>
  );
}
