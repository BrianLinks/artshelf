import { describe, expect, it } from "vitest";
import { detectFormat, type Format } from "../src/assets/signatures.js";

const pad = (bytes: number[], length = 32) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(length)]);
const text = (value: string, offset = 0) => {
  const buffer = Buffer.alloc(32);
  buffer.write(value, offset, "latin1");
  return buffer;
};

describe("detectFormat", () => {
  const cases: [Format, Buffer][] = [
    ["png", pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["jpeg", pad([0xff, 0xd8, 0xff, 0xe0])],
    ["webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)])],
    ["wav", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(8)])],
    ["pdf", text("%PDF-1.7")],
    ["zip", pad([0x50, 0x4b, 0x03, 0x04])],
    ["mp4", text("ftypisom", 4)],
    ["mp3", text("ID3")],
    ["mp3", pad([0xff, 0xfb, 0x90])],
  ];

  it.each(cases)("recognizes %s from its signature", (format, data) => {
    expect(detectFormat(data)).toBe(format);
  });

  it.each([
    ["plain text", Buffer.from("hello, this is just text")],
    ["an html file", Buffer.from("<html><script>alert(1)</script></html>")],
    ["an svg file", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["a gif", Buffer.from("GIF89a" + "\0".repeat(20))],
    ["a RIFF file of another kind", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("AVI "), Buffer.alloc(8)])],
    ["an empty buffer", Buffer.alloc(0)],
    ["a single byte", Buffer.from([0xff])],
  ])("returns undefined for %s", (_label, data) => {
    expect(detectFormat(data)).toBeUndefined();
  });

  it("ignores the filename entirely: a PNG-named script is still not a PNG", () => {
    expect(detectFormat(Buffer.from("#!/bin/sh\nrm -rf /"))).toBeUndefined();
  });
});
