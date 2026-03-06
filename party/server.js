// ─── Grid Wars — PartyKit Server ─────────────────────────────────────────────
// This file runs in the cloud. It holds the authoritative game state and
// broadcasts updates to all connected players in real time.

const COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899",
  "#f43f5e","#84cc16","#14b8a6","#6366f1","#d946ef","#fb923c","#a3e635","#38bdf8"
];
const PLAYER_EMOJIS = ["🐺","🦊","🐻","🐯","🦁","🐸","🐧","🦅","🦋","🐉","🦄","🤖","👻","💀","🧙","🧛"];

function gridSizeForPlayers(n) {
  if (n <= 4) return 8;
  if (n <= 6) return 10;
  if (n <= 8) return 12;
  if (n <= 12) return 14;
  return 16;
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

function createGameState(mode, numPlayers, shrinkEnabled, playerNames) {
  const isAbridged = mode === "abridged";
  const gridSize = isAbridged
    ? Math.max(8, Math.ceil(numPlayers * 1.5))
    : gridSizeForPlayers(numPlayers);

  const positions = [];
  while (positions.length < numPlayers) {
    const pos = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize)
    };
    if (!positions.find(p => p.x === pos.x && p.y === pos.y)) positions.push(pos);
  }

  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: i,
    name: playerNames[i] || `Player ${i + 1}`,
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
    connectionId: null, // assigned when player joins
    stats: {
      attacks: 0, kills: 0, heals: 0, lootCollected: 0,
      apGiven: 0, heartsGiven: 0, revives: 0, movesMade: 0,
      rangeUpgrades: 0, turnsSkipped: 0, shrunkOut: false,
      eliminationRound: null,
    }
  }));

  // Spawn initial loot
  const loot = [];
  for (let i = 0; i < 2; i++) {
    const pos = randomEmptyCell(players, loot, gridSize);
    if (pos) loot.push({ ...pos, type: i === 0 ? "heart" : "ap", value: i === 0 ? 1 : 3 });
  }

  return {
    phase: "game", // lobby | game | gameover
    mode,
    gridSize,
    initialGridSize: gridSize,
    shrinkEnabled,
    numPlayers,
    players,
    currentPlayerIndex: 0,
    round: 1,
    log: ["⚔️ Game started! Good luck to all players."],
    loot,
    turnsTaken: [],
    shrinkEvery: 3,
    winner: null,
    hauntedPlayer: null,
    intercessionPlayer: null,
    secondaryDone: false,
    actionDone: false,
    gameStats: {
      totalRounds: 0, totalAttacks: 0, totalHeals: 0,
      totalLootSpawned: 2, totalLootCollected: 0,
      gridShrinks: 0, shrinkHistory: [],
    }
  };
}

// ─── Action Processor ────────────────────────────────────────────────────────
// Pure function — takes current state + action, returns new state + log lines
function processAction(gs, action, targetId, targetPos) {
  // Deep clone so we never mutate
  gs = JSON.parse(JSON.stringify(gs));
  const log = [];

  const pidx = gs.currentPlayerIndex;
  const player = gs.players[pidx];
  if (!player || player.downed || player.eliminated) return { gs, log };

  // ── Main Actions ──
  if (!gs.actionDone) {
    if (action === "move" && targetPos) {
      if (player.ap < 1) return { gs, log };
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
        if (loot.type === "heart") {
          player.hearts += loot.value;
          log.push(`${player.emoji} collected a ❤️ heart!`);
        } else {
          player.ap += loot.value;
          log.push(`${player.emoji} collected ${loot.value} AP!`);
        }
      }
      gs.actionDone = true;

    } else if (action === "attack" && targetId !== null) {
      if (player.ap < 1) return { gs, log };
      const target = gs.players.find(p => p.id === targetId);
      if (!target) return { gs, log };
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
      if (player.ap < cost) return { gs, log };
      player.ap -= cost;
      player.hearts += 1;
      player.stats.heals++;
      gs.gameStats.totalHeals++;
      log.push(`${player.emoji} ${player.name} healed +1 ❤️`);
      gs.actionDone = true;

    } else if (action === "upgrade_range") {
      const cost = gs.mode === "abridged" ? 2 : 3;
      if (player.ap < cost) return { gs, log };
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

  // ── Secondary Actions ──
  if (gs.actionDone && !gs.secondaryDone) {
    if (action === "give_heart" && targetId !== null) {
      const target = gs.players.find(p => p.id === targetId);
      if (!target || player.hearts <= 1) return { gs, log };
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
      if (!target) return { gs, log };
      const give = Math.min(maxGive, player.ap);
      if (give <= 0) return { gs, log };
      player.ap -= give;
      target.ap += give;
      player.stats.apGiven += give;
      log.push(`${player.emoji} ${player.name} gave ${give} AP to ${target.emoji} ${target.name}`);
      gs.secondaryDone = true;

    } else if (action === "pass_secondary") {
      log.push(`${player.emoji} ${player.name} passed secondary action.`);
      gs.secondaryDone = true;
    }
  }

  // ── Advance Turn ──
  if (gs.actionDone && gs.secondaryDone) {
    if (!gs.turnsTaken.includes(player.id)) gs.turnsTaken.push(player.id);
    log.push(`─── ${player.emoji} ${player.name}'s turn ended ───`);

    const activePlayers = gs.players.filter(p => !p.downed && !p.eliminated);
    const allTaken = activePlayers.every(p => gs.turnsTaken.includes(p.id));

    if (allTaken || activePlayers.length <= 1) {
      endRound(gs, log);
    } else {
      let next = (pidx + 1) % gs.players.length;
      let safety = 0;
      while ((gs.players[next].downed || gs.players[next].eliminated || gs.turnsTaken.includes(gs.players[next].id)) && safety < gs.players.length) {
        next = (next + 1) % gs.players.length;
        safety++;
      }
      gs.currentPlayerIndex = next;
    }
    gs.actionDone = false;
    gs.secondaryDone = false;
  }

  checkWin(gs, log);
  gs.log = [...gs.log, ...log];
  return { gs, log };
}

function processSkipTurn(gs) {
  gs = JSON.parse(JSON.stringify(gs));
  const log = [];
  const player = gs.players[gs.currentPlayerIndex];

  player.hearts = Math.max(0, player.hearts - 1);
  player.stats.turnsSkipped++;
  log.push(`⏩ ${player.emoji} ${player.name} skipped — lost 1 ❤️`);

  if (player.hearts <= 0) {
    player.downed = true;
    player.stats.eliminationRound = gs.round;
    log.push(`💀 ${player.emoji} ${player.name} has been downed!`);
    if (gs.mode === "abridged") {
      player.eliminated = true;
      player.rank = gs.players.filter(p => !p.eliminated).length + 1;
    }
  }

  if (!gs.turnsTaken.includes(player.id)) gs.turnsTaken.push(player.id);
  gs.actionDone = false;
  gs.secondaryDone = false;

  const activePlayers = gs.players.filter(p => !p.downed && !p.eliminated);
  const allTaken = activePlayers.every(p => gs.turnsTaken.includes(p.id));

  if (allTaken || activePlayers.length <= 1) {
    endRound(gs, log);
  } else {
    let next = (gs.currentPlayerIndex + 1) % gs.players.length;
    let safety = 0;
    while ((gs.players[next].downed || gs.players[next].eliminated || gs.turnsTaken.includes(gs.players[next].id)) && safety < gs.players.length) {
      next = (next + 1) % gs.players.length;
      safety++;
    }
    gs.currentPlayerIndex = next;
  }

  checkWin(gs, log);
  gs.log = [...gs.log, ...log];
  return { gs, log };
}

function endRound(gs, log) {
  gs.round += 1;
  gs.gameStats.totalRounds = gs.round;
  gs.turnsTaken = [];
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

  const heartPos = randomEmptyCell(gs.players, gs.loot, gs.gridSize);
  if (heartPos) { gs.loot.push({ ...heartPos, type: "heart", value: 1 }); gs.gameStats.totalLootSpawned++; }
  if (Math.random() > 0.5) {
    const apPos = randomEmptyCell(gs.players, gs.loot, gs.gridSize);
    if (apPos) { gs.loot.push({ ...apPos, type: "ap", value: 3 }); gs.gameStats.totalLootSpawned++; }
  }

  let next = 0;
  while (next < gs.players.length && (gs.players[next].downed || gs.players[next].eliminated)) {
    next++;
  }
  gs.currentPlayerIndex = next < gs.players.length ? next : 0;
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
    gs.winner = active[0] || gs.players.find(p => p.rank === 1) || null;
    gs.phase = "gameover";
  }
}

// ─── PartyKit Server Class ────────────────────────────────────────────────────
export default class GridWarsServer {
  constructor(room) {
    this.room = room;
    this.lobby = null;   // lobby state before game starts
    this.game = null;    // game state once started
  }

  // Called when a new player connects
  onConnect(conn) {
    // Send them the current state immediately
    if (this.game) {
      conn.send(JSON.stringify({ type: "game_state", state: this.game }));
    } else if (this.lobby) {
      conn.send(JSON.stringify({ type: "lobby_state", state: this.lobby }));
    } else {
      conn.send(JSON.stringify({ type: "empty" }));
    }
  }

  // Called when a player disconnects
  onClose(conn) {
    if (this.lobby) {
      this.lobby.players = this.lobby.players.filter(p => p.connectionId !== conn.id);
      this.broadcast({ type: "lobby_state", state: this.lobby });
    }
  }

  // Called when a message arrives from any client
  onMessage(message, sender) {
    const msg = JSON.parse(message);

    switch (msg.type) {

      // ── Lobby: host creates a game ──
      case "create_lobby": {
        this.lobby = {
          hostId: sender.id,
          mode: msg.mode,
          numPlayers: msg.numPlayers,
          shrinkEnabled: msg.shrinkEnabled,
          players: [{
            connectionId: sender.id,
            name: msg.playerName,
            slot: 0,
          }],
          maxPlayers: msg.numPlayers,
        };
        this.broadcast({ type: "lobby_state", state: this.lobby });
        break;
      }

      // ── Lobby: player joins ──
      case "join_lobby": {
        if (!this.lobby) {
          sender.send(JSON.stringify({ type: "error", message: "Game not found. Check your code." }));
          return;
        }
        if (this.lobby.players.length >= this.lobby.maxPlayers) {
          sender.send(JSON.stringify({ type: "error", message: "Game is full!" }));
          return;
        }
        if (this.game) {
          sender.send(JSON.stringify({ type: "error", message: "Game already started." }));
          return;
        }
        const slot = this.lobby.players.length;
        this.lobby.players.push({
          connectionId: sender.id,
          name: msg.playerName,
          slot,
        });
        this.broadcast({ type: "lobby_state", state: this.lobby });
        break;
      }

      // ── Lobby: host starts the game ──
      case "start_game": {
        if (!this.lobby || sender.id !== this.lobby.hostId) return;
        const names = this.lobby.players.map(p => p.name);
        this.game = createGameState(
          this.lobby.mode,
          this.lobby.numPlayers,
          this.lobby.shrinkEnabled,
          names
        );
        // Assign connection IDs to player slots
        this.lobby.players.forEach((lp, i) => {
          if (this.game.players[i]) {
            this.game.players[i].connectionId = lp.connectionId;
          }
        });
        this.broadcast({ type: "game_state", state: this.game });
        break;
      }

      // ── Game: player takes an action ──
      case "action": {
        if (!this.game || this.game.phase !== "game") return;

        const currentPlayer = this.game.players[this.game.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.connectionId !== sender.id) return;

        const { gs, log } = processAction(
          this.game,
          msg.action,
          msg.targetId ?? null,
          msg.targetPos ?? null
        );
        this.game = gs;
        this.broadcast({ type: "game_state", state: this.game });
        break;
      }

      // ── Game: player skips their turn ──
      case "skip_turn": {
        if (!this.game || this.game.phase !== "game") return;
        const currentPlayer = this.game.players[this.game.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.connectionId !== sender.id) return;

        const { gs } = processSkipTurn(this.game);
        this.game = gs;
        this.broadcast({ type: "game_state", state: this.game });
        break;
      }

      // ── Spectator / rejoining: request full state ──
      case "request_state": {
        if (this.game) {
          sender.send(JSON.stringify({ type: "game_state", state: this.game }));
        } else if (this.lobby) {
          sender.send(JSON.stringify({ type: "lobby_state", state: this.lobby }));
        }
        break;
      }
    }
  }

  // Send a message to every connected client
  broadcast(msg) {
    this.room.broadcast(JSON.stringify(msg));
  }
}
