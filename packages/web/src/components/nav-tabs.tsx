import {
  Activity,
  BookOpen,
  FileBox,
  Hammer,
  KeyRound,
  MessageSquare,
  Server,
  Sparkles,
} from "lucide-react";
import { skillsCapability } from "@rolaca11/mcp-inspector-core/skills";

/**
 * The canonical navigation destinations, shared by both app shells (classic
 * sidebar + command icon rail), the mobile bottom nav, and the ⌘K palette.
 */
export type NavKey =
  | "overview"
  | "skills"
  | "resources"
  | "tools"
  | "prompts"
  | "completions"
  | "auth"
  | "servers";

export interface NavItem {
  key: NavKey;
  label: string;
  icon: typeof Activity;
  /** Path segment under `/:serverName/`. */
  path: string;
  count?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", icon: Activity, path: "overview" },
  { key: "skills", label: "Skills", icon: BookOpen, path: "skills" },
  { key: "resources", label: "Resources", icon: FileBox, path: "resources" },
  { key: "tools", label: "Tools", icon: Hammer, path: "tools" },
  { key: "prompts", label: "Prompts", icon: MessageSquare, path: "prompts" },
  { key: "completions", label: "Completions", icon: Sparkles, path: "completions" },
  { key: "auth", label: "Auth", icon: KeyRound, path: "auth" },
  { key: "servers", label: "Servers", icon: Server, path: "servers" },
];

export function availableNavItems(capabilities: unknown): NavItem[] {
  return NAV_ITEMS.filter((item) => item.key !== "skills" || skillsCapability(capabilities) !== undefined);
}
