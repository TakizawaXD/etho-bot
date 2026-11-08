// Genera assets/banner.png (banner del menú de Etho) con sharp.
import sharp from 'sharp';
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="420">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f0c29"/><stop offset="0.5" stop-color="#302b63"/><stop offset="1" stop-color="#24c6dc"/>
    </linearGradient>
    <radialGradient id="r" cx="0.8" cy="0.2" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.25"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1000" height="420" fill="url(#g)"/><rect width="1000" height="420" fill="url(#r)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2">
    <circle cx="840" cy="120" r="150"/><circle cx="840" cy="120" r="100"/><circle cx="840" cy="120" r="50"/>
  </g>
  <polygon points="500,60 560,150 500,240 440,150" fill="#ffffff" fill-opacity="0.0"/>
  <text x="80" y="230" font-family="DejaVu Sans, Arial, sans-serif" font-size="150" font-weight="bold" fill="#ffffff" letter-spacing="14">ETHO</text>
  <text x="86" y="300" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" fill="#bff6ff" letter-spacing="6">TU ASISTENTE EN WHATSAPP</text>
  <rect x="86" y="326" width="260" height="6" rx="3" fill="#24c6dc"/>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(new URL('../assets/banner.png', import.meta.url).pathname);
console.log('banner generado');
