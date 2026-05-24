import { Buffer } from "node:buffer";

export function audioFramesToMulawBytes(
  frames: readonly { readonly payload: string }[]
): Uint8Array {
  const chunks = frames.map((frame) => Buffer.from(frame.payload, "base64"));
  return concatBytes(chunks);
}

export function wavToTwilioMulawPayloads(wavBytes: Uint8Array, frameSize = 160): readonly string[] {
  const wav = parsePcm16Wav(wavBytes);
  const samples = resamplePcm16(wav.samples, wav.sampleRate, 8_000);
  const mulawBytes = new Uint8Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    mulawBytes[index] = encodePcm16ToMulaw(samples[index] ?? 0);
  }

  const payloads: string[] = [];
  for (let offset = 0; offset < mulawBytes.byteLength; offset += frameSize) {
    payloads.push(Buffer.from(mulawBytes.subarray(offset, offset + frameSize)).toString("base64"));
  }

  return payloads;
}

export async function collectAudioBytes(audio: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of audio) {
    chunks.push(chunk);
  }

  return concatBytes(chunks);
}

interface ParsedWav {
  readonly sampleRate: number;
  readonly samples: Int16Array;
}

function parsePcm16Wav(bytes: Uint8Array): ParsedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("TTS provider returned audio that is not a WAV file");
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || channels < 1 || sampleRate < 1 || bitsPerSample !== 16) {
    throw new Error("TTS WAV must be 16-bit PCM audio");
  }

  if (dataOffset < 0 || dataLength <= 0) {
    throw new Error("TTS WAV is missing audio data");
  }

  const sampleCount = Math.floor(dataLength / 2 / channels);
  const samples = new Int16Array(sampleCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    let mixed = 0;

    for (let channel = 0; channel < channels; channel += 1) {
      const byteOffset = dataOffset + (sampleIndex * channels + channel) * 2;
      mixed += view.getInt16(byteOffset, true);
    }

    samples[sampleIndex] = Math.round(mixed / channels);
  }

  return { sampleRate, samples };
}

function resamplePcm16(
  samples: Int16Array,
  fromSampleRate: number,
  toSampleRate: number
): Int16Array {
  if (fromSampleRate === toSampleRate) {
    return samples;
  }

  const outputLength = Math.max(1, Math.round((samples.length * toSampleRate) / fromSampleRate));
  const output = new Int16Array(outputLength);
  const ratio = fromSampleRate / toSampleRate;

  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * ratio;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(samples.length - 1, lowerIndex + 1);
    const fraction = sourceIndex - lowerIndex;
    const lower = samples[lowerIndex] ?? 0;
    const upper = samples[upperIndex] ?? lower;
    output[index] = Math.round(lower + (upper - lower) * fraction);
  }

  return output;
}

function encodePcm16ToMulaw(sample: number): number {
  const bias = 0x84;
  const clip = 32635;
  const sign = (sample >> 8) & 0x80;

  if (sign !== 0) {
    sample = -sample;
  }

  sample = Math.min(sample, clip) + bias;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}
