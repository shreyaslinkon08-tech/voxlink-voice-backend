import { describe, expect, it } from "vitest";
import { ProviderRequestError } from "@voxlink/shared";
import { GroqLlmProvider } from "./groq-llm-provider.js";

describe("GroqLlmProvider", () => {
  it("selects model profiles and rotates configured API keys", async () => {
    const calls: {
      readonly authorization: string | null;
      readonly payload: Record<string, unknown>;
    }[] = [];
    const provider = new GroqLlmProvider({
      apiKeys: ["key-a", "key-b"],
      fetchImpl: (_input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          authorization: headers.get("authorization"),
          payload: JSON.parse(bodyAsString(init?.body)) as Record<string, unknown>
        });

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "completion-id",
              choices: [{ message: { content: "Hello from Groq" } }],
              usage: { prompt_tokens: 10, completion_tokens: 4 }
            }),
            { status: 200, headers: { "x-request-id": "provider-request-id" } }
          )
        );
      }
    });

    await provider.complete(
      {
        agentId: "agent_1",
        modelProfile: "gemma",
        messages: [{ role: "user", content: "Hi" }]
      },
      { requestId: "req_1" }
    );
    await provider.complete(
      {
        agentId: "agent_1",
        modelProfile: "gpt",
        messages: [{ role: "user", content: "Hi again" }]
      },
      { requestId: "req_2" }
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.authorization).toBe("Bearer key-a");
    expect(calls[0]?.payload.model).toBe("gemma2-9b-it");
    expect(calls[1]?.authorization).toBe("Bearer key-b");
    expect(calls[1]?.payload.model).toBe("openai/gpt-oss-120b");
  });

  it("fails fast when a requested profile has no configured Groq model", async () => {
    const provider = new GroqLlmProvider({
      apiKeys: ["key-a"],
      fetchImpl: () => Promise.reject(new Error("fetch should not be called"))
    });

    await expect(
      provider.complete(
        {
          agentId: "agent_1",
          modelProfile: "mixtral",
          messages: [{ role: "user", content: "Hi" }]
        },
        { requestId: "req_1" }
      )
    ).rejects.toBeInstanceOf(ProviderRequestError);
  });
});

function bodyAsString(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") {
    throw new Error("Expected string request body");
  }

  return body;
}
