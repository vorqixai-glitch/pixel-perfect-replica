import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const BUCKET = "thread-files";
const MAX_BYTES = 50 * 1024 * 1024;

export type ExportFile = { path: string; contentBase64: string };

type Client = SupabaseClient<Database>;
type Scope = { projectId: string } | { threadId: string };

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function textFile(path: string, text: string): ExportFile {
  return { path, contentBase64: toBase64(new TextEncoder().encode(text)) };
}

function slug(name: string, fallback: string): string {
  const s = name
    .trim()
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return s || fallback;
}

function artifactExt(kind: string, language: string | null): string {
  if (kind === "markdown") return "md";
  if (kind === "html") return "html";
  const map: Record<string, string> = {
    typescript: "ts",
    tsx: "tsx",
    javascript: "js",
    jsx: "jsx",
    python: "py",
    bash: "sh",
    shell: "sh",
    json: "json",
    yaml: "yml",
    sql: "sql",
    css: "css",
    go: "go",
    rust: "rs",
    java: "java",
    ruby: "rb",
    php: "php",
  };
  return map[(language ?? "").toLowerCase()] ?? (language || "txt");
}

export async function buildExport(supabase: Client, scope: Scope) {
  let project: { id: string; name: string; description: string | null; system_prompt: string | null } | null =
    null;
  let threadIds: string[] = [];
  let exportName = "chat-export";

  if ("projectId" in scope) {
    const { data: p, error } = await supabase
      .from("projects")
      .select("id,name,description,system_prompt")
      .eq("id", scope.projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Project not found");
    project = p;
    exportName = slug(p.name, "project");
  }

  const threadsQuery = supabase
    .from("threads")
    .select("id,title,model,persona_id,project_id,created_at,updated_at")
    .order("created_at", { ascending: true });
  const { data: threads, error: tErr } =
    "projectId" in scope
      ? await threadsQuery.eq("project_id", scope.projectId)
      : await threadsQuery.eq("id", scope.threadId);
  if (tErr) throw new Error(tErr.message);
  const threadRows = threads ?? [];
  if (threadRows.length === 0 && !project) throw new Error("Nothing to export");
  threadIds = threadRows.map((t) => t.id);
  if (!("projectId" in scope) && threadRows[0]) {
    exportName = slug(threadRows[0].title, "chat");
  }

  const [messagesRes, artifactsRes, filesRes] = await Promise.all([
    threadIds.length
      ? supabase
          .from("messages")
          .select("id,thread_id,role,content,model,created_at")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    threadIds.length
      ? supabase
          .from("artifacts")
          .select("id,thread_id,title,kind,language,content,version,updated_at")
          .in("thread_id", threadIds)
      : Promise.resolve({ data: [], error: null }),
    threadIds.length
      ? supabase
          .from("thread_files")
          .select("id,thread_id,name,path,mime_type,size_bytes,created_at")
          .in("thread_id", threadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (messagesRes.error) throw new Error(messagesRes.error.message);
  if (artifactsRes.error) throw new Error(artifactsRes.error.message);
  if (filesRes.error) throw new Error(filesRes.error.message);

  const messages = messagesRes.data ?? [];
  const artifacts = artifactsRes.data ?? [];
  const uploads = filesRes.data ?? [];

  const files: ExportFile[] = [];
  const usedPaths = new Set<string>();
  function uniquePath(base: string, ext: string): string {
    let p = `${base}.${ext}`;
    let n = 2;
    while (usedPaths.has(p)) p = `${base}-${n++}.${ext}`;
    usedPaths.add(p);
    return p;
  }

  // Chat transcripts
  for (const t of threadRows) {
    const msgs = messages.filter((m) => m.thread_id === t.id);
    const body = [
      `# ${t.title}`,
      "",
      `- Model: ${t.model}`,
      t.persona_id ? `- Persona: ${t.persona_id}` : "",
      `- Created: ${t.created_at}`,
      "",
      "---",
      "",
      ...msgs.map(
        (m) =>
          `## ${m.role === "user" ? "User" : "Assistant"}${m.model ? ` (${m.model})` : ""}\n\n${m.content}\n`,
      ),
    ]
      .filter(Boolean)
      .join("\n");
    files.push(textFile(uniquePath(`chats/${slug(t.title, t.id.slice(0, 8))}`, "md"), body));
  }

  // Artifacts
  for (const a of artifacts) {
    const ext = artifactExt(a.kind, a.language);
    files.push(textFile(uniquePath(`artifacts/${slug(a.title, a.id.slice(0, 8))}`, ext), a.content));
  }

  // Uploaded files
  let totalBytes = 0;
  for (const f of uploads) {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(f.path);
    if (error || !blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_BYTES) {
      throw new Error("Export is larger than 50MB. Remove some uploaded files and try again.");
    }
    const dot = f.name.lastIndexOf(".");
    const base = dot > 0 ? f.name.slice(0, dot) : f.name;
    const ext = dot > 0 ? f.name.slice(dot + 1) : "bin";
    files.push({
      path: uniquePath(`files/${slug(base, f.id.slice(0, 8))}`, slug(ext, "bin")),
      contentBase64: toBase64(bytes),
    });
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    project: project
      ? {
          name: project.name,
          description: project.description,
          instructions: project.system_prompt,
        }
      : null,
    threads: threadRows.map((t) => ({
      id: t.id,
      title: t.title,
      model: t.model,
      persona: t.persona_id,
      messageCount: messages.filter((m) => m.thread_id === t.id).length,
    })),
    artifacts: artifacts.map((a) => ({
      title: a.title,
      kind: a.kind,
      language: a.language,
      version: a.version,
    })),
    files: uploads.map((f) => ({ name: f.name, mime: f.mime_type, size: f.size_bytes })),
  };
  files.push(textFile("project.json", JSON.stringify(manifest, null, 2)));

  const readme = [
    `# ${project?.name ?? threadRows[0]?.title ?? "Export"}`,
    "",
    project?.description ?? "",
    "",
    project?.system_prompt ? `## Project instructions\n\n${project.system_prompt}\n` : "",
    "## Chats",
    "",
    ...threadRows.map((t) => `- [${t.title}](chats/${slug(t.title, t.id.slice(0, 8))}.md)`),
    "",
    artifacts.length ? "## Artifacts\n" : "",
    ...artifacts.map((a) => `- ${a.title} (${a.kind}${a.language ? `/${a.language}` : ""})`),
    "",
    uploads.length ? "## Files\n" : "",
    ...uploads.map((f) => `- ${f.name}`),
    "",
    `_Exported ${new Date().toISOString()}_`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
  files.unshift(textFile("README.md", readme));

  return { name: exportName, files, counts: {
    chats: threadRows.length,
    artifacts: artifacts.length,
    files: uploads.length,
  } };
}

const GATEWAY = "https://connector-gateway.lovable.dev/github";

async function gh(
  key: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${GATEWAY}/${path.replace(/^\//, "")}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, json };
}

export async function pushFilesToGithub(opts: {
  files: ExportFile[];
  repo: string;
  isPrivate: boolean;
  subdir: string;
}) {
  const key = process.env.GITHUB_API_KEY;
  if (!key) {
    throw new Error("GitHub is not connected. Connect GitHub in integrations settings first.");
  }

  const me = await gh(key, "user");
  if (!me.ok) throw new Error(`GitHub auth failed (${me.status}).`);
  const owner: string = me.json?.login;
  if (!owner) throw new Error("Could not resolve your GitHub account.");

  const existing = await gh(key, `repos/${owner}/${opts.repo}`);
  if (!existing.ok) {
    const created = await gh(key, "user/repos", {
      method: "POST",
      body: {
        name: opts.repo,
        private: opts.isPrivate,
        auto_init: true,
        description: "Exported from Emergent",
      },
    });
    if (!created.ok) {
      throw new Error(
        `Could not create repo: ${created.json?.message ?? created.status}`,
      );
    }
  }

  const prefix = opts.subdir ? `${opts.subdir.replace(/^\/|\/$/g, "")}/` : "";
  let written = 0;
  for (const f of opts.files) {
    const path = `${prefix}${f.path}`;
    const head = await gh(key, `repos/${owner}/${opts.repo}/contents/${encodeURI(path)}`);
    const sha = head.ok && !Array.isArray(head.json) ? head.json?.sha : undefined;
    const put = await gh(key, `repos/${owner}/${opts.repo}/contents/${encodeURI(path)}`, {
      method: "PUT",
      body: {
        message: `Export: ${f.path}`,
        content: f.contentBase64,
        ...(sha ? { sha } : {}),
      },
    });
    if (!put.ok) {
      throw new Error(
        `Failed writing ${f.path}: ${put.json?.message ?? put.status}`,
      );
    }
    written++;
  }

  return {
    url: `https://github.com/${owner}/${opts.repo}`,
    owner,
    repo: opts.repo,
    written,
  };
}
