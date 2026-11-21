import { useState } from "react";
import { GameClient, roomPda, viewPda, worldPda } from "../chain/client";
import { RoomState } from "../chain/decode";
import { VerifyReport } from "../chain/verify";
import { SEAT_COLORS } from "../game/render";
import { trackEvent } from "../analytics";

/** Ask the TEE, with your own valid token, for accounts you shouldn't be able to read. */
export function CheatConsole({ client, roomId, seat }: { client: GameClient; roomId: number; seat: number }) {
  const [out, setOut] = useState<{ label: string; note: string; ok: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const other = seat === 0 ? 1 : 0;
    const tries: [string, any][] = [
      ["World: every role + position", worldPda(roomId)],
      [`Seat ${other}'s View: their sight`, viewPda(roomId, other)],
      ["Room: the public lobby", roomPda(roomId)],
    ];
    if (seat >= 0) tries.push([`Your own View (seat ${seat})`, viewPda(roomId, seat)]);
    const res = [];
    for (const [label, addr] of tries) {
      const r = await client.tryRead(addr);
      res.push({ label, note: r.note, ok: r.ok });
    }
    // Wiretap: a move's input byte carries the cuff bit. Can a no-token RPC read it, or list the moves?
    const h = await client.tryListTxs(worldPda(roomId));
    res.push({ label: "Wiretap: list every move sent to the World", note: h.note, ok: h.ok });
    if (client.lastActSig) {
      const t = await client.tryReadTx(client.lastActSig);
      res.push({ label: "Wiretap: open your last move with no token", note: t.note, ok: t.ok });
    }
    setOut(res);
    setBusy(false);
    trackEvent("cheat_attempt", { room: roomId, denied: res.filter((r) => !r.ok).length });
  };
  return (
    <div className="proofcard">
      <h3>🕵 Try to cheat</h3>
      <p className="muted small">Wallhack attempt: request the sealed accounts from MagicBlock's TEE with your own valid auth token, then try to wiretap the moves themselves.</p>
      <button className="btn red" disabled={busy} onClick={run}>{busy ? "Asking the enclave…" : "Read the Mole's identity"}</button>
      {out.map((o) => (
        <div key={o.label} className={`check ${o.ok ? "ok" : "bad"}`}>{o.ok ? "◯ readable" : "⛔ denied"} · {o.label}<div className="mono tiny">{o.note}</div></div>
      ))}
    </div>
  );
}

export function VerifyBox({ room, report }: { room: RoomState; report: VerifyReport | null }) {
  if (!report) return <div className="proofcard"><h3>✔ Verify the deal</h3><p className="muted small">Reading the unsealed World…</p></div>;
  return (
    <div className="proofcard">
      <h3>✔ Verify the deal</h3>
      <div className={`check ${report.seedOk ? "ok" : "bad"}`}>{report.seedOk ? "✓" : "✗"} seed = SHA-256(VRF ‖ {report.saltsSet} sealed salts ‖ room ‖ heist)</div>
      <div className={`check ${report.rolesOk ? "ok" : "bad"}`}>{report.rolesOk ? "✓" : "✗"} replaying the shuffle in your browser gives exactly these roles</div>
      <div className="mono tiny muted">{room.seedState === 2 ? "⚠ dealt by fallback (oracle was silent), still salted" : "randomness: MagicBlock VRF"} · {report.vrfHex.slice(0, 18)}…</div>
    </div>
  );
}

export function SealMatrix() {
  const rows: [string, string, string, string][] = [
    ["Room: lobby, chat, task bar, published votes", "✓", "✓", "✓"],
    ["Your View: your role, tasks, your light", "✓", "✕", "✕"],
    ["World: every role, position, body, ballot", "✕", "✕", "✕"],
    ["Move transactions: inputs, accounts, logs", "✕", "✕", "✕"],
  ];
  return (
    <div className="proofcard">
      <h3>🔒 Who can read what</h3>
      <table className="matrix">
        <thead><tr><th /><th>You</th><th>Others</th><th>RPC</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td>{r.slice(1).map((c, i) => <td key={i} className={c === "✓" ? "y" : "n"}>{c}</td>)}</tr>)}</tbody>
      </table>
      <p className="muted tiny">At lights-on everything flips public so anyone can replay the heist.</p>
    </div>
  );
}

export function Chat({ client, room, roomId, seat, seated, canTalk, compact }: {
  client: GameClient; room: RoomState; roomId: number; seat: number; seated: boolean; canTalk: boolean; compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const send = async (t0?: string) => {
    const t = (t0 ?? text).trim();
    if (!t) return;
    if (!t0) setText("");
    setErr("");
    try { await client.chat(roomId, t); } catch (e: any) { setErr(e?.message ?? String(e)); }
  };
  const quick = ["Where?", "I saw them!", "Skip", "Not me!", "Who was near?", "Trust me"];
  return (
    <div className={`chatbox ${compact ? "compact" : ""}`}>
      <div className="msgs">
        {room.chat.length === 0 && <div className="muted small">Chat is on-chain. It opens in the lobby and during meetings.</div>}
        {room.chat.map((m) => (
          <div key={m.n} className={`msg ${m.seat === seat ? "mine" : ""}`}>
            <span className="dotc" style={{ background: SEAT_COLORS[m.seat] }} />
            <b style={{ color: SEAT_COLORS[m.seat] }}>{room.names[m.seat] || `#${m.seat}`}</b>
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      {seated && canTalk && (
        <>
          <div className="quick">{quick.map((q) => <button key={q} className="qbtn" onClick={() => send(q)}>{q}</button>)}</div>
          <div className="row">
            <input maxLength={48} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") send(); }} placeholder="Say something (on-chain)…" />
            <button className="btn" onClick={() => send()}>Send</button>
          </div>
        </>
      )}
      {err && <div className="error inline">{err}</div>}
    </div>
  );
}
