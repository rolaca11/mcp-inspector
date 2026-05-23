import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export function MarkdownDescription({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("md-description text-sm", className)}>
      <ReactMarkdown>
        {children}
      </ReactMarkdown>
    </div>
  );
}
