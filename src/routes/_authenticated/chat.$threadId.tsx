import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/emergent/chat-view";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  component: ChatThreadPage,
});

function ChatThreadPage() {
  const { threadId } = Route.useParams();
  return <ChatView threadId={threadId} key={threadId} />;
}
