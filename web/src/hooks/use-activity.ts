import * as React from "react";

import { activityLog, type ActivityEntry } from "@/data/activity";

export function useActivity(): ActivityEntry[] {
  const [entries, setEntries] = React.useState<ActivityEntry[]>(activityLog.list());
  React.useEffect(() => activityLog.subscribe(setEntries), []);
  return entries;
}
