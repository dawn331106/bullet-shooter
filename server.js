const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ARENA_WIDTH = 1280;
const ARENA_HEIGHT = 720;
const ONLINE_PLAYER_SPEED = 220;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function normalizeVector(x, y) {
  const mag = Math.hypot(x, y);
  if (mag === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / mag, y: y / mag };
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function freshMatchState() {
  return {
    players: {
      p1: null,
      p2: null
    },
    bullets: [],
    boosters: [],
    nextBoosterAt: Date.now() + randomRange(10000, 15000),
    mode: 'waiting',
    countdownStartAt: 0,
    runningStartAt: 0,
    countdownDurationMs: 3000,
    winner: null,
    arena: {
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT
    }
  };
}

function makePlayer(role) {
  const isP1 = role === 'p1';
  return {
    role,
    socketId: null,
    x: isP1 ? 180 : 1100,
    y: 360,
    radius: 18,
    health: 3,
    moveSpeed: ONLINE_PLAYER_SPEED,
    movementSpeedMultiplier: 1,
    bulletSpeedMultiplier: 1,
    shield: false,
    extraBullets: 0,
    angle: isP1 ? 0 : Math.PI,
    inputX: 0,
    inputY: 0,
    aimX: isP1 ? 1 : -1,
    aimY: 0,
    connected: false
  };
}

function resetRound(match) {
  match.matchState.bullets = [];
  match.matchState.boosters = [];
  match.matchState.nextBoosterAt = Date.now() + randomRange(10000, 15000);
  match.matchState.runningStartAt = 0;
  match.matchState.winner = null;

  if (match.matchState.players.p1) {
    match.matchState.players.p1.x = 180;
    match.matchState.players.p1.y = 360;
    match.matchState.players.p1.health = 3;
    match.matchState.players.p1.movementSpeedMultiplier = 1;
    match.matchState.players.p1.bulletSpeedMultiplier = 1;
    match.matchState.players.p1.shield = false;
    match.matchState.players.p1.extraBullets = 0;
    match.matchState.players.p1.angle = 0;
    match.matchState.players.p1.inputX = 0;
    match.matchState.players.p1.inputY = 0;
  }

  if (match.matchState.players.p2) {
    match.matchState.players.p2.x = 1100;
    match.matchState.players.p2.y = 360;
    match.matchState.players.p2.health = 3;
    match.matchState.players.p2.movementSpeedMultiplier = 1;
    match.matchState.players.p2.bulletSpeedMultiplier = 1;
    match.matchState.players.p2.shield = false;
    match.matchState.players.p2.extraBullets = 0;
    match.matchState.players.p2.angle = Math.PI;
    match.matchState.players.p2.inputX = 0;
    match.matchState.players.p2.inputY = 0;
  }
}

function startCountdown(roomCode, match) {
  if (!match.matchState.players.p1 || !match.matchState.players.p2) {
    return;
  }

  resetRound(match);
  match.matchState.mode = 'countdown';
  match.matchState.countdownStartAt = Date.now();
  match.rematchVotes.clear();

  io.to(roomCode).emit('countdown-start', {
    startAt: match.matchState.countdownStartAt,
    durationMs: match.matchState.countdownDurationMs
  });
}

function spawnBooster(matchState) {
  const radius = 22;
  const margin = 24;
  const boosterTypes = [
    { type: 'bullet-speed', bonus: 0.1 },
    { type: 'bullet-speed', bonus: 0.2 },
    { type: 'bullet-speed', bonus: 0.3 },
    { type: 'movement-speed', bonus: 0.05 },
    { type: 'movement-speed', bonus: 0.1 },
    { type: 'shield', bonus: 1 },
    { type: 'extra-bullet', bonus: 1 }
  ];
  const picked = boosterTypes[Math.floor(Math.random() * boosterTypes.length)];
  const id = `b_${Date.now()}_${Math.floor(Math.random() * 99999)}`;

  matchState.boosters.push({
    id,
    x: randomRange(margin + radius, matchState.arena.width - margin - radius),
    y: randomRange(margin + radius, matchState.arena.height - margin - radius),
    radius,
    type: picked.type,
    bonus: picked.bonus
  });
}

function bulletCapacityForElapsed(elapsedMs) {
  return Math.min(7, 1 + Math.floor(elapsedMs / 10000));
}

function currentBulletCapacity(matchState) {
  if (!matchState || matchState.runningStartAt <= 0) {
    return 1;
  }
  return bulletCapacityForElapsed(Math.max(0, Date.now() - matchState.runningStartAt));
}

function tryShoot(matchState, playerRole) {
  if (matchState.mode !== 'running') {
    return;
  }

  const shooter = matchState.players[playerRole];
  if (!shooter) {
    return;
  }

  const activeBulletCount = matchState.bullets.reduce((count, bullet) => {
    return bullet.owner === playerRole ? count + 1 : count;
  }, 0);
  const canShootExtra = shooter.extraBullets > 0;
  if (activeBulletCount >= currentBulletCapacity(matchState) && !canShootExtra) {
    return;
  }

  const aim = normalizeVector(shooter.aimX, shooter.aimY);
  if (aim.x === 0 && aim.y === 0) {
    return;
  }

  const speed = 210 * shooter.bulletSpeedMultiplier;
  const spawnOffset = shooter.radius + 8;

  matchState.bullets.push({
    x: shooter.x + aim.x * spawnOffset,
    y: shooter.y + aim.y * spawnOffset,
    vx: aim.x * speed,
    vy: aim.y * speed,
    radius: 6,
    owner: shooter.role
  });

  if (canShootExtra) {
    shooter.extraBullets -= 1;
  }
}

function updatePlayers(matchState, dtSec) {
  ['p1', 'p2'].forEach((role) => {
    const p = matchState.players[role];
    if (!p) {
      return;
    }

    const input = normalizeVector(p.inputX, p.inputY);
    const effectiveSpeed = p.moveSpeed * p.movementSpeedMultiplier;
    p.x += input.x * effectiveSpeed * dtSec;
    p.y += input.y * effectiveSpeed * dtSec;

    p.x = clamp(p.x, p.radius, matchState.arena.width - p.radius);
    p.y = clamp(p.y, p.radius, matchState.arena.height - p.radius);

    const aim = normalizeVector(p.aimX, p.aimY);
    if (aim.x !== 0 || aim.y !== 0) {
      p.angle = Math.atan2(aim.y, aim.x);
    }
  });
}

function updateAimAnglesOnly(matchState) {
  ['p1', 'p2'].forEach((role) => {
    const p = matchState.players[role];
    if (!p) {
      return;
    }

    const aim = normalizeVector(p.aimX, p.aimY);
    if (aim.x !== 0 || aim.y !== 0) {
      p.angle = Math.atan2(aim.y, aim.x);
    }
  });
}

function updateBullets(matchState, dtSec) {
  for (let i = 0; i < matchState.bullets.length; i += 1) {
    const b = matchState.bullets[i];
    b.x += b.vx * dtSec;
    b.y += b.vy * dtSec;

    if (b.x - b.radius < 0) {
      b.x = b.radius;
      b.vx = -b.vx;
    } else if (b.x + b.radius > matchState.arena.width) {
      b.x = matchState.arena.width - b.radius;
      b.vx = -b.vx;
    }

    if (b.y - b.radius < 0) {
      b.y = b.radius;
      b.vy = -b.vy;
    } else if (b.y + b.radius > matchState.arena.height) {
      b.y = matchState.arena.height - b.radius;
      b.vy = -b.vy;
    }
  }
}

function checkBoosterPickup(matchState) {
  ['p1', 'p2'].forEach((role) => {
    const p = matchState.players[role];
    if (!p) {
      return;
    }

    for (let i = matchState.boosters.length - 1; i >= 0; i -= 1) {
      const booster = matchState.boosters[i];
      const sum = p.radius + booster.radius;
      if (distSq(p.x, p.y, booster.x, booster.y) <= sum * sum) {
        if (booster.type === 'bullet-speed') {
          const scale = 1 + booster.bonus;
          p.bulletSpeedMultiplier *= scale;
          for (let j = 0; j < matchState.bullets.length; j += 1) {
            if (matchState.bullets[j].owner === role) {
              matchState.bullets[j].vx *= scale;
              matchState.bullets[j].vy *= scale;
            }
          }
        } else if (booster.type === 'movement-speed') {
          p.movementSpeedMultiplier *= 1 + booster.bonus;
        } else if (booster.type === 'shield') {
          if (!p.shield) {
            p.shield = true;
          }
        } else if (booster.type === 'extra-bullet') {
          p.extraBullets += 1;
        }

        matchState.boosters.splice(i, 1);
      }
    }
  });
}

function checkBulletHits(roomCode, matchState) {
  if (matchState.mode !== 'running') {
    return;
  }

  for (let i = 0; i < matchState.bullets.length; i += 1) {
    const b = matchState.bullets[i];

    const targetRole = b.owner === 'p1' ? 'p2' : 'p1';
    const target = matchState.players[targetRole];
    if (!target) {
      continue;
    }

    const sum = b.radius + target.radius;
    if (distSq(b.x, b.y, target.x, target.y) <= sum * sum) {
      if (target.shield) {
        target.shield = false;
      } else {
        target.health -= 1;
      }
      matchState.bullets.splice(i, 1);

      if (target.health <= 0) {
        matchState.mode = 'ended';
        matchState.winner = b.owner;
        io.to(roomCode).emit('round-ended', { winner: matchState.winner });
      }
      break;
    }
  }
}

function buildSnapshot(matchState) {
  const playersArray = ['p1', 'p2'].map((role) => {
    const p = matchState.players[role];
    if (!p) {
      return [role, 0, 0, 0, 1, 0, 3, 1, 0, 0];
    }
    return [
      role,
      p.x,
      p.y,
      p.angle,
      p.bulletSpeedMultiplier,
      1,
      p.health,
      p.movementSpeedMultiplier,
      p.shield ? 1 : 0,
      p.extraBullets
    ];
  });

  const bulletsArray = matchState.bullets.map((b) => [b.x, b.y, b.vx, b.vy, b.owner]);
  const boostersArray = matchState.boosters.map((booster) => [
    booster.id,
    booster.x,
    booster.y,
    booster.type,
    booster.bonus
  ]);

  let countdownMsLeft = 0;
  if (matchState.mode === 'countdown') {
    const elapsed = Date.now() - matchState.countdownStartAt;
    countdownMsLeft = Math.max(0, matchState.countdownDurationMs - elapsed);
  }

  return {
    players: playersArray,
    bullets: bulletsArray,
    boosters: boostersArray,
    mode: matchState.mode,
    winner: matchState.winner,
    countdownMsLeft,
    arena: [matchState.arena.width, matchState.arena.height]
  };
}

function runSimulationTick(roomCode, match) {
  const matchState = match.matchState;
  if (!matchState) {
    return;
  }

  if (matchState.mode === 'countdown') {
    updateAimAnglesOnly(matchState);
    const elapsed = Date.now() - matchState.countdownStartAt;
    if (elapsed >= matchState.countdownDurationMs) {
      matchState.mode = 'running';
      matchState.runningStartAt = Date.now();
    }
  }

  if (matchState.mode === 'running') {
    updatePlayers(matchState, match.dtSec);
    updateBullets(matchState, match.dtSec);
    checkBoosterPickup(matchState);
    checkBulletHits(roomCode, matchState);

    const now = Date.now();
    if (now >= matchState.nextBoosterAt) {
      spawnBooster(matchState);
      matchState.nextBoosterAt = now + randomRange(10000, 15000);
    }
  }

  io.to(roomCode).emit('snapshot', buildSnapshot(matchState));
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function createRoom() {
  let roomCode = makeRoomCode();
  while (rooms.has(roomCode)) {
    roomCode = makeRoomCode();
  }

  const room = {
    matchState: freshMatchState(),
    rematchVotes: new Set(),
    loop: null,
    lastTick: Date.now(),
    dtSec: 1 / 60
  };

  room.loop = setInterval(() => {
    const now = Date.now();
    room.dtSec = Math.min(0.05, (now - room.lastTick) / 1000);
    room.lastTick = now;
    runSimulationTick(roomCode, room);
  }, 1000 / 60);

  rooms.set(roomCode, room);
  return roomCode;
}

function cleanupRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  const nobodyInside = !room.matchState.players.p1 && !room.matchState.players.p2;
  if (nobodyInside) {
    if (room.loop) {
      clearInterval(room.loop);
    }
    rooms.delete(roomCode);
  }
}

function assignRole(room) {
  if (!room.matchState.players.p1) {
    return 'p1';
  }
  if (!room.matchState.players.p2) {
    return 'p2';
  }
  return null;
}

function emitLobbyState(roomCode, room) {
  io.to(roomCode).emit('lobby-state', {
    roomCode,
    players: {
      p1: !!room.matchState.players.p1,
      p2: !!room.matchState.players.p2
    },
    canStart: !!room.matchState.players.p1 && !!room.matchState.players.p2
  });
}

const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('create-room', (ack) => {
    const roomCode = createRoom();
    if (typeof ack === 'function') {
      ack({ ok: true, roomCode });
    }
  });

  socket.on('join-room', ({ roomCode }, ack) => {
    const normalized = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(normalized);

    if (!room) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Room not found.' });
      }
      return;
    }

    const role = assignRole(room);
    if (!role) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Room is full.' });
      }
      socket.emit('room-full');
      return;
    }

    socket.join(normalized);
    socket.data.roomCode = normalized;
    socket.data.role = role;

    const player = makePlayer(role);
    player.socketId = socket.id;
    player.connected = true;
    room.matchState.players[role] = player;

    socket.emit('assigned-role', { role, roomCode: normalized });
    if (typeof ack === 'function') {
      ack({ ok: true, role, roomCode: normalized });
    }
    emitLobbyState(normalized, room);
  });

  // Arena size is fixed server-side for consistency across different client viewports.

  socket.on('input', ({ moveX, moveY, aimX, aimY }) => {
    const roomCode = socket.data.roomCode;
    const role = socket.data.role;
    const room = rooms.get(roomCode);
    if (!room || !role) {
      return;
    }

    const p = room.matchState.players[role];
    if (!p) {
      return;
    }

    p.inputX = Number.isFinite(moveX) ? clamp(moveX, -1, 1) : 0;
    p.inputY = Number.isFinite(moveY) ? clamp(moveY, -1, 1) : 0;
    p.aimX = Number.isFinite(aimX) ? aimX : p.aimX;
    p.aimY = Number.isFinite(aimY) ? aimY : p.aimY;
  });

  socket.on('shoot', () => {
    const roomCode = socket.data.roomCode;
    const role = socket.data.role;
    const room = rooms.get(roomCode);
    if (!room || !role) {
      return;
    }

    tryShoot(room.matchState, role);
  });

  socket.on('rematch', () => {
    const roomCode = socket.data.roomCode;
    const role = socket.data.role;
    const room = rooms.get(roomCode);
    if (!room || !role) {
      return;
    }

    room.rematchVotes.add(role);
    if (room.rematchVotes.size === 2 && room.matchState.players.p1 && room.matchState.players.p2) {
      startCountdown(roomCode, room);
    }
  });

  socket.on('start-match', () => {
    const roomCode = socket.data.roomCode;
    const role = socket.data.role;
    const room = rooms.get(roomCode);
    if (!room || !role) {
      return;
    }

    if (role !== 'p1') {
      return;
    }

    if (!room.matchState.players.p1 || !room.matchState.players.p2) {
      return;
    }

    if (room.matchState.mode !== 'waiting' && room.matchState.mode !== 'ended') {
      return;
    }

    startCountdown(roomCode, room);
  });

  socket.on('leave-match', () => {
    socket.disconnect(true);
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    const role = socket.data.role;
    if (!roomCode || !role) {
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      return;
    }

    if (room.matchState.players[role]) {
      room.matchState.players[role] = null;
    }

    room.rematchVotes.clear();
    room.matchState.mode = 'waiting';
    room.matchState.winner = null;
    room.matchState.bullets = [];
    room.matchState.boosters = [];

    io.to(roomCode).emit('peer-disconnected');
    emitLobbyState(roomCode, room);
    cleanupRoomIfEmpty(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Bullet Shooter Web listening on :${PORT}`);
});