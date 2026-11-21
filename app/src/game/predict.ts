// Client-side prediction for your own robber.
//
// The server (sim.rs) moves you by an integer `step` once per tick while your last input is
// held. Your View comes back a network round trip later, so it always shows where you were
// ~200-400 ms ago. The old client stepped 7 px every 100 ms on a timer and then pulled itself
// 35 % of the way back toward that stale position on every update: the robber walked in
// jerks and was constantly dragged backwards ("slow", "delayed").
//
// This predictor:
//  - runs the exact integer `step` from map.ts (same as sim.rs) at the *measured* tick rate,
//    so it walks the same lattice of positions, and stops at walls where the server stops;
//  - draws between ticks by extrapolating toward the next step (smooth at any frame rate);
//  - reconciles by finding the position in its own recent history that the server's report
//    matches. A server that's merely behind matches exactly and causes no correction. Only a
//    real disagreement (dropped input, a meeting teleport) moves you, and the visual jump is
//    spread over ~120 ms.
import { GHOST_SPEED, SPEED, step } from "./map";

interface Sample { t: number; x: number; y: number }

export class Predictor {
  /** integer sim position (what the server will reach) */
  x = 0; y = 0;
  /** smoothed screen position */
  rx = 0; ry = 0;
  ready = false;
  private acc = 0;
  private dir = 0;
  private offX = 0; private offY = 0;
  private hist: Sample[] = [];
  private lastMoveAt = 0;
  private lastT = 0;
  // measured server tick rate (ticks / s)
  rate = 10;
  private rateRef: { tick: number; at: number } | null = null;

  reset(x: number, y: number, now: number) {
    this.x = x; this.y = y; this.rx = x; this.ry = y;
    this.offX = 0; this.offY = 0; this.acc = 0;
    this.hist = [{ t: now, x, y }];
    this.ready = true;
  }

  /** Feed every View the server sends. `live` = heist running (PLAY phase). */
  onServer(sx: number, sy: number, tick: number, live: boolean, now: number) {
    // tick rate from the View's own tick counter (the crank isn't always a perfect 10 Hz)
    const r = this.rateRef;
    if (!r || tick < r.tick || now - r.at > 4000) this.rateRef = { tick, at: now };
    else if (now - r.at > 1200 && tick > r.tick) {
      const measured = ((tick - r.tick) * 1000) / (now - r.at);
      this.rate = Math.max(3, Math.min(12, this.rate * 0.6 + measured * 0.4));
      this.rateRef = { tick, at: now };
    }

    if (!this.ready || !live) { this.reset(sx, sy, now); return; }

    // where were we when the server computed this? (a lagging server matches an old sample)
    let ex: number, ey: number;
    if (now - this.lastMoveAt > 800) {
      // we've been standing still long enough that the server must have caught up
      ex = sx - this.x; ey = sy - this.y;
    } else {
      let best = Infinity, bx = this.x, by = this.y;
      for (let i = this.hist.length - 1; i >= 0; i--) {
        const h = this.hist[i];
        if (now - h.t > 1000) break;
        const d = (h.x - sx) ** 2 + (h.y - sy) ** 2;
        if (d < best) { best = d; bx = h.x; by = h.y; if (d === 0) break; }
      }
      ex = sx - bx; ey = sy - by;
    }
    if (ex === 0 && ey === 0) return;
    if (ex * ex + ey * ey > 96 * 96) { this.reset(sx, sy, now); return; } // teleport (meeting, respawn)
    // shift the sim onto the server's lattice; keep the picture where it was and ease it over
    this.x += ex; this.y += ey;
    this.offX -= ex; this.offY -= ey;
    for (const h of this.hist) { h.x += ex; h.y += ey; }
  }

  /** Advance one frame with the direction you're holding right now. */
  frame(dir: number, alive: boolean, now: number) {
    if (!this.ready) return;
    // a stalled frame (GC, notification shade) still advances the walk, up to half a second
    const dt = this.lastT ? Math.min(0.5, Math.max(0, (now - this.lastT) / 1000)) : 0;
    this.lastT = now;
    const speed = alive ? SPEED : GHOST_SPEED;

    if (dir !== this.dir) {
      // changing direction drops the extrapolated part: hand it to the visual offset instead
      const [px, py] = this.extrap(this.dir, speed);
      const [nx, ny] = this.extrap(dir, speed);
      this.offX += px - nx; this.offY += py - ny;
      this.dir = dir;
    }

    this.acc += dt * this.rate;
    let moved = false;
    while (this.acc >= 1) {
      this.acc -= 1;
      const [nx, ny] = step(this.x, this.y, dir, speed);
      if (nx !== this.x || ny !== this.y) moved = true;
      this.x = nx; this.y = ny;
      this.hist.push({ t: now, x: nx, y: ny });
    }
    if (dir && moved) this.lastMoveAt = now;
    // keep ~1.2 s of history
    while (this.hist.length > 2 && now - this.hist[0].t > 1200) this.hist.shift();

    const k = Math.exp(-dt / 0.12);
    this.offX *= k; this.offY *= k;
    if (Math.abs(this.offX) < 0.05) this.offX = 0;
    if (Math.abs(this.offY) < 0.05) this.offY = 0;
    const [ex, ey] = this.extrap(dir, speed);
    this.rx = ex + this.offX;
    this.ry = ey + this.offY;
  }

  /** sim position plus the fraction of the next step already "walked" */
  private extrap(dir: number, speed: number): [number, number] {
    if (!dir) return [this.x, this.y];
    const [nx, ny] = step(this.x, this.y, dir, speed);
    return [this.x + (nx - this.x) * this.acc, this.y + (ny - this.y) * this.acc];
  }
}
