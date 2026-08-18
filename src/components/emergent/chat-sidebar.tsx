import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listThreads,
  createThread,
  deleteThread,
  renameThread,
} from "@/lib/chat.functions";
import {
  listProjects,
  deleteProject,
  moveThreadToProject,
} from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  MessageSquarePlus,
  MoreHorizontal,
  Trash2,
  Pencil,
  LogOut,
  Loader2,
  FolderPlus,
  Folder,
  ChevronRight,
  Plus,
  FolderOpen,
  FolderMinus,
  Download,
} from "lucide-react";
import { Workflow, Users, ShieldCheck } from "lucide-react";
import { getMyRole } from "@/lib/admin.functions";
import { useRealtime } from "@/hooks/use-realtime";

import { ProjectDialog, type ProjectFormValue } from "./project-dialog";
import { ExportDialog, type ExportTarget } from "./export-dialog";

export function ChatSidebar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeId = params.threadId;
  const { user } = useAuth();

  const listThreadsFn = useServerFn(listThreads);
  const createThreadFn = useServerFn(createThread);
  const deleteThreadFn = useServerFn(deleteThread);
  const renameThreadFn = useServerFn(renameThread);
  const listProjectsFn = useServerFn(listProjects);
  const deleteProjectFn = useServerFn(deleteProject);
  const moveThreadFn = useServerFn(moveThreadToProject);

  const threadsQ = useQuery({
    queryKey: ["threads"],
    queryFn: () => listThreadsFn(),
  });
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjectsFn(),
  });
  const roleFn = useServerFn(getMyRole);
  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });

  useRealtime(
    [
      { table: "threads", keys: [["threads"]] },
      { table: "projects", keys: [["projects"], ["threads"]] },
    ],
    "sidebar",
  );



  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [projectDialog, setProjectDialog] = useState<{
    open: boolean;
    initial: ProjectFormValue | null;
  }>({ open: false, initial: null });
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string | null, typeof threadsQ.data>();
    (threadsQ.data ?? []).forEach((t) => {
      const key = t.project_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    });
    return map;
  }, [threadsQ.data]);

  async function handleNewChat(projectId: string | null) {
    try {
      const row = await createThreadFn({ data: { project_id: projectId } });
      qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: row.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create chat");
    }
  }

  async function handleDeleteThread(id: string) {
    try {
      await deleteThreadFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["threads"] });
      if (activeId === id) navigate({ to: "/chat" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function commitRename(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    try {
      await renameThreadFn({ data: { id, title } });
      qc.invalidateQueries({ queryKey: ["threads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename");
    }
  }

  async function moveThread(threadId: string, projectId: string | null) {
    try {
      await moveThreadFn({ data: { threadId, projectId } });
      qc.invalidateQueries({ queryKey: ["threads"] });
      toast.success(projectId ? "Moved to project" : "Removed from project");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move");
    }
  }

  async function confirmDeleteProject() {
    if (!deletingProjectId) return;
    try {
      await deleteProjectFn({ data: { id: deletingProjectId } });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      toast.success("Project deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeletingProjectId(null);
    }
  }

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const initials =
    (user?.user_metadata?.display_name as string | undefined)?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    "?";

  const projects = projectsQ.data ?? [];

  const renderThreadRow = (t: NonNullable<typeof threadsQ.data>[number]) => {
    const isActive = t.id === activeId;
    const isRenaming = renamingId === t.id;
    return (
      <div
        key={t.id}
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent",
          isActive && "bg-sidebar-accent",
        )}
      >
        {isRenaming ? (
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitRename(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(t.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            className="h-7"
          />
        ) : (
          <>
            <Link
              to="/chat/$threadId"
              params={{ threadId: t.id }}
              className="flex-1 min-w-0 truncate"
            >
              {t.title || "New chat"}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 h-6 w-6"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setRenamingId(t.id);
                    setRenameValue(t.title);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" /> Rename
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderOpen className="mr-2 h-4 w-4" /> Move to project
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {projects.length === 0 && (
                      <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                        No projects yet
                      </DropdownMenuLabel>
                    )}
                    {projects.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() => moveThread(t.id, p.id)}
                        disabled={p.id === t.project_id}
                      >
                        <Folder className="mr-2 h-4 w-4" /> {p.name}
                      </DropdownMenuItem>
                    ))}
                    {t.project_id && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => moveThread(t.id, null)}>
                          <FolderMinus className="mr-2 h-4 w-4" /> Remove from project
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  onClick={() => setExportTarget({ kind: "thread", id: t.id, name: t.title })}
                >
                  <Download className="mr-2 h-4 w-4" /> Export chat
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => handleDeleteThread(t.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    );
  };

  const ungrouped = grouped.get(null) ?? [];

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
        <div className="h-7 w-7 rounded-md bg-primary/15 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <span className="font-semibold tracking-tight">Emergent</span>
      </div>

      <div className="p-3 space-y-2">
        <Button className="w-full justify-start" size="sm" onClick={() => handleNewChat(null)}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          New chat
        </Button>
        <Button
          className="w-full justify-start"
          size="sm"
          variant="outline"
          onClick={() => setProjectDialog({ open: true, initial: null })}
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          New project
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
        {(threadsQ.isLoading || projectsQ.isLoading) && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {projects.map((p) => {
          const items = grouped.get(p.id) ?? [];
          const isCollapsed = collapsed[p.id];
          return (
            <Collapsible
              key={p.id}
              open={!isCollapsed}
              onOpenChange={(o) =>
                setCollapsed((c) => ({ ...c, [p.id]: !o }))
              }
            >
              <div className="group flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-muted-foreground">
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1 flex-1 min-w-0 hover:text-foreground">
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        !isCollapsed && "rotate-90",
                      )}
                    />
                    <Folder className="h-3.5 w-3.5" />
                    <span className="truncate">{p.name}</span>
                  </button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 h-6 w-6"
                  onClick={() => handleNewChat(p.id)}
                  title="New chat in project"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100 h-6 w-6"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() =>
                        setProjectDialog({
                          open: true,
                          initial: {
                            id: p.id,
                            name: p.name,
                            description: p.description,
                            system_prompt: p.system_prompt,
                          },
                        })
                      }
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Edit project
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleNewChat(p.id)}>
                      <MessageSquarePlus className="mr-2 h-4 w-4" /> New chat here
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        setExportTarget({ kind: "project", id: p.id, name: p.name })
                      }
                    >
                      <Download className="mr-2 h-4 w-4" /> Export project
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeletingProjectId(p.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <CollapsibleContent className="pl-3 space-y-0.5">
                {items.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground/70">
                    No chats yet
                  </p>
                )}
                {items.map(renderThreadRow)}
              </CollapsibleContent>
            </Collapsible>
          );
        })}

        {(ungrouped.length > 0 || projects.length === 0) && (
          <div>
            {projects.length > 0 && (
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Chats
              </div>
            )}
            {ungrouped.length === 0 && projects.length === 0 && !threadsQ.isLoading && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No chats yet.
              </p>
            )}
            <div className="space-y-0.5">{ungrouped.map(renderThreadRow)}</div>
          </div>
        )}
      </div>

      <div className="border-t border-sidebar-border p-2">
        <Link
          to="/workflows"
          className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent"
        >
          <Workflow className="h-4 w-4" /> Workflows
        </Link>
        <Link
          to="/leads"
          className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent"
        >
          <Users className="h-4 w-4" /> Leads
        </Link>
        {roleQ.data?.isAdmin && (
          <Link
            to="/admin"
            className="mb-1 flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent"
          >
            <ShieldCheck className="h-4 w-4" /> Admin
          </Link>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-2 rounded-md px-2 py-2 hover:bg-sidebar-accent text-left">
              <Avatar className="h-7 w-7">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0 truncate text-sm">
                {user?.email ?? "Signed in"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ExportDialog
        target={exportTarget}
        open={exportTarget !== null}
        onOpenChange={(o) => !o && setExportTarget(null)}
      />

      <ProjectDialog
        open={projectDialog.open}
        onOpenChange={(o) =>
          setProjectDialog((s) => ({ ...s, open: o, initial: o ? s.initial : null }))
        }
        initial={projectDialog.initial}
      />

      <AlertDialog
        open={!!deletingProjectId}
        onOpenChange={(o) => !o && setDeletingProjectId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Chats inside this project will be kept and moved to the top level.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
