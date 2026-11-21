import { ReactNode, useEffect, useRef, useState } from "react";
import { drawIsland, HOTSPOTS, Hotspot, phaseName, placement } from "../game/island";
import { drawRobber } from "../game/sprites";
import { COLOR_NAMES, SEAT_COLORS } from "../game/render";
import { sfx } from "../game/sfx";
import Avatar from "./Avatar";

/*
 * Motion system (mirrors the reference site's tokens):
 *   ease  cubic-bezier(.2,.8,.2,1)  fast out, soft settle; one curve everywhere
 *   micro 140–160 ms  (press / hover)    medium 300–450 ms (lift / slide)    reveal 700 ms
 *   load: UI shell → sky fades in → headline types on → island rises from the clouds
 *   scroll: rise-in reveals with an 80 ms stagger; sticky scrubbers drive canvases
 */

/** A low-res canvas scaled up with nearest-neighbour: whole-number pixel size only. */
function PixelCanvas({ paint, className, px = 4, fitH, onEl }: {
  paint: (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void; className?: string; px?: number; fitH?: number; onEl?: (c: HTMLCanvasElement, k: () => number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  useEffect(() => {
    let raf = 0;
    let visible = true;
    const c = ref.current!;
    const kOf = () => (fitH ? Math.max(1, Math.floor(c.clientHeight / fitH)) : px);
    onEl?.(c, kOf);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(c);
    const frame = (t: number) => {
      if (visible) {
        const k = kOf();
        const w = Math.max(16, Math.round(c.clientWidth / k)), h = Math.max(16, Math.round(c.clientHeight / k));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const g = c.getContext("2d")!;
        g.imageSmoothingEnabled = false;
        paintRef.current(g, w, h, t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, fitH]);
  return <canvas ref={ref} className={`pixelcanvas ${className ?? ""}`} />;
}

/** Sticky-scrub progress (0..1) of a tall section. */
function useScrub(ref: React.RefObject<HTMLElement>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setP(Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - window.innerHeight))));
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, [ref]);
  return p;
}
const scrubTo = (el: HTMLElement | null, p: number) => {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: top + p * (el.offsetHeight - window.innerHeight), behavior: "auto" });
};

export interface LandingStats { tables: number; live: number; humans: number; tickRate: number | null; teeMs: number | null }

interface Props {
  stats: LandingStats;
  enclave: "checking" | "verified" | "unverified";
  onPlayFree: () => void;
  onHow: () => void;
  busy: boolean;
  name: string;
  setName: (s: string) => void;
  walletButton: ReactNode;
  muteButton: ReactNode;
  freeTables: ReactNode;
  stakedTables: ReactNode;
  stakedNote?: ReactNode;
}

const nowDayT = () => { const d = new Date(); return (d.getHours() + d.getMinutes() / 60) / 24; };
const HEADLINE = "Trust no one";

export default function Landing(p: Props) {
  // the island's clock: starts at your local time; one in-world day every 3 minutes
  const [dayT, setDayT] = useState(nowDayT);
  const [paused, setPaused] = useState(false);
  const dayRef = useRef(dayT);
  dayRef.current = dayT;
  useEffect(() => {
    if (paused) return;
    let last = performance.now(), raf = 0;
    const step = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setDayT((d) => (d + dt / 180) % 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paused]);
  const hours = Math.floor(dayT * 24), mins = Math.floor((dayT * 24 * 60) % 60);
  const clock = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  const dark = dayT < 0.23 || dayT > 0.79;

  // load choreography: the island rises 400 ms after mount, over 1.6 s
  const mountT = useRef(performance.now());

  // hover the bank: every building is a page
  const [spot, setSpot] = useState<string | null>(null);
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const [tip, setTip] = useState<{ s: Hotspot; x: number; y: number } | null>(null);
  const heroCanvas = useRef<{ c: HTMLCanvasElement; k: () => number } | null>(null);
  const tipFor = (id: string | null) => {
    const h = heroCanvas.current;
    const s = HOTSPOTS.find((x) => x.id === id);
    if (!h || !s) { setTip(null); return; }
    const pl = placement.get(h.c.getContext("2d")!);
    if (!pl) return;
    const k = h.k();
    setTip({ s, x: (pl.sx + (s.box[0] + s.box[2]) / 2) * k, y: (pl.sy + s.box[1]) * k });
  };
  const hover = (id: string | null) => { if (id !== spotRef.current) { setSpot(id); tipFor(id); if (id) sfx.click(); } };
  const onHeroMove = (e: React.MouseEvent) => {
    const h = heroCanvas.current;
    if (!h) return;
    const pl = placement.get(h.c.getContext("2d")!);
    if (!pl) return;
    const r = h.c.getBoundingClientRect();
    const k = h.k();
    const x = (e.clientX - r.left) / k - pl.sx, y = (e.clientY - r.top) / k - pl.sy;
    const hit = HOTSPOTS.find((s) => x >= s.box[0] && x <= s.box[2] && y >= s.box[1] && y <= s.box[3]);
    hover(hit?.id ?? null);
  };
  const go = (href: string) => document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });

  // nav goes solid once you leave the sky
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 60);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // rise-in reveals with stagger
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".landing [data-reveal]");
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing">
      {/* ---------------- nav */}
      <nav className={`lp-nav ${scrolled ? "solid" : ""}`}>
        <a className="lp-logo" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}><span className="sq" /> Inside Job</a>
        <div className="lp-links">
          <a href="#how" className="pbtn dark">How it works</a>
          <a href="#clock" className="pbtn dark">The heist</a>
          <a href="#tables" className="pbtn dark">Tables</a>
          {p.walletButton}
          {p.muteButton}
          <button className="pbtn gold" onClick={p.onPlayFree} disabled={p.busy}>{p.busy ? "Joining…" : "Play free"}</button>
        </div>
      </nav>

      {/* ---------------- hero */}
      <section className="lp-hero" id="top" onMouseMove={onHeroMove} onMouseLeave={() => hover(null)} onClick={() => spot && go(HOTSPOTS.find((s) => s.id === spot)!.href)} style={{ cursor: spot ? "pointer" : undefined }}>
        <PixelCanvas
          className="lp-sky"
          fitH={300}
          onEl={(c, k) => { heroCanvas.current = { c, k }; }}
          paint={(g, w, h, t) => drawIsland(g, w, h, { t, dayT: dayRef.current, intro: (t - mountT.current - 400) / 1600, highlight: spotRef.current })}
        />
        <h1 className={`lp-headline ${dark ? "on-dark" : ""}`} aria-label={`${HEADLINE}.`}>
          {HEADLINE.split("").map((ch, i) => <span key={i} className="ch" style={{ animationDelay: `${700 + i * 60}ms` }}>{ch === " " ? " " : ch}</span>)}
          <span className="ch dot" style={{ animationDelay: `${700 + HEADLINE.length * 60 + 120}ms` }}>.</span>
        </h1>

        {tip && (
          <div className="lp-tip" style={{ left: tip.x, top: tip.y }} key={tip.s.id}>
            <b>{tip.s.title}</b>
            <span>{tip.s.text}</span>
            <em>{tip.s.kicker} · CLICK TO ENTER ›</em>
          </div>
        )}

        <div className="lp-card intro-left" onMouseMove={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="lp-tag"><span className={`led ${p.enclave}`} /> {p.enclave === "verified" ? "LIVE ON SOLANA DEVNET · ENCLAVE VERIFIED" : "LIVE ON SOLANA DEVNET · MAGICBLOCK TEE"}</div>
          <h2>A real-time heist where one of you is the Mole.</h2>
          <p>Sneak through the bank, crack the vault, vote out the traitor. Every move is a Solana transaction sealed inside a MagicBlock Private Ephemeral Rollup.</p>
          <div className="lp-name">
            <input maxLength={12} placeholder="CODENAME" value={p.name} onChange={(e) => p.setName(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && p.onPlayFree()} />
          </div>
          <div className="lp-ctas">
            <button className="pbtn gold big" onClick={p.onPlayFree} disabled={p.busy}>{p.busy ? "Joining…" : "Play free"} <span>›</span></button>
            <a className="pbtn dark big" href="#stakes">High stakes <span>›</span></a>
          </div>
          <div className="lp-rule" />
          <div className="lp-mini">HOVER THE BANK · EVERY BUILDING IS A PAGE</div>
          <div className="lp-chips">
            {HOTSPOTS.map((s) => (
              <button key={s.id} className={`chipbtn ${spot === s.id ? "on" : spot ? "dim" : ""}`} onMouseEnter={() => hover(s.id)} onMouseLeave={() => hover(null)} onClick={() => go(s.href)}>{s.title.replace("The ", "")}</button>
            ))}
          </div>
        </div>

        <div className="lp-clock intro-right" onMouseMove={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="lp-clock-top">
            <span className="time">{clock}</span>
            <span className="ph">{phaseName(dayT)}</span>
            <button className="pbtn gold tiny" onClick={() => setPaused((x) => !x)}>{paused ? "▶ PLAY" : "❚❚ PAUSE"}</button>
          </div>
          <div className="lp-dayline" onPointerDown={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            el.setPointerCapture(e.pointerId);
            const set = (cx: number) => { const r = el.getBoundingClientRect(); setDayT(Math.max(0, Math.min(0.999, (cx - r.left) / r.width))); };
            set(e.clientX);
            el.onpointermove = (ev) => set(ev.clientX);
            el.onpointerup = () => { el.onpointermove = null; };
          }}>
            <div className="marker" style={{ left: `${dayT * 100}%` }} />
          </div>
          <div className="lp-daylabels"><span>NIGHT</span><span>DAWN</span><span>NOON</span><span>DUSK</span><span>NIGHT</span></div>
          <div className="lp-live"><span className="led verified" /> {p.stats.live} heist{p.stats.live === 1 ? "" : "s"} live · {p.stats.humans} agent{p.stats.humans === 1 ? "" : "s"} in the field</div>
        </div>
      </section>

      {/* ---------------- marquee */}
      <section className="lp-marquee" aria-label="Built with">
        <div className="lp-kicker" data-reveal>SEALED, DEALT AND PAID OUT WITH</div>
        <Marquee items={["MagicBlock Private Ephemeral Rollup", "Intel TDX", "VRF", "10 Hz Crank", "Magic Actions", "Session Keys"]} />
        <Marquee items={["Solana Devnet", "Zero-reader World", "Sealed ballots", "No oracle", "No house cut", "Lights on"]} outline reverse />
      </section>

      {/* ---------------- stats */}
      <Stats stats={p.stats} />

      {/* ---------------- 01 the roles */}
      <section className="lp-section" id="how">
        <div className="lp-sechead" data-reveal>
          <div>
            <div className="lp-kicker">01 · HOW A HEIST GOES</div>
            <h2 className="lp-h2">Four ways to get caught.</h2>
          </div>
          <p>4–8 agents, one or two of them the Mole. Real-time, top-down, about five minutes a heist. Empty seats are on-chain bots that obey the same fog.</p>
        </div>
        <div className="lp-cards">
          <RoleCard i={0} title="Crack the vault" tag="CREW" text="Sneak to your stations and work them. Fill the vault bar before the time lock runs out." scene="crew" />
          <RoleCard i={1} title="Cuff in the dark" tag="MOLE" text="Look like everyone else. Cuff the crew when nobody's watching, fake your tasks, survive the vote." scene="mole" />
          <RoleCard i={2} title="Call a meeting" tag="REPORT" text="Find someone in cuffs, or hit the alarm. Argue it out, then cast a sealed ballot." scene="meeting" />
          <RoleCard i={3} title="Lights on" tag="VERIFY" text="When it ends, everything flips public and your browser replays the deal to prove nobody rigged it." scene="lights" />
        </div>
      </section>

      {/* ---------------- 02 under the hood: exploded island */}
      <LayerSection dayT={dayT} />

      {/* ---------------- 03 the heist clock */}
      <HeistClock />

      {/* ---------------- 04 sealed vs lights on */}
      <SealedSlider />

      {/* ---------------- 05 the crew (sprite viewer) */}
      <SpriteViewer />

      {/* ---------------- 06 briefing (dialogue box) */}
      <Briefing />

      {/* ---------------- 07 tables */}
      <section className="lp-section" id="tables">
        <div className="lp-sechead" data-reveal>
          <div>
            <div className="lp-kicker">07 · PICK A TABLE</div>
            <h2 className="lp-h2">Free crews.</h2>
          </div>
          <p>Guest play: your browser makes a session key that signs ~10 moves a second, gasless. Bots fill the empty seats.</p>
        </div>
        <div data-reveal>{p.freeTables}</div>
        <div className="lp-sechead" id="stakes" style={{ marginTop: 56 }} data-reveal>
          <div>
            <div className="lp-kicker gold">08 · HIGH STAKES · DEVNET SOL</div>
            <h2 className="lp-h2">Winners split the pot.</h2>
          </div>
          <p>Buy a ticket on Solana, play sealed in the TEE. At lights-on the rollup commits the result and a Magic Action pays the winners. No oracle, no house cut, and anyone can refund a stuck pot.</p>
        </div>
        <div data-reveal>{p.stakedTables}</div>
        {p.stakedNote}
      </section>

      {/* ---------------- 09 proof */}
      <section className="lp-section" id="proof">
        <div className="lp-sechead" data-reveal>
          <div>
            <div className="lp-kicker">09 · VERIFIED ON DEVNET</div>
            <h2 className="lp-h2">Don't trust us. Check.</h2>
          </div>
          <p>Every claim on this page is a test we run against the live MagicBlock TEE and Solana devnet. Inside a game, the 🔒 panel lets you try to read the sealed accounts yourself.</p>
        </div>
        <ProofTerm />
      </section>

      {/* ---------------- footer */}
      <section className="lp-cta" data-reveal>
        <PixelCanvas className="lp-cta-art" px={3} paint={(g, w, h, t) => drawCampfire(g, w, h, t)} />
        <div>
          <h2>Pull up a crate. The crew's waiting.</h2>
          <div className="lp-ctas">
            <button className="pbtn gold big" onClick={p.onPlayFree} disabled={p.busy}>Play free <span>›</span></button>
            <button className="pbtn dark big" onClick={p.onHow}>How to play <span>›</span></button>
          </div>
        </div>
      </section>
      <div className="lp-wordmark" aria-hidden>INSIDE JOB</div>
      <footer className="lp-foot">
        <span><span className="sq" /> INSIDE JOB · built for MagicBlock Solana Blitz v10</span>
        <span>EVERY PIXEL ON THIS PAGE IS DRAWN IN CODE · SEALED IN A TEE</span>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ marquee

function Marquee({ items, outline, reverse }: { items: string[]; outline?: boolean; reverse?: boolean }) {
  const dots = ["#ffd95a", "#3ddc97", "#ff9f43", "#4dabff"];
  const row = (pre: string) => items.flatMap((s, i) => [
    <span key={`${pre}t${i}`} className="mq-t">{s}</span>,
    <span key={`${pre}d${i}`} className="mq-d" style={{ background: dots[i % dots.length] }} />,
  ]);
  return (
    <div className={`lp-mq ${outline ? "outline" : ""} ${reverse ? "rev" : ""}`}>
      <div className="mq-track">{row("a")}<span className="mq-copy" aria-hidden>{row("b")}</span></div>
    </div>
  );
}

// ------------------------------------------------------------------ stats: count-up + cycling progress

function useInView<T extends HTMLElement>(ref: React.RefObject<T>, threshold = 0.3) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return seen;
}

function CountUp({ to, suffix = "", run }: { to: number; suffix?: string; run: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return <>{v.toLocaleString()}{suffix}</>;
}

function Stats({ stats }: { stats: LandingStats }) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref);
  const [active, setActive] = useState(0);
  useEffect(() => { const t = setInterval(() => setActive((a) => (a + 1) % 4), 2800); return () => clearInterval(t); }, []);
  const items: [number, string, string][] = [
    [Math.round(stats.tickRate ?? 10), " Hz", "the crank ticks every heist inside the enclave"],
    [0, "", "accounts can read the World: every role, position and body"],
    [stats.teeMs ?? 150, " ms", "round trip from your browser to the TEE rollup"],
    [stats.tables, "", "tables live on devnet right now"],
  ];
  return (
    <section className="lp-stats" ref={ref}>
      {items.map(([n, suf, lbl], i) => (
        <div key={lbl} className={`lp-stat ${active === i ? "active" : ""}`} data-reveal style={{ ["--i" as any]: i }} onMouseEnter={() => setActive(i)}>
          <div className="bar"><i key={active === i ? "on" : "off"} /></div>
          <div className="big"><CountUp to={n} suffix={suf} run={seen} /></div>
          <div className="lbl">{lbl}</div>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ role cards

function RoleCard({ i, title, tag, text, scene }: { i: number; title: string; tag: string; text: string; scene: "crew" | "mole" | "meeting" | "lights" }) {
  return (
    <div className="lp-rcard" data-reveal style={{ ["--i" as any]: i }}>
      <PixelCanvas className="lp-rart" px={3} paint={(g, w, h, t) => drawScene(g, w, h, t, scene)} />
      <div className="lp-rbody">
        <div className="lp-kicker small">{tag}</div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </div>
  );
}

function drawScene(g: CanvasRenderingContext2D, w: number, h: number, t: number, scene: string) {
  const bg: Record<string, [string, string]> = { crew: ["#1d2a40", "#2a3d5c"], mole: ["#1a1020", "#2a1830"], meeting: ["#3a1424", "#5a1e34"], lights: ["#2a2208", "#4a3c10"] };
  const [a, b] = bg[scene];
  g.fillStyle = a;
  g.fillRect(0, 0, w, h);
  g.fillStyle = b;
  for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 0 : 8; x < w; x += 16) g.fillRect(x, y, 8, 8);
  const cy = Math.round(h * 0.62);
  const s = Math.max(1, Math.min(2.2, h / 46));
  if (scene === "crew") {
    g.fillStyle = "#2a3346"; g.fillRect(Math.round(w * 0.58), cy - 14, 18, 14);
    g.fillStyle = Math.sin(t / 200) > 0 ? "#ffd23f" : "#c9a227"; g.fillRect(Math.round(w * 0.58) + 3, cy - 11, 12, 5);
    drawRobber(g, Math.round(w * 0.38), cy, { color: SEAT_COLORS[2], t, scale: s, facing: 1 });
    g.fillStyle = "#3ddc97";
    g.fillRect(Math.round(w * 0.2), 6, Math.round(((t / 40) % 30) * (w * 0.6) / 30), 3);
  } else if (scene === "mole") {
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, 0, w, h);
    drawRobber(g, Math.round(w * 0.3 + Math.sin(t / 900) * w * 0.08), cy, { color: SEAT_COLORS[0], t, scale: s, mole: true, moving: true, walk: t / 90 });
    drawRobber(g, Math.round(w * 0.7), cy, { color: SEAT_COLORS[1], t: t + 300, scale: s, facing: -1 });
  } else if (scene === "meeting") {
    for (let k = 0; k < 4; k++) drawRobber(g, Math.round(w * (0.18 + k * 0.21)), cy + (k % 2) * 3, { color: SEAT_COLORS[(k * 2) % 8], t: t + k * 400, scale: s * 0.85, facing: k < 2 ? 1 : -1 });
    if (Math.floor(t / 500) % 2) { g.fillStyle = "#ff4d6d"; g.fillRect(Math.round(w / 2) - 2, 4, 5, 9); g.fillRect(Math.round(w / 2) - 2, 15, 5, 4); }
  } else {
    const glow = 0.5 + 0.5 * Math.sin(t / 400);
    g.fillStyle = `rgba(255,220,120,${0.15 + glow * 0.15})`; g.fillRect(0, 0, w, h);
    drawRobber(g, Math.round(w * 0.35), cy, { color: SEAT_COLORS[3], t, scale: s });
    drawRobber(g, Math.round(w * 0.65), cy, { color: SEAT_COLORS[5], t: t + 500, scale: s, mole: true, facing: -1 });
    for (let k = 0; k < 8; k++) { g.fillStyle = "#ffd23f"; g.fillRect(Math.round((k * 37 + t / 20) % w), Math.round((k * 23 + t / 14) % h), 2, 2); }
  }
}

// ------------------------------------------------------------------ 02 layers

const LAYERS: [string, string, string][] = [
  ["Towers & roofs", "THE ROOM · PUBLIC", "The lobby, chat, the crew-wide task bar and the votes once they flip. Everyone can read it, spectators included."],
  ["Streets & walls", "YOUR VIEW · ONE READER", "What your light reveals this tick, computed inside the enclave. Only your session key and wallet can read it."],
  ["Ground & water", "THE WORLD · ZERO READERS", "Every role, true position, body, ballot and salt. Its permission has no members: nobody can read it until lights-on."],
  ["Rock & roots", "THE POT · SOLANA", "Stakes and payouts live on Solana. The rollup commits the result and a Magic Action pays from it."],
];

function LayerSection({ dayT }: { dayT: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const prog = useScrub(ref as React.RefObject<HTMLElement>);
  const explode = Math.min(1, prog * 1.6);
  const active = prog < 0.12 ? -1 : Math.min(3, Math.floor((prog - 0.12) / 0.22));
  return (
    <section className="lp-layers" id="hood" ref={ref}>
      <div className="lp-sticky">
        <div className="lp-lcopy">
          <div className="lp-kicker">02 · UNDER THE HOOD</div>
          <h2 className="lp-h2">Every heist is sealed in layers.</h2>
          <p>The bank, taken apart. Scroll to lift each layer off the one below: who can read it, and where it lives.</p>
          <div className="lp-llist">
            {LAYERS.map(([t, k, d], i) => (
              <div key={t} className={`lp-litem ${active === i ? "on" : ""}`} onClick={() => scrubTo(ref.current, 0.14 + i * 0.22)}>
                <span className="n">0{i + 1}</span>
                <div>
                  <b>{t}</b>
                  <div className="k">{k}</div>
                  <p className="desc">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-lart">
          <PixelCanvas className="lp-island" fitH={480} paint={(g, w, h, t) => drawIsland(g, w, h, { t, dayT: Math.max(0.42, Math.min(0.6, dayT)), explode, active: active < 0 ? undefined : active, showSky: false })} />
          <div className="lp-llabels" style={{ opacity: explode }}>
            {LAYERS.map(([, k], i) => <div key={k} className={active === i ? "on" : ""} style={{ top: `${[16, 34, 54, 74][i]}%` }}><span className="line" /> {k}</div>)}
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 03 the heist clock (scroll-scrubbed dial)

const EVENTS = [
  { at: 0.0, t: "00:00", title: "Lobby", label: "LOBBY", text: "Agents sit down with in-browser session keys. Bots fill the empty seats." },
  { at: 0.08, t: "00:05", title: "The deal", label: "DEALING", text: "MagicBlock VRF ⊕ every sealed salt. Your role lands in your View, and only there." },
  { at: 0.2, t: "00:08", title: "The heist", label: "HEIST", text: "The crank ticks ten times a second. You see only what your light reveals." },
  { at: 0.48, t: "04:30", title: "Body found", label: "MEETING", text: "Someone's in cuffs. 45 seconds to argue, chat on-chain." },
  { at: 0.64, t: "05:15", title: "Ballots flip", label: "VERDICT", text: "Every sealed vote publishes at once. No bandwagons, no peeking." },
  { at: 0.84, t: "09:00", title: "Lights on", label: "LIGHTS ON", text: "The World goes public, your browser verifies the deal, the Pot pays out." },
];
const HEIST_SECS = 570;

function HeistClock() {
  const ref = useRef<HTMLElement>(null);
  const p = useScrub(ref);
  const pRef = useRef(p);
  pRef.current = p;
  const secs = Math.round(p * HEIST_SECS);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
  const idx = EVENTS.reduce((a, e, i) => (p >= e.at ? i : a), 0);
  const ang = p * Math.PI * 2 - Math.PI / 2;
  const R = 46; // % of the dial box
  const dial = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (cx: number, cy: number) => {
      const r = dial.current!.getBoundingClientRect();
      let a = Math.atan2(cy - (r.top + r.height / 2), cx - (r.left + r.width / 2)) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      scrubTo(ref.current, Math.min(0.999, a / (Math.PI * 2)));
    };
    el.onpointermove = (ev) => move(ev.clientX, ev.clientY);
    el.onpointerup = () => { el.onpointermove = null; };
  };
  return (
    <section className="lp-clocksec" id="clock" ref={ref}>
      <div className="lp-sticky clockgrid">
        <div className="cl-left">
          <div className="lp-kicker">03 · A HEIST, MINUTE BY MINUTE</div>
          <h2 className="lp-h2 sm">Same bank, every second.</h2>
          <p>Scroll to run the heist, or drag the sun around the dial. Every phase below is a real state the program moves through, ticked inside the enclave.</p>
          <div className="cl-label">{EVENTS[idx].label}</div>
          <div className="cl-digits">{mm}:{ss}</div>
        </div>
        <div className="cl-dial" ref={dial}>
          <div className="cl-face">
            <PixelCanvas className="cl-scene" fitH={300} paint={(g, w, h, t) => drawIsland(g, w, h, { t, dayT: 0.5 + pRef.current * 0.46, topFrac: 0.1 })} />
          </div>
          <svg className="cl-ring" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r={R} fill="none" stroke="#fff1cf" strokeWidth="0.8" />
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i / 24) * Math.PI * 2;
              const r1 = R + 3, r2 = R + (i % 6 === 0 ? 5.5 : 4);
              return <line key={i} x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1} x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2} stroke={i % 6 === 0 ? "#fff1cf" : "#5a5488"} strokeWidth={i % 6 === 0 ? 1.2 : 0.8} />;
            })}
            {["00:00", "02:22", "04:45", "07:07"].map((l, i) => {
              const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
              return <text key={l} x={50 + Math.cos(a) * (R + 9)} y={50 + Math.sin(a) * (R + 9) + 1.2} textAnchor="middle" className="cl-tick">{l}</text>;
            })}
          </svg>
          <button className="cl-knob" style={{ left: `${50 + Math.cos(ang) * R}%`, top: `${50 + Math.sin(ang) * R}%` }} onPointerDown={drag} aria-label="drag the sun" />
          <div className="cl-progress"><i style={{ width: `${p * 100}%` }} /></div>
          <div className="cl-hint">SCROLL TO RUN THE HEIST · DRAG THE SUN</div>
        </div>
        <div className="cl-list">
          {EVENTS.map((e, i) => (
            <div key={e.t} className={`cl-item ${i === idx ? "on" : ""}`} onClick={() => scrubTo(ref.current, e.at + 0.01)}>
              <span className="t">{e.t}</span>
              <div><b>{e.title}</b>{i === idx && <p>{e.text}</p>}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 04 sealed vs lights on (drag divider)

function SealedSlider() {
  const [x, setX] = useState(0.5);
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box, 0.4);
  const dragged = useRef(false);
  useEffect(() => {
    if (!seen || dragged.current) return;
    // first view: sweep the divider so people discover it
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1800);
      setX(0.5 - 0.38 * Math.sin(k * Math.PI));
      if (k < 1 && !dragged.current) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [seen]);
  const onDown = (e: React.PointerEvent) => {
    dragged.current = true;
    const el = box.current!;
    el.setPointerCapture(e.pointerId);
    const set = (cx: number) => { const r = el.getBoundingClientRect(); setX(Math.max(0.02, Math.min(0.98, (cx - r.left) / r.width))); };
    set(e.clientX);
    el.onpointermove = (ev) => set(ev.clientX);
    el.onpointerup = () => { el.onpointermove = null; };
  };
  const step = x < 0.34 ? 2 : x < 0.67 ? 1 : 0;
  const steps: [string, string, string][] = [
    ["01", "Sealed", "What any RPC sees of the World: nothing. Zero readers, not even us."],
    ["02", "Your light", "Your View: the room you're in, the crew in it, bodies in sight. Nothing else."],
    ["03", "Lights on", "Game over: everything flips public and the deal replays in your browser."],
  ];
  return (
    <section className="lp-section" id="sealed">
      <div className="lp-sechead" data-reveal>
        <div>
          <div className="lp-kicker">04 · FROM SEALED TO LIGHTS ON</div>
          <h2 className="lp-h2">Same heist. Three ways to look.</h2>
        </div>
        <p>Drag the divider. Left is what the chain shows a stranger while the heist runs; right is the same bank after lights-on.</p>
      </div>
      <div className="ss-box" ref={box} onPointerDown={onDown} data-reveal>
        <PixelCanvas className="ss-art" fitH={300} paint={(g, w, h, t) => drawIsland(g, w, h, { t, dayT: 0.56, topFrac: 0.08 })} />
        <div className="ss-fog" style={{ clipPath: `inset(0 ${Math.max(0, 100 - x * 100 - 22)}% 0 0)` }} />
        <div className="ss-sealed" style={{ clipPath: `inset(0 ${100 - x * 100}% 0 0)`, opacity: 1 }}>
          <div className="ss-noise" />
          <div className="ss-label"><span>🔒</span> SEALED · 0 READERS</div>
        </div>
        <div className="ss-div" style={{ left: `${x * 100}%` }}><span className="ss-handle">◂▸</span></div>
      </div>
      <div className="ss-steps">
        {steps.map(([n, t, d], i) => (
          <div key={n} className={`ss-step ${step === i ? "on" : ""}`} onClick={() => { dragged.current = true; setX([0.92, 0.5, 0.12][i]); }}>
            <div className="bar" />
            <b><span>{n}</span> {t}</b>
            <p>{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 05 the crew: sprite viewer

function SpriteViewer() {
  const [seat, setSeat] = useState(1);
  const [fps, setFps] = useState(8);
  const [paused, setPaused] = useState(false);
  const [mole, setMole] = useState(false);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (paused) return;
    const iv = setInterval(() => setFrame((f) => (f + 1) % 4), 1000 / fps);
    return () => clearInterval(iv);
  }, [fps, paused]);
  const st = useRef({ seat, frame, mole });
  st.current = { seat, frame, mole };
  return (
    <section className="lp-section" id="crew">
      <div className="lp-sechead" data-reveal>
        <div>
          <div className="lp-kicker">05 · THE CREW</div>
          <h2 className="lp-h2">Pick your colour.</h2>
        </div>
        <p>Eight seats, eight colours, one walk cycle drawn in code. Nobody's sprite gives the Mole away: the red eyes only show in your own View.</p>
      </div>
      <div className="sv" data-reveal>
        <div className="sv-stage">
          <PixelCanvas className="sv-big" px={6} paint={(g, w, h, t) => {
            g.fillStyle = "#1d1a38"; g.fillRect(0, 0, w, h);
            const grd = Math.round(h * 0.78);
            for (let x = 0; x < w; x += 4) { g.fillStyle = (x / 4) % 2 ? "#26224a" : "#221e42"; g.fillRect(x, grd, 4, h - grd); }
            const { seat: s, frame: f, mole: m } = st.current;
            drawRobber(g, Math.round(w / 2), grd - 6, { color: SEAT_COLORS[s], moving: true, walk: f * (Math.PI / 2), t, mole: m, scale: Math.max(1, h / 34) });
          }} />
        </div>
        <div className="sv-side">
          <div className="sv-row">
            <span className="lp-kicker small">WALK CYCLE · 4 FRAMES</span>
            <button className="pbtn tiny dark" onClick={() => setPaused((x) => !x)}>{paused ? "▶ PLAY" : "❚❚ PAUSE"}</button>
          </div>
          <div className="sv-frames">
            {[0, 1, 2, 3].map((k) => (
              <button key={k} className={`sv-frame ${frame === k ? "on" : ""}`} onClick={() => { setPaused(true); setFrame(k); }}>
                <PixelCanvas px={3} paint={(g, w, h) => {
                  g.clearRect(0, 0, w, h);
                  drawRobber(g, Math.round(w / 2), Math.round(h * 0.68), { color: SEAT_COLORS[st.current.seat], moving: true, walk: k * (Math.PI / 2), t: 0, mole: st.current.mole, scale: Math.max(1, h / 40) });
                }} />
              </button>
            ))}
          </div>
          <div className="sv-ctrl">
            <div>
              <span className="lp-kicker small">FRAME RATE</span>
              <div className="sv-chips">{[4, 8, 12].map((f) => <button key={f} className={`chipbtn ${fps === f ? "on" : ""}`} onClick={() => { setFps(f); setPaused(false); }}>{f} FPS</button>)}</div>
            </div>
            <div>
              <span className="lp-kicker small">SEAT COLOUR</span>
              <div className="sv-chips">{SEAT_COLORS.map((c, i) => (
                <button key={c} className={`chipbtn sw ${seat === i ? "on" : ""}`} onClick={() => setSeat(i)} title={COLOR_NAMES[i]}><i style={{ background: c }} />{COLOR_NAMES[i]}</button>
              ))}</div>
            </div>
            <div>
              <span className="lp-kicker small">WHAT YOUR VIEW SHOWS</span>
              <div className="sv-chips">
                <button className={`chipbtn ${!mole ? "on" : ""}`} onClick={() => setMole(false)}>Crew eyes</button>
                <button className={`chipbtn ${mole ? "on mole" : ""}`} onClick={() => setMole(true)}>Mole eyes (only you)</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 06 briefing: RPG dialogue box

const LINES = [
  { seat: 1, name: "LOCKPICK", role: "CREW · SEAT 2", text: "Psst. One of us is working for the other side. Nobody knows who: not us, not the chain, not even the dealer." },
  { seat: 2, name: "GHOSTWIRE", role: "CREW · SEAT 3", text: "Follow the yellow arrows to your stations and press E. Fill the vault bar before the time lock runs out." },
  { seat: 0, name: "VAULTBOT", role: "BOT · SEAT 1", text: "Find someone in cuffs? Hit R and we talk. Ballots stay sealed until everyone's voted, so no bandwagons." },
  { seat: 3, name: "SAFECRACK", role: "CREW · SEAT 4", text: "When the lights come on, the whole World goes public. Check the deal yourself. Nobody can rig it." },
  { seat: 5, name: "KEYRING", role: "??? · SEAT 6", text: "Me? I'm just here for the vault. Definitely not cuffing anyone in the dark. Definitely." },
];

function Briefing() {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.4);
  const line = LINES[i];
  useEffect(() => {
    if (!seen) return;
    setN(0);
    const iv = setInterval(() => setN((x) => {
      if (x >= line.text.length) { clearInterval(iv); return x; }
      if (x % 3 === 0) sfx.taskTick();
      return x + 1;
    }), 28);
    return () => clearInterval(iv);
  }, [i, seen, line.text.length]);
  const next = () => {
    if (n < line.text.length) setN(line.text.length);
    else setI((x) => (x + 1) % LINES.length);
  };
  return (
    <section className="lp-section" id="briefing">
      <div className="lp-sechead" data-reveal>
        <div>
          <div className="lp-kicker">06 · THE BRIEFING</div>
          <h2 className="lp-h2">What the crew says.</h2>
        </div>
      </div>
      <div className="dlg" ref={ref} onClick={next} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && next()} data-reveal>
        <div className="dlg-portrait"><Avatar seat={line.seat} size={112} animate mole={line.role.startsWith("???") && n >= line.text.length} /></div>
        <div className="dlg-body">
          <div className="dlg-name"><b style={{ color: SEAT_COLORS[line.seat] }}>{line.name}</b> <span>{line.role}</span></div>
          <p>{line.text.slice(0, n)}<span className="dlg-caret">{n >= line.text.length ? "▼" : "▌"}</span></p>
        </div>
      </div>
      <div className="dlg-thumbs">
        {LINES.map((l, k) => (
          <button key={k} className={`dlg-thumb ${k === i ? "on" : ""}`} onClick={() => setI(k)}><Avatar seat={l.seat} size={40} /></button>
        ))}
        <span className="lp-kicker small muted">CLICK THE BOX TO CONTINUE</span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ proof terminal (types on when seen)

const PROOF = [
  "stranger with a valid token is refused my View",
  "a seated player is refused the sealed World too",
  "VRF callback dealt the roles · 290 ms",
  "crank ticks the heist inside the TEE · 10.3 ticks/s",
  "seed = sha256(vrf ‖ salts ‖ room ‖ heist)",
  "a session key the ticket didn't name is refused a seat",
  "lights-on committed the Room; the Magic Action settled the Pot · 1.5 s",
  "conservation: payouts == stake × tickets",
];
function ProofTerm() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.3);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!seen) return;
    const iv = setInterval(() => setK((x) => (x >= PROOF.length ? x : x + 1)), 220);
    return () => clearInterval(iv);
  }, [seen]);
  return (
    <div className="lp-term" ref={ref}>
      <div className="mono muted">$ npx tsx scripts/e2e.ts 14 && npx tsx scripts/e2e-stake.ts 21</div>
      {PROOF.slice(0, k).map((l) => <div key={l} className="tline"><span className="pass">PASS</span> {l}</div>)}
      {k < PROOF.length && <div className="tline"><span className="dlg-caret">▌</span></div>}
    </div>
  );
}

// ------------------------------------------------------------------ footer campfire

function drawCampfire(g: CanvasRenderingContext2D, w: number, h: number, t: number) {
  for (let y = 0; y < h; y++) { g.fillStyle = `rgb(${12 + y / 6},${12 + y / 8},${36 + y / 3})`; g.fillRect(0, y, w, 1); }
  for (let k = 0; k < 40; k++) { if ((k + Math.floor(t / 700)) % 7) { g.fillStyle = "#cfd6ff"; g.fillRect((k * 53) % w, (k * 29) % Math.round(h * 0.55), 1, 1); } }
  const mx = Math.round(w * 0.78), my = Math.round(h * 0.22);
  g.fillStyle = "#fff1cf"; for (let yy = -5; yy <= 5; yy++) { const s = Math.floor(Math.sqrt(25 - yy * yy)); g.fillRect(mx - s, my + yy, s * 2 + 1, 1); }
  g.fillStyle = "#16132e"; for (let yy = -5; yy <= 5; yy++) { const s = Math.floor(Math.sqrt(25 - yy * yy)); g.fillRect(mx + 3 - s, my - 2 + yy, s * 2 + 1, 1); }
  const gy = Math.round(h * 0.8);
  g.fillStyle = "#1d2a22"; g.fillRect(0, gy, w, h - gy);
  g.fillStyle = "#2a3d2c"; for (let x = 0; x < w; x += 3) g.fillRect(x, gy, 2, 1);
  const fx = Math.round(w * 0.5), fy = gy - 2;
  const glow = 0.25 + 0.08 * Math.sin(t / 120);
  g.fillStyle = `rgba(255,160,60,${glow})`;
  for (let yy = -16; yy <= 6; yy++) { const s = Math.floor(Math.sqrt(Math.max(0, 300 - yy * yy * 1.2))); g.fillRect(fx - s, fy + yy, s * 2, 1); }
  g.fillStyle = "#6a4220"; g.fillRect(fx - 7, fy, 14, 2);
  for (let k = 0; k < 7; k++) {
    const life = (t / 500 + k / 7) % 1;
    g.fillStyle = life < 0.4 ? "#ffe27a" : life < 0.7 ? "#ff9f43" : "#ff4d6d";
    g.fillRect(fx - 3 + ((k * 5) % 7) + Math.round(Math.sin(t / 90 + k)), fy - 1 - Math.round(life * 9), 2, 2);
  }
  drawRobber(g, fx - 18, gy - 4, { color: SEAT_COLORS[3], t, scale: 0.6, facing: 1 });
  drawRobber(g, fx + 18, gy - 4, { color: SEAT_COLORS[1], t: t + 400, scale: 0.6, facing: -1 });
}
