import { useEffect, useRef } from 'react';

// YAB's BingoEndFireworkRenderer: when a team wins, 50 ★ burst out of its card in six pastel colours,
// each flying straight out (with a slight lift) and spinning, fading as (distance / range)³ until gone.
// Distances are in card pixels (the card is 122 wide); time runs in game ticks (50 ms).
const COLORS = ['#f5c0a3', '#a3f5a3', '#a3f5c7', '#a3abf5', '#cca3f5', '#f5a3d6'];
const COUNT = 50, RANGE = 500, VELOCITY = 1.5, FONT = 9;

interface Star { vx: number; vy: number; rot: number; spin: number; color: string }

function burst(): Star[] {
  return Array.from({ length: COUNT }, () => {
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random();
    return {
      vx: Math.cos(a) * s * VELOCITY,
      vy: Math.sin(a) * s * VELOCITY - 0.2,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.5 * VELOCITY,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });
}

/** Plays the burst over the whole page from the centre of `anchor`'s parent; a new `play` value plays it again. */
export function WinStars({ play }: { play: number }) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const card = anchor.current?.parentElement;
    if (!card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'win-stars';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    let stars = burst(), raf = 0;
    const start = performance.now();

    const frame = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth, h = window.innerHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const box = card.getBoundingClientRect();
      const unit = box.width / 122;                     // one card pixel on screen
      const ox = box.left + box.width / 2, oy = box.top + box.height / 2;
      const ticks = (now - start) / 50;
      ctx.font = `${FONT * unit}px Minecraft, "Noto Sans SC", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      stars = stars.filter(s => {
        const x = s.vx * ticks, y = s.vy * ticks;
        const alpha = 1 - Math.pow(Math.hypot(x, y) / RANGE, 3);
        if (alpha <= 0.025) return false;
        ctx.save();
        ctx.translate(ox + x * unit, oy + y * unit);
        ctx.rotate(s.rot + s.spin * ticks);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.color;
        ctx.fillText('★', 0, 0);
        ctx.restore();
        return true;
      });
      if (stars.length) raf = requestAnimationFrame(frame);
      else canvas.remove();
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); canvas.remove(); };
  }, [play]);
  return <span ref={anchor} hidden />;
}
