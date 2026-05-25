import { publicApiUrl } from "./api-url";

export { publicApiUrl };

interface ApiErrorPayload {
  readonly error?: {
    readonly message?: string;
  };
}

const clientRequestTimeoutMs = 30_000;

export async function clientApi<TResponse>(
  path: string,
  init: RequestInit = {}
): Promise<TResponse> {
  const isFormData = init.body instanceof FormData;
  const controller = init.signal ? undefined : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), clientRequestTimeoutMs)
    : undefined;
  let response: Response;

  try {
    response = await fetch(`${publicApiUrl}${path}`, {
      ...init,
      credentials: "include",
      signal: init.signal ?? controller?.signal,
      headers: isFormData
        ? init.headers
        : {
            "Content-Type": "application/json",
            ...init.headers
          }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  return payload as TResponse;
}
