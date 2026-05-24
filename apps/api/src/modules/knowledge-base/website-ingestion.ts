import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { load } from "cheerio";
import { AppError } from "../../errors/app-error.js";

const defaultMaxBytes = 1_000_000;
const defaultTimeoutMs = 10_000;

export interface WebsiteIngestionResult {
  readonly title: string | null;
  readonly content: string;
  readonly contentSha256: string;
  readonly contentType: string | null;
  readonly finalUrl: string;
  readonly fetchedAt: string;
}

export interface WebsiteIngestionOptions {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

export async function fetchWebsiteKnowledgeText(
  sourceUri: string,
  options: WebsiteIngestionOptions = {}
): Promise<WebsiteIngestionResult> {
  const url = await assertPublicHttpUrl(sourceUri);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "user-agent": "AltrionVoiceBot/0.1 (+https://altrion.local)"
      }
    });

    if (!response.ok) {
      throw AppError.badRequest(`Website returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type");

    if (!isSupportedContentType(contentType)) {
      throw AppError.badRequest("Website content type is not supported for ingestion");
    }

    const rawText = await readTextResponse(response, maxBytes);
    const parsed =
      contentType?.toLowerCase().includes("html") ?? false
        ? extractHtmlText(rawText)
        : { title: null, content: normalizeText(rawText) };

    if (parsed.content.length === 0) {
      throw AppError.badRequest("Website did not contain readable text");
    }

    return {
      title: parsed.title,
      content: parsed.content,
      contentSha256: createHash("sha256").update(parsed.content).digest("hex"),
      contentType,
      finalUrl: response.url,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw AppError.badRequest("Website ingestion timed out");
    }

    throw AppError.badRequest("Website could not be fetched for ingestion");
  } finally {
    clearTimeout(timeout);
  }
}

export function extractHtmlText(html: string): { readonly title: string | null; readonly content: string } {
  const $ = load(html);

  $("script,style,noscript,svg,canvas,iframe,template,nav,footer").remove();

  const title = normalizeText($("title").first().text()) || null;
  const description = normalizeText($('meta[name="description"]').attr("content") ?? "");
  const heading = normalizeText($("h1").first().text());
  const body = normalizeText($("body").text() || $.root().text());
  const parts = [title, description, heading, body].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );

  return {
    title,
    content: dedupeAdjacentLines(parts.join("\n\n"))
  };
}

function normalizeText(value: string): string {
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

function dedupeAdjacentLines(value: string): string {
  const lines = value.split("\n");
  const deduped: string[] = [];

  for (const line of lines) {
    if (line !== deduped.at(-1)) {
      deduped.push(line);
    }
  }

  return deduped.join("\n").trim();
}

async function readTextResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        throw AppError.badRequest("Website content is too large to ingest directly");
      }

      chunks.push(value);
    }
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function isSupportedContentType(contentType: string | null): boolean {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("text/html") ||
    normalized.includes("application/xhtml+xml") ||
    normalized.includes("text/plain")
  );
}

async function assertPublicHttpUrl(sourceUri: string): Promise<string> {
  let parsed: URL;

  try {
    parsed = new URL(sourceUri);
  } catch {
    throw AppError.badRequest("Website URL is invalid");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw AppError.badRequest("Only HTTP and HTTPS website URLs can be ingested");
  }

  if (parsed.username || parsed.password) {
    throw AppError.badRequest("Website URLs with credentials are not allowed");
  }

  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address.address))) {
    throw AppError.badRequest("Website URL must resolve to a public address");
  }

  return parsed.toString();
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);

    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 0 && b === 0)
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();

    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized === "::"
    );
  }

  return true;
}
