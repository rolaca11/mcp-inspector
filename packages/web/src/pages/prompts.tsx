import { MessageSquare } from "lucide-react";

import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";

export function PromptsPage() {
  return (
    <PageShell>
      <Empty
        icon={MessageSquare}
        title="Not yet supported"
        description="Prompts are not yet supported in this version of the inspector."
      />
    </PageShell>
  );
}
