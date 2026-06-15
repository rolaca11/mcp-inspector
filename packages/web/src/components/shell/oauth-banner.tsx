import { ExternalLink, ShieldAlert } from "lucide-react";

/**
 * The pending-OAuth strip. Rendered at the top of the content column (not the
 * grid frame) so it never shifts the sidebar/status bar.
 */
export function OAuthBanner({ url }: { url: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning sm:px-6">
      <ShieldAlert className="size-4 shrink-0" />
      <span className="font-medium">Authorization required</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-1 inline-flex items-center gap-1.5 underline decoration-warning/40 underline-offset-2 transition-colors hover:decoration-warning"
      >
        <ExternalLink className="size-3.5" />
        Open authorization page
      </a>
    </div>
  );
}
