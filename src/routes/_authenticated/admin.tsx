import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  claimFirstAdmin,
  getAdminOverview,
  getMyRole,
  setUserRole,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { useRealtime } from "@/hooks/use-realtime";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Admin console — vorqix.ai" },
      {
        name: "description",
        content:
          "Admin console for vorqix.ai: usage stats, user roles, and recent activity across the workspace.",
      },
      { property: "og:title", content: "Admin console — vorqix.ai" },
      {
        property: "og:description",
        content: "Usage stats, user roles, and recent activity across the workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AdminPage() {
  const qc = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const overviewFn = useServerFn(getAdminOverview);
  const claimFn = useServerFn(claimFirstAdmin);
  const setRoleFn = useServerFn(setUserRole);

  const roleQ = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const isAdmin = roleQ.data?.isAdmin === true;

  const overviewQ = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => overviewFn(),
    enabled: isAdmin,
  });

  useRealtime(
    [
      { table: "threads", keys: [["admin-overview"]] },
      { table: "messages", keys: [["admin-overview"]] },
      { table: "leads", keys: [["admin-overview"]] },
      { table: "projects", keys: [["admin-overview"]] },
    ],
    "admin",
  );

  const claim = useMutation({
    mutationFn: () => claimFn(),
    onSuccess: (r) => {
      if (r.claimed) {
        toast.success("You are now an admin");
        qc.invalidateQueries({ queryKey: ["my-role"] });
      } else {
        toast.error(r.reason ?? "Could not claim admin");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRole = useMutation({
    mutationFn: (v: { userId: string; grant: boolean }) =>
      setRoleFn({ data: { userId: v.userId, role: "admin", grant: v.grant } }),
    onSuccess: () => {
      toast.success("Roles updated");
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/chat">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Admin console</h1>
            <p className="text-sm text-muted-foreground">
              Live workspace stats, users, and role management.
            </p>
          </div>
        </div>

        {roleQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
          </div>
        )}

        {!roleQ.isLoading && !isAdmin && (
          <div className="rounded-lg border p-6">
            <h2 className="mb-1 font-medium">You are not an admin yet</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              If no admin exists yet, you can claim the first admin seat. Otherwise ask an
              existing admin to grant you access.
            </p>
            <Button onClick={() => claim.mutate()} disabled={claim.isPending}>
              {claim.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Claim admin
            </Button>
          </div>
        )}

        {isAdmin && (
          <div className="space-y-8">
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">Usage</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(overviewQ.data?.counts ?? {}).map(([k, v]) => (
                  <div key={k} className="rounded-lg border p-4">
                    <div className="text-2xl font-semibold">{v}</div>
                    <div className="text-xs capitalize text-muted-foreground">
                      {k.replace(/_/g, " ")}
                    </div>
                  </div>
                ))}
                {overviewQ.isLoading && (
                  <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">Users</h2>
              <div className="divide-y rounded-lg border">
                {(overviewQ.data?.users ?? []).map((u) => {
                  const admin = u.roles.includes("admin");
                  return (
                    <div key={u.id} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">
                          {u.display_name || u.id.slice(0, 8)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{u.id}</div>
                      </div>
                      {admin && <Badge variant="secondary">admin</Badge>}
                      <Button
                        size="sm"
                        variant={admin ? "outline" : "default"}
                        disabled={toggleRole.isPending}
                        onClick={() => toggleRole.mutate({ userId: u.id, grant: !admin })}
                      >
                        {admin ? "Revoke" : "Make admin"}
                      </Button>
                    </div>
                  );
                })}
                {(overviewQ.data?.users ?? []).length === 0 && !overviewQ.isLoading && (
                  <p className="p-4 text-sm text-muted-foreground">No users yet.</p>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                Recent chats
              </h2>
              <div className="divide-y rounded-lg border">
                {(overviewQ.data?.recentThreads ?? []).map((t) => (
                  <div key={t.id} className="flex items-center gap-3 p-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.model}</span>
                  </div>
                ))}
                {(overviewQ.data?.recentThreads ?? []).length === 0 &&
                  !overviewQ.isLoading && (
                    <p className="p-4 text-sm text-muted-foreground">No chats yet.</p>
                  )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
