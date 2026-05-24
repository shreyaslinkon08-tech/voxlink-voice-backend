import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";
import { AppError } from "../../errors/app-error.js";

const maxExtractedCharacters = 500_000;

const textMimeTypes = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json"
]);

const docxMimeType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface KnowledgeFileExtractionResult {
  readonly content: string;
  readonly contentSha256: string;
  readonly mimeType: string;
  readonly metadata: {
    readonly parser: string;
    readonly originalSizeBytes: number;
  };
}

export async function extractKnowledgeFileText(input: {
  readonly filename: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}): Promise<KnowledgeFileExtractionResult> {
  const mimeType = normalizeMimeType(input.mimeType, input.filename);
  let content: string;
  let parser: string;

  if (textMimeTypes.has(mimeType)) {
    content = decodeText(input.buffer);
    parser = "text_decoder";
  } else if (mimeType === "application/pdf") {
    content = await extractPdfText(input.buffer);
    parser = "pdf_parse";
  } else if (mimeType === docxMimeType) {
    content = await extractDocxText(input.buffer);
    parser = "mammoth";
  } else {
    throw AppError.badRequest("Only TXT, Markdown, JSON, PDF, and DOCX files can be ingested");
  }

  const normalized = normalizeExtractedText(content);

  if (normalized.length === 0) {
    throw AppError.badRequest("Uploaded file did not contain readable text");
  }

  if (normalized.length > maxExtractedCharacters) {
    throw AppError.badRequest("Uploaded file contains too much text to ingest directly");
  }

  return {
    content: normalized,
    contentSha256: createHash("sha256").update(normalized).digest("hex"),
    mimeType,
    metadata: {
      parser,
      originalSizeBytes: input.buffer.byteLength
    }
  };
}

function normalizeMimeType(mimeType: string, filename: string): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = filename.toLowerCase().split(".").at(-1);

  if (normalized) {
    return normalized;
  }

  switch (extension) {
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    case "docx":
      return docxMimeType;
    default:
      return "application/octet-stream";
  }
}

function decodeText(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
