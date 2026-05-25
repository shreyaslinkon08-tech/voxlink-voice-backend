const localApiUrl = "http://localhost:4000";
const productionApiUrl = "https://voxlinkapi-production.up.railway.app";

export const publicApiUrl = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL);
export const internalApiUrl = resolveApiUrl(
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL
);

function resolveApiUrl(configuredValue: string | undefined): string {
  const configured = configuredValue?.trim();

  if (configured && !isLocalApiUrl(configured)) {
    return trimTrailingSlash(configured);
  }

  if (isLocalBrowser() || process.env.NODE_ENV !== "production") {
    return localApiUrl;
  }

  return productionApiUrl;
}

function isLocalBrowser(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
}

function isLocalApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
