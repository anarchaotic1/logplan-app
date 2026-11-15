// Renders the source images for the Android icon and splash screen. Run: node scripts/make-assets.mjs && npx capacitor-assets generate --android
import sharp from 'sharp';
const mark = (s, pad) => `<g transform="translate(${pad} ${pad}) scale(${(s - 2 * pad) / 512})"><circle cx="256" cy="256" r="150" fill="none" stroke="#221A12" stroke-width="34"/><path d="M256 106a150 150 0 0 1 129.9 225" fill="none" stroke="#FFB35C" stroke-width="34" stroke-linecap="round"/><circle cx="385.9" cy="331" r="30" fill="#F4F1EE"/><circle cx="256" cy="256" r="26" fill="#FFB35C"/></g>`;
const svg = (s, body, bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${bg ? `<rect width="${s}" height="${s}" fill="#010208"/>` : ''}${body}</svg>`);
await sharp(svg(1024, mark(1024, 110), true)).png().toFile('assets/icon-only.png');
await sharp(svg(1024, mark(1024, 230), false)).png().toFile('assets/icon-foreground.png'); // inside the adaptive-icon safe zone
await sharp(svg(1024, '', true)).png().toFile('assets/icon-background.png');
for (const n of ['splash', 'splash-dark']) await sharp(svg(2732, mark(2732, 1116), true)).png().toFile(`assets/${n}.png`);
console.log('assets written');
