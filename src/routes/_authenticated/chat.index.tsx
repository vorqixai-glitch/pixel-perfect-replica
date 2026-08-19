import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { createThread } from "@/lib/chat.functions";
import { toast } from "sonner";
import { Sparkles, MessageSquarePlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatEmpty,
});

function ChatEmpty() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createFn = useServerFn(createThread);

  async function startNew() {
    try {
      const row = await createFn({ data: {} });
      qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: row.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create chat");
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to vorqix.ai</h1>
        <p className="mt-2 text-muted-foreground">
          Start a new thread to talk with the AI. Your conversations are saved automatically.
        </p>
        <Button className="mt-6" onClick={startNew}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          Start a new chat
        </Button>
      </div>
    </div>
  );
}
