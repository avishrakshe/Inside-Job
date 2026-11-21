// Original INSIDE JOB character art, drawn procedurally (no image assets):
// a chunky little robber with a beanie, a burglar's eye-mask and a swag bag.
// Coordinates: (x, y) is the character's centre in world units (1 tile = 32).

export const OUTLINE = "#0b0f18";

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt))),
  );
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

export interface RobberOpts {
  color: string;
  facing?: number; // 1 = right, -1 = left
  walk?: number; // walk-cycle phase (radians)
  moving?: boolean;
  ghost?: boolean;
  mole?: boolean; // red eyes (only drawn for yourself / your partner)
  ko?: boolean; // X eyes (cuffed)
  t?: number; // ms, for idle animation
  scale?: number;
  shadow?: boolean;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r as any);
}

export function drawRobber(ctx: CanvasRenderingContext2D, x: number, y: number, o: RobberOpts) {
  const f = o.facing && o.facing < 0 ? -1 : 1;
  const t = o.t ?? 0;
  const s = o.scale ?? 1;
  const walk = o.walk ?? 0;
  const c = o.color;
  ctx.save();
  ctx.translate(x, y + 4 * s);
  ctx.scale(s, s);
  if (o.ghost) {
    ctx.globalAlpha *= 0.5;
    ctx.translate(0, Math.sin(t / 320) * 2.2 - 5);
  }
  // ground shadow
  if (!o.ghost && o.shadow !== false) {
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 12, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.scale(f, 1);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.lineJoin = "round";

  // feet (behind the body)
  if (!o.ghost) {
    const sw = o.moving ? Math.sin(walk) * 3.2 : 0;
    const lift = o.moving ? Math.max(0, Math.cos(walk)) * 1.5 : 0;
    ctx.fillStyle = shade(c, -0.6);
    rr(ctx, -8 + sw, 3 - lift, 7.5, 7, 3.5);
    ctx.fill(); ctx.stroke();
    rr(ctx, 1 - sw, 3 - (o.moving ? Math.max(0, -Math.cos(walk)) * 1.5 : 0), 7.5, 7, 3.5);
    ctx.fill(); ctx.stroke();
  }

  const bob = o.moving ? -Math.abs(Math.sin(walk)) * 2 : Math.sin(t / 420) * 0.7;
  ctx.translate(0, bob);

  // swag bag on the back
  if (!o.ghost) {
    ctx.fillStyle = "#c9a36b";
    ctx.beginPath();
    ctx.ellipse(-11.5, -2, 6.2, 7.2, -0.2, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#8a6a3c";
    rr(ctx, -14, -10.5, 5, 3, 1.5);
    ctx.fill();
    ctx.fillStyle = "#5b4322";
    ctx.font = "bold 8px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", -11.5, -1);
  }

  // body
  ctx.fillStyle = c;
  if (o.ghost) {
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.arcTo(-10, -16, 0, -16, 9);
    ctx.arcTo(10, -16, 10, -6, 9);
    ctx.lineTo(10, 8);
    const ph = t / 160;
    for (let k = 0; k <= 4; k++) {
      const xx = 10 - k * 5;
      ctx.lineTo(xx, 8 + Math.sin(ph + k) * 2.2 + (k % 2 ? 3 : 0));
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else {
    rr(ctx, -10, -16, 20, 24, 9);
    ctx.fill(); ctx.stroke();
    // shading crescent + highlight
    ctx.save();
    rr(ctx, -10, -16, 20, 24, 9);
    ctx.clip();
    ctx.fillStyle = shade(c, -0.28);
    ctx.beginPath();
    ctx.ellipse(-12, 4, 10, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(c, 0.35);
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.ellipse(4, -3, 3, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // striped shirt hem
    ctx.fillStyle = shade(c, -0.45);
    ctx.fillRect(-9, 2, 18, 2);
  }

  // burglar mask band
  ctx.fillStyle = "#14171f";
  rr(ctx, -10.5, -11.5, 22, 7.5, 3.5);
  ctx.fill();
  // eyes
  if (o.ko) {
    ctx.strokeStyle = "#f2f5fa";
    ctx.lineWidth = 1.4;
    for (const ex of [2.5, 7.5]) {
      ctx.beginPath();
      ctx.moveTo(ex - 1.8, -9.6); ctx.lineTo(ex + 1.8, -6.2);
      ctx.moveTo(ex + 1.8, -9.6); ctx.lineTo(ex - 1.8, -6.2);
      ctx.stroke();
    }
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
  } else {
    const blink = !o.ghost && Math.sin(t / 900 + c.length) > 0.985;
    for (const ex of [2.5, 7.5]) {
      ctx.fillStyle = "#f6f8fc";
      ctx.beginPath();
      ctx.ellipse(ex, -7.8, 2.5, blink ? 0.5 : 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!blink) {
        ctx.fillStyle = o.mole ? "#ff2d55" : "#10131a";
        ctx.beginPath();
        ctx.arc(ex + 0.9, -7.6, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (o.mole) {
      ctx.fillStyle = "rgba(255,45,85,0.35)";
      ctx.beginPath();
      ctx.ellipse(5, -7.8, 7, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // beanie
  ctx.fillStyle = shade(c, -0.38);
  rr(ctx, -10, -22, 20, 10, [9, 9, 2, 2]);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = shade(c, -0.55);
  rr(ctx, -11, -14.5, 22, 4, 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = shade(c, 0.3);
  ctx.beginPath();
  ctx.arc(-1, -23, 3, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // ghost halo
  if (o.ghost) {
    ctx.strokeStyle = "rgba(255,226,120,0.9)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -29, 7, 2.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A cuffed crew member, lying where it happened. */
export function drawCuffed(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 17, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  drawRobber(ctx, 0, -2, { color, ko: true, shadow: false, t });
  ctx.restore();
  // handcuffs
  ctx.save();
  ctx.strokeStyle = "#dfe5ef";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + 4, y + 9, 3.2, 0, Math.PI * 2);
  ctx.moveTo(x + 13.2, y + 9);
  ctx.arc(x + 10, y + 9, 3.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 7.2, y + 9); ctx.lineTo(x + 6.8, y + 9);
  ctx.stroke();
  // dizzy stars
  for (let k = 0; k < 3; k++) {
    const a = t / 380 + (k * Math.PI * 2) / 3;
    star(ctx, x - 16 + Math.cos(a) * 7, y - 2 + Math.sin(a) * 3, 2.4, "#ffd23f");
  }
  ctx.restore();
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}
