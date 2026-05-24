import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { audioFramesToMulawBytes, wavToTwilioMulawPayloads } from "./twilio-audio-codec.js";

describe("Twilio audio codec helpers", () => {
  it("joins inbound Twilio media frames into mu-law bytes", () => {
    const bytes = audioFramesToMulawBytes([
      { payload: Buffer.from([1, 2]).toString("base64") },
      { payload: Buffer.from([3, 4]).toString("base64") }
    ]);

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it("converts PCM WAV audio into Twilio media payload frames", () => {
    const payloads = wavToTwilioMulawPayloads(createPcm16Wav(), 80);

    expect(payloads.length).toBeGreaterThan(1);
    expect(Buffer.from(payloads[0] ?? "", "base64").byteLength).toBe(80);
  });
});

function createPcm16Wav(): Uint8Array {
  const sampleRate = 16_000;
  const sampleCount = 320;
  const dataLength = sampleCount * 2;
  const wav = new Uint8Array(44 + dataLength);
  const view = new DataView(wav.buffer);

  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
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
  view.setUint32(40, dataLength, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(index / 8) * 8_000);
    view.setInt16(44 + index * 2, sample, true);
  }

  return wav;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
