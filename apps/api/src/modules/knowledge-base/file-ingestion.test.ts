import { describe, expect, it } from "vitest";
import { extractKnowledgeFileText } from "./file-ingestion.js";

describe("file knowledge ingestion", () => {
  it("extracts normalized text files", async () => {
    const result = await extractKnowledgeFileText({
      filename: "policy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Refunds   are available.\n\n\nEscalate billing disputes.")
    });

    expect(result.mimeType).toBe("text/plain");
    expect(result.content).toBe("Refunds are available.\nEscalate billing disputes.");
    expect(result.metadata.parser).toBe("text_decoder");
    expect(result.contentSha256).toHaveLength(64);
  });

  it("rejects unsupported file types", async () => {
    await expect(
      extractKnowledgeFileText({
        filename: "archive.zip",
        mimeType: "application/zip",
        buffer: Buffer.from("nope")
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
  });
});
