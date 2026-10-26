/** Procedurally generated artwork for demo data. Original by construction: no third-party images are used. */
const HEX = /^#[0-9a-f]{6}$/i;

export type Triple = readonly [string, string, string];

/** A small, fast, seedable random number generator (mulberry32). The same seed always gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (value: number): string => value.toFixed(1);

/** An 800x600 abstract composition: a gradient field with overlapping circles and triangles in the given colors. */
export function generateArtSvg(seed: number, colors: Triple): string {
  for (const color of colors) {
    if (!HEX.test(color)) throw new RangeError(`Not a #rrggbb color: ${color}`);
  }
  const random = seededRandom(seed);
  const pick = (): string => colors[Math.floor(random() * colors.length)] as string;
  const angle = Math.floor(random() * 360);
  const shapes: string[] = [];

  for (let i = 0; i < 14; i++) {
    const radius = 30 + random() * 130;
    shapes.push(
      `<circle cx="${n(random() * 800)}" cy="${n(random() * 600)}" r="${n(radius)}" fill="${pick()}" fill-opacity="${n(0.3 + random() * 0.6)}"/>`,
    );
  }
  for (let i = 0; i < 5; i++) {
    const x = random() * 700;
    const y = random() * 500;
    const size = 60 + random() * 160;
    shapes.push(
      `<polygon points="${n(x)},${n(y + size)} ${n(x + size / 2)},${n(y)} ${n(x + size)},${n(y + size)}" fill="${colors[2]}" fill-opacity="${n(0.4 + random() * 0.5)}"/>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">`,
    `<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>`,
    `<rect width="800" height="600" fill="url(#g)"/>`,
    ...shapes,
    `</svg>`,
  ].join("");
}
