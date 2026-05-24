import { describe, expect, it } from "vitest";
import { ProviderRequestError } from "@voxlink/shared";
import { GroqTtsProvider } from "./groq-tts-provider.js";

describe("GroqTtsProvider", () => {
  it("chunks long Orpheus input and streams wav audio", async () => {
    const payloads: Record<string, unknown>[] = [];
    const provider = new GroqTtsProvider({
      apiKeys: ["key-a", "key-b"],
      maxInputCharacters: 12,
      fetchImpl: (_input, init) => {
        payloads.push(JSON.parse(bodyAsString(init?.body)) as Record<string, unknown>);

        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      }
    });

    const audio: Uint8Array[] = [];

    for await (const chunk of provider.synthesize(
      {
        callId: "call_1",
        text: "hello world again",
        voiceId: "autumn",
        outputFormat: "wav"
      },
      { requestId: "req_1" }
    )) {
      audio.push(chunk);
    }

    expect(payloads.map((payload) => payload.input)).toEqual(["hello world", "again"]);
    expect(payloads[0]?.model).toBe("canopylabs/orpheus-v1-english");
    expect(payloads[0]?.voice).toBe("autumn");
    expect(payloads[0]?.response_format).toBe("wav");
    expect(audio).toHaveLength(2);
  });

  it("rejects non-wav output because Groq Orpheus only supports wav", async () => {
    const provider = new GroqTtsProvider({
      apiKeys: ["key-a"],
      fetchImpl: () => Promise.resolve(new Response(new Uint8Array([1]), { status: 200 }))
    });

    await expect(async () => {
      for await (const chunk of provider.synthesize(
        {
          callId: "call_1",
          text: "hello",
          voiceId: "autumn",
          outputFormat: "mp3"
        },
        { requestId: "req_1" }
      )) {
        expect(chunk).toBeUndefined();
        // The provider should throw before streaming any audio.
      }
    }).rejects.toBeInstanceOf(ProviderRequestError);
  });
});

function bodyAsString(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") {
    throw new Error("Expected string request body");
  }

  return body;
}
