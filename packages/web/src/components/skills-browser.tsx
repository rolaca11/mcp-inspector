import { useEffect, useRef, useState } from "react";
import { BookOpen, FolderOpen, RefreshCw } from "lucide-react";
import { skillsCapability, type Skill } from "@rolaca11/mcp-inspector-core/skills";
import { api } from "@/data/api";
import type { ActivityResult, MCPResource, ReadResourceResult } from "@/data/types";
import { PageShell } from "@/components/page-shell";
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { ErrorMessage } from "@/components/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SkillsBrowser({ serverId, serverName, skills, capabilities, connecting }: {
  serverId: string;
  serverName: string;
  skills: Skill[];
  capabilities: unknown;
  connecting: boolean;
}) {
  const capability = skillsCapability(capabilities);
  const [catalog, setCatalog] = useState<Skill[] | null>(null);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [uri, setUri] = useState("");
  const [filter, setFilter] = useState("");
  const [directoryUri, setDirectoryUri] = useState("");
  const [directory, setDirectory] = useState<MCPResource[] | null>(null);
  const [result, setResult] = useState<(ReadResourceResult & { verification: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    request.current++;
    setCatalog(null);
    setSkill(null);
    setResult(null);
    setDirectory(null);
    setError(null);
    setBusy(false);
    return () => { request.current++; };
  }, [capabilities]);

  async function run<T>(operation: () => Promise<ActivityResult[]>, onResult: (value: T) => void) {
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const [activity] = await operation();
      if (id !== request.current) return;
      if (!activity || activity.outcome === "error") throw new Error(activity?.error ?? "Request failed");
      onResult(activity.result as T);
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  function select(entry: Skill) {
    request.current++;
    setBusy(false);
    setError(null);
    setSkill(entry);
    setUri(entry.uri);
    setDirectoryUri(entry.uri.slice(0, -"/SKILL.md".length));
    setDirectory(null);
    setResult(null);
  }

  function read(resourceUri: string) {
    if (!skill) return;
    setResult(null);
    void run<ReadResourceResult & { skill: Skill; verification: string }>(
      () => api.readSkill(serverId, skill.uri, resourceUri),
      (value) => { setResult(value); setSkill(value.skill); },
    );
  }

  if (connecting) return <PageShell><p role="status">Loading skills...</p></PageShell>;
  if (!capability) return <PageShell><Empty icon={BookOpen} title="Skills unavailable"
    description="Connect to a server that advertises the MCP Skills extension." /></PageShell>;

  const entries = (catalog ?? skills).filter((entry) =>
    `${entry.frontmatter.name} ${entry.frontmatter.description} ${entry.uri}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <PageShell description={`Inspect skills from ${serverName}. Reading a file does not activate the skill.`}
      actions={<Button variant="outline" className="h-10" disabled={busy} onClick={() => {
        void run<{ skills: Skill[] }>(() => api.listSkills(serverId), (value) => setCatalog(value.skills));
      }}><RefreshCw className="size-4" />Refresh skills</Button>}>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
        event.preventDefault();
        setResult(null);
        setSkill(null);
        setDirectory(null);
        void run<{ skill: Skill }>(() => api.getSkill(serverId, uri.trim()), (value) => select(value.skill));
      }}>
        <Input aria-label="Skill URI" placeholder="skill://my-skill/SKILL.md" value={uri}
          className="h-10" onChange={(event) => setUri(event.target.value)} />
        <Button type="submit" className="h-10" disabled={busy || !uri.trim()}>Get skill</Button>
      </form>
      {error && <div role="alert"><ErrorMessage error={error} /></div>}
      {busy && <p role="status" className="text-sm text-muted-foreground">Loading...</p>}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <Input aria-label="Filter skills" placeholder="Filter skills..." value={filter}
            onChange={(event) => setFilter(event.target.value)} />
          {entries.length === 0 && <p className="text-sm text-muted-foreground">
            {filter ? "No matching skills." : "No skills listed. Enter a skill URI above to look it up directly."}
          </p>}
          {entries.map((entry) => <button key={entry.uri} type="button" onClick={() => select(entry)}
            aria-pressed={skill?.uri === entry.uri}
            className={cn("w-full rounded-md border p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              skill?.uri === entry.uri && "border-primary bg-accent")}>
            <span className="block text-sm font-medium">{entry.frontmatter.name}</span>
            <span className="mt-1 block break-all text-xs text-muted-foreground">{entry.uri}</span>
            <span className="mt-2 block text-sm text-muted-foreground">{entry.frontmatter.description}</span>
          </button>)}
        </div>
        <div className="min-w-0 space-y-4">
          {!skill && <p className="text-sm text-muted-foreground">Select a skill to inspect its metadata and files.</p>}
          {skill && <>
            <div className="space-y-2">
              <h2 className="text-lg font-medium">{skill.frontmatter.name}</h2>
              <p className="break-all text-xs text-muted-foreground">{serverName} · {skill.uri}</p>
              <CodeBlock language="json" caption="Frontmatter">{JSON.stringify(skill.frontmatter, null, 2)}</CodeBlock>
            </div>
            <Button variant="outline" className="h-10" disabled={busy} onClick={() => read(skill.uri)}>Read SKILL.md</Button>
            {skill.resources === "dynamic" ? <p className="text-sm text-muted-foreground">
              Dynamic content. This server does not publish file digests, so content integrity cannot be verified.
            </p> : <div className="space-y-2">
              <h3 className="text-sm font-medium">Files ({skill.resources.length})</h3>
              {skill.resources.map((file) => <div key={file.uri} className="rounded-md border p-3">
                <Button variant="ghost" className="h-auto min-h-10 max-w-full whitespace-normal break-all text-left"
                  disabled={busy} onClick={() => read(file.uri)}>{file.uri.slice(skill.uri.lastIndexOf("/") + 1)}</Button>
                <p className="break-all text-xs text-muted-foreground">{file.size} bytes · {file.digest}</p>
              </div>)}
            </div>}
            {capability.directoryRead && <div className="space-y-2">
              <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
                event.preventDefault();
                setDirectory(null);
                void run<{ resources: MCPResource[] }>(() => api.readSkillDirectory(serverId, directoryUri.trim()),
                  (value) => setDirectory(value.resources));
              }}>
                <Input aria-label="Directory URI" value={directoryUri} className="h-10"
                  onChange={(event) => setDirectoryUri(event.target.value)} />
                <Button variant="outline" className="h-10" disabled={busy || !directoryUri.trim()}>
                  <FolderOpen className="size-4" />Browse directory
                </Button>
              </form>
              {directory?.length === 0 && <p className="text-sm text-muted-foreground">Empty directory.</p>}
              {directory?.map((file) => <Button key={file.uri} variant="ghost" disabled={busy}
                className="h-auto min-h-10 w-full justify-start whitespace-normal break-all" onClick={() => {
                  if (file.mimeType === "inode/directory") {
                    setDirectoryUri(file.uri);
                    setDirectory(null);
                    void run<{ resources: MCPResource[] }>(() => api.readSkillDirectory(serverId, file.uri),
                      (value) => setDirectory(value.resources));
                  } else read(file.uri);
                }}>{file.mimeType === "inode/directory" && <FolderOpen className="size-4 shrink-0" />}{file.uri}</Button>)}
            </div>}
            {result && <div className="space-y-2">
              <p className="text-sm">{result.verification === "verified" ? "Size and SHA-256 digest verified." : "Dynamic content. No digest available."}</p>
              {result.contents.map((content) => <CodeBlock key={content.uri} caption={content.uri}>
                {content.text ?? content.blob ?? ""}
              </CodeBlock>)}
            </div>}
          </>}
        </div>
      </div>
    </PageShell>
  );
}
