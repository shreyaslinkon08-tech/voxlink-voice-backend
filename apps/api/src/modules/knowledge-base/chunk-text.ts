export interface TextChunk {
  readonly chunkIndex: number;
  readonly chunkText: string;
}

export function chunkKnowledgeText(content: string, maxCharacters = 1_500): readonly TextChunk[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const chunks: TextChunk[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      if (current) {
        chunks.push({ chunkIndex: chunks.length, chunkText: current });
        current = "";
      }

      for (const sentenceChunk of splitLongText(paragraph, maxCharacters)) {
        chunks.push({ chunkIndex: chunks.length, chunkText: sentenceChunk });
      }

      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;

    if (next.length > maxCharacters) {
      chunks.push({ chunkIndex: chunks.length, chunkText: current });
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push({ chunkIndex: chunks.length, chunkText: current });
  }

  return chunks;
}

function splitLongText(text: string, maxCharacters: number): readonly string[] {
  const chunks: string[] = [];
  let current = "";

  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > maxCharacters) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      for (let offset = 0; offset < sentence.length; offset += maxCharacters) {
        chunks.push(sentence.slice(offset, offset + maxCharacters));
      }

      continue;
    }

    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length > maxCharacters) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
