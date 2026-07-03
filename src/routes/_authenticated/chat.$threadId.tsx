import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/emergent/chat-view";
import { ArtifactPane } from "@/components/emergent/artifact-pane";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  component: ChatThreadPage,
});

function ChatThreadPage() {
  const { threadId } = Route.useParams();
  const [artifactId, setArtifactId] = useState<string | null>(null);

  return (
    <div className="flex flex-1 min-h-0 w-full" key={threadId}>
      <ChatView
        threadId={threadId}
        onOpenArtifact={setArtifactId}
        activeArtifactId={artifactId}
      />
      {artifactId && (
        <ArtifactPane
          artifactId={artifactId}
          onClose={() => setArtifactId(null)}
        />
      )}
    </div>
  );
}
