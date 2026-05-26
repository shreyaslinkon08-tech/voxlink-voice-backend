import { internalApiUrl } from "@/lib/api-url";

interface ProxyRouteContext {
  readonly params: Promise<{
    readonly path: string[];
  }>;
}

const hopByHopHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export async function GET(request: Request, context: ProxyRouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

export async function POST(request: Request, context: ProxyRouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

export async function PUT(request: Request, context: ProxyRouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

export async function PATCH(request: Request, context: ProxyRouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

export async function DELETE(request: Request, context: ProxyRouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

async function proxyApiRequest(request: Request, context: ProxyRouteContext): Promise<Response> {
  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(path.map(encodeURIComponent).join("/"), `${internalApiUrl}/`);
  upstreamUrl.search = incomingUrl.search;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("host");
  requestHeaders.delete("content-length");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: requestHeaders,
    redirect: "manual"
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstreamResponse = await fetch(upstreamUrl, init);
  const responseHeaders = copyResponseHeaders(upstreamResponse.headers);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
}

function copyResponseHeaders(headers: Headers): Headers {
  const copied = new Headers();

  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();

    if (hopByHopHeaders.has(normalizedKey) || normalizedKey === "set-cookie") {
      return;
    }

    copied.append(key, value);
  });

  for (const cookie of getSetCookieHeaders(headers)) {
    copied.append("set-cookie", rewriteCookiePath(cookie));
  }

  return copied;
}

function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const explicitCookies = withGetSetCookie.getSetCookie?.();

  if (explicitCookies?.length) {
    return explicitCookies;
  }

  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

function splitSetCookieHeader(value: string): string[] {
  return value.split(/,(?=\s*[\w!#$%&'*+.^_`|~-]+=)/).map((cookie) => cookie.trim());
}

function rewriteCookiePath(cookie: string): string {
  return cookie.replace(/;\s*Path=\/auth\/google/iu, "; Path=/api/auth/google");
}
