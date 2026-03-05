import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899",
  "#f43f5e","#84cc16","#14b8a6","#6366f1","#d946ef","#fb923c","#a3e635","#38bdf8"
];
const PLAYER_EMOJIS = ["🐺","🦊","🐻","🐯","🦁","🐸","🐧","🦅","🦋","🐉","🦄","🤖","👻","💀","🧙","🧛"];

function gridSizeForPlayers(numPlayers) {
  if (numPlayers <= 4) return 8;
  if (numPlayers <= 6) return 10;
  if (numPlayers <= 8) return 12;
  if (numPlayers <= 12) return 14;
  return 16;
}

function createInitialState(mode, numPlayers, shrinkEnabled) {
  const isAbridged = mode === "abridged";
  const gridSize = isAbridged
    ? Math.max(8, Math.ceil(numPlayers * 1.5))
    : gridSizeForPlayers(numPlayers);

  const positions = [];
  while (positions.length < numPlayers) {
    const pos = { x: Math.floor(Math.random() * gridSize), y: Math.floor(Math.random() * gridSize) };
    if (!positions.find(p => p.x === pos.x && p.y === pos.y)) positions.push(pos);
  }

  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: i,
    name: `Player ${i + 1}`,
    emoji: PLAYER_EMOJIS[i],
    color: COLORS[i],
    x: positions[i].x,
    y: positions[i].y,
    hearts: 3,
    ap: isAbridged ? 2 : 1,
    range: 2,
    downed: false,
    eliminated: false,
    rank: null,
    // stats
    stats: {
      attacks: 0, kills: 0, heals: 0, lootCollected: 0,
      apGiven: 0, heartsGiven: 0, revives: 0, movesMade: 0,
      rangeUpgrades: 0, turnsSkipped: 0, shrunkOut: false,
      eliminationRound: null,
    }
  }));

  return {
    mode,
    gridSize,
    initialGridSize: gridSize,
    shrinkEnabled,
    numPlayers,
    players,
    currentPlayerIndex: 0,
    turn: 1,
    round: 1,
    log: ["⚔️ Game started! Good luck to all players."],
    loot: [],
    turnsTaken: new Set(),
    shrinkEvery: 3,
    winner: null,
    hauntedPlayer: null,
    intercessionPlayer: null,
    secondaryDone: false,
    actionDone: false,
    // game-wide stats
    gameStats: {
      totalRounds: 0,
      totalAttacks: 0,
      totalHeals: 0,
      totalLootSpawned: 0,
      totalLootCollected: 0,
      gridShrinks: 0,
      shrinkHistory: [],
    }
  };
}

function getPlayersInRange(player, allPlayers, gridSize) {
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

function randomEmptyCell(players, loot, gridSize) {
  const occupied = new Set([
    ...players.filter(p => !p.eliminated).map(p => `${p.x},${p.y}`),
    ...loot.map(l => `${l.x},${l.y}`)
  ]);
  const cells = [];
  for (let x = 0; x < gridSize; x++)
    for (let y = 0; y < gridSize; y++)
      if (!occupied.has(`${x},${y}`)) cells.push({ x, y });
  if (!cells.length) return null;
  return cells[Math.floor(Math.random() * cells.length)];
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("menu");
  const [mode, setMode] = useState(null);
  const [numPlayers, setNumPlayers] = useState(8);
  const [shrinkEnabled, setShrinkEnabled] = useState(true);
  const [playerNames, setPlayerNames] = useState([]);
  const [gs, setGs] = useState(null);
  const [selectedAction, setSelectedAction] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [overlay, setOverlay] = useState(null); // null | "options" | "pause" | "tutorial" | "quit_confirm"
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [gs?.log]);

  function startSetup(m) {
    setMode(m);
    const defaultN = m === "abridged" ? 4 : 8;
    setNumPlayers(defaultN);
    setShrinkEnabled(true);
    setPlayerNames(Array.from({ length: 16 }, (_, i) => `Player ${i + 1}`));
    setScreen("setup");
  }

  function startGame() {
    const state = createInitialState(mode, numPlayers, shrinkEnabled);
    state.players.forEach((p, i) => { p.name = playerNames[i] || p.name; });
    // spawn initial loot
    const newLoot = [];
    for (let i = 0; i < 2; i++) {
      const pos = randomEmptyCell(state.players, newLoot, state.gridSize);
      if (pos) newLoot.push({ ...pos, type: i === 0 ? "heart" : "ap", value: i === 0 ? 1 : 3 });
    }
    state.loot = newLoot;
    state.gameStats.totalLootSpawned += newLoot.length;
    setGs(state);
    setSelectedAction(null);
    setScreen("game");
  }

  // ─── Core Game Logic ───
  const doAction = useCallback((action, targetId = null, targetPos = null) => {
    setGs(prev => {
      if (!prev || prev.winner) return prev;
      const gs = JSON.parse(JSON.stringify(prev));
      gs.turnsTaken = prev.turnsTaken;

      const pidx = gs.currentPlayerIndex;
      const player = gs.players[pidx];
      if (!player || player.downed || player.eliminated) return prev;

      let log = [];

      if (!gs.actionDone && action !== "secondary_done" && action !== "pass_secondary") {
        if (action === "move" && targetPos) {
          if (player.ap < 1) return prev;
          player.ap -= 1;
          player.x = targetPos.x;
          player.y = targetPos.y;
          player.stats.movesMade++;
          log.push(`${player.emoji} ${player.name} moved to (${targetPos.x},${targetPos.y})`);

          const lootIdx = gs.loot.findIndex(l => l.x === player.x && l.y === player.y);
          if (lootIdx !== -1) {
            const loot = gs.loot[lootIdx];
            gs.loot.splice(lootIdx, 1);
            player.stats.lootCollected++;
            gs.gameStats.totalLootCollected++;
            if (loot.type === "heart") { player.hearts += loot.value; log.push(`${player.emoji} collected a ❤️ heart!`); }
            else { player.ap += loot.value; log.push(`${player.emoji} collected ${loot.value} AP!`); }
          }
          gs.actionDone = true;

        } else if (action === "attack" && targetId !== null) {
          if (player.ap < 1) return prev;
          const target = gs.players.find(p => p.id === targetId);
          if (!target) return prev;
          player.ap -= 1;
          target.hearts -= 1;
          player.stats.attacks++;
          gs.gameStats.totalAttacks++;
          log.push(`${player.emoji} ${player.name} attacked ${target.emoji} ${target.name}! (-1 ❤️)`);

          if (target.hearts <= 0 && !target.downed) {
            target.hearts = 0;
            target.downed = true;
            player.stats.kills++;
            target.stats.eliminationRound = gs.round;
            if (target.ap > 0) {
              player.ap += target.ap;
              log.push(`${player.emoji} gained ${target.ap} AP from downed ${target.emoji} ${target.name}!`);
              target.ap = 0;
            }
            log.push(`💀 ${target.emoji} ${target.name} has been downed!`);
            checkEliminations(gs, log);
          }
          gs.actionDone = true;

        } else if (action === "heal") {
          const cost = gs.mode === "abridged" ? 2 : 3;
          if (player.ap < cost) return prev;
          player.ap -= cost;
          player.hearts += 1;
          player.stats.heals++;
          gs.gameStats.totalHeals++;
          log.push(`${player.emoji} ${player.name} healed +1 ❤️`);
          gs.actionDone = true;

        } else if (action === "upgrade_range") {
          const cost = gs.mode === "abridged" ? 2 : 3;
          if (player.ap < cost) return prev;
          player.ap -= cost;
          player.range += 1;
          player.stats.rangeUpgrades++;
          log.push(`${player.emoji} ${player.name} upgraded range to ${player.range}!`);
          gs.actionDone = true;

        } else if (action === "do_nothing") {
          log.push(`${player.emoji} ${player.name} did nothing.`);
          gs.actionDone = true;
        }
      }

      if (gs.actionDone && !gs.secondaryDone) {
        if (action === "give_heart" && targetId !== null) {
          const target = gs.players.find(p => p.id === targetId);
          if (!target || player.hearts <= 1) return prev;
          player.hearts -= 1;
          target.hearts += 1;
          player.stats.heartsGiven++;
          if (target.downed && gs.mode !== "abridged") {
            target.downed = false;
            target.ap = 1;
            target.stats.eliminationRound = null;
            player.stats.revives++;
            log.push(`${player.emoji} ${player.name} revived ${target.emoji} ${target.name}! 🩺`);
          } else {
            log.push(`${player.emoji} ${player.name} gave ❤️ to ${target.emoji} ${target.name}`);
          }
          gs.secondaryDone = true;
        } else if (action === "give_ap" && targetId !== null) {
          const maxGive = gs.mode === "abridged" ? 2 : 3;
          const target = gs.players.find(p => p.id === targetId);
          if (!target) return prev;
          const give = Math.min(maxGive, player.ap);
          if (give <= 0) return prev;
          player.ap -= give;
          target.ap += give;
          player.stats.apGiven += give;
          log.push(`${player.emoji} ${player.name} gave ${give} AP to ${target.emoji} ${target.name}`);
          gs.secondaryDone = true;
        } else if (action === "pass_secondary" || action === "secondary_done") {
          gs.secondaryDone = true;
          if (action === "pass_secondary") log.push(`${player.emoji} ${player.name} passed secondary action.`);
        }
      }

      if (gs.actionDone && gs.secondaryDone) {
        gs.turnsTaken.add(player.id);
        log.push(`─── ${player.emoji} ${player.name}'s turn ended ───`);

        const activePlayers = gs.players.filter(p => !p.downed && !p.eliminated);
        const allTaken = activePlayers.every(p => gs.turnsTaken.has(p.id));

        if (allTaken || activePlayers.length <= 1) {
          endRound(gs, log);
        } else {
          let next = (pidx + 1) % gs.players.length;
          while (gs.players[next].downed || gs.players[next].eliminated || gs.turnsTaken.has(gs.players[next].id)) {
            next = (next + 1) % gs.players.length;
          }
          gs.currentPlayerIndex = next;
        }
        gs.actionDone = false;
        gs.secondaryDone = false;
      }

      checkWin(gs, log);
      gs.log = [...gs.log, ...log];
      return gs;
    });
    setSelectedAction(null);
  }, []);

  function endRound(gs, log) {
    gs.round += 1;
    gs.gameStats.totalRounds = gs.round;
    gs.turnsTaken = new Set();
    log.push(`═══ 🔔 Round ${gs.round} begins! ═══`);

    gs.players.forEach(p => {
      if (!p.downed && !p.eliminated) {
        p.ap += 1;
        if (gs.hauntedPlayer === p.id) {
          p.ap = Math.max(0, p.ap - 1);
          log.push(`👻 ${p.emoji} ${p.name} was haunted! Lost 1 AP.`);
        }
        if (gs.intercessionPlayer === p.id) {
          p.ap += 3;
          log.push(`✨ ${p.emoji} ${p.name} received intercession! +3 AP.`);
        }
      }
    });
    gs.hauntedPlayer = null;
    gs.intercessionPlayer = null;

    // Shrink grid
    if (gs.shrinkEnabled && gs.round % gs.shrinkEvery === 0 && gs.gridSize > 4) {
      gs.gridSize -= 1;
      gs.gameStats.gridShrinks++;
      gs.gameStats.shrinkHistory.push(gs.round);
      log.push(`🌀 Grid shrank to ${gs.gridSize}×${gs.gridSize}!`);

      gs.players.forEach(p => {
        if (p.eliminated) return;
        if (p.x >= gs.gridSize || p.y >= gs.gridSize) {
          p.downed = true;
          p.stats.shrunkOut = true;
          p.stats.eliminationRound = gs.round;
          if (gs.mode === "abridged") p.eliminated = true;
          log.push(`⚠️ ${p.emoji} ${p.name} was shrunk out!`);
        }
      });
      gs.loot = gs.loot.filter(l => l.x < gs.gridSize && l.y < gs.gridSize);
    }

    // Spawn daily loot
    const heartPos = randomEmptyCell(gs.players, gs.loot, gs.gridSize);
    if (heartPos) { gs.loot.push({ ...heartPos, type: "heart", value: 1 }); gs.gameStats.totalLootSpawned++; }
    if (Math.random() > 0.5) {
      const apPos = randomEmptyCell(gs.players, gs.loot, gs.gridSize);
      if (apPos) { gs.loot.push({ ...apPos, type: "ap", value: 3 }); gs.gameStats.totalLootSpawned++; }
    }

    let next = 0;
    while (gs.players[next].downed || gs.players[next].eliminated) {
      next = (next + 1) % gs.players.length;
    }
    gs.currentPlayerIndex = next;
    checkEliminations(gs, log);
  }

  function checkEliminations(gs, log) {
    if (gs.mode === "abridged") {
      gs.players.forEach(p => {
        if (p.downed && !p.eliminated) {
          p.eliminated = true;
          p.rank = gs.players.filter(pl => !pl.eliminated).length + 1;
          if (!p.stats.eliminationRound) p.stats.eliminationRound = gs.round;
        }
      });
    }
  }

  function checkWin(gs, log) {
    const active = gs.players.filter(p => !p.downed && !p.eliminated);
    if (active.length <= 1) {
      gs.gameStats.totalRounds = gs.round;
      if (active.length === 1) {
        active[0].rank = 1;
        log.push(`🏆 ${active[0].emoji} ${active[0].name} wins the game!`);
      }
      gs.winner = active[0] || gs.players.find(p => p.rank === 1);
      if (gs.winner) setScreen("gameover");
    }
  }

  function skipTurn() {
    setGs(prev => {
      if (!prev) return prev;
      const gs = JSON.parse(JSON.stringify(prev));
      gs.turnsTaken = prev.turnsTaken;
      const player = gs.players[gs.currentPlayerIndex];
      player.hearts = Math.max(0, player.hearts - 1);
      player.stats.turnsSkipped++;
      gs.log = [...gs.log, `⏩ ${player.emoji} ${player.name} skipped — lost 1 ❤️`];

      if (player.hearts <= 0) {
        player.downed = true;
        player.stats.eliminationRound = gs.round;
        gs.log = [...gs.log, `💀 ${player.emoji} ${player.name} has been downed!`];
        if (gs.mode === "abridged") {
          player.eliminated = true;
          player.rank = gs.players.filter(p => !p.eliminated).length + 1;
        }
      }

      gs.turnsTaken.add(player.id);
      gs.actionDone = false;
      gs.secondaryDone = false;

      const activePlayers = gs.players.filter(p => !p.downed && !p.eliminated);
      const allTaken = activePlayers.every(p => gs.turnsTaken.has(p.id));
      if (allTaken || activePlayers.length <= 1) {
        endRound(gs, gs.log);
      } else {
        let next = (gs.currentPlayerIndex + 1) % gs.players.length;
        while (gs.players[next].downed || gs.players[next].eliminated || gs.turnsTaken.has(gs.players[next].id)) {
          next = (next + 1) % gs.players.length;
        }
        gs.currentPlayerIndex = next;
      }
      checkWin(gs, gs.log);
      return gs;
    });
    setSelectedAction(null);
  }

  if (screen === "menu") return <MenuScreen onStart={startSetup} />;
  if (screen === "setup") return (
    <SetupScreen
      mode={mode} numPlayers={numPlayers} setNumPlayers={n => {
        setNumPlayers(n);
        setPlayerNames(Array.from({ length: 16 }, (_, i) => playerNames[i] || `Player ${i + 1}`));
      }}
      shrinkEnabled={shrinkEnabled} setShrinkEnabled={setShrinkEnabled}
      playerNames={playerNames} setPlayerNames={setPlayerNames}
      onStart={startGame} onBack={() => setScreen("menu")}
    />
  );
  if (screen === "gameover") return <GameOverScreen gs={gs} onRestart={() => setScreen("menu")} />;
  if (!gs) return null;

  return (
    <GameScreen
      gs={gs} selectedAction={selectedAction} setSelectedAction={setSelectedAction}
      hoveredCell={hoveredCell} setHoveredCell={setHoveredCell}
      doAction={doAction} skipTurn={skipTurn} logRef={logRef}
      overlay={overlay} setOverlay={setOverlay}
      onQuitToMenu={() => { setOverlay(null); setScreen("menu"); setGs(null); }}
    />
  );
}

// ─── Menu Screen ──────────────────────────────────────────────────────────────
function MenuScreen({ onStart }) {
  return (
    <div style={{
      minHeight:"100vh", background:"#0a0a0f", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", fontFamily:"'Courier New',monospace",
      color:"#e2e8f0", padding:"2rem"
    }}>
      <div style={{ textAlign:"center", maxWidth:600 }}>
        <div style={{ fontSize:"4rem", marginBottom:"0.5rem" }}>⚔️</div>
        <h1 style={{
          fontSize:"clamp(2rem,5vw,3.5rem)", fontWeight:900, letterSpacing:"-0.02em",
          background:"linear-gradient(135deg,#f97316,#ef4444,#8b5cf6)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:"0.5rem"
        }}>GRID WARS</h1>
        <p style={{ color:"#94a3b8", fontSize:"1.1rem", marginBottom:"3rem" }}>
          A turn-based battle royale on a shrinking grid
        </p>
        <div style={{ display:"flex", flexDirection:"column", gap:"1rem", alignItems:"center" }}>
          <ModeCard title="Full Game" subtitle="8–16 players · up to 16×16 · deep strategy" emoji="🏟️" color="#f97316"
            desc="Daily AP, jury votes, shrinking grid, and diplomatic endgame. Set your player count." onClick={() => onStart("full")} />
          <ModeCard title="Abridged" subtitle="4–8 players · fast grid · quick elimination" emoji="⚡" color="#8b5cf6"
            desc="Fast-paced action. No revival, quick rounds, shrinking board optional." onClick={() => onStart("abridged")} />
        </div>
      </div>
    </div>
  );
}

function ModeCard({ title, subtitle, emoji, color, desc, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
      width:"100%", maxWidth:420, padding:"1.5rem",
      background: hov ? `${color}15` : "#111827",
      border:`2px solid ${hov ? color : "#1f2937"}`, borderRadius:12, cursor:"pointer",
      transition:"all 0.2s ease", transform: hov ? "translateY(-2px)" : "none",
      boxShadow: hov ? `0 8px 30px ${color}30` : "none", textAlign:"left"
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:"1rem", marginBottom:"0.5rem" }}>
        <span style={{ fontSize:"2rem" }}>{emoji}</span>
        <div>
          <div style={{ fontWeight:800, fontSize:"1.2rem", color }}>{title}</div>
          <div style={{ fontSize:"0.8rem", color:"#64748b" }}>{subtitle}</div>
        </div>
      </div>
      <p style={{ color:"#9ca3af", fontSize:"0.9rem", margin:0 }}>{desc}</p>
    </div>
  );
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────
function SetupScreen({ mode, numPlayers, setNumPlayers, shrinkEnabled, setShrinkEnabled, playerNames, setPlayerNames, onStart, onBack }) {
  const isAbridged = mode === "abridged";
  const minP = isAbridged ? 4 : 8;
  const maxP = isAbridged ? 8 : 16;
  const accent = isAbridged ? "#8b5cf6" : "#f97316";
  const gridPreview = isAbridged ? Math.max(8, Math.ceil(numPlayers * 1.5)) : gridSizeForPlayers(numPlayers);

  return (
    <div style={{
      minHeight:"100vh", background:"#0a0a0f", fontFamily:"'Courier New',monospace",
      color:"#e2e8f0", padding:"2rem", display:"flex", flexDirection:"column", alignItems:"center"
    }}>
      <div style={{ maxWidth:760, width:"100%" }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", marginBottom:"1rem", fontSize:"0.9rem" }}>← Back</button>
        <h2 style={{ fontSize:"1.8rem", fontWeight:800, marginBottom:"0.25rem", color:accent }}>
          {isAbridged ? "⚡ Abridged" : "🏟️ Full Game"} — Setup
        </h2>

        {/* Settings Row */}
        <div style={{ display:"flex", gap:"1.5rem", flexWrap:"wrap", marginBottom:"1.5rem", marginTop:"1rem" }}>
          {/* Player Count */}
          <div style={{ background:"#111827", border:`1px solid ${accent}40`, borderRadius:12, padding:"1.25rem 1.5rem", flex:"1 1 220px" }}>
            <div style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>
              Player Count
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
              <button onClick={() => setNumPlayers(Math.max(minP, numPlayers - 1))}
                style={{ width:32, height:32, borderRadius:8, background:"#1e293b", border:`1px solid #334155`, color:"#e2e8f0", cursor:"pointer", fontSize:"1.2rem", fontFamily:"inherit" }}>−</button>
              <span style={{ fontSize:"2.5rem", fontWeight:900, color:accent, minWidth:50, textAlign:"center" }}>{numPlayers}</span>
              <button onClick={() => setNumPlayers(Math.min(maxP, numPlayers + 1))}
                style={{ width:32, height:32, borderRadius:8, background:"#1e293b", border:`1px solid #334155`, color:"#e2e8f0", cursor:"pointer", fontSize:"1.2rem", fontFamily:"inherit" }}>+</button>
            </div>
            <div style={{ display:"flex", gap:"0.4rem", marginTop:"0.75rem", flexWrap:"wrap" }}>
              {Array.from({ length: maxP - minP + 1 }, (_, i) => i + minP).map(n => (
                <button key={n} onClick={() => setNumPlayers(n)} style={{
                  padding:"3px 9px", borderRadius:6, fontSize:"0.75rem", cursor:"pointer", fontFamily:"inherit",
                  background: n === numPlayers ? accent : "#1e293b",
                  border:`1px solid ${n === numPlayers ? accent : "#334155"}`,
                  color: n === numPlayers ? "#fff" : "#64748b"
                }}>{n}</button>
              ))}
            </div>
            <div style={{ fontSize:"0.72rem", color:"#64748b", marginTop:"0.6rem" }}>
              Grid: <span style={{ color:accent }}>{gridPreview}×{gridPreview}</span>
              {" "}· Min {minP}, Max {maxP}
            </div>
          </div>

          {/* Shrinking Map Toggle */}
          <div style={{ background:"#111827", border:`1px solid ${shrinkEnabled ? "#06b6d4" : "#1e293b"}`, borderRadius:12, padding:"1.25rem 1.5rem", flex:"1 1 220px", transition:"border-color 0.2s" }}>
            <div style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>
              Shrinking Map
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
              <div onClick={() => setShrinkEnabled(!shrinkEnabled)} style={{
                width:52, height:28, borderRadius:14, cursor:"pointer",
                background: shrinkEnabled ? "#06b6d4" : "#1e293b",
                border:`2px solid ${shrinkEnabled ? "#06b6d4" : "#334155"}`,
                position:"relative", transition:"all 0.2s"
              }}>
                <div style={{
                  position:"absolute", top:2, left: shrinkEnabled ? 26 : 2, width:20, height:20,
                  borderRadius:"50%", background:"#fff", transition:"left 0.2s"
                }} />
              </div>
              <span style={{ fontWeight:700, color: shrinkEnabled ? "#06b6d4" : "#475569", fontSize:"0.9rem" }}>
                {shrinkEnabled ? "ON" : "OFF"}
              </span>
            </div>
            <div style={{ fontSize:"0.72rem", color:"#64748b", marginTop:"0.75rem", lineHeight:1.5 }}>
              {shrinkEnabled
                ? "Grid shrinks every 3 rounds. Players on removed squares are downed."
                : "Fixed grid — no shrinking. Survival based purely on combat."}
            </div>
          </div>
        </div>

        {/* Player Names */}
        <div style={{ fontSize:"0.7rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>
          Player Names
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))", gap:"0.6rem", marginBottom:"2rem" }}>
          {Array.from({ length: numPlayers }, (_, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:"0.5rem", background:"#111827", borderRadius:8, padding:"0.5rem 0.75rem", border:`1px solid ${COLORS[i]}40` }}>
              <span style={{ fontSize:"1.1rem" }}>{PLAYER_EMOJIS[i]}</span>
              <input
                value={playerNames[i] || ""}
                onChange={e => { const arr=[...playerNames]; arr[i]=e.target.value; setPlayerNames(arr); }}
                style={{ background:"none", border:"none", color:COLORS[i], fontFamily:"inherit", fontSize:"0.9rem", width:"100%", outline:"none" }}
                placeholder={`Player ${i + 1}`}
              />
            </div>
          ))}
        </div>

        <button onClick={onStart} style={{
          background:`linear-gradient(135deg,${accent},${isAbridged?"#ec4899":"#ef4444"})`,
          border:"none", borderRadius:10, padding:"1rem 3rem",
          color:"white", fontFamily:"inherit", fontWeight:800, fontSize:"1.1rem",
          cursor:"pointer", letterSpacing:"0.05em"
        }}>START GAME →</button>
      </div>
    </div>
  );
}

// ─── Game Screen ──────────────────────────────────────────────────────────────
function GameScreen({ gs, selectedAction, setSelectedAction, hoveredCell, setHoveredCell, doAction, skipTurn, logRef, overlay, setOverlay, onQuitToMenu }) {
  const currentPlayer = gs.players[gs.currentPlayerIndex];
  const activePlayers = gs.players.filter(p => !p.downed && !p.eliminated);
  const downedPlayers = gs.players.filter(p => p.downed && !p.eliminated);
  const inRangePlayers = currentPlayer ? getPlayersInRange(currentPlayer, gs.players.filter(p => !p.eliminated), gs.gridSize) : [];
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
    if (!currentPlayer || gs.actionDone) return false;
    if (selectedAction === "move") return adjacentCells.some(c => c.x === x && c.y === y);
    if (selectedAction === "attack") return inRangePlayers.some(p => p.x === x && p.y === y && !p.downed);
    return false;
  }

  function isSecondaryTarget(x, y) {
    if (!currentPlayer || !gs.actionDone || gs.secondaryDone) return false;
    if (selectedAction === "give_heart" || selectedAction === "give_ap")
      return inRangePlayers.some(p => p.x === x && p.y === y);
    return false;
  }

  function handleCellClick(x, y) {
    if (isPaused) return;
    const content = cellContent(x, y);
    if (!currentPlayer || currentPlayer.downed) return;

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
        <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
          <span style={{ fontWeight:800, fontSize:"1.1rem", color:"#f97316" }}>⚔️ GRID WARS</span>
          <span style={{ fontSize:"0.75rem", color:"#64748b", background:"#1e293b", padding:"2px 8px", borderRadius:4 }}>
            {gs.mode === "abridged" ? "⚡ ABRIDGED" : "🏟️ FULL"}
          </span>
          {!gs.shrinkEnabled && <span style={{ fontSize:"0.7rem", color:"#475569", background:"#1e293b", padding:"2px 8px", borderRadius:4 }}>🔒 NO SHRINK</span>}
          {isPaused && <span style={{ fontSize:"0.7rem", color:"#eab308", background:"#422006", padding:"2px 10px", borderRadius:4, fontWeight:700, letterSpacing:"0.05em" }}>⏸ PAUSED</span>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
          <div style={{ display:"flex", gap:"1.25rem", fontSize:"0.82rem" }}>
            <span>Round <strong style={{ color:"#f97316" }}>{gs.round}</strong></span>
            <span>Grid <strong style={{ color:"#06b6d4" }}>{gs.gridSize}×{gs.gridSize}</strong></span>
            <span>Active <strong style={{ color:"#22c55e" }}>{activePlayers.length}</strong></span>
            <span>Downed <strong style={{ color:"#94a3b8" }}>{downedPlayers.length}</strong></span>
          </div>
          <button onClick={() => setOverlay(overlay ? null : "options")} style={{
            background: overlay === "options" ? "#1e3a5f" : "#1e293b",
            border:`1px solid ${overlay === "options" ? "#3b82f6" : "#334155"}`,
            color: overlay === "options" ? "#60a5fa" : "#94a3b8",
            borderRadius:8, padding:"0.35rem 0.8rem", cursor:"pointer",
            fontFamily:"inherit", fontSize:"0.8rem", fontWeight:700,
            transition:"all 0.15s", display:"flex", alignItems:"center", gap:"0.35rem"
          }}>⚙️ Options</button>
        </div>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden", flexWrap:"wrap" }}>
        {/* Grid Area */}
        <div style={{ flex:"1 1 auto", padding:"1.25rem", display:"flex", flexDirection:"column", alignItems:"center" }}>
          {/* Current player banner */}
          {currentPlayer && (
            <div style={{
              background:`${currentPlayer.color}20`, border:`2px solid ${currentPlayer.color}60`,
              borderRadius:10, padding:"0.6rem 1.25rem", marginBottom:"0.75rem",
              textAlign:"center", width:"100%", maxWidth: cellSize * gs.gridSize + 8
            }}>
              <div style={{ fontSize:"1.3rem" }}>{currentPlayer.emoji}</div>
              <div style={{ fontWeight:800, color:currentPlayer.color, fontSize:"0.95rem" }}>{currentPlayer.name}'s Turn</div>
              <div style={{ fontSize:"0.78rem", color:"#94a3b8", display:"flex", gap:"1rem", justifyContent:"center", marginTop:"0.2rem", flexWrap:"wrap" }}>
                <span>❤️ {currentPlayer.hearts}</span>
                <span>⚡ {currentPlayer.ap} AP</span>
                <span>🎯 Range {currentPlayer.range}</span>
                <span style={{ color: gs.actionDone ? "#22c55e" : "#f97316" }}>
                  {gs.actionDone ? (gs.secondaryDone ? "✓ Done" : "2nd action") : "Main action"}
                </span>
              </div>
            </div>
          )}

          {/* The Grid */}
          <div style={{
            display:"grid", gridTemplateColumns:`repeat(${gs.gridSize},${cellSize}px)`,
            gap:2, background:"#1e293b", padding:3, borderRadius:8, border:"2px solid #334155"
          }}>
            {Array.from({ length: gs.gridSize }, (_, y) =>
              Array.from({ length: gs.gridSize }, (_, x) => {
                const content = cellContent(x, y);
                const inR = isInRange(x, y);
                const secTarget = isSecondaryTarget(x, y);
                const isCurrent = content?.player?.id === currentPlayer?.id;
                const isHovered = hoveredCell?.x === x && hoveredCell?.y === y;

                let bg = "#111827";
                if (isCurrent) bg = `${currentPlayer.color}30`;
                else if (inR) bg = selectedAction === "attack" ? "#ef444425" : "#22c55e25";
                else if (secTarget) bg = "#8b5cf625";
                else if (isHovered) bg = "#1e293b";

                if (currentPlayer && !gs.actionDone && !isCurrent) {
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
                      boxShadow: isCurrent ? `0 0 10px ${currentPlayer.color}50` : "none"
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

          <div style={{ display:"flex", gap:"1rem", marginTop:"0.6rem", fontSize:"0.72rem", color:"#64748b", flexWrap:"wrap", justifyContent:"center" }}>
            <span>❤️ Heart</span><span>✨ +3 AP</span>
            <span style={{ color:"#22c55e" }}>■ Move</span>
            <span style={{ color:"#ef4444" }}>■ Attack</span>
            <span style={{ color:"#8b5cf6" }}>■ Give</span>
          </div>
        </div>

        {/* Side Panel */}
        <div style={{ width:"min(300px,100%)", background:"#0f172a", borderLeft:"1px solid #1e293b", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Actions */}
          <div style={{ padding:"0.85rem", borderBottom:"1px solid #1e293b" }}>
            <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.5rem" }}>
              {!gs.actionDone ? "Main Action" : !gs.secondaryDone ? "Secondary Action" : "Turn Complete"}
            </div>

            {currentPlayer && !gs.actionDone && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.35rem" }}>
                {[
                  { id:"move", label:"Move", emoji:"🚶", cost:1, desc:"Move 1 square" },
                  { id:"attack", label:"Attack", emoji:"⚔️", cost:1, desc:"Hit a player in range" },
                  { id:"heal", label:"Heal", emoji:"💊", cost:gs.mode==="abridged"?2:3, desc:"+1 heart" },
                  { id:"upgrade_range", label:"Upgrade", emoji:"🎯", cost:gs.mode==="abridged"?2:3, desc:"+1 range" },
                  { id:"do_nothing", label:"Skip", emoji:"⏭️", cost:0, desc:"Do nothing" },
                ].map(a => (
                  <ActionBtn key={a.id} {...a} ap={currentPlayer.ap} selected={selectedAction===a.id}
                    onClick={() => {
                      if (a.id==="do_nothing") { doAction("do_nothing"); return; }
                      if (a.id==="heal") { doAction("heal"); return; }
                      if (a.id==="upgrade_range") { doAction("upgrade_range"); return; }
                      setSelectedAction(selectedAction===a.id ? null : a.id);
                    }} />
                ))}
              </div>
            )}

            {currentPlayer && gs.actionDone && !gs.secondaryDone && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.35rem" }}>
                {[
                  { id:"give_heart", label:"Give ❤️", emoji:"🩺", desc:"Give 1 heart" },
                  { id:"give_ap", label:"Give AP", emoji:"⚡", desc:`Give up to ${gs.mode==="abridged"?2:3} AP` },
                  { id:"pass_secondary", label:"Pass", emoji:"⏭️", desc:"Skip" },
                ].map(a => (
                  <ActionBtn key={a.id} {...a} cost={0} ap={currentPlayer.ap} selected={selectedAction===a.id}
                    onClick={() => {
                      if (a.id==="pass_secondary") { doAction("pass_secondary"); return; }
                      setSelectedAction(selectedAction===a.id ? null : a.id);
                    }} />
                ))}
              </div>
            )}

            {gs.actionDone && gs.secondaryDone && (
              <div style={{ textAlign:"center", color:"#22c55e", fontSize:"0.85rem", padding:"0.5rem 0" }}>✅ Turn complete</div>
            )}

            <button onClick={isPaused ? undefined : skipTurn} style={{
              marginTop:"0.4rem", width:"100%", background:"#1e293b", border:"1px solid #334155",
              color:"#64748b", padding:"0.35rem", borderRadius:6, cursor: isPaused ? "not-allowed" : "pointer",
              fontFamily:"inherit", fontSize:"0.72rem", opacity: isPaused ? 0.4 : 1
            }}>⏩ Skip Turn (−1 ❤️)</button>
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
                <span style={{ fontSize:"0.95rem" }}>{p.emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:"0.75rem", color:p.color, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {p.downed?"💀 ":""}{p.name}
                  </div>
                  <div style={{ fontSize:"0.65rem", color:"#64748b" }}>
                    {"❤️".repeat(Math.min(p.hearts,5))} · ⚡{p.ap} · 🎯{p.range}
                  </div>
                </div>
                {gs.turnsTaken.has(p.id) && !p.downed && <span style={{ fontSize:"0.65rem", color:"#22c55e" }}>✓</span>}
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

      {/* ── OPTIONS OVERLAY ── */}
      {overlay === "options" && (
        <div style={{
          position:"absolute", inset:0, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:100
        }} onClick={() => setOverlay(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#0f172a", border:"1px solid #334155", borderRadius:16,
            padding:"2rem", width:"min(360px,90vw)", boxShadow:"0 20px 60px rgba(0,0,0,0.6)"
          }}>
            <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
              <div style={{ fontSize:"2rem", marginBottom:"0.25rem" }}>⚙️</div>
              <h2 style={{ fontWeight:900, fontSize:"1.4rem", margin:0, color:"#e2e8f0" }}>Options</h2>
              <div style={{ fontSize:"0.75rem", color:"#475569", marginTop:"0.25rem" }}>
                Round {gs.round} · {activePlayers.length} players active
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"0.6rem" }}>
              <OptionsMenuBtn emoji="⏸" label="Pause Game" sub="Freeze the game state" color="#eab308"
                onClick={() => setOverlay("pause")} />
              <OptionsMenuBtn emoji="📖" label="Tutorial" sub="How to play Grid Wars" color="#06b6d4"
                onClick={() => setOverlay("tutorial")} />
              <div style={{ height:"1px", background:"#1e293b", margin:"0.25rem 0" }} />
              <OptionsMenuBtn emoji="🚪" label="Quit to Menu" sub="Abandon this game" color="#ef4444"
                onClick={() => setOverlay("quit_confirm")} />
            </div>
            <button onClick={() => setOverlay(null)} style={{
              marginTop:"1.25rem", width:"100%", background:"#1e293b", border:"1px solid #334155",
              color:"#94a3b8", padding:"0.6rem", borderRadius:8, cursor:"pointer",
              fontFamily:"inherit", fontSize:"0.85rem", fontWeight:600
            }}>← Back to Game</button>
          </div>
        </div>
      )}

      {/* ── PAUSE OVERLAY ── */}
      {overlay === "pause" && (
        <div style={{
          position:"absolute", inset:0, background:"rgba(0,0,0,0.85)", backdropFilter:"blur(6px)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:100
        }}>
          <div style={{
            background:"#0f172a", border:"2px solid #eab30860", borderRadius:16,
            padding:"2.5rem 2rem", width:"min(380px,90vw)", textAlign:"center",
            boxShadow:"0 20px 60px rgba(0,0,0,0.7)"
          }}>
            <div style={{ fontSize:"3rem", marginBottom:"0.5rem" }}>⏸</div>
            <h2 style={{ fontWeight:900, fontSize:"1.8rem", color:"#eab308", margin:"0 0 0.5rem" }}>PAUSED</h2>
            <p style={{ color:"#64748b", fontSize:"0.88rem", marginBottom:"0.5rem" }}>
              Game is frozen. No actions can be taken.
            </p>
            <div style={{ background:"#111827", border:"1px solid #1e293b", borderRadius:10, padding:"0.75rem 1rem", marginBottom:"1.5rem", fontSize:"0.82rem" }}>
              <div style={{ color:"#94a3b8" }}>Currently up: <strong style={{ color: currentPlayer?.color }}>{currentPlayer?.emoji} {currentPlayer?.name}</strong></div>
              <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:"0.2rem" }}>Round {gs.round} · {activePlayers.length} active players</div>
            </div>
            <button onClick={() => setOverlay(null)} style={{
              width:"100%", background:"linear-gradient(135deg,#eab308,#f97316)",
              border:"none", borderRadius:10, padding:"0.85rem",
              color:"#000", fontFamily:"inherit", fontWeight:900, fontSize:"1rem",
              cursor:"pointer", letterSpacing:"0.05em"
            }}>▶ RESUME GAME</button>
            <button onClick={() => setOverlay("options")} style={{
              marginTop:"0.6rem", width:"100%", background:"transparent", border:"1px solid #334155",
              color:"#64748b", padding:"0.5rem", borderRadius:8,
              cursor:"pointer", fontFamily:"inherit", fontSize:"0.8rem"
            }}>⚙️ Back to Options</button>
          </div>
        </div>
      )}

      {/* ── QUIT CONFIRM OVERLAY ── */}
      {overlay === "quit_confirm" && (
        <div style={{
          position:"absolute", inset:0, background:"rgba(0,0,0,0.85)", backdropFilter:"blur(6px)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:100
        }}>
          <div style={{
            background:"#0f172a", border:"2px solid #ef444460", borderRadius:16,
            padding:"2rem", width:"min(360px,90vw)", textAlign:"center",
            boxShadow:"0 20px 60px rgba(0,0,0,0.7)"
          }}>
            <div style={{ fontSize:"2.5rem", marginBottom:"0.5rem" }}>🚪</div>
            <h2 style={{ fontWeight:900, fontSize:"1.4rem", color:"#ef4444", margin:"0 0 0.75rem" }}>Quit Game?</h2>
            <p style={{ color:"#94a3b8", fontSize:"0.88rem", marginBottom:"1.5rem", lineHeight:1.6 }}>
              All progress will be lost. This can't be undone.
            </p>
            <div style={{ display:"flex", gap:"0.75rem" }}>
              <button onClick={() => setOverlay("options")} style={{
                flex:1, background:"#1e293b", border:"1px solid #334155",
                color:"#94a3b8", padding:"0.7rem", borderRadius:8,
                cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:"0.88rem"
              }}>Cancel</button>
              <button onClick={onQuitToMenu} style={{
                flex:1, background:"linear-gradient(135deg,#ef4444,#b91c1c)",
                border:"none", borderRadius:8, padding:"0.7rem",
                color:"white", fontFamily:"inherit", fontWeight:800, fontSize:"0.88rem",
                cursor:"pointer"
              }}>Quit to Menu</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TUTORIAL OVERLAY ── */}
      {overlay === "tutorial" && (
        <div style={{
          position:"absolute", inset:0, background:"rgba(0,0,0,0.88)", backdropFilter:"blur(6px)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:"1rem", overflowY:"auto"
        }} onClick={() => setOverlay("options")}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#0f172a", border:"1px solid #334155", borderRadius:16,
            padding:"1.75rem", width:"min(620px,96vw)", maxHeight:"90vh", overflowY:"auto",
            boxShadow:"0 20px 60px rgba(0,0,0,0.7)"
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
              <div>
                <h2 style={{ fontWeight:900, fontSize:"1.4rem", color:"#e2e8f0", margin:0 }}>📖 How to Play</h2>
                <div style={{ fontSize:"0.72rem", color:"#475569", marginTop:"0.2rem" }}>Grid Wars — Tutorial</div>
              </div>
              <button onClick={() => setOverlay("options")} style={{
                background:"#1e293b", border:"1px solid #334155", color:"#94a3b8",
                borderRadius:8, padding:"0.35rem 0.8rem", cursor:"pointer",
                fontFamily:"inherit", fontSize:"0.8rem"
              }}>✕ Close</button>
            </div>

            <TutSection title="🎯 Goal" color="#f97316">
              Be the last player standing on the grid. Eliminate opponents, survive the shrinking board, and manage your resources wisely.
            </TutSection>

            <TutSection title="🔄 Turn Structure" color="#06b6d4">
              Players take turns in order. Each turn has two phases:
              <TutList items={[
                "Main Action — choose one action to spend AP on (or skip)",
                "Secondary Action — optionally give a heart or AP to a nearby ally",
              ]} />
              Missing your turn costs you 1 ❤️.
            </TutSection>

            <TutSection title="⚡ Action Points (AP)" color="#eab308">
              AP is your currency. You start with {gs.mode === "abridged" ? "2" : "1"} AP and gain 1 each round.
              <TutList items={[
                "Move 1 square — costs 1 AP",
                "Attack a player in range — costs 1 AP (removes 1 ❤️ from target)",
                `Heal yourself +1 ❤️ — costs ${gs.mode === "abridged" ? "2" : "3"} AP`,
                `Upgrade range +1 — costs ${gs.mode === "abridged" ? "2" : "3"} AP`,
              ]} />
            </TutSection>

            <TutSection title="❤️ Hearts" color="#ef4444">
              You start with 3 ❤️. Reach 0 and you're downed.
              {gs.mode !== "abridged" && " Downed players can be revived by receiving a heart from an ally within range."}
              {gs.mode === "abridged" && " In Abridged mode, downed players are eliminated immediately — no revival!"}
            </TutSection>

            <TutSection title="🎯 Range" color="#8b5cf6">
              Your range determines how far you can attack or trade. Default range is 2 squares (Chebyshev distance — includes diagonals). Upgrade range to reach further opponents or allies.
            </TutSection>

            <TutSection title="💀 Downed Players" color="#94a3b8">
              {gs.mode === "abridged"
                ? "Downed players are immediately eliminated in Abridged mode. Their remaining AP is lost."
                : "Downed players stay on the board. Their AP transfers to whoever downed them. An active player within range can revive them by giving 1 heart — they come back with 1 ❤️ and 1 AP."}
            </TutSection>

            {gs.shrinkEnabled && (
              <TutSection title="🌀 Shrinking Grid" color="#22c55e">
                Every 3 rounds, the grid shrinks by 1 row and column. Players caught on the edge are downed. Move towards the center to stay safe!
              </TutSection>
            )}

            <TutSection title="✨ Loot" color="#eab308">
              Each round, pickups spawn randomly on the grid:
              <TutList items={[
                "❤️ Heart pickup — move onto it to gain +1 ❤️",
                "✨ AP loot — move onto it to gain +3 AP",
              ]} />
              First player to step on the square collects it.
            </TutSection>

            <TutSection title="🗺️ Grid Colors" color="#64748b">
              <TutList items={[
                "🟩 Green highlight — valid move squares",
                "🟥 Red highlight — attackable players",
                "🟪 Purple highlight — give heart/AP targets",
                "Dim squares — within your range but not actionable",
              ]} />
            </TutSection>

            <button onClick={() => setOverlay(null)} style={{
              marginTop:"1rem", width:"100%",
              background:"linear-gradient(135deg,#06b6d4,#3b82f6)",
              border:"none", borderRadius:10, padding:"0.75rem",
              color:"white", fontFamily:"inherit", fontWeight:800, fontSize:"0.95rem",
              cursor:"pointer"
            }}>Got it — Back to Game</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Options Menu Button ──────────────────────────────────────────────────────
function OptionsMenuBtn({ emoji, label, sub, color, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
      display:"flex", alignItems:"center", gap:"1rem", padding:"0.85rem 1rem",
      borderRadius:10, cursor:"pointer",
      background: hov ? `${color}18` : "#111827",
      border:`1px solid ${hov ? color + "60" : "#1e293b"}`,
      transition:"all 0.15s"
    }}>
      <span style={{ fontSize:"1.5rem" }}>{emoji}</span>
      <div>
        <div style={{ fontWeight:700, fontSize:"0.95rem", color: hov ? color : "#e2e8f0" }}>{label}</div>
        <div style={{ fontSize:"0.72rem", color:"#475569" }}>{sub}</div>
      </div>
      <span style={{ marginLeft:"auto", color:"#334155", fontSize:"1rem" }}>›</span>
    </div>
  );
}

// ─── Tutorial Helpers ─────────────────────────────────────────────────────────
function TutSection({ title, color, children }) {
  return (
    <div style={{ marginBottom:"1.1rem" }}>
      <div style={{ fontWeight:800, fontSize:"0.88rem", color, marginBottom:"0.35rem", letterSpacing:"0.02em" }}>{title}</div>
      <div style={{ fontSize:"0.82rem", color:"#94a3b8", lineHeight:1.6 }}>{children}</div>
    </div>
  );
}
function TutList({ items }) {
  return (
    <ul style={{ margin:"0.4rem 0 0", paddingLeft:"1.25rem" }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize:"0.8rem", color:"#94a3b8", marginBottom:"0.2rem", lineHeight:1.5 }}>{item}</li>
      ))}
    </ul>
  );
}

function ActionBtn({ id, label, emoji, cost, ap, desc, selected, onClick }) {
  const canAfford = cost === 0 || ap >= cost;
  const [hov, setHov] = useState(false);
  return (
    <div onClick={canAfford ? onClick : undefined}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding:"0.45rem", borderRadius:7, cursor:canAfford?"pointer":"not-allowed",
        background: selected?"#1d4ed8": hov&&canAfford?"#1e293b":"#111827",
        border:`1px solid ${selected?"#3b82f6":canAfford?"#334155":"#1e293b"}`,
        opacity:canAfford?1:0.4, transition:"all 0.15s", textAlign:"center"
      }} title={desc}>
      <div style={{ fontSize:"1rem" }}>{emoji}</div>
      <div style={{ fontSize:"0.65rem", fontWeight:700 }}>{label}</div>
      {cost > 0 && <div style={{ fontSize:"0.58rem", color:"#64748b" }}>⚡{cost}</div>}
    </div>
  );
}

// ─── Game Over / Stats Screen ─────────────────────────────────────────────────
function GameOverScreen({ gs, onRestart }) {
  const [tab, setTab] = useState("podium"); // podium | stats | log
  const ranked = [...gs.players].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return 0;
  });
  const top3 = ranked.filter(p => p.rank).slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const medalColors = ["#eab308", "#94a3b8", "#cd7c3f"];

  // Derived stats
  const mvp = [...gs.players].sort((a,b) => b.stats.kills - a.stats.kills)[0];
  const mostMoves = [...gs.players].sort((a,b) => b.stats.movesMade - a.stats.movesMade)[0];
  const mostHeals = [...gs.players].sort((a,b) => b.stats.heals - a.stats.heals)[0];
  const mostGenerous = [...gs.players].sort((a,b) => (b.stats.heartsGiven+b.stats.apGiven) - (a.stats.heartsGiven+a.stats.apGiven))[0];
  const survivor = ranked[0];

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
      <div style={{ flex:1 }}>
        <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.08em" }}>{title}</div>
        <div style={{ fontWeight:800, color:player.color, fontSize:"0.95rem" }}>{player.emoji} {player.name}</div>
        <div style={{ fontSize:"0.72rem", color:"#64748b" }}>{desc}</div>
      </div>
    </div>
  );

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{
      padding:"0.5rem 1.25rem", borderRadius:8, cursor:"pointer", fontFamily:"inherit", fontWeight:700,
      fontSize:"0.82rem", border:"none",
      background: tab===id ? "linear-gradient(135deg,#f97316,#ef4444)" : "#1e293b",
      color: tab===id ? "#fff" : "#64748b",
      transition:"all 0.15s"
    }}>{label}</button>
  );

  return (
    <div style={{
      minHeight:"100vh", background:"#0a0a0f", fontFamily:"'Courier New',monospace",
      color:"#e2e8f0", padding:"2rem", display:"flex", flexDirection:"column", alignItems:"center"
    }}>
      <div style={{ maxWidth:680, width:"100%" }}>
        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
          <div style={{ fontSize:"3rem" }}>🏆</div>
          <h1 style={{
            fontSize:"2.2rem", fontWeight:900,
            background:"linear-gradient(135deg,#f97316,#eab308)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", margin:"0.25rem 0"
          }}>GAME OVER</h1>
          <div style={{ fontSize:"0.82rem", color:"#64748b" }}>
            {gs.mode === "abridged" ? "⚡ Abridged" : "🏟️ Full Game"} · {gs.numPlayers} players · {gs.round} rounds · {gs.initialGridSize}×{gs.initialGridSize} grid{gs.shrinkEnabled ? ` → ${gs.gridSize}×${gs.gridSize}` : " (fixed)"}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1.25rem", justifyContent:"center" }}>
          <TabBtn id="podium" label="🏅 Podium" />
          <TabBtn id="stats" label="📊 Stats" />
          <TabBtn id="log" label="📜 Full Log" />
        </div>

        {/* PODIUM TAB */}
        {tab === "podium" && (
          <div>
            {top3.map((p, i) => (
              <div key={p.id} style={{
                display:"flex", alignItems:"center", gap:"1rem",
                background: i===0 ? "#1a1400" : "#111827",
                border:`2px solid ${medalColors[i]}${i===0?"":"60"}`,
                borderRadius:12, padding:"1rem 1.5rem", marginBottom:"0.75rem",
                boxShadow: i===0 ? `0 4px 20px ${medalColors[0]}25` : "none"
              }}>
                <span style={{ fontSize:"2.2rem" }}>{medals[i]}</span>
                <span style={{ fontSize:"2rem" }}>{p.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, color:medalColors[i], fontSize:"1.1rem" }}>{p.name}</div>
                  <div style={{ fontSize:"0.78rem", color:"#64748b", display:"flex", gap:"1rem", flexWrap:"wrap", marginTop:"0.2rem" }}>
                    <span>❤️ {p.hearts} hp left</span>
                    <span>⚔️ {p.stats.kills} kills</span>
                    <span>🎯 Range {p.range}</span>
                    <span>🚶 {p.stats.movesMade} moves</span>
                  </div>
                </div>
                {i === 0 && <div style={{ fontSize:"1.5rem" }}>👑</div>}
              </div>
            ))}

            {ranked.filter(p => p.rank > 3).length > 0 && (
              <div style={{ background:"#111827", borderRadius:10, padding:"0.75rem 1rem", marginBottom:"1rem" }}>
                <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.5rem" }}>All Rankings</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:"0.4rem" }}>
                  {ranked.filter(p=>p.rank).map(p => (
                    <div key={p.id} style={{ display:"flex", alignItems:"center", gap:"0.4rem", fontSize:"0.78rem" }}>
                      <span style={{ color:"#475569", minWidth:20 }}>#{p.rank}</span>
                      <span>{p.emoji}</span>
                      <span style={{ color:p.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Awards */}
            <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.6rem" }}>Awards</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:"0.6rem", marginBottom:"1.5rem" }}>
              {mvp.stats.kills > 0 && <AwardCard emoji="💀" title="Top Eliminator" player={mvp} desc={`${mvp.stats.kills} kills`} />}
              {mostMoves.stats.movesMade > 0 && <AwardCard emoji="🏃" title="Most Active" player={mostMoves} desc={`${mostMoves.stats.movesMade} moves`} />}
              {mostHeals.stats.heals > 0 && <AwardCard emoji="💊" title="Self-Healer" player={mostHeals} desc={`${mostHeals.stats.heals} heals`} />}
              {(mostGenerous.stats.heartsGiven + mostGenerous.stats.apGiven) > 0 && (
                <AwardCard emoji="🤝" title="Most Generous" player={mostGenerous}
                  desc={`${mostGenerous.stats.heartsGiven} hearts + ${mostGenerous.stats.apGiven} AP given`} />
              )}
            </div>
          </div>
        )}

        {/* STATS TAB */}
        {tab === "stats" && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"1rem", marginBottom:"1.5rem" }}>
            {/* Game Summary */}
            <div style={{ background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b" }}>
              <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.6rem" }}>Game Summary</div>
              <StatRow label="Total Rounds" value={gs.round} />
              <StatRow label="Total Attacks" value={gs.gameStats.totalAttacks} />
              <StatRow label="Total Heals" value={gs.gameStats.totalHeals} />
              <StatRow label="Loot Spawned" value={gs.gameStats.totalLootSpawned} />
              <StatRow label="Loot Collected" value={gs.gameStats.totalLootCollected} />
              {gs.shrinkEnabled && <StatRow label="Grid Shrinks" value={gs.gameStats.gridShrinks} sub={`${gs.initialGridSize}×${gs.initialGridSize} → ${gs.gridSize}×${gs.gridSize}`} />}
              {!gs.shrinkEnabled && <StatRow label="Shrinking" value="Disabled" />}
            </div>

            {/* Per-player table */}
            <div style={{ background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b" }}>
              <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.6rem" }}>Player Stats</div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.72rem" }}>
                  <thead>
                    <tr style={{ color:"#475569" }}>
                      <th style={{ textAlign:"left", padding:"0.25rem 0.4rem", fontWeight:600 }}>Player</th>
                      <th style={{ textAlign:"center", padding:"0.25rem 0.3rem" }}>⚔️</th>
                      <th style={{ textAlign:"center", padding:"0.25rem 0.3rem" }}>💀</th>
                      <th style={{ textAlign:"center", padding:"0.25rem 0.3rem" }}>💊</th>
                      <th style={{ textAlign:"center", padding:"0.25rem 0.3rem" }}>🚶</th>
                      <th style={{ textAlign:"center", padding:"0.25rem 0.3rem" }}>✨</th>
                      <th style={{ textAlign:"center", padding:"0.25rem 0.3rem" }}>🏅</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.filter(p=>p.rank).map(p => (
                      <tr key={p.id} style={{ borderTop:"1px solid #1e293b" }}>
                        <td style={{ padding:"0.3rem 0.4rem", color:p.color, fontWeight:700 }}>
                          {p.emoji} {p.name.slice(0,8)}
                        </td>
                        <td style={{ textAlign:"center", padding:"0.3rem", color:"#e2e8f0" }}>{p.stats.attacks}</td>
                        <td style={{ textAlign:"center", padding:"0.3rem", color:"#ef4444" }}>{p.stats.kills}</td>
                        <td style={{ textAlign:"center", padding:"0.3rem", color:"#22c55e" }}>{p.stats.heals}</td>
                        <td style={{ textAlign:"center", padding:"0.3rem", color:"#94a3b8" }}>{p.stats.movesMade}</td>
                        <td style={{ textAlign:"center", padding:"0.3rem", color:"#eab308" }}>{p.stats.lootCollected}</td>
                        <td style={{ textAlign:"center", padding:"0.3rem", color: p.rank<=3 ? medalColors[p.rank-1] : "#475569", fontWeight:800 }}>#{p.rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize:"0.62rem", color:"#475569", marginTop:"0.5rem" }}>⚔️ Attacks · 💀 Kills · 💊 Heals · 🚶 Moves · ✨ Loot</div>
              </div>
            </div>

            {/* Survival Timeline */}
            <div style={{ background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b", gridColumn:"1/-1" }}>
              <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.75rem" }}>Survival Timeline</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"0.35rem" }}>
                {ranked.filter(p=>p.rank).map(p => {
                  const elimRound = p.stats.eliminationRound || gs.round;
                  const pct = Math.min(100, (elimRound / gs.round) * 100);
                  return (
                    <div key={p.id} style={{ display:"flex", alignItems:"center", gap:"0.6rem" }}>
                      <span style={{ fontSize:"0.85rem", minWidth:22 }}>{p.emoji}</span>
                      <div style={{ flex:1, height:14, background:"#1e293b", borderRadius:7, overflow:"hidden" }}>
                        <div style={{
                          height:"100%", width:`${pct}%`,
                          background: p.rank===1 ? `linear-gradient(90deg,${p.color},#eab308)` : p.color,
                          borderRadius:7, opacity:0.85,
                          transition:"width 1s ease"
                        }} />
                      </div>
                      <span style={{ fontSize:"0.65rem", color:"#64748b", minWidth:50, textAlign:"right" }}>
                        {p.rank===1 ? "🏆 Winner" : `Rd ${elimRound}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* LOG TAB */}
        {tab === "log" && (
          <div style={{
            background:"#111827", borderRadius:12, padding:"1rem 1.25rem", border:"1px solid #1e293b",
            maxHeight:480, overflowY:"auto", marginBottom:"1.5rem"
          }}>
            <div style={{ fontSize:"0.65rem", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"0.6rem" }}>Full Game Log ({gs.log.length} entries)</div>
            {gs.log.map((entry, i) => (
              <div key={i} style={{
                fontSize:"0.72rem", color: entry.startsWith("═") ? "#f97316" : entry.startsWith("💀") ? "#ef4444" : entry.startsWith("🏆") ? "#eab308" : "#94a3b8",
                marginBottom:"0.18rem", lineHeight:1.5,
                fontWeight: entry.startsWith("═") || entry.startsWith("🏆") ? 700 : 400
              }}>{entry}</div>
            ))}
          </div>
        )}

        <button onClick={onRestart} style={{
          background:"linear-gradient(135deg,#f97316,#ef4444)", border:"none", borderRadius:10,
          padding:"1rem 3rem", color:"white", fontFamily:"inherit", fontWeight:800, fontSize:"1rem",
          cursor:"pointer", display:"block", margin:"0 auto"
        }}>PLAY AGAIN</button>
      </div>
    </div>
  );
}
