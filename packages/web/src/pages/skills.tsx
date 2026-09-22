import { SkillsBrowser } from "@/components/skills-browser";
import { useConnectionStore } from "@/stores/connection-store";

export function SkillsPage() {
  const { server, data, loading } = useConnectionStore();
  if (!server) return null;
  return <SkillsBrowser key={server.id} serverId={server.id}
    skills={data?.skills ?? []} capabilities={data?.capabilities} connecting={loading} />;
}
