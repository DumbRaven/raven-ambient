import { mkdir, writeFile } from 'node:fs/promises';
import { ambientCovers } from '../src/ambient-covers.ts';

// Original line illustrations, generated as local SVG assets. No remote fonts or images.
const drawings = {
  rain: '<path d="M5 12a4 4 0 1 1 2-7 5 5 0 0 1 9 1 3 3 0 1 1 2 6H5M7 16l-1 3m6-3-1 4m6-4-1 3"/>',
  thunder: '<path d="M5 12a4 4 0 1 1 2-7 5 5 0 0 1 9 1 3 3 0 1 1 2 6h-3M12 10l-5 7h5l-1 5 6-8h-5z"/>',
  ocean: '<path d="M2 15c4 0 4-9 10-9 5 0 5 5 2 6 0-3-3-3-3-1 0 4 6 6 11 4M2 19q3-3 6 0t6 0 8 0"/><circle cx="19" cy="4" r="1.2"/>',
  stream: '<path d="M9 2c-9 5 13 6 4 11S3 18 6 22m8-20c-7 5 12 5 5 11s-9 7-6 9M2 7l2-2 2 2m13 12 2-2 2 2"/>',
  forest: '<path d="M9 3 3 13h3l-4 6h14l-4-6h3L9 3Zm0 16v3m7-16 5 8h-3l4 6h-5m-1-4v6"/>',
  wind: '<path d="M2 8h13c5 0 5-6 1-6-2 0-3 2-2 3M2 12h17c4 0 4-4 1-4M4 16h9c6 0 6 6 2 6-2 0-3-2-2-3M2 20h5"/>',
  birds: '<path d="M3 17c5 0 10-3 11-9 2-5 7-3 7 0l2 1-3 1c0 9-11 12-17 7Zm7-4-5-5c4-1 8 0 10 3m-4 9-1 3m5-5v4"/><circle cx="18" cy="7" r=".3"/>',
  insects: '<path d="M12 8v12m-3-8C0 0 1 19 9 16m6-4C24 0 23 19 15 16M9 9c0-5 6-5 6 0v9c0 4-6 4-6 0V9Zm1-4L7 2m7 3 3-3M5 21l3-2m11 2-3-2"/>',
  fire: '<path d="M12 2c2 6-3 7-2 10 2 1 4-2 5-5 1 4 5 5 5 9a8 8 0 0 1-16 0c0-3 2-6 4-8-1 5 3 3 4-6Zm0 11c-1 4-4 5-3 7 1 3 7 2 6-1l-3-6Z"/>',
  cafe: '<path d="M4 10h13v7c0 6-13 6-13 0v-7Zm13 1h2c5 0 4 6-2 6M2 23h19M7 7c-4-3 4-3 0-6m5 6c-4-3 4-3 0-6"/>',
  train: '<rect x="5" y="2" width="14" height="17" rx="4"/><path d="M5 10h14M12 3v7M8 19l-4 4m12-4 4 4M7 22h10M9 5h6"/><circle cx="8.5" cy="15" r=".8"/><circle cx="15.5" cy="15" r=".8"/>',
  city: '<path d="M2 22V9h6v13m0-1V3h8v19m0-8h6v8M1 22h22M5 12v1m0 4v1m6-12v1m2-1v1m-2 4v1m2-1v1m-2 4v1m2-1v1m6-1v1"/>',
  keyboard: '<rect x="1" y="7" width="22" height="14" rx="2"/><path d="M12 7V4c0-3 6-1 6-4M4 11h1m3 0h1m3 0h1m3 0h1m3 0h0M4 14h1m3 0h1m3 0h1m3 0h1m3 0h0M6 18h12"/>',
  writing: '<path d="M17 3H4v19h16V10M7 18h8m-8-4h2M18 2l4 4-9 9-5 1 1-5 9-9Zm-3 3 4 4M9 11l4 4"/>',
  fan: '<circle cx="12" cy="10" r="8"/><circle cx="12" cy="10" r="1.5"/><path d="M12 8c-7-8-10 6-2 3m3 1c0 9 10 2 1-2m0-1c8-3-4-10-3-1M12 18v4m-5 1h10"/>',
  snow: '<path d="M12 2v20M3 7l18 10M3 17 21 7M9 3l3 3 3-3M9 21l3-3 3 3M3 10l4-1-1-4m12 14-1-4 4-1M3 14l4 1-1 4M18 5l-1 4 4 1"/>',
  noise: '<path d="M2 10v4m3-7v10m3-12v14m4-17v20m4-17v14m3-12v10m3-7v4"/>',
};
const directory = new URL('../public/covers/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [index, cover] of ambientCovers.entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><title>${cover.name}</title><defs><linearGradient id="wash" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#172724" stop-opacity=".12"/></linearGradient></defs><rect width="300" height="300" fill="${cover.color}"/><rect width="300" height="300" fill="url(#wash)"/><g fill="none" stroke="#f8f5e8"><rect x="17" y="17" width="266" height="266" rx="130" stroke-opacity=".16"/><circle cx="150" cy="117" r="75" stroke-opacity=".22"/><circle cx="150" cy="117" r="68" stroke-opacity=".1"/><path d="M150 32v9m0 152v9M66 117h9m150 0h9M30 265h240" stroke-opacity=".4"/><g transform="translate(102 69) scale(4)" stroke-width=".65" stroke-linecap="round" stroke-linejoin="round">${drawings[cover.id]}</g></g><text x="150" y="252" fill="#f8f5e8" opacity=".65" text-anchor="middle" font-family="serif" font-size="9" letter-spacing="4">FIELD / ${String(index + 1).padStart(2, '0')}</text></svg>`;
  await writeFile(new URL(`${cover.id}.svg`, directory), svg);
}
console.log(`Generated ${ambientCovers.length} local covers.`);
