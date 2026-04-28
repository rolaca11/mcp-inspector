export function Footer() {
  return (
    <footer className="mt-16 border-t border-border/60 bg-background/40">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-6 py-5 text-xs text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono">mcp-inspector</span>
          <span className="text-muted-foreground/40">v0.1.0</span>
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
        <div className="flex items-center gap-5">
          <a href="#status" className="hover:text-foreground">
            Status
          </a>
          <a href="#changelog" className="hover:text-foreground">
            Changelog
          </a>
          <a href="#docs" className="hover:text-foreground">
            Docs
          </a>
          <a href="#help" className="hover:text-foreground">
            Help
          </a>
        </div>
      </div>
    </footer>
  );
}
