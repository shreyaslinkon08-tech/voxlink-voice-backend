import { publicApiUrl } from "./api-url";

export { publicApiUrl };

interface ApiErrorPayload {
  readonly error?: {
    readonly message?: string;
  };
}

export async function clientApi<TResponse>(
  path: string,
  init: RequestInit = {}
): Promise<TResponse> {
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${publicApiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: isFormData
      ? init.headers
      : {
          "Content-Type": "application/json",
          ...init.headers
        }
  });

  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Request failed");
  }

  return payload as TResponse;
}
