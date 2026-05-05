export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/60 bg-chrome/40">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-8 py-8 text-sm text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono">mcp-inspector</span>
          <span className="text-muted-foreground/40">v{__APP_VERSION__}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>
            Built on{" "}
            <a
              href="https://www.npmjs.com/package/@modelcontextprotocol/sdk"
              className="hover:text-foreground"
            >
              @modelcontextprotocol/sdk
            </a>
          </span>
        </div>
        <a
          href={`https://github.com/rolaca11/mcp-inspector/releases/tag/v${__APP_VERSION__}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground"
        >
          Changelog
        </a>
      </div>
    </footer>
  );
}
