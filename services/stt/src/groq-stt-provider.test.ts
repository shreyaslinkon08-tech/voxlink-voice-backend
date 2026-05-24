import { describe, expect, it } from "vitest";
import { GroqSttProvider } from "./groq-stt-provider.js";

describe("GroqSttProvider", () => {
  it("sends the configured Whisper model and yields transcription chunks", async () => {
    let capturedFormData: FormData | undefined;
    const provider = new GroqSttProvider({
      apiKeys: ["key-a"],
      defaultModel: "whisper-large-v3",
      fetchImpl: (_input, init) => {
        capturedFormData = init?.body as FormData;

        return Promise.resolve(
          new Response(
            JSON.stringify({
              text: "hello world",
              segments: [{ text: "hello world", start: 0.1, end: 0.9, avg_logprob: -0.2 }]
            }),
            { status: 200 }
          )
        );
      }
    });

    const chunks: {
      readonly text: string;
      readonly startedAtMs: number;
      readonly endedAtMs: number;
      readonly confidence?: number;
    }[] = [];

    for await (const chunk of provider.transcribe(
      {
        callId: "call_1",
        audioFormat: "wav",
        audio: asyncGenerator([new Uint8Array([1, 2, 3])])
      },
      { requestId: "req_1" }
    )) {
      chunks.push(chunk);
    }

    expect(capturedFormData?.get("model")).toBe("whisper-large-v3");
    expect(capturedFormData?.get("response_format")).toBe("verbose_json");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      text: "hello world",
      startedAtMs: 100,
      endedAtMs: 900
    });
    expect(chunks[0]?.confidence).toBeGreaterThan(0);
  });
});

async function* asyncGenerator(chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  await Promise.resolve();

  for (const chunk of chunks) {
    yield chunk;
  }
}
