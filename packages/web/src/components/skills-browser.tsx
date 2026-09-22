import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FolderOpen } from "lucide-react";
import { skillsCapability, type Skill } from "@rolaca11/mcp-inspector-core/skills";
import { api } from "@/data/api";
import type { ActivityResult, MCPResource, ReadResourceResult } from "@/data/types";
import { PageShell } from "@/components/page-shell";
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { ErrorMessage } from "@/components/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/section";
import { MarkdownDescription } from "@/components/markdown-description";
import { SubNav, useCapabilitySubItems } from "@/components/shell/sub-nav";
import { useConnectionStore } from "@/stores/connection-store";
import { useSelectionStore } from "@/stores/selection-store";

export function SkillsBrowser({ serverId, skills, capabilities, connecting }: {
  serverId: string;
  skills: Skill[];
  capabilities: unknown;
  connecting: boolean;
}) {
  const capability = skillsCapability(capabilities);
  const selectionStore = useSelectionStore();
  const subItems = useCapabilitySubItems(serverId);
  const selectedUri = selectionStore.get(serverId, "skills");
  const skill = skills.find((entry) => entry.uri === selectedUri) ?? skills[0] ?? null;
  const skillUri = skill?.uri ?? "";
  const [directoryUri, setDirectoryUri] = useState("");
  const [directory, setDirectory] = useState<MCPResource[] | null>(null);
  const [result, setResult] = useState<ReadResourceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const run = useCallback(async <T,>(operation: () => Promise<ActivityResult[]>, onResult: (value: T) => void) => {
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
  }, []);

  const read = useCallback((resourceUri: string) => {
    if (!skillUri) return;
    setResult(null);
    void run<ReadResourceResult & { skill: Skill }>(
      () => api.readSkill(serverId, skillUri, resourceUri),
      (value) => {
        setResult(value);
        const { data, setSkills } = useConnectionStore.getState();
        setSkills(serverId, (data?.skills ?? []).map((entry) =>
          entry.uri === skillUri ? value.skill : entry));
      },
    );
  }, [serverId, skillUri, run]);

  useEffect(() => {
    request.current++;
    setDirectoryUri(skillUri.slice(0, -"/SKILL.md".length));
    setResult(null);
    setDirectory(null);
    setError(null);
    setBusy(false);
    if (!connecting && skillsCapability(capabilities) && skillUri) read(skillUri);
    return () => { request.current++; };
  }, [capabilities, connecting, skillUri, read]);

  if (connecting) return <PageShell><p role="status">Loading skills...</p></PageShell>;
  if (!capability) return <PageShell><Empty icon={BookOpen} title="Skills unavailable"
    description="Connect to a server that advertises the MCP Skills extension." /></PageShell>;

  return (
    <PageShell>
      <div className="lg:hidden">
        <SubNav items={subItems.skills ?? []} variant="page" />
      </div>
      <div className="min-w-0 space-y-8">
        {!skill && <Empty icon={BookOpen} title="No skills advertised"
          description="This server did not advertise any skills." />}
        {skill && <>
          <Section
            titleClassName="flex items-center gap-2.5 flex-wrap"
            title={<span>{skill.frontmatter.name}</span>}
            description={<MarkdownDescription>{skill.frontmatter.description}</MarkdownDescription>}
          />
          {error && <div role="alert"><ErrorMessage error={error} /></div>}
          {busy && <p role="status" className="text-sm text-muted-foreground">Loading...</p>}
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
            {result.contents.map((content) => {
              const text = content.text ?? content.blob ?? "";
              const isMarkdown = content.text != null && (
                content.uri === skillUri || /\.md$/i.test(content.uri) || content.mimeType === "text/markdown"
              );
              const markdown = content.uri === skillUri
                ? text.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "")
                : text;

              return <CodeBlock key={content.uri} caption={content.uri}
                renderedContent={isMarkdown ? (
                  <MarkdownDescription className="break-words leading-relaxed [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg">
                    {markdown}
                  </MarkdownDescription>
                ) : undefined}>
                {text}
              </CodeBlock>;
            })}
          </div>}
        </>}
      </div>
    </PageShell>
  );
}
