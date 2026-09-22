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
