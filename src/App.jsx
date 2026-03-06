import { useState, useEffect, useCallback, useRef } from "react";
import PartySocket from "partysocket";

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899",
  "#f43f5e","#84cc16","#14b8a6","#6366f1","#d946ef","#fb923c","#a3e635","#38bdf8"
];
const PLAYER_EMOJIS = ["🐺","🦊","🐻","🐯","🦁","🐸","🐧","🦅","🦋","🐉","🦄","🤖","👻","💀","🧙","🧛"];

// Replace this with your PartyKit project URL after deploying
// It will look like: "grid-wars.YOUR-USERNAME.partykit.dev"
const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "grid-wars.partykit.dev";

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function gridSizeForPlayers(n) {
  if (n <= 4) return 8;
  if (n <= 6) return 10;
  if (n <= 8) return 12;
  if (n <= 12) return 14;
  return 16;
}

function getPlayersInRange(player, allPlayers) {
  return allPlayers.filter(p => {
    if (p.id === player.id) return false;
    const dx = Math.abs(p.x - player.x);
    const dy = Math.abs(p.y - player.y);
    return Math.max(dx, dy) <= player.range;
  });
}

function getAdjacent(player, allPlayers, gridSize) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  return dirs
    .map(([dx, dy]) => ({ x: player.x + dx, y: player.y + dy }))
    .filter(pos =>
      pos.x >= 0 && pos.x < gridSize &&
      pos.y >= 0 && pos.y < gridSize &&
      !allPlayers.find(p => !p.eliminated && p.x === pos.x && p.y === pos.y)
    );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("menu"); // menu | name | lobby | game | gameover
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [mode, setMode] = useState("full");
  const [numPlayers, setNumPlayers] = useState(4);
  const [shrinkEnabled, setShrinkEnabled] = useState(true);
  const [lobbyState, setLobbyState] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [myConnectionId, setMyConnectionId] = useState(null);
  const [selectedAction, setSelectedAction] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const [error, setError] = useState("");
  const socketRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [gameState?.log]);

  // ── Connect to PartyKit room ──
  function connectToRoom(code) {
    if (socketRef.current) socketRef.current.close();

    const socket = new PartySocket({
      host: PARTYKIT_HOST,
      room: code.toLowerCase(),
    });

    socket.addEventListener("open", () => {
      setMyConnectionId(socket.id);
    });

    socket.addEventListener("message", (evt) => {
      const msg = JSON.parse(evt.data);
      handleServerMessage(msg, socket);
    });

    socket.addEventListener("close", () => {
      console.log("Disconnected from server");
    });

    socketRef.current = socket;
    return socket;
  }

  function handleServerMessage(msg, socket) {
    if (msg.type === "lobby_state") {
      setLobbyState(msg.state);
      setScreen("lobby");
      setError("");
    } else if (msg.type === "game_state") {
      setGameState(msg.state);
      if (msg.state.phase === "gameover") {
        setScreen("gameover");
      } else {
        setScreen("game");
      }
      setError("");
    } else if (msg.type === "empty") {
      setError("Game not found. Check your code.");
    } else if (msg.type === "error") {
      setError(msg.message);
    }
  }

  function send(msg) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }

  // ── Host a new game ──
  function hostGame() {
    if (!playerName.trim()) return;
    const code = generateRoomCode();
    setRoomCode(code);
    setIsHost(true);
    const socket = connectToRoom(code);
    setTimeout(() => {
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({
          type: "create_lobby",
          mode,
          numPlayers,
          shrinkEnabled,
          playerName: playerName.trim(),
        }));
      });
      // If already open
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "create_lobby",
          mode,
          numPlayers,
          shrinkEnabled,
          playerName: playerName.trim(),
        }));
      }
    }, 100);
  }

  // ── Join an existing game ──
  function joinGame() {
    if (!playerName.trim() || !joinCode.trim()) return;
    const code = joinCode.trim().toUpperCase();
    setRoomCode(code);
    setIsHost(false);
    const socket = connectToRoom(code);

    const sendJoin = () => {
      socket.send(JSON.stringify({
        type: "join_lobby",
        playerName: playerName.trim(),
      }));
    };

    if (socket.readyState === WebSocket.OPEN) {
      sendJoin();
    } else {
      socket.addEventListener("open", sendJoin, { once: true });
    }
  }

  // ── Start the game (host only) ──
  function startGame() {
    send({ type: "start_game" });
  }

  // ── Game actions ──
  function doAction(action, targetId = null, targetPos = null) {
    send({ type: "action", action, targetId, targetPos });
    setSelectedAction(null);
  }

  function skipTurn() {
    send({ type: "skip_turn" });
    setSelectedAction(null);
  }

  function quitToMenu() {
    if (socketRef.current) socketRef.current.close();
    socketRef.current = null;
    setGameState(null);
    setLobbyState(null);
    setRoomCode("");
    setJoinCode("");
    setIsHost(false);
    setOverlay(null);
    setError("");
    setScreen("menu");
  }

  // ── Derive my player slot ──
  const myPlayer = gameState?.players.find(p => p.connectionId === myConnectionId) || null;
  const isMyTurn = gameState && myPlayer &&
    gameState.players[gameState.currentPlayerIndex]?.connectionId === myConnectionId;

  // ── Render ──
  if (screen === "menu") return (
    <MenuScreen
      playerName={playerName} setPlayerName={setPlayerName}
      mode={mode} setMode={setMode}
      numPlayers={numPlayers} setNumPlayers={setNumPlayers}
      shrinkEnabled={shrinkEnabled} setShrinkEnabled={setShrinkEnabled}
      joinCode={joinCode} setJoinCode={setJoinCode}
      onHost={hostGame} onJoin={joinGame}
      error={error}
    />
  );

  if (screen === "lobby") return (
    <LobbyScreen
      lobby={lobbyState} roomCode={roomCode} isHost={isHost}
      myConnectionId={myConnectionId}
      onStart={startGame} onQuit={quitToMenu}
    />
  );

  if (screen === "gameover") return (
    <GameOverScreen gs={gameState} onRestart={quitToMenu} />
  );

  if (screen === "game" && gameState) return (
    <GameScreen
      gs={gameState} myPlayer={myPlayer} isMyTurn={isMyTurn}
      selectedAction={selectedAction} setSelectedAction={setSelectedAction}
      hoveredCell={hoveredCell} setHoveredCell={setHoveredCell}
      doAction={doAction} skipTurn={skipTurn} logRef={logRef}
      overlay={overlay} setOverlay={setOverlay}
      onQuitToMenu={quitToMenu}
    />
  );

  return null;
}

// ─── Menu / Join Screen ───────────────────────────────────────────────────────
function MenuScreen({ playerName, setPlayerName, mode, setMode, numPlayers, setNumPlayers,
  shrinkEnabled, setShrinkEnabled, joinCode, setJoinCode, onHost, onJoin, error }) {
  const [tab, setTab] = useState("host"); // host | join
  const isAbridged = mode === "abridged";
  const minP = isAbridged ? 4 : 8;
  const maxP = isAbridged ? 8 : 16;
  const accent = "#f97316";

  return (
    <div style={{
      minHeight:"100vh", background:"#0a0a0f", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", fontFamily:"'Courier New',monospace",
      color:"#e2e8f0", padding:"2rem"
    }}>
      <div style={{ maxWidth:520, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:"2rem" }}>
          <div style={{ fontSize:"3.5rem", marginBottom:"0.25rem" }}>⚔️</div>
          <h1 style={{
            fontSize:"clamp(2rem,5vw,3rem)", fontWeight:900, letterSpacing:"-0.02em",
            background:"linear-gradient(135deg,#f97316,#ef4444,#8b5cf6)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:"0.25rem"
          }}>GRID WARS</h1>
          <p style={{ color:"#475569", fontSize:"0.88rem" }}>Multiplayer Battle Royale</p>
        </div>

        {/* Your Name */}
        <div style={{ marginBottom:"1.25rem" }}>
          <label style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", display:"block", marginBottom:"0.4rem" }}>Your Name</label>
          <input
            value={playerName} onChange={e => setPlayerName(e.target.value)}
            placeholder="Enter your name..."
            style={{
              width:"100%", background:"#111827", border:"1px solid #334155",
              borderRadius:8, padding:"0.75rem 1rem", color:"#e2e8f0",
              fontFamily:"inherit", fontSize:"1rem", outline:"none",
              boxSizing:"border-box"
            }}
          />
        </div>

        {/* Host / Join tabs */}
        <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1.25rem" }}>
          {["host","join"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex:1, padding:"0.6rem", borderRadius:8, cursor:"pointer",
              fontFamily:"inherit", fontWeight:700, fontSize:"0.88rem", border:"none",
              background: tab===t ? "linear-gradient(135deg,#f97316,#ef4444)" : "#1e293b",
              color: tab===t ? "#fff" : "#64748b",
            }}>
              {t === "host" ? "🏟️ Host Game" : "🚪 Join Game"}
            </button>
          ))}
        </div>

        {tab === "host" && (
          <div style={{ background:"#111827", border:"1px solid #1e293b", borderRadius:12, padding:"1.25rem", marginBottom:"1rem" }}>
            {/* Mode */}
            <div style={{ marginBottom:"1rem" }}>
              <label style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", display:"block", marginBottom:"0.5rem" }}>Mode</label>
              <div style={{ display:"flex", gap:"0.5rem" }}>
                {[["full","🏟️ Full"],["abridged","⚡ Abridged"]].map(([m, label]) => (
                  <button key={m} onClick={() => { setMode(m); setNumPlayers(m==="abridged"?4:8); }} style={{
                    flex:1, padding:"0.5rem", borderRadius:8, cursor:"pointer",
                    fontFamily:"inherit", fontWeight:700, fontSize:"0.82rem", border:"none",
                    background: mode===m ? `${accent}25` : "#1e293b",
                    color: mode===m ? accent : "#64748b",
                    border: `1px solid ${mode===m ? accent+"60" : "#1e293b"}`,
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Player count */}
            <div style={{ marginBottom:"1rem" }}>
              <label style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", display:"block", marginBottom:"0.5rem" }}>
                Players: <span style={{ color:accent }}>{numPlayers}</span>
              </label>
              <div style={{ display:"flex", gap:"0.35rem", flexWrap:"wrap" }}>
                {Array.from({ length: maxP - minP + 1 }, (_, i) => i + minP).map(n => (
                  <button key={n} onClick={() => setNumPlayers(n)} style={{
                    padding:"4px 10px", borderRadius:6, fontSize:"0.78rem", cursor:"pointer",
                    fontFamily:"inherit", border:"none",
                    background: n===numPlayers ? accent : "#1e293b",
                    color: n===numPlayers ? "#fff" : "#64748b",
                  }}>{n}</button>
                ))}
              </div>
            </div>

            {/* Shrink toggle */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:"0.82rem", color:"#94a3b8" }}>🌀 Shrinking Map</span>
              <div onClick={() => setShrinkEnabled(!shrinkEnabled)} style={{
                width:44, height:24, borderRadius:12, cursor:"pointer",
                background: shrinkEnabled ? "#06b6d4" : "#1e293b",
                border:`2px solid ${shrinkEnabled ? "#06b6d4" : "#334155"}`,
                position:"relative", transition:"all 0.2s"
              }}>
                <div style={{
                  position:"absolute", top:2, left: shrinkEnabled ? 22 : 2, width:16, height:16,
                  borderRadius:"50%", background:"#fff", transition:"left 0.2s"
                }} />
              </div>
            </div>
          </div>
        )}

        {tab === "join" && (
          <div style={{ background:"#111827", border:"1px solid #1e293b", borderRadius:12, padding:"1.25rem", marginBottom:"1rem" }}>
            <label style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", display:"block", marginBottom:"0.5rem" }}>Room Code</label>
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter 4-letter code..."
              maxLength={4}
              style={{
                width:"100%", background:"#0f172a", border:"1px solid #334155",
                borderRadius:8, padding:"0.75rem 1rem", color:accent,
                fontFamily:"inherit", fontSize:"1.5rem", fontWeight:900,
                letterSpacing:"0.3em", textAlign:"center", outline:"none",
                boxSizing:"border-box"
              }}
            />
          </div>
        )}

        {error && (
          <div style={{ background:"#1a0a0a", border:"1px solid #ef444460", borderRadius:8, padding:"0.6rem 1rem", marginBottom:"0.75rem", fontSize:"0.82rem", color:"#ef4444" }}>
            ⚠️ {error}
          </div>
        )}

        <button
          onClick={tab === "host" ? onHost : onJoin}
          disabled={!playerName.trim() || (tab === "join" && joinCode.length !== 4)}
          style={{
            width:"100%", padding:"0.9rem",
            background: "linear-gradient(135deg,#f97316,#ef4444)",
            border:"none", borderRadius:10, color:"white",
            fontFamily:"inherit", fontWeight:800, fontSize:"1rem",
            cursor:"pointer", opacity: (!playerName.trim() || (tab==="join" && joinCode.length!==4)) ? 0.5 : 1,
            letterSpacing:"0.05em"
          }}
        >
          {tab === "host" ? "CREATE GAME →" : "JOIN GAME →"}
        </button>
      </div>
    </div>
  );
}

// ─── Lobby Screen ─────────────────────────────────────────────────────────────
function LobbyScreen({ lobby, roomCode, isHost, myConnectionId, onStart, onQuit }) {
  if (!lobby) return null;
  const filled = lobby.players.length;
  const total = lobby.maxPlayers;
  const canStart = isHost && filled >= 2;

  return (
    <div style={{
      minHeight:"100vh", background:"#0a0a0f", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", fontFamily:"'Courier New',monospace",
      color:"#e2e8f0", padding:"2rem"
    }}>
      <div style={{ maxWidth:480, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:"2rem" }}>
          <div style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.5rem" }}>Room Code</div>
          <div style={{
            fontSize:"3.5rem", fontWeight:900, letterSpacing:"0.3em",
            color:"#f97316", background:"#111827", border:"2px solid #f97316",
            borderRadius:12, padding:"0.5rem 1.5rem", display:"inline-block"
          }}>{roomCode}</div>
          <div style={{ fontSize:"0.78rem", color:"#64748b", marginTop:"0.5rem" }}>Share this code with your friends</div>
        </div>

        <div style={{ background:"#111827", border:"1px solid #1e293b", borderRadius:12, padding:"1.25rem", marginBottom:"1.25rem" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.75rem" }}>
            <span style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em" }}>Players</span>
            <span style={{ fontSize:"0.78rem", color:"#94a3b8" }}>{filled} / {total}</span>
          </div>

          {Array.from({ length: total }, (_, i) => {
            const p = lobby.players[i];
            return (
              <div key={i} style={{
                display:"flex", alignItems:"center", gap:"0.75rem",
                padding:"0.6rem 0.75rem", borderRadius:8, marginBottom:"0.4rem",
                background: p ? "#0f172a" : "#0a0a0f",
                border:`1px solid ${p ? COLORS[i]+"40" : "#1e293b"}`,
              }}>
                <span style={{ fontSize:"1.1rem" }}>{p ? PLAYER_EMOJIS[i] : "·"}</span>
                <span style={{ flex:1, fontSize:"0.88rem", color: p ? COLORS[i] : "#1e293b", fontWeight: p ? 700 : 400 }}>
                  {p ? p.name : "Waiting..."}
                </span>
                {p?.connectionId === lobby.hostId && (
                  <span style={{ fontSize:"0.65rem", color:"#eab308", background:"#422006", padding:"2px 6px", borderRadius:4 }}>HOST</span>
                )}
                {p?.connectionId === myConnectionId && p?.connectionId !== lobby.hostId && (
                  <span style={{ fontSize:"0.65rem", color:"#22c55e", background:"#052e16", padding:"2px 6px", borderRadius:4 }}>YOU</span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:10, padding:"0.75rem 1rem", marginBottom:"1.25rem", fontSize:"0.78rem", color:"#475569" }}>
          <div>Mode: <span style={{ color:"#94a3b8" }}>{lobby.mode === "abridged" ? "⚡ Abridged" : "🏟️ Full Game"}</span></div>
          <div>Shrink: <span style={{ color:"#94a3b8" }}>{lobby.shrinkEnabled ? "🌀 On" : "🔒 Off"}</span></div>
        </div>

        {isHost ? (
          <button onClick={onStart} disabled={!canStart} style={{
            width:"100%", padding:"0.9rem",
            background: canStart ? "linear-gradient(135deg,#22c55e,#16a34a)" : "#1e293b",
            border:"none", borderRadius:10,
            color: canStart ? "white" : "#475569",
            fontFamily:"inherit", fontWeight:800, fontSize:"1rem",
            cursor: canStart ? "pointer" : "not-allowed",
            marginBottom:"0.6rem"
          }}>
            {canStart ? "▶ START GAME" : `Waiting for players... (${filled}/${total})`}
          </button>
        ) : (
          <div style={{ textAlign:"center", color:"#64748b", fontSize:"0.88rem", padding:"1rem", background:"#111827", borderRadius:10, marginBottom:"0.6rem" }}>
            ⏳ Waiting for host to start the game...
          </div>
        )}

        <button onClick={onQuit} style={{
          width:"100%", padding:"0.6rem", background:"transparent",
          border:"1px solid #334155", borderRadius:8, color:"#64748b",
          fontFamily:"inherit", fontSize:"0.82rem", cursor:"pointer"
        }}>← Leave Game</button>
      </div>
    </div>
  );
}

// ─── Game Screen ──────────────────────────────────────────────────────────────
function GameScreen({ gs, myPlayer, isMyTurn, selectedAction, setSelectedAction,
  hoveredCell, setHoveredCell, doAction, skipTurn, logRef, overlay, setOverlay, onQuitToMenu }) {

  const currentPlayer = gs.players[gs.currentPlayerIndex];
  const activePlayers = gs.players.filter(p => !p.downed && !p.eliminated);
  const downedPlayers = gs.players.filter(p => p.downed && !p.eliminated);
  const inRangePlayers = currentPlayer ? getPlayersInRange(currentPlayer, gs.players.filter(p => !p.eliminated)) : [];
  const adjacentCells = currentPlayer ? getAdjacent(currentPlayer, gs.players.filter(p => !p.eliminated), gs.gridSize) : [];
  const isPaused = overlay === "pause";

  function cellContent(x, y) {
    const player = gs.players.find(p => !p.eliminated && p.x === x && p.y === y);
    const loot = gs.loot.find(l => l.x === x && l.y === y);
    if (player) return { player, loot: null };
    if (loot) return { player: null, loot };
    return null;
  }

  function isInRange(x, y) {
    if (!isMyTurn || gs.actionDone || isPaused) return false;
    if (selectedAction === "move") return adjacentCells.some(c => c.x === x && c.y === y);
    if (selectedAction === "attack") return inRangePlayers.some(p => p.x === x && p.y === y && !p.downed);
    return false;
  }

  function isSecondaryTarget(x, y) {
    if (!isMyTurn || !gs.actionDone || gs.secondaryDone || isPaused) return false;
    if (selectedAction === "give_heart" || selectedAction === "give_ap")
      return inRangePlayers.some(p => p.x === x && p.y === y);
    return false;
  }

  function handleCellClick(x, y) {
    if (!isMyTurn || isPaused) return;
    const content = cellContent(x, y);
    if (selectedAction === "move" && !gs.actionDone) {
      if (adjacentCells.some(c => c.x === x && c.y === y)) doAction("move", null, { x, y });
    } else if (selectedAction === "attack" && !gs.actionDone) {
      if (content?.player && !content.player.downed && inRangePlayers.find(p => p.id === content.player.id))
        doAction("attack", content.player.id);
    } else if (selectedAction === "give_heart" && gs.actionDone) {
      if (content?.player && inRangePlayers.find(p => p.id === content.player.id))
        doAction("give_heart", content.player.id);
    } else if (selectedAction === "give_ap" && gs.actionDone) {
      if (content?.player && inRangePlayers.find(p => p.id === content.player.id))
        doAction("give_ap", content.player.id);
    }
  }

  const maxCellSize = gs.gridSize <= 8 ? 52 : gs.gridSize <= 12 ? 42 : 34;
  const cellSize = Math.min(Math.floor(Math.min(window.innerWidth * 0.55, 600) / gs.gridSize), maxCellSize);

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0f", fontFamily:"'Courier New',monospace", color:"#e2e8f0", display:"flex", flexDirection:"column", position:"relative" }}>
      {/* Header */}
      <div style={{ background:"#0f172a", borderBottom:"1px solid #1e293b", padding:"0.6rem 1.5rem", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"0.5rem" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <span style={{ fontWeight:800, fontSize:"1.1rem", color:"#f97316" }}>⚔️ GRID WARS</span>
          <span style={{ fontSize:"0.72rem", color:"#64748b", background:"#1e293b", padding:"2px 8px", borderRadius:4 }}>
            {gs.mode === "abridged" ? "⚡ ABRIDGED" : "🏟️ FULL"}
          </span>
          {isPaused && <span style={{ fontSize:"0.7rem", color:"#eab308", background:"#422006", padding:"2px 8px", borderRadius:4, fontWeight:700 }}>⏸ PAUSED</span>}
          {!isMyTurn && !isPaused && (
            <span style={{ fontSize:"0.7rem", color:"#8b5cf6", background:"#2e1065", padding:"2px 8px", borderRadius:4, fontWeight:700 }}>
              ⏳ {currentPlayer?.name}'s turn
            </span>
          )}
          {isMyTurn && !isPaused && (
            <span style={{ fontSize:"0.7rem", color:"#22c55e", background:"#052e16", padding:"2px 8px", borderRadius:4, fontWeight:700 }}>
              ✅ YOUR TURN
            </span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
          <div style={{ display:"flex", gap:"1rem", fontSize:"0.8rem" }}>
            <span>Round <strong style={{ color:"#f97316" }}>{gs.round}</strong></span>
            <span>Grid <strong style={{ color:"#06b6d4" }}>{gs.gridSize}×{gs.gridSize}</strong></span>
            <span>Active <strong style={{ color:"#22c55e" }}>{activePlayers.length}</strong></span>
          </div>
          <button onClick={() => setOverlay(overlay ? null : "options")} style={{
            background: overlay==="options" ? "#1e3a5f" : "#1e293b",
            border:`1px solid ${overlay==="options" ? "#3b82f6" : "#334155"}`,
            color: overlay==="options" ? "#60a5fa" : "#94a3b8",
            borderRadius:8, padding:"0.3rem 0.7rem", cursor:"pointer",
            fontFamily:"inherit", fontSize:"0.78rem", fontWeight:700
          }}>⚙️ Options</button>
        </div>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden", flexWrap:"wrap" }}>
        {/* Grid */}
        <div style={{ flex:"1 1 auto", padding:"1.25rem", display:"flex", flexDirection:"column", alignItems:"center" }}>
          {/* Turn banner */}
          <div style={{
            background: isMyTurn ? `${myPlayer?.color || "#22c55e"}20` : "#111827",
            border:`2px solid ${isMyTurn ? (myPlayer?.color || "#22c55e")+"60" : "#1e293b"}`,
            borderRadius:10, padding:"0.6rem 1.25rem", marginBottom:"0.75rem",
            textAlign:"center", width:"100%", maxWidth: cellSize * gs.gridSize + 8
          }}>
            {isMyTurn ? (
              <>
                <div style={{ fontSize:"1.3rem" }}>{myPlayer?.emoji}</div>
                <div style={{ fontWeight:800, color:myPlayer?.color, fontSize:"0.95rem" }}>Your Turn!</div>
                <div style={{ fontSize:"0.75rem", color:"#94a3b8", display:"flex", gap:"0.75rem", justifyContent:"center", marginTop:"0.2rem", flexWrap:"wrap" }}>
                  <span>❤️ {myPlayer?.hearts}</span>
                  <span>⚡ {myPlayer?.ap} AP</span>
                  <span>🎯 Range {myPlayer?.range}</span>
                  <span style={{ color: gs.actionDone ? "#22c55e" : "#f97316" }}>
                    {gs.actionDone ? (gs.secondaryDone ? "✓ Done" : "2nd action") : "Main action"}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize:"1.1rem" }}>{currentPlayer?.emoji} <span style={{ color:currentPlayer?.color, fontWeight:700 }}>{currentPlayer?.name}</span> is taking their turn...</div>
                {myPlayer && (
                  <div style={{ fontSize:"0.72rem", color:"#475569", marginTop:"0.2rem" }}>
                    You: ❤️ {myPlayer.hearts} · ⚡ {myPlayer.ap} AP · 🎯 Range {myPlayer.range}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Grid */}
          <div style={{
            display:"grid", gridTemplateColumns:`repeat(${gs.gridSize},${cellSize}px)`,
            gap:2, background:"#1e293b", padding:3, borderRadius:8, border:"2px solid #334155",
            opacity: isPaused ? 0.5 : 1, transition:"opacity 0.2s"
          }}>
            {Array.from({ length: gs.gridSize }, (_, y) =>
              Array.from({ length: gs.gridSize }, (_, x) => {
                const content = cellContent(x, y);
                const inR = isInRange(x, y);
                const secTarget = isSecondaryTarget(x, y);
                const isCurrent = isMyTurn && content?.player?.id === myPlayer?.id;
                const isHovered = hoveredCell?.x === x && hoveredCell?.y === y;

                let bg = "#111827";
                if (isCurrent) bg = `${myPlayer.color}30`;
                else if (inR) bg = selectedAction === "attack" ? "#ef444425" : "#22c55e25";
                else if (secTarget) bg = "#8b5cf625";
                else if (isHovered) bg = "#1e293b";

                if (isMyTurn && currentPlayer && !gs.actionDone && !isCurrent) {
                  const dx = Math.abs(x - currentPlayer.x);
                  const dy = Math.abs(y - currentPlayer.y);
                  if (Math.max(dx, dy) <= currentPlayer.range && !inR) bg = "#0f172a";
                }

                const borderColor = inR
                  ? (selectedAction === "attack" ? "#ef4444" : "#22c55e")
                  : secTarget ? "#8b5cf6" : "#1e293b";

                return (
                  <div key={`${x}-${y}`}
                    onClick={() => handleCellClick(x, y)}
                    onMouseEnter={() => setHoveredCell({ x, y })}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{
                      width:cellSize, height:cellSize, background:bg,
                      border:`1px solid ${borderColor}`, borderRadius:3,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      cursor:(inR||secTarget) ? "pointer" : "default",
                      fontSize: cellSize > 36 ? "1.1rem" : "0.8rem",
                      transition:"background 0.1s", position:"relative",
                      boxShadow: isCurrent ? `0 0 10px ${myPlayer.color}50` : "none"
                    }}
                    title={content?.player ? `${content.player.emoji} ${content.player.name} ❤️${content.player.hearts} ⚡${content.player.ap}` : ""}
                  >
                    {content?.player && (
                      <div style={{ textAlign:"center", lineHeight:1 }}>
                        <div>{content.player.emoji}</div>
                        {content.player.downed && <div style={{ fontSize:"0.5rem", color:"#ef4444" }}>💀</div>}
                        {cellSize > 28 && (
                          <div style={{ fontSize:"0.4rem", color:content.player.color, letterSpacing:"-0.5px" }}>
                            {"❤".repeat(Math.min(content.player.hearts, 5))}
                          </div>
                        )}
                      </div>
                    )}
                    {content?.loot && !content?.player && (
                      <div>{content.loot.type === "heart" ? "❤️" : "✨"}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div style={{ display:"flex", gap:"1rem", marginTop:"0.6rem", fontSize:"0.7rem", color:"#64748b", flexWrap:"wrap", justifyContent:"center" }}>
            <span>❤️ Heart</span><span>✨ +3 AP</span>
            <span style={{ color:"#22c55e" }}>■ Move</span>
            <span style={{ color:"#ef4444" }}>■ Attack</span>
            <span style={{ color:"#8b5cf6" }}>■ Give</span>
          </div>
        </div>

        {/* Side Panel */}
        <div style={{ width:"min(300px,100%)", background:"#0f172a", borderLeft:"1px solid #1e293b", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Actions — only shown on your turn */}
          <div style={{ padding:"0.85rem", borderBottom:"1px solid #1e293b" }}>
            <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.5rem" }}>
              {isMyTurn ? (!gs.actionDone ? "Main Action" : !gs.secondaryDone ? "Secondary Action" : "Turn Complete") : "Waiting..."}
            </div>

            {isMyTurn && !gs.actionDone && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.35rem" }}>
                {[
                  { id:"move", label:"Move", emoji:"🚶", cost:1 },
                  { id:"attack", label:"Attack", emoji:"⚔️", cost:1 },
                  { id:"heal", label:"Heal", emoji:"💊", cost:gs.mode==="abridged"?2:3 },
                  { id:"upgrade_range", label:"Upgrade", emoji:"🎯", cost:gs.mode==="abridged"?2:3 },
                  { id:"do_nothing", label:"Skip", emoji:"⏭️", cost:0 },
                ].map(a => (
                  <ActionBtn key={a.id} {...a} ap={myPlayer?.ap || 0} selected={selectedAction===a.id}
                    onClick={() => {
                      if (isPaused) return;
                      if (a.id==="do_nothing") { doAction("do_nothing"); return; }
                      if (a.id==="heal") { doAction("heal"); return; }
                      if (a.id==="upgrade_range") { doAction("upgrade_range"); return; }
                      setSelectedAction(selectedAction===a.id ? null : a.id);
                    }} />
                ))}
              </div>
            )}

            {isMyTurn && gs.actionDone && !gs.secondaryDone && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.35rem" }}>
                {[
                  { id:"give_heart", label:"Give ❤️", emoji:"🩺", cost:0 },
                  { id:"give_ap", label:"Give AP", emoji:"⚡", cost:0 },
                  { id:"pass_secondary", label:"Pass", emoji:"⏭️", cost:0 },
                ].map(a => (
                  <ActionBtn key={a.id} {...a} ap={myPlayer?.ap || 0} selected={selectedAction===a.id}
                    onClick={() => {
                      if (isPaused) return;
                      if (a.id==="pass_secondary") { doAction("pass_secondary"); return; }
                      setSelectedAction(selectedAction===a.id ? null : a.id);
                    }} />
                ))}
              </div>
            )}

            {isMyTurn && gs.actionDone && gs.secondaryDone && (
              <div style={{ textAlign:"center", color:"#22c55e", fontSize:"0.85rem", padding:"0.5rem 0" }}>✅ Turn complete</div>
            )}

            {!isMyTurn && (
              <div style={{ textAlign:"center", color:"#475569", fontSize:"0.82rem", padding:"0.5rem 0" }}>
                Waiting for {currentPlayer?.name}...
              </div>
            )}

            {isMyTurn && (
              <button onClick={isPaused ? undefined : skipTurn} style={{
                marginTop:"0.4rem", width:"100%", background:"#1e293b", border:"1px solid #334155",
                color:"#64748b", padding:"0.35rem", borderRadius:6,
                cursor: isPaused ? "not-allowed" : "pointer",
                fontFamily:"inherit", fontSize:"0.72rem", opacity: isPaused ? 0.4 : 1
              }}>⏩ Skip Turn (−1 ❤️)</button>
            )}
          </div>

          {/* Players list */}
          <div style={{ flex:1, overflow:"auto", padding:"0.7rem" }}>
            <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.4rem" }}>Players</div>
            {gs.players.filter(p => !p.eliminated).map(p => (
              <div key={p.id} style={{
                display:"flex", alignItems:"center", gap:"0.4rem",
                padding:"0.3rem 0.4rem", borderRadius:6, marginBottom:"0.2rem",
                background: p.id===currentPlayer?.id ? `${p.color}20` : "transparent",
                border: p.id===currentPlayer?.id ? `1px solid ${p.color}40` : "1px solid transparent",
                opacity: p.downed ? 0.5 : 1
              }}>
                <span style={{ fontSize:"0.9rem" }}>{p.emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:"0.75rem", color:p.color, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {p.downed?"💀 ":""}{p.name}
                    {p.connectionId === myPlayer?.connectionId && <span style={{ color:"#22c55e", fontSize:"0.6rem", marginLeft:"4px" }}>(you)</span>}
                  </div>
                  <div style={{ fontSize:"0.62rem", color:"#64748b" }}>
                    {"❤️".repeat(Math.min(p.hearts,5))} · ⚡{p.ap} · 🎯{p.range}
                  </div>
                </div>
                {gs.turnsTaken.includes(p.id) && !p.downed && <span style={{ fontSize:"0.6rem", color:"#22c55e" }}>✓</span>}
              </div>
            ))}
            {gs.players.filter(p => p.eliminated).length > 0 && (
              <>
                <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", margin:"0.5rem 0 0.3rem" }}>Eliminated</div>
                {gs.players.filter(p=>p.eliminated).sort((a,b)=>a.rank-b.rank).map(p => (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:"0.4rem", padding:"0.2rem 0.4rem", opacity:0.4 }}>
                    <span style={{ fontSize:"0.85rem" }}>{p.emoji}</span>
                    <span style={{ fontSize:"0.7rem", color:"#64748b" }}>{p.name}</span>
                    <span style={{ fontSize:"0.65rem", color:"#ef4444", marginLeft:"auto" }}>#{p.rank}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Log */}
          <div style={{ height:160, borderTop:"1px solid #1e293b", padding:"0.65rem", overflow:"auto" }} ref={logRef}>
            <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.35rem" }}>Log</div>
            {gs.log.slice(-50).map((entry, i) => (
              <div key={i} style={{ fontSize:"0.68rem", color:"#94a3b8", marginBottom:"0.18rem", lineHeight:1.4 }}>{entry}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Options overlay */}
      {overlay === "options" && (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}
          onClick={() => setOverlay(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:16, padding:"2rem", width:"min(340px,90vw)", boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
              <div style={{ fontSize:"1.8rem" }}>⚙️</div>
              <h2 style={{ fontWeight:900, fontSize:"1.3rem", margin:"0.25rem 0 0", color:"#e2e8f0" }}>Options</h2>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"0.6rem" }}>
              <OptionsMenuBtn emoji="⏸" label="Pause Game" sub="Freeze your view" color="#eab308" onClick={() => setOverlay("pause")} />
              <OptionsMenuBtn emoji="📖" label="Tutorial" sub="How to play" color="#06b6d4" onClick={() => setOverlay("tutorial")} />
              <div style={{ height:"1px", background:"#1e293b" }} />
              <OptionsMenuBtn emoji="🚪" label="Quit to Menu" sub="Leave this game" color="#ef4444" onClick={() => setOverlay("quit_confirm")} />
            </div>
            <button onClick={() => setOverlay(null)} style={{ marginTop:"1.25rem", width:"100%", background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", padding:"0.6rem", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:"0.85rem" }}>← Back to Game</button>
          </div>
        </div>
      )}

      {/* Pause overlay */}
      {overlay === "pause" && (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.85)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ background:"#0f172a", border:"2px solid #eab30860", borderRadius:16, padding:"2.5rem 2rem", width:"min(360px,90vw)", textAlign:"center" }}>
            <div style={{ fontSize:"3rem" }}>⏸</div>
            <h2 style={{ fontWeight:900, fontSize:"1.8rem", color:"#eab308", margin:"0.25rem 0 0.5rem" }}>PAUSED</h2>
            <p style={{ color:"#64748b", fontSize:"0.85rem", marginBottom:"1.5rem" }}>
              Note: other players can still take their turns while you're paused.
            </p>
            <button onClick={() => setOverlay(null)} style={{ width:"100%", background:"linear-gradient(135deg,#eab308,#f97316)", border:"none", borderRadius:10, padding:"0.85rem", color:"#000", fontFamily:"inherit", fontWeight:900, fontSize:"1rem", cursor:"pointer" }}>▶ RESUME</button>
            <button onClick={() => setOverlay("options")} style={{ marginTop:"0.6rem", width:"100%", background:"transparent", border:"1px solid #334155", color:"#64748b", padding:"0.5rem", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontSize:"0.8rem" }}>⚙️ Options</button>
          </div>
        </div>
      )}

      {/* Quit confirm */}
      {overlay === "quit_confirm" && (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.85)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ background:"#0f172a", border:"2px solid #ef444460", borderRadius:16, padding:"2rem", width:"min(340px,90vw)", textAlign:"center" }}>
            <div style={{ fontSize:"2.5rem" }}>🚪</div>
            <h2 style={{ fontWeight:900, fontSize:"1.3rem", color:"#ef4444", margin:"0.5rem 0 0.75rem" }}>Quit Game?</h2>
            <p style={{ color:"#94a3b8", fontSize:"0.85rem", marginBottom:"1.5rem" }}>You'll be disconnected. The game continues without you.</p>
            <div style={{ display:"flex", gap:"0.75rem" }}>
              <button onClick={() => setOverlay("options")} style={{ flex:1, background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", padding:"0.7rem", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontWeight:700 }}>Cancel</button>
              <button onClick={onQuitToMenu} style={{ flex:1, background:"linear-gradient(135deg,#ef4444,#b91c1c)", border:"none", borderRadius:8, padding:"0.7rem", color:"white", fontFamily:"inherit", fontWeight:800, cursor:"pointer" }}>Quit</button>
            </div>
          </div>
        </div>
      )}

      {/* Tutorial */}
      {overlay === "tutorial" && (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.88)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:"1rem", overflowY:"auto" }}
          onClick={() => setOverlay("options")}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:16, padding:"1.75rem", width:"min(580px,96vw)", maxHeight:"85vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
              <h2 style={{ fontWeight:900, fontSize:"1.3rem", color:"#e2e8f0", margin:0 }}>📖 How to Play</h2>
              <button onClick={() => setOverlay("options")} style={{ background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:8, padding:"0.3rem 0.7rem", cursor:"pointer", fontFamily:"inherit", fontSize:"0.8rem" }}>✕</button>
            </div>
            <TutSection title="🎯 Goal" color="#f97316">Be the last player standing. Eliminate opponents, survive the shrinking board, manage your resources.</TutSection>
            <TutSection title="🔄 Turns" color="#06b6d4">Players take turns in order. Each turn: one Main Action, then one Secondary Action. Missing your turn costs 1 ❤️.</TutSection>
            <TutSection title="⚡ Actions" color="#eab308">
              <TutList items={["Move 1 square — 1 AP","Attack in range — 1 AP (−1 ❤️ to target)",`Heal +1 ❤️ — ${gs.mode==="abridged"?2:3} AP`,`Upgrade range — ${gs.mode==="abridged"?2:3} AP`,"Do nothing — free"]} />
            </TutSection>
            <TutSection title="🤝 Secondary Actions" color="#8b5cf6"><TutList items={["Give 1 heart to ally in range","Give AP to ally in range","Pass (do nothing)"]}/></TutSection>
            <TutSection title="💀 Downed" color="#94a3b8">{gs.mode==="abridged"?"Downed = eliminated immediately.":"Downed players stay on board. Revive them by giving a heart within range — they return with 1 ❤️ and 1 AP."}</TutSection>
            {gs.shrinkEnabled && <TutSection title="🌀 Shrinking Grid" color="#22c55e">Every 3 rounds the grid shrinks. Players on removed squares are downed. Stay central!</TutSection>}
            <TutSection title="✨ Loot" color="#eab308"><TutList items={["❤️ pickup — step on it for +1 heart","✨ pickup — step on it for +3 AP"]}/></TutSection>
            <button onClick={() => setOverlay(null)} style={{ marginTop:"1rem", width:"100%", background:"linear-gradient(135deg,#06b6d4,#3b82f6)", border:"none", borderRadius:10, padding:"0.75rem", color:"white", fontFamily:"inherit", fontWeight:800, cursor:"pointer" }}>Got it — Back to Game</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function OptionsMenuBtn({ emoji, label, sub, color, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display:"flex", alignItems:"center", gap:"1rem", padding:"0.8rem 1rem", borderRadius:10, cursor:"pointer", background: hov ? `${color}18` : "#111827", border:`1px solid ${hov ? color+"60" : "#1e293b"}`, transition:"all 0.15s" }}>
      <span style={{ fontSize:"1.4rem" }}>{emoji}</span>
      <div>
        <div style={{ fontWeight:700, fontSize:"0.9rem", color: hov ? color : "#e2e8f0" }}>{label}</div>
        <div style={{ fontSize:"0.7rem", color:"#475569" }}>{sub}</div>
      </div>
      <span style={{ marginLeft:"auto", color:"#334155" }}>›</span>
    </div>
  );
}

function TutSection({ title, color, children }) {
  return (
    <div style={{ marginBottom:"1rem" }}>
      <div style={{ fontWeight:800, fontSize:"0.85rem", color, marginBottom:"0.3rem" }}>{title}</div>
      <div style={{ fontSize:"0.8rem", color:"#94a3b8", lineHeight:1.6 }}>{children}</div>
    </div>
  );
}

function TutList({ items }) {
  return (
    <ul style={{ margin:"0.3rem 0 0", paddingLeft:"1.2rem" }}>
      {items.map((item, i) => <li key={i} style={{ fontSize:"0.78rem", color:"#94a3b8", marginBottom:"0.18rem", lineHeight:1.5 }}>{item}</li>)}
    </ul>
  );
}

function ActionBtn({ id, label, emoji, cost, ap, selected, onClick }) {
  const canAfford = cost === 0 || ap >= cost;
  const [hov, setHov] = useState(false);
  return (
    <div onClick={canAfford ? onClick : undefined}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ padding:"0.45rem", borderRadius:7, cursor:canAfford?"pointer":"not-allowed", background: selected?"#1d4ed8": hov&&canAfford?"#1e293b":"#111827", border:`1px solid ${selected?"#3b82f6":canAfford?"#334155":"#1e293b"}`, opacity:canAfford?1:0.4, transition:"all 0.15s", textAlign:"center" }}>
      <div style={{ fontSize:"1rem" }}>{emoji}</div>
      <div style={{ fontSize:"0.65rem", fontWeight:700 }}>{label}</div>
      {cost > 0 && <div style={{ fontSize:"0.58rem", color:"#64748b" }}>⚡{cost}</div>}
    </div>
  );
}

// ─── Game Over Screen ─────────────────────────────────────────────────────────
function GameOverScreen({ gs, onRestart }) {
  const [tab, setTab] = useState("podium");
  const ranked = [...gs.players].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1; if (b.rank) return 1; return 0;
  });
  const top3 = ranked.filter(p => p.rank).slice(0, 3);
  const medals = ["🥇","🥈","🥉"];
  const medalColors = ["#eab308","#94a3b8","#cd7c3f"];
  const mvp = [...gs.players].sort((a,b) => b.stats.kills-a.stats.kills)[0];
  const mostMoves = [...gs.players].sort((a,b) => b.stats.movesMade-a.stats.movesMade)[0];
  const mostHeals = [...gs.players].sort((a,b) => b.stats.heals-a.stats.heals)[0];
  const mostGenerous = [...gs.players].sort((a,b) => (b.stats.heartsGiven+b.stats.apGiven)-(a.stats.heartsGiven+a.stats.apGiven))[0];

  const StatRow = ({ label, value, sub }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.5rem 0", borderBottom:"1px solid #1e293b" }}>
      <span style={{ fontSize:"0.82rem", color:"#94a3b8" }}>{label}</span>
      <div style={{ textAlign:"right" }}>
        <span style={{ fontWeight:700, color:"#e2e8f0" }}>{value}</span>
        {sub && <div style={{ fontSize:"0.7rem", color:"#64748b" }}>{sub}</div>}
      </div>
    </div>
  );

  const AwardCard = ({ emoji, title, player, desc }) => (
    <div style={{ background:"#111827", border:"1px solid #1e293b", borderRadius:10, padding:"0.85rem 1rem", display:"flex", gap:"0.75rem", alignItems:"center" }}>
      <span style={{ fontSize:"1.8rem" }}>{emoji}</span>
      <div>
        <div style={{ fontSize:"0.6rem", color:"#64748b", textTransform:"uppercase" }}>{title}</div>
        <div style={{ fontWeight:800, color:player.color }}>{player.emoji} {player.name}</div>
        <div style={{ fontSize:"0.7rem", color:"#64748b" }}>{desc}</div>
      </div>
    </div>
  );

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{
      padding:"0.5rem 1.1rem", borderRadius:8, cursor:"pointer", fontFamily:"inherit",
      fontWeight:700, fontSize:"0.8rem", border:"none",
      background: tab===id ? "linear-gradient(135deg,#f97316,#ef4444)" : "#1e293b",
      color: tab===id ? "#fff" : "#64748b"
    }}>{label}</button>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0f", fontFamily:"'Courier New',monospace", color:"#e2e8f0", padding:"2rem", display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div style={{ maxWidth:660, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
          <div style={{ fontSize:"3rem" }}>🏆</div>
          <h1 style={{ fontSize:"2rem", fontWeight:900, background:"linear-gradient(135deg,#f97316,#eab308)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", margin:"0.25rem 0" }}>GAME OVER</h1>
          <div style={{ fontSize:"0.8rem", color:"#64748b" }}>
            {gs.mode==="abridged"?"⚡ Abridged":"🏟️ Full"} · {gs.numPlayers} players · {gs.round} rounds
          </div>
        </div>

        <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1.25rem", justifyContent:"center" }}>
          <TabBtn id="podium" label="🏅 Podium" />
          <TabBtn id="stats" label="📊 Stats" />
          <TabBtn id="log" label="📜 Log" />
        </div>

        {tab === "podium" && (
          <div>
            {top3.map((p, i) => (
              <div key={p.id} style={{ display:"flex", alignItems:"center", gap:"1rem", background: i===0?"#1a1400":"#111827", border:`2px solid ${medalColors[i]}${i===0?"":"60"}`, borderRadius:12, padding:"1rem 1.5rem", marginBottom:"0.75rem", boxShadow: i===0?`0 4px 20px ${medalColors[0]}25`:"none" }}>
                <span style={{ fontSize:"2rem" }}>{medals[i]}</span>
                <span style={{ fontSize:"1.8rem" }}>{p.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, color:medalColors[i], fontSize:"1.05rem" }}>{p.name}</div>
                  <div style={{ fontSize:"0.75rem", color:"#64748b", display:"flex", gap:"0.75rem", flexWrap:"wrap", marginTop:"0.2rem" }}>
                    <span>❤️ {p.hearts}</span><span>⚔️ {p.stats.kills} kills</span><span>🚶 {p.stats.movesMade} moves</span>
                  </div>
                </div>
                {i===0 && <span style={{ fontSize:"1.3rem" }}>👑</span>}
              </div>
            ))}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:"0.6rem", marginTop:"1rem" }}>
              {mvp?.stats.kills > 0 && <AwardCard emoji="💀" title="Top Eliminator" player={mvp} desc={`${mvp.stats.kills} kills`} />}
              {mostMoves?.stats.movesMade > 0 && <AwardCard emoji="🏃" title="Most Active" player={mostMoves} desc={`${mostMoves.stats.movesMade} moves`} />}
              {mostHeals?.stats.heals > 0 && <AwardCard emoji="💊" title="Self-Healer" player={mostHeals} desc={`${mostHeals.stats.heals} heals`} />}
              {(mostGenerous?.stats.heartsGiven+mostGenerous?.stats.apGiven) > 0 && <AwardCard emoji="🤝" title="Most Generous" player={mostGenerous} desc={`${mostGenerous.stats.heartsGiven}❤️ + ${mostGenerous.stats.apGiven}AP given`} />}
            </div>
          </div>
        )}

        {tab === "stats" && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:"1rem", marginBottom:"1rem" }}>
            <div style={{ background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b" }}>
              <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.6rem" }}>Game Summary</div>
              <StatRow label="Total Rounds" value={gs.round} />
              <StatRow label="Total Attacks" value={gs.gameStats.totalAttacks} />
              <StatRow label="Loot Collected" value={gs.gameStats.totalLootCollected} />
              <StatRow label="Grid Shrinks" value={gs.shrinkEnabled ? gs.gameStats.gridShrinks : "Off"} />
            </div>
            <div style={{ background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b" }}>
              <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.6rem" }}>Player Stats</div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.7rem" }}>
                  <thead><tr style={{ color:"#475569" }}>
                    <th style={{ textAlign:"left", padding:"0.2rem 0.3rem" }}>Player</th>
                    <th style={{ textAlign:"center", padding:"0.2rem" }}>⚔️</th>
                    <th style={{ textAlign:"center", padding:"0.2rem" }}>💀</th>
                    <th style={{ textAlign:"center", padding:"0.2rem" }}>💊</th>
                    <th style={{ textAlign:"center", padding:"0.2rem" }}>🚶</th>
                    <th style={{ textAlign:"center", padding:"0.2rem" }}>🏅</th>
                  </tr></thead>
                  <tbody>
                    {ranked.filter(p=>p.rank).map(p => (
                      <tr key={p.id} style={{ borderTop:"1px solid #1e293b" }}>
                        <td style={{ padding:"0.28rem 0.3rem", color:p.color, fontWeight:700 }}>{p.emoji} {p.name.slice(0,8)}</td>
                        <td style={{ textAlign:"center", color:"#e2e8f0" }}>{p.stats.attacks}</td>
                        <td style={{ textAlign:"center", color:"#ef4444" }}>{p.stats.kills}</td>
                        <td style={{ textAlign:"center", color:"#22c55e" }}>{p.stats.heals}</td>
                        <td style={{ textAlign:"center", color:"#94a3b8" }}>{p.stats.movesMade}</td>
                        <td style={{ textAlign:"center", color: p.rank<=3?medalColors[p.rank-1]:"#475569", fontWeight:800 }}>#{p.rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b", gridColumn:"1/-1" }}>
              <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.6rem" }}>Survival Timeline</div>
              {ranked.filter(p=>p.rank).map(p => {
                const elimRound = p.stats.eliminationRound || gs.round;
                const pct = Math.min(100, (elimRound / gs.round) * 100);
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.3rem" }}>
                    <span style={{ fontSize:"0.85rem", minWidth:20 }}>{p.emoji}</span>
                    <div style={{ flex:1, height:12, background:"#1e293b", borderRadius:6, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background: p.rank===1?`linear-gradient(90deg,${p.color},#eab308)`:p.color, borderRadius:6, opacity:0.85 }} />
                    </div>
                    <span style={{ fontSize:"0.62rem", color:"#64748b", minWidth:45, textAlign:"right" }}>{p.rank===1?"🏆":`Rd ${elimRound}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "log" && (
          <div style={{ background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b", maxHeight:440, overflowY:"auto", marginBottom:"1rem" }}>
            {gs.log.map((entry, i) => (
              <div key={i} style={{ fontSize:"0.7rem", color: entry.startsWith("═")?"#f97316":entry.startsWith("💀")?"#ef4444":entry.startsWith("🏆")?"#eab308":"#94a3b8", marginBottom:"0.18rem", lineHeight:1.5, fontWeight: entry.startsWith("═")||entry.startsWith("🏆")?700:400 }}>{entry}</div>
            ))}
          </div>
        )}

        <button onClick={onRestart} style={{ background:"linear-gradient(135deg,#f97316,#ef4444)", border:"none", borderRadius:10, padding:"1rem 3rem", color:"white", fontFamily:"inherit", fontWeight:800, fontSize:"1rem", cursor:"pointer", display:"block", margin:"0 auto" }}>
          PLAY AGAIN
        </button>
      </div>
    </div>
  );
}
