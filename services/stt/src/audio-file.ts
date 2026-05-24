import type { SttTranscriptionRequest } from "@voxlink/shared";

export interface PreparedAudioFile {
  readonly blob: Blob;
  readonly filename: string;
}

export async function prepareAudioFile(
  request: SttTranscriptionRequest
): Promise<PreparedAudioFile> {
  const audioBytes = await collectAudioBytes(request.audio);

  if (request.audioFormat === "wav") {
    return {
      blob: new Blob([toArrayBuffer(audioBytes)], { type: "audio/wav" }),
      filename: `${request.callId}.wav`
    };
  }

  if (request.audioFormat === "pcm_16khz") {
    return {
      blob: new Blob([toArrayBuffer(wrapPcm16AsWav(audioBytes, 16_000))], { type: "audio/wav" }),
      filename: `${request.callId}.wav`
    };
  }

  return {
    blob: new Blob([toArrayBuffer(wrapPcm16AsWav(decodeMulawToPcm16(audioBytes), 8_000))], {
      type: "audio/wav"
    }),
    filename: `${request.callId}.wav`
  };
}

async function collectAudioBytes(audio: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const chunk of audio) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }

  const collected = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    collected.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return collected;
}

function decodeMulawToPcm16(mulawBytes: Uint8Array): Uint8Array {
  const pcm = new Uint8Array(mulawBytes.byteLength * 2);
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < mulawBytes.byteLength; index += 1) {
    view.setInt16(index * 2, decodeMulawSample(mulawBytes[index] ?? 0), true);
  }

  return pcm;
}

function decodeMulawSample(value: number): number {
  const inverted = ~value & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;

  return sign === 0 ? sample : -sample;
}

function wrapPcm16AsWav(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const headerSize = 44;
  const wav = new Uint8Array(headerSize + pcmBytes.byteLength);
  const view = new DataView(wav.buffer);

  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(wav, 36, "data");
  view.setUint32(40, pcmBytes.byteLength, true);
  wav.set(pcmBytes, headerSize);

  return wav;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
