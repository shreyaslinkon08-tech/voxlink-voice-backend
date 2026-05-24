import { describe, expect, it } from "vitest";
import { chunkKnowledgeText } from "./chunk-text.js";

describe("knowledge text chunking", () => {
  it("keeps chunks under the configured character budget", () => {
    const chunks = chunkKnowledgeText(
      [
        "Refunds are available within 30 days. Exchanges are available within 60 days.",
        "Support is open Monday through Friday from 9 AM to 5 PM."
      ].join("\n\n"),
      80
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.chunkText.length <= 80)).toBe(true);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
  });
});
