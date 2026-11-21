import { useEffect, useState } from "react";
import { GameClient } from "../chain/client";
import { MAXP, NO_SEAT, RoomState, ViewState, VOTE_SKIP, occupied } from "../chain/decode";
import { SEAT_COLORS } from "../game/render";
import { sfx } from "../game/sfx";
import Avatar from "./Avatar";
import { Chat } from "./Proof";

export default function MeetingScreen({ client, room, view, seat, seated, roomId }: {
  client: GameClient; room: RoomState; view: ViewState | null; seat: number; seated: boolean; roomId: number;
}) {
  const [now, setNow] = useState(Date.now() / 1000);
  const [pick, setPick] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 250); return () => clearInterval(t); }, []);
  const total = 45;
  const left = Math.max(0, room.phaseEnd - now);
  const iVoted = seated && (room.votedMask & (1 << seat)) !== 0;
  const alive = view?.alive === 1;
  const canVote = seated && alive && !iVoted && !sending;
  const vote = async (t: number) => {
    setErr(""); setSending(true); sfx.vote();
    try { await client.vote(roomId, t); setPick(null); } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setSending(false); }
  };
  const list = Array.from({ length: MAXP }, (_, i) => i).filter((i) => occupied(room, i));
  const voted = list.filter((i) => room.votedMask & (1 << i)).length;
  const living = list.filter((i) => room.alivePub[i] === 1).length;
  const body = room.reported !== NO_SEAT;

  return (
    <div className="meeting-wrap">
      <div className="tablet">
        <div className="tablet-head">
          <div>
            <div className="mt-title">WHO IS THE MOLE?</div>
            <div className="muted small">
              {body ? <>Body: <b style={{ color: SEAT_COLORS[room.reported] }}>{room.names[room.reported]}</b> · reported by {room.names[room.caller]}</> : <>Emergency called by <b style={{ color: SEAT_COLORS[room.caller] }}>{room.names[room.caller]}</b></>}
            </div>
          </div>
          <div className="timer" style={{ ["--p" as any]: left / total }}>
            <span>{Math.ceil(left)}</span>
          </div>
        </div>
        <div className="mt-body">
          <div className="mt-grid">
            {list.map((i) => {
              const dead = room.alivePub[i] === 0;
              const hasVoted = (room.votedMask & (1 << i)) !== 0;
              const selectable = canVote && !dead;
              return (
                <div key={i}
                  className={`mt-card ${dead ? "dead" : ""} ${pick === i ? "picked" : ""} ${selectable ? "sel" : ""}`}
                  style={{ borderColor: SEAT_COLORS[i] }}
                  onClick={() => selectable && (sfx.click(), setPick(pick === i ? null : i))}>
                  <Avatar seat={i} size={52} ghost={dead} />
                  <div className="mt-name">
                    <b style={{ color: SEAT_COLORS[i] }}>{room.names[i]}</b>
                    {i === seat && <span className="tag">YOU</span>}
                    {room.caller === i && <span className="tag mega">📣</span>}
                  </div>
                  {hasVoted && !dead && <span className="voted-stamp">VOTED</span>}
                  {dead && <span className="dead-x">✕</span>}
                  {pick === i && (
                    <div className="confirm" onClick={(e) => e.stopPropagation()}>
                      <button className="yes" onClick={() => vote(i)}>✓</button>
                      <button className="no" onClick={() => setPick(null)}>✕</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-chat"><Chat client={client} room={room} roomId={roomId} seat={seat} seated={seated} canTalk={alive} compact /></div>
        </div>
        <div className="tablet-foot">
          {pick === VOTE_SKIP ? (
            <span className="row"><b>Skip?</b><button className="btn green" onClick={() => vote(VOTE_SKIP)}>✓</button><button className="btn ghost" onClick={() => setPick(null)}>✕</button></span>
          ) : (
            <button className="btn ghost" disabled={!canVote} onClick={() => setPick(VOTE_SKIP)}>SKIP VOTE</button>
          )}
          <span className="muted small">
            {!seated ? "Spectating: ballots are sealed until the tally." : !alive ? "Ghosts can't vote. Watch them squirm." : iVoted ? "Your ballot is sealed in the enclave. Nobody sees it until everyone flips together." : "Pick a suspect, confirm with ✓."}
          </span>
          <span className="mono small">{voted}/{living} voted</span>
        </div>
        {err && <div className="error inline">{err}</div>}
      </div>
    </div>
  );
}
