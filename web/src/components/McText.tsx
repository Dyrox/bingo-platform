import { useEffect, useRef, useState } from 'react';

// Text in Minecraft's own bitmap font (assets/minecraft/textures/font/ascii.png, copied to /yab/ascii.png).
// Printable ASCII sits at row = code / 16, column = code % 16, 8x8 cells; glyphs are white and get tinted.
// A glyph is as wide as its rightmost lit column + 1, plus 1px spacing; space advances 4px (font/include/space.json).

let font: Promise<{ img: HTMLImageElement; widths: number[] }> | null = null;

function loadFont() {
  font ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const widths = Array.from({ length: 256 }, (_, code) => {
        const cx = (code % 16) * 8, cy = Math.floor(code / 16) * 8;
        for (let x = 7; x >= 0; x--)
          for (let y = 0; y < 8; y++) if (px[((cy + y) * img.width + cx + x) * 4 + 3] > 0) return x + 1;
        return 0;
      });
      resolve({ img, widths });
    };
    img.onerror = reject;
    img.src = '/yab/ascii.png';
  });
  return font;
}

const advance = (widths: number[], ch: string) => (ch === ' ' ? 4 : widths[ch.charCodeAt(0)] + 1);

/** Cuts text to fit maxWidth font pixels, like the mod's font.truncate(name, 70). */
function fit(widths: number[], text: string, maxWidth: number) {
  let w = 0, out = '';
  for (const ch of text) {
    const a = advance(widths, ch);
    if (w + a - 1 > maxWidth) break;
    w += a; out += ch;
  }
  return { text: out, width: Math.max(0, w - 1) };
}

/**
 * Draws `text` at 1 font pixel per canvas pixel; CSS scales it up crisply. `unit` is the size of one
 * font pixel in CSS (e.g. a % of the card width), so the text scales with whatever it sits on.
 * Characters the bitmap font lacks (e.g. Chinese) fall back to a regular font.
 */
export function McText({ text, color, unit, maxWidth = 1000, shadow = false, shadowColor = 'rgba(0,0,0,.35)', className, style }: {
  text: string; color: string; unit: string; maxWidth?: number; shadow?: boolean; shadowColor?: string;
  className?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const ascii = /^[\x20-\x7e]*$/.test(text);

  useEffect(() => {
    if (!ascii) return;
    let live = true;
    loadFont().then(({ img, widths }) => {
      const canvas = ref.current;
      if (!live || !canvas) return;
      const { text: t, width } = fit(widths, text, maxWidth);
      const off = shadow ? 1 : 0;
      canvas.width = Math.max(1, width + off);
      canvas.height = 8 + off;
      const ctx = canvas.getContext('2d')!;
      // draw white glyphs, then tint them with source-in
      const glyphs = document.createElement('canvas');
      glyphs.width = canvas.width; glyphs.height = canvas.height;
      const g = glyphs.getContext('2d')!;
      let x = 0;
      for (const ch of t) {
        const code = ch.charCodeAt(0);
        if (ch !== ' ') g.drawImage(img, (code % 16) * 8, Math.floor(code / 16) * 8, 8, 8, x, 0, 8, 8);
        x += advance(widths, ch);
      }
      const tint = (c: string) => {
        const layer = document.createElement('canvas');
        layer.width = glyphs.width; layer.height = glyphs.height;
        const l = layer.getContext('2d')!;
        l.drawImage(glyphs, 0, 0);
        l.globalCompositeOperation = 'source-in';
        l.fillStyle = c;
        l.fillRect(0, 0, layer.width, layer.height);
        return layer;
      };
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (shadow) ctx.drawImage(tint(shadowColor), 1, 1);
      ctx.drawImage(tint(color), 0, 0);
      setSize({ w: canvas.width, h: canvas.height });
    });
    return () => { live = false; };
  }, [text, color, maxWidth, shadow, shadowColor, ascii]);

  if (!ascii) {
    return <span className={'mc-text-fallback ' + (className ?? '')} style={{ color, fontSize: `calc(${unit} * 8)`, ...style }}>{text}</span>;
  }
  return (
    <canvas ref={ref} className={'mc-text ' + (className ?? '')} aria-label={text} role="img"
      style={{ width: size ? `calc(${unit} * ${size.w})` : 0, height: size ? `calc(${unit} * ${size.h})` : 0, ...style }} />
  );
}
