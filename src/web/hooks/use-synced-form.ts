import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useToolArgsStore } from "@/stores/tool-args-store";

export function useSyncedForm(opts: {
  serverName: string;
  formKey: string;
  schema: z.ZodObject<Record<string, z.ZodType>>;
  defaults: Record<string, string>;
}) {
  const { serverName, formKey, schema, defaults } = opts;
  const { getArgs, setArg, setArgs } = useToolArgsStore();

  const cached = getArgs(serverName, formKey);
  const defaultValues = cached ?? defaults;

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onChange",
  });

  const skipSyncRef = React.useRef(false);

  React.useEffect(() => {
    const sub = form.watch((values, { name }) => {
      if (skipSyncRef.current) return;
      if (name && values[name] !== undefined) {
        setArg(serverName, formKey, name, values[name] as string);
      }
    });
    return () => sub.unsubscribe();
  }, [form, serverName, formKey, setArg]);

  const setAllValues = React.useCallback(
    (values: Record<string, string>) => {
      skipSyncRef.current = true;
      form.reset(values);
      setArgs(serverName, formKey, values);
      skipSyncRef.current = false;
    },
    [form, serverName, formKey, setArgs],
  );

  return { ...form, setAllValues };
}
