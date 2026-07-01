import { isRenderableUiResource } from "@/lib/mcp-apps";
import type { MCPResource, MCPResourceTemplate } from "@/data/types";

/**
 * A single entry in the Resources list — either a concrete resource or a
 * templated one. Shared by the Resources page and the sidebar sub-nav so both
 * resolve the same selection.
 */
export type ResourceItem =
  | { kind: "static"; resource: MCPResource }
  | { kind: "template"; template: MCPResourceTemplate };

export function buildResourceItems(
  resources: MCPResource[],
  templates: MCPResourceTemplate[],
): ResourceItem[] {
  return [
    ...resources.map((resource) => ({ kind: "static", resource }) as const),
    ...templates.map((template) => ({ kind: "template", template }) as const),
  ];
}

export function resourceItemKey(item: ResourceItem): string {
  return item.kind === "static" ? item.resource.uri : item.template.uriTemplate;
}

export function resourceItemLabel(item: ResourceItem): string {
  if (item.kind === "static") return item.resource.title ?? item.resource.name;
  return item.template.title ?? item.template.name;
}

export function resourceItemIsUi(item: ResourceItem): boolean {
  return item.kind === "static"
    ? isRenderableUiResource(item.resource.mimeType, item.resource.uri)
    : isRenderableUiResource(item.template.mimeType, item.template.uriTemplate);
}
