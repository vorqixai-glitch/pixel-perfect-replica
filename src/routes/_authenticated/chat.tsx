import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ChatSidebar } from "@/components/emergent/chat-sidebar";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatLayout,
});

function ChatLayout() {
  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <ChatSidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
