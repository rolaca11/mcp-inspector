import posthog, { type CaptureResult } from "posthog-js";

const URL_PROPERTY = /(url|pathname|referrer)$/i;
const REDACTED_SERVER = ":server";

export function redactPath(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if (!first) return pathname;
  return ["", REDACTED_SERVER, ...rest].join("/");
}

export function redactUrl(value: string, appHost: string): string {
  if (value.startsWith("/")) return redactPath(value.split(/[?#]/, 1)[0]!);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  const host = `${url.protocol}//${url.host}`;
  if (host !== appHost) return value;
  return `${host}${redactPath(url.pathname)}`;
}

function redactProperties(
  properties: Record<string, unknown> | undefined,
  appHost: string,
): void {
  if (!properties) return;
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" && URL_PROPERTY.test(key)) {
      properties[key] = redactUrl(value, appHost);
    }
  }
}

export function redactEvent(
  event: CaptureResult | null,
  appHost: string,
): CaptureResult | null {
  if (!event) return event;
  redactProperties(event.properties, appHost);
  redactProperties(event.$set, appHost);
  redactProperties(event.$set_once, appHost);
  return event;
}

export function initAnalytics(): typeof posthog | undefined {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  const host = import.meta.env.VITE_POSTHOG_HOST;
  if (!token || !host) return undefined;

  const appHost = `${window.location.protocol}//${window.location.host}`;
  posthog.init(token, {
    api_host: host,
    defaults: "2026-08-30",
    respect_dnt: true,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    before_send: (event) => redactEvent(event, appHost),
  });
  posthog.register({
    app_version: __PKG_VERSION__,
    app_surface: window.location.protocol === "app:" ? "desktop" : "web",
  });
  return posthog;
}
