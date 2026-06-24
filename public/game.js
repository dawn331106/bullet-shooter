(function () {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const menuScreen = document.getElementById('menu-screen');
  const lobbyScreen = document.getElementById('lobby-screen');
  const createRoomPanel = document.getElementById('create-room-panel');
  const joinRoomPanel = document.getElementById('join-room-panel');
  const roomCodeLabel = document.getElementById('room-code-label');
  const lobbyRoomCode = document.getElementById('lobby-room-code');
  const lobbyP1 = document.getElementById('lobby-p1');
  const lobbyP2 = document.getElementById('lobby-p2');
  const joinRoomInput = document.getElementById('join-room-input');
  const countdownScreen = document.getElementById('countdown-screen');
  const resultScreen = document.getElementById('result-screen');
  const resultTitle = document.getElementById('result-title');
  const tutorialOverlay = document.getElementById('tutorial-overlay');
  const tutorialPanel = document.getElementById('tutorial-panel');
  const toast = document.getElementById('toast');

  const btnBot = document.getElementById('btn-bot');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const btnHowToPlay = document.getElementById('btn-how-to-play');
  const btnLobbyStart = document.getElementById('btn-lobby-start');
  const btnLobbyExit = document.getElementById('btn-lobby-exit');
  const btnConnectRoom = document.getElementById('btn-connect-room');
  const btnRematch = document.getElementById('btn-rematch');
  const btnExit = document.getElementById('btn-exit');
  const btnCloseTutorial = document.getElementById('btn-close-tutorial');

  const GAME = {
    playerRadius: 18,
    playerSpeed: 260,
    baseBulletSpeed: 210,
    bulletRadius: 6,
    boosterRadius: 22,
    countdownMs: 3000
  };

  const bgMusicElement = document.getElementById('bgMusic');
  if (bgMusicElement) {
    bgMusicElement.volume = 0.9;
  }

  const audio = {
    ctx: null,
    masterGain: null,
    musicGain: null,
    musicStarted: false
  };

  function ensureAudioReady() {
    if (audio.ctx) {
      if (audio.ctx.state === 'suspended') {
        audio.ctx.resume().catch(() => {});
      }
      return true;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return false;
    }

    audio.ctx = new Ctx();
    audio.masterGain = audio.ctx.createGain();
    audio.masterGain.gain.value = 0.18;
    audio.masterGain.connect(audio.ctx.destination);

    audio.musicGain = audio.ctx.createGain();
    audio.musicGain.gain.value = 0.05;
    audio.musicGain.connect(audio.masterGain);
    return true;
  }

  function stopMusic() {
    if (bgMusicElement) {
      bgMusicElement.pause();
    }
    audio.musicStarted = false;
  }

  function startMusic() {
    if (!audio.musicStarted && bgMusicElement) {
      bgMusicElement.currentTime = 0;
      bgMusicElement.play().catch(() => {});
      audio.musicStarted = true;
    }
  }

  function playSound(type) {
    try {
      if (!ensureAudioReady()) {
        return;
      }
      const now = audio.ctx.currentTime;

      if (type === 'hit') {
        const osc = audio.ctx.createOscillator();
        const gain = audio.ctx.createGain();
        osc.connect(gain);
        gain.connect(audio.masterGain);
        osc.frequency.value = 150;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'booster-pickup') {
        const osc = audio.ctx.createOscillator();
        const gain = audio.ctx.createGain();
        osc.connect(gain);
        gain.connect(audio.masterGain);
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'victory') {
        const frequencies = [523.25, 659.25, 783.99];
        frequencies.forEach((freq, idx) => {
          const osc = audio.ctx.createOscillator();
          const gain = audio.ctx.createGain();
          osc.connect(gain);
          gain.connect(audio.masterGain);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const startTime = now + idx * 0.15;
          gain.gain.setValueAtTime(0.1, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);
          osc.start(startTime);
          osc.stop(startTime + 0.2);
        });
      }
    } catch (_err) {
      // Audio unavailable.
    }
  }

  const inputState = {
    keys: new Set(),
    mouseX: window.innerWidth * 0.5,
    mouseY: window.innerHeight * 0.5
  };

  const game = {
    mode: 'menu',
    subMode: null,
    players: {
      p1: null,
      p2: null
    },
    bullets: [],
    boosters: [],
    winner: null,
    countdownStartAt: 0,
    countdownDurationMs: GAME.countdownMs,
    localRole: 'p1',
    bot: null,
    socket: null,
    roomCode: '',
    isRoomCreator: false,
    lobby: {
      p1Joined: false,
      p2Joined: false,
      canStart: false
    },
    onlineArena: {
      width: null,
      height: null
    },
    lastBotShotAt: 0,
    nextBoosterAt: 0,
    runningStartAt: 0,
    hitFreezeUntil: 0,
    hitFlashUntil: 0,
    hitShakeUntil: 0,
    hitShakePower: 0,
    renderPlayers: {
      p1: null,
      p2: null
    },
    renderBullets: []
  };

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function normalize(x, y) {
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

  function randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function showToast(message, timeout = 2500) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add('hidden'), timeout);
  }

  function setPanelVisible(el, visible) {
    if (visible) {
      el.classList.remove('hidden');
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
      el.classList.add('hidden');
    }
  }

  function hideSubPanels() {
    createRoomPanel.classList.add('hidden');
    joinRoomPanel.classList.add('hidden');
  }

  function openTutorial() {
    tutorialOverlay.classList.remove('hidden');
    tutorialOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeTutorial() {
    tutorialOverlay.classList.add('hidden');
    tutorialOverlay.setAttribute('aria-hidden', 'true');
  }

  function applyOnlineArena(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }

    const w = Math.max(320, Math.round(width));
    const h = Math.max(200, Math.round(height));
    game.onlineArena.width = w;
    game.onlineArena.height = h;
    canvas.width = w;
    canvas.height = h;
  }

  function emitArenaSizeCandidate() {
    if (!game.socket || game.subMode !== 'online') {
      return;
    }

    game.socket.emit('arena-size', {
      width: window.innerWidth,
      height: window.innerHeight
    });
  }

  function resizeCanvas() {
    if (game.subMode === 'online' && Number.isFinite(game.onlineArena.width) && Number.isFinite(game.onlineArena.height)) {
      canvas.width = game.onlineArena.width;
      canvas.height = game.onlineArena.height;
      emitArenaSizeCandidate();
      return;
    }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (game.subMode !== 'online') {
      ['p1', 'p2'].forEach((role) => {
        const p = game.players[role];
        if (!p) {
          return;
        }
        p.x = clamp(p.x, p.radius, canvas.width - p.radius);
        p.y = clamp(p.y, p.radius, canvas.height - p.radius);
      });
    }
  }

  function createPlayer(role) {
    const isP1 = role === 'p1';
    return {
      role,
      x: isP1 ? 180 : Math.max(260, canvas.width - 180),
      y: canvas.height * 0.5,
      radius: GAME.playerRadius,
      moveSpeed: GAME.playerSpeed,
      bulletSpeedMultiplier: 1,
      movementSpeedMultiplier: 1,
      health: 3,
      shield: false,
      extraBullets: 0,
      angle: isP1 ? 0 : Math.PI,
      inputX: 0,
      inputY: 0,
      aimX: isP1 ? 1 : -1,
      aimY: 0
    };
  }

  function resetLocalRound() {
    game.players.p1 = createPlayer('p1');
    game.players.p2 = createPlayer('p2');
    game.bullets = [];
    game.boosters = [];
    game.winner = null;
    game.nextBoosterAt = performance.now() + randomRange(10000, 15000);
    game.lastBotShotAt = performance.now();
    game.hitFreezeUntil = 0;
    game.hitFlashUntil = 0;
    game.hitShakeUntil = 0;
    game.hitShakePower = 0;
    if (game.bot) {
      game.bot.reset();
    }
  }

  function startCountdownLocal() {
    game.mode = 'countdown';
    game.countdownStartAt = performance.now();
    startMusic();
    countdownScreen.classList.remove('hidden');
  }

  function triggerHitFeedback(targetRole) {
    const now = performance.now();
    const isLocalHit = targetRole === game.localRole || game.subMode === 'bot';
    if (!isLocalHit) {
      return;
    }

    game.hitFreezeUntil = now + 70;
    game.hitFlashUntil = now + 140;
    game.hitShakeUntil = now + 180;
    game.hitShakePower = 8;

    if (navigator.vibrate) {
      navigator.vibrate(60);
    }
  }

  function countdownValue() {
    const left = Math.max(0, game.countdownDurationMs - (performance.now() - game.countdownStartAt));
    return Math.max(1, Math.ceil(left / 1000));
  }

  function isCountdownOver() {
    return performance.now() - game.countdownStartAt >= game.countdownDurationMs;
  }

  function getInputAxes() {
    const left = inputState.keys.has('a') || inputState.keys.has('arrowleft');
    const right = inputState.keys.has('d') || inputState.keys.has('arrowright');
    const up = inputState.keys.has('w') || inputState.keys.has('arrowup');
    const down = inputState.keys.has('s') || inputState.keys.has('arrowdown');
    return {
      x: (right ? 1 : 0) - (left ? 1 : 0),
      y: (down ? 1 : 0) - (up ? 1 : 0)
    };
  }

  function bulletCapacityForElapsed(elapsedMs) {
    return Math.min(7, 1 + Math.floor(elapsedMs / 10000));
  }

  function elapsedSinceRunningStartMs() {
    if (game.runningStartAt <= 0) {
      return 0;
    }
    return Math.max(0, performance.now() - game.runningStartAt);
  }

  function currentBulletCapacity() {
    return bulletCapacityForElapsed(elapsedSinceRunningStartMs());
  }

  function nextBulletUnlockSecondsLeft() {
    const elapsedMs = elapsedSinceRunningStartMs();
    const cap = bulletCapacityForElapsed(elapsedMs);

    if (cap >= 7) {
      return 0;
    }

    const nextThresholdMs = cap * 10000;
    return Math.max(0, (nextThresholdMs - elapsedMs) / 1000);
  }

  function bulletCountForOwner(ownerRole) {
    return game.bullets.reduce((count, bullet) => {
      return bullet.owner === ownerRole ? count + 1 : count;
    }, 0);
  }

  function tryShootLocal(role) {
    if (game.mode !== 'playing') {
      return;
    }

    const shooter = game.players[role];
    if (!shooter) {
      return;
    }

    const capacity = currentBulletCapacity();
    const bulletCount = bulletCountForOwner(role);
    const canShootExtra = shooter.extraBullets > 0;

    if (bulletCount >= capacity && !canShootExtra) {
      return;
    }

    const aim = normalize(shooter.aimX, shooter.aimY);
    if (aim.x === 0 && aim.y === 0) {
      return;
    }

    const speed = GAME.baseBulletSpeed * shooter.bulletSpeedMultiplier;
    const spawnOffset = shooter.radius + 9;

    game.bullets.push({
      x: shooter.x + aim.x * spawnOffset,
      y: shooter.y + aim.y * spawnOffset,
      vx: aim.x * speed,
      vy: aim.y * speed,
      radius: GAME.bulletRadius,
      owner: role
    });

    if (canShootExtra) {
      shooter.extraBullets -= 1;
    }
  }

  function updateLocalInputs() {
    if (game.mode !== 'playing' && game.mode !== 'countdown') {
      return;
    }

    const p1 = game.players.p1;
    if (!p1) {
      return;
    }

    const move = getInputAxes();
    p1.inputX = move.x;
    p1.inputY = move.y;

    const aim = normalize(inputState.mouseX - p1.x, inputState.mouseY - p1.y);
    p1.aimX = aim.x;
    p1.aimY = aim.y;
  }

  function updatePlayers(dtSec) {
    ['p1', 'p2'].forEach((role) => {
      const p = game.players[role];
      if (!p) {
        return;
      }

      const move = normalize(p.inputX, p.inputY);
      const effectiveSpeed = p.moveSpeed * p.movementSpeedMultiplier;
      p.x += move.x * effectiveSpeed * dtSec;
      p.y += move.y * effectiveSpeed * dtSec;
      p.x = clamp(p.x, p.radius, canvas.width - p.radius);
      p.y = clamp(p.y, p.radius, canvas.height - p.radius);

      const aim = normalize(p.aimX, p.aimY);
      if (aim.x || aim.y) {
        p.angle = Math.atan2(aim.y, aim.x);
      }
    });
  }

  function updateAimOnly() {
    ['p1', 'p2'].forEach((role) => {
      const p = game.players[role];
      if (!p) {
        return;
      }
      const aim = normalize(p.aimX, p.aimY);
      if (aim.x || aim.y) {
        p.angle = Math.atan2(aim.y, aim.x);
      }
    });
  }

  function updateBullets(dtSec) {
    for (let i = 0; i < game.bullets.length; i += 1) {
      const b = game.bullets[i];
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;

      if (b.x - b.radius < 0) {
        b.x = b.radius;
        b.vx = -b.vx;
      } else if (b.x + b.radius > canvas.width) {
        b.x = canvas.width - b.radius;
        b.vx = -b.vx;
      }

      if (b.y - b.radius < 0) {
        b.y = b.radius;
        b.vy = -b.vy;
      } else if (b.y + b.radius > canvas.height) {
        b.y = canvas.height - b.radius;
        b.vy = -b.vy;
      }
    }
  }

  function spawnBooster() {
    const boosterTypes = [
      { type: 'bullet-speed', bonus: 0.1, label: '+10% speed' },
      { type: 'bullet-speed', bonus: 0.2, label: '+20% speed' },
      { type: 'bullet-speed', bonus: 0.3, label: '+30% speed' },
      { type: 'movement-speed', bonus: 0.05, label: '+5% move' },
      { type: 'movement-speed', bonus: 0.10, label: '+10% move' },
      { type: 'shield', bonus: 1, label: 'Shield' },
      { type: 'extra-bullet', bonus: 1, label: '+1 Bullet' }
    ];
    const booster = boosterTypes[Math.floor(Math.random() * boosterTypes.length)];
    game.boosters.push({
      id: `local_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
      x: randomRange(40, canvas.width - 40),
      y: randomRange(40, canvas.height - 40),
      radius: GAME.boosterRadius,
      type: booster.type,
      bonus: booster.bonus,
      label: booster.label
    });
  }

  function pickupBoosters() {
    ['p1', 'p2'].forEach((role) => {
      const p = game.players[role];
      if (!p) {
        return;
      }

      for (let i = game.boosters.length - 1; i >= 0; i -= 1) {
        const booster = game.boosters[i];
        const sum = p.radius + booster.radius;
        if (distSq(p.x, p.y, booster.x, booster.y) <= sum * sum) {
          playSound('booster-pickup');

          if (booster.type === 'bullet-speed') {
            const scale = 1 + booster.bonus;
            p.bulletSpeedMultiplier *= scale;
            for (let j = 0; j < game.bullets.length; j += 1) {
              if (game.bullets[j].owner === role) {
                game.bullets[j].vx *= scale;
                game.bullets[j].vy *= scale;
              }
            }
          } else if (booster.type === 'movement-speed') {
            const scale = 1 + booster.bonus;
            p.movementSpeedMultiplier *= scale;
          } else if (booster.type === 'shield') {
            if (!p.shield) {
              p.shield = true;
            }
          } else if (booster.type === 'extra-bullet') {
            p.extraBullets += 1;
          }

          game.boosters.splice(i, 1);
        }
      }
    });
  }

  function checkHitsLocal() {
    if (game.mode !== 'playing') {
      return;
    }

    if (game.bullets.length === 0) {
      return;
    }

    for (let i = 0; i < game.bullets.length; i += 1) {
      const b = game.bullets[i];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
        continue;
      }

      if (b.owner !== 'p1' && b.owner !== 'p2') {
        continue;
      }

      const targetRole = b.owner === 'p1' ? 'p2' : 'p1';
      const target = game.players[targetRole];
      if (!target) {
        continue;
      }

      const sum = b.radius + target.radius;
      if (distSq(b.x, b.y, target.x, target.y) <= sum * sum) {
        playSound('hit');
        triggerHitFeedback(targetRole);

        if (target.shield) {
          target.shield = false;
        } else {
          target.health -= 1;
        }

        game.bullets.splice(i, 1);

        if (target.health <= 0) {
          game.mode = 'ended';
          game.winner = b.owner;
          resultTitle.textContent = b.owner === 'p1' ? 'Victory' : 'Defeat';
          setPanelVisible(resultScreen, true);
          stopMusic();
          playSound('victory');
        }
        break;
      }
    }
  }

  class BotFSM {
    constructor() {
      this.state = 'attack';
      this.strafePhase = 0;
    }

    reset() {
      this.state = 'attack';
      this.strafePhase = 0;
    }

    scanThreat(bot, bullets) {
      const horizonFrames = 120;
      for (let i = 0; i < bullets.length; i += 1) {
        const b = bullets[i];
        if (b.owner !== 'p1') {
          continue;
        }

        let simX = b.x;
        let simY = b.y;
        let simVx = b.vx;
        let simVy = b.vy;

        for (let f = 0; f < horizonFrames; f += 1) {
          simX += simVx / 60;
          simY += simVy / 60;

          if (simX - GAME.bulletRadius < 0) {
            simX = GAME.bulletRadius;
            simVx = -simVx;
          } else if (simX + GAME.bulletRadius > canvas.width) {
            simX = canvas.width - GAME.bulletRadius;
            simVx = -simVx;
          }

          if (simY - GAME.bulletRadius < 0) {
            simY = GAME.bulletRadius;
            simVy = -simVy;
          } else if (simY + GAME.bulletRadius > canvas.height) {
            simY = canvas.height - GAME.bulletRadius;
            simVy = -simVy;
          }

          const safety = bot.radius + GAME.bulletRadius + 10;
          if (distSq(simX, simY, bot.x, bot.y) <= safety * safety) {
            return { vx: simVx, vy: simVy };
          }
        }
      }
      return null;
    }

    predictPlayerPos(enemy, timeAheadMs) {
      const dtSec = timeAheadMs / 1000;
      const move = normalize(enemy.inputX, enemy.inputY);
      return {
        x: enemy.x + move.x * enemy.moveSpeed * dtSec,
        y: enemy.y + move.y * enemy.moveSpeed * dtSec
      };
    }

    update(bot, enemy, boosters, bullets, nowMs) {
      const threat = this.scanThreat(bot, bullets);

      if (threat) {
        this.state = 'evade';
        const vel = normalize(threat.vx, threat.vy);
        const moveA = { x: -vel.y, y: vel.x };
        const moveB = { x: vel.y, y: -vel.x };

        const scoreA = distSq(bot.x + moveA.x * 40, bot.y + moveA.y * 40, enemy.x, enemy.y);
        const scoreB = distSq(bot.x + moveB.x * 40, bot.y + moveB.y * 40, enemy.x, enemy.y);
        const pick = scoreA > scoreB ? moveA : moveB;

        bot.inputX = pick.x;
        bot.inputY = pick.y;
      } else if (boosters.length > 0) {
        this.state = 'seek';
        let target = boosters[0];
        let d = distSq(bot.x, bot.y, target.x, target.y);
        for (let i = 1; i < boosters.length; i += 1) {
          const cur = distSq(bot.x, bot.y, boosters[i].x, boosters[i].y);
          if (cur < d) {
            d = cur;
            target = boosters[i];
          }
        }
        const dir = normalize(target.x - bot.x, target.y - bot.y);
        bot.inputX = dir.x;
        bot.inputY = dir.y;
      } else {
        this.state = 'attack';
        const toEnemy = normalize(enemy.x - bot.x, enemy.y - bot.y);
        const distance = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);

        if (distance > 200) {
          bot.inputX = toEnemy.x;
          bot.inputY = toEnemy.y;
        } else if (distance < 100) {
          bot.inputX = -toEnemy.x;
          bot.inputY = -toEnemy.y;
        } else {
          this.strafePhase += 0.04;
          const perpA = { x: -toEnemy.y, y: toEnemy.x };
          const perpB = { x: toEnemy.y, y: -toEnemy.x };
          const sineInfluence = Math.sin(this.strafePhase);

          if (sineInfluence > 0) {
            bot.inputX = perpA.x;
            bot.inputY = perpA.y;
          } else {
            bot.inputX = perpB.x;
            bot.inputY = perpB.y;
          }
        }
      }

      const predictedPos = this.predictPlayerPos(enemy, 100);
      const aim = normalize(predictedPos.x - bot.x, predictedPos.y - bot.y);
      bot.aimX = aim.x;
      bot.aimY = aim.y;

      if (nowMs - game.lastBotShotAt >= 1500) {
        tryShootLocal('p2');
        game.lastBotShotAt = nowMs;
      }
    }
  }

  function startBotMode() {
    if (game.socket) {
      game.socket.disconnect();
      game.socket = null;
    }

    game.subMode = 'bot';
    game.localRole = 'p1';
    game.bot = new BotFSM();
    game.runningStartAt = 0;
    resetLocalRound();
    setPanelVisible(menuScreen, false);
    setPanelVisible(lobbyScreen, false);
    setPanelVisible(resultScreen, false);
    startCountdownLocal();
  }

  function updateLobbyView() {
    lobbyRoomCode.textContent = game.roomCode || '------';
    lobbyP1.textContent = game.lobby.p1Joined ? 'Player 1 (Host): Joined' : 'Player 1 (Host): Waiting...';
    lobbyP2.textContent = game.lobby.p2Joined ? 'Player 2: Joined' : 'Player 2: Waiting...';

    const isHost = game.localRole === 'p1';
    btnLobbyStart.disabled = !isHost || !game.lobby.canStart;
    btnLobbyStart.textContent = isHost ? 'Start Match' : 'Only Host Can Start';
  }

  function enterLobby() {
    game.mode = 'lobby';
    setPanelVisible(menuScreen, false);
    setPanelVisible(lobbyScreen, true);
    setPanelVisible(resultScreen, false);
    countdownScreen.classList.add('hidden');
    updateLobbyView();
  }

  function getSocket() {
    if (!game.socket) {
      game.socket = io({
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
      });
      bindSocketHandlers(game.socket);
    }
    return game.socket;
  }

  function createOnlineRoom() {
    const socket = getSocket();
    socket.emit('create-room', (res) => {
      if (!res || !res.ok) {
        showToast('Failed to create room.');
        return;
      }

      const roomCode = res.roomCode;
      game.roomCode = roomCode;
      game.isRoomCreator = true;
      roomCodeLabel.textContent = roomCode;
      showToast('Room created. Share the code.');

      socket.emit('join-room', { roomCode }, (joinRes) => {
        if (!joinRes || !joinRes.ok) {
          showToast(joinRes?.error || 'Unable to join your room.');
        }
      });
    });
  }

  function joinOnlineRoom(roomCode) {
    const socket = getSocket();
    socket.emit('join-room', { roomCode }, (res) => {
      if (!res || !res.ok) {
        showToast(res?.error || 'Unable to join room.');
      }
    });
  }

  function boosterLabel(type, bonus) {
    if (type === 'bullet-speed') {
      return `+${Math.round((bonus || 0) * 100)}% speed`;
    }
    if (type === 'movement-speed') {
      return `+${Math.round((bonus || 0) * 100)}% move`;
    }
    if (type === 'shield') {
      return 'Shield';
    }
    if (type === 'extra-bullet') {
      return '+1 Bullet';
    }
    return 'Booster';
  }

  function bindSocketHandlers(socket) {
    socket.on('connect', () => {
      if (game.subMode === 'online' && game.mode !== 'menu') {
        showToast('Connected.');
      }
    });

    socket.on('assigned-role', ({ role, roomCode }) => {
      game.localRole = role;
      game.roomCode = roomCode;
      game.subMode = 'online';
      enterLobby();
      emitArenaSizeCandidate();
      showToast(`Joined room ${roomCode} as ${role.toUpperCase()}`);
    });

    socket.on('lobby-state', ({ roomCode, players, canStart, arena }) => {
      game.roomCode = roomCode;
      game.lobby.p1Joined = !!players?.p1;
      game.lobby.p2Joined = !!players?.p2;
      game.lobby.canStart = !!canStart;
      if (Array.isArray(arena) && arena.length === 2) {
        applyOnlineArena(arena[0], arena[1]);
      }

      if (game.subMode === 'online' && (game.mode === 'lobby' || game.mode === 'waiting-network')) {
        enterLobby();
      }
    });

    socket.on('countdown-start', ({ startAt, durationMs, arena }) => {
      game.mode = 'countdown';
      game.countdownDurationMs = durationMs;
      game.countdownStartAt = performance.now() - Math.max(0, Date.now() - startAt);
      const runningAtUnixMs = startAt + durationMs;
      game.runningStartAt = performance.now() + Math.max(0, runningAtUnixMs - Date.now());
      if (Array.isArray(arena) && arena.length === 2) {
        applyOnlineArena(arena[0], arena[1]);
      }
      startMusic();
      countdownScreen.classList.remove('hidden');
      setPanelVisible(lobbyScreen, false);
      setPanelVisible(resultScreen, false);
    });

    socket.on('snapshot', (snapshot) => {
      if (game.subMode !== 'online') {
        return;
      }

      const prevMe = game.players[game.localRole];

      const players = {};
      snapshot.players.forEach((p) => {
        const [
          role,
          x,
          y,
          angle,
          bulletSpeedMultiplier,
          connected,
          health,
          movementSpeedMultiplier,
          shield,
          extraBullets
        ] = p;
        players[role] = {
          role,
          x,
          y,
          radius: GAME.playerRadius,
          angle,
          bulletSpeedMultiplier,
          health: Number.isFinite(health) ? health : 3,
          movementSpeedMultiplier: Number.isFinite(movementSpeedMultiplier) ? movementSpeedMultiplier : 1,
          shield: shield === 1,
          extraBullets: Number.isFinite(extraBullets) ? extraBullets : 0,
          connected: connected === 1
        };
      });

      game.players.p1 = players.p1 || null;
      game.players.p2 = players.p2 || null;

      if (!game.renderPlayers.p1 && game.players.p1) {
        game.renderPlayers.p1 = { ...game.players.p1 };
      }
      if (!game.renderPlayers.p2 && game.players.p2) {
        game.renderPlayers.p2 = { ...game.players.p2 };
      }

      const nextMe = game.players[game.localRole];
      if (prevMe && nextMe && snapshot.mode === 'running') {
        const tookDamage = nextMe.health < prevMe.health;
        const shieldBroke = prevMe.shield && !nextMe.shield;
        if (tookDamage || shieldBroke) {
          playSound('hit');
          triggerHitFeedback(game.localRole);
        }
      }

      game.bullets = snapshot.bullets.map((b) => ({
        x: b[0],
        y: b[1],
        vx: b[2],
        vy: b[3],
        owner: b[4],
        radius: GAME.bulletRadius
      }));
      if (Array.isArray(snapshot.arena) && snapshot.arena.length === 2) {
        applyOnlineArena(snapshot.arena[0], snapshot.arena[1]);
      }
      if (game.renderBullets.length === 0) {
        game.renderBullets = game.bullets.map((b) => ({ ...b }));
      }
      game.boosters = snapshot.boosters.map((x) => ({
        id: x[0],
        x: x[1],
        y: x[2],
        type: x[3],
        bonus: x[4],
        radius: GAME.boosterRadius,
        label: boosterLabel(x[3], x[4])
      }));

      if (snapshot.mode === 'running') {
        game.mode = 'playing';
        startMusic();
        if (game.runningStartAt <= 0) {
          game.runningStartAt = performance.now();
        }
      } else if (snapshot.mode === 'countdown') {
        game.mode = 'countdown';
      } else if (snapshot.mode === 'ended') {
        game.mode = 'ended';
        game.winner = snapshot.winner;
      }
    });

    socket.on('round-ended', ({ winner }) => {
      if (game.subMode !== 'online') {
        return;
      }

      game.mode = 'ended';
      game.winner = winner;
      resultTitle.textContent = winner === game.localRole ? 'You Win' : 'You Lose';
      setPanelVisible(resultScreen, true);
      stopMusic();
    });

    socket.on('peer-disconnected', () => {
      if (game.mode === 'playing' || game.mode === 'countdown' || game.mode === 'ended') {
        showToast('Opponent disconnected. Returning to menu.');
        enterMenu();
      } else {
        showToast('A player left the lobby.');
      }
    });

    socket.on('room-full', () => {
      showToast('Room is full.');
      enterMenu();
    });

    socket.on('disconnect', (reason) => {
      if (game.subMode === 'online') {
        if (reason === 'io server disconnect') {
          showToast('Disconnected from match.');
          enterMenu();
        } else {
          showToast('Connection lost. Reconnecting...');
        }
      }
    });

    socket.on('connect_error', () => {
      showToast('Server waking up... retrying connection.');
    });
  }

  function sendOnlineInput() {
    if (!game.socket) {
      return;
    }

    const me = game.players[game.localRole];
    if (!me) {
      return;
    }

    const move = getInputAxes();
    const aim = normalize(inputState.mouseX - me.x, inputState.mouseY - me.y);

    game.socket.emit('input', {
      moveX: move.x,
      moveY: move.y,
      aimX: aim.x,
      aimY: aim.y
    });
  }

  function drawArena() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#0a1521');
    grad.addColorStop(1, '#111d2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(180, 220, 255, 0.12)';
    const step = 48;
    for (let x = 0; x < canvas.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function drawPlayerShip(player, palette, isLocal) {
    if (!player) {
      return;
    }

    const bodyLen = player.radius * 2.2;
    const bodyWid = player.radius * 1.2;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);

    ctx.fillStyle = palette.shadow;
    ctx.beginPath();
    ctx.ellipse(-3, 3, bodyLen * 0.55, bodyWid * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.body;
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.55, 0);
    ctx.lineTo(-bodyLen * 0.35, bodyWid * 0.62);
    ctx.lineTo(-bodyLen * 0.56, 0);
    ctx.lineTo(-bodyLen * 0.35, -bodyWid * 0.62);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.23, 0);
    ctx.lineTo(-bodyLen * 0.22, bodyWid * 0.24);
    ctx.lineTo(-bodyLen * 0.28, 0);
    ctx.lineTo(-bodyLen * 0.22, -bodyWid * 0.24);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f5fbff';
    ctx.fillRect(bodyLen * 0.46, -2.5, 10, 5);

    if (isLocal) {
      ctx.strokeStyle = 'rgba(255,255,255,0.78)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, bodyLen * 0.67, bodyWid * 0.82, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    if (player.shield) {
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius + 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(100, 200, 255, 0.1)';
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius + 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '12px Bahnschrift';
    ctx.fillText(`x${(player.bulletSpeedMultiplier || 1).toFixed(2)}`, player.x - 16, player.y - player.radius - 12);
  }

  function drawBullets(list) {
    list.forEach((b) => {
      ctx.fillStyle = b.owner === 'p1' ? '#ff8f3f' : '#59a0ff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawBoosters() {
    game.boosters.forEach((booster, i) => {
      const pulse = 0.82 + 0.18 * Math.sin(performance.now() * 0.01 + i);
      ctx.save();
      ctx.globalAlpha = pulse;
      if (booster.type === 'bullet-speed') {
        ctx.fillStyle = '#ffb84d';
        ctx.shadowColor = '#ffcc80';
      } else if (booster.type === 'movement-speed') {
        ctx.fillStyle = '#00d084';
        ctx.shadowColor = '#00ff9d';
      } else if (booster.type === 'shield') {
        ctx.fillStyle = '#ff6b9d';
        ctx.shadowColor = '#ff99cc';
      } else if (booster.type === 'extra-bullet') {
        ctx.fillStyle = '#d946ef';
        ctx.shadowColor = '#f472b6';
      }
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(booster.x, booster.y, booster.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (booster.label) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Bahnschrift';
        ctx.textAlign = 'center';
        ctx.fillText(booster.label, booster.x, booster.y + 4);
        ctx.textAlign = 'left';
      }
    });
  }

  function renderHud() {
    if (game.mode === 'countdown') {
      countdownScreen.textContent = String(countdownValue());
      countdownScreen.classList.remove('hidden');
    } else {
      countdownScreen.classList.add('hidden');
    }

    if (game.mode === 'ended' && game.subMode === 'bot') {
      resultTitle.textContent = game.winner === 'p1' ? 'Victory' : 'Defeat';
      setPanelVisible(resultScreen, true);
    }

    if (game.subMode && (game.mode === 'countdown' || game.mode === 'playing')) {
      const cap = game.mode === 'playing' ? currentBulletCapacity() : 1;
      const countdownSec = game.mode === 'playing' ? nextBulletUnlockSecondsLeft() : 15;
      const myHealth = game.players[game.localRole]?.health || 0;
      const enemyRole = game.localRole === 'p1' ? 'p2' : 'p1';
      const enemyHealth = game.players[enemyRole]?.health || 0;

      const boxW = 236;
      const boxH = 86;
      const x = canvas.width - boxW - 10;
      const y = 10;

      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillRect(x, y, boxW, boxH);
      ctx.strokeStyle = 'rgba(180, 220, 255, 0.08)';
      ctx.strokeRect(x, y, boxW, boxH);

      ctx.fillStyle = 'rgba(233, 243, 255, 0.95)';
      ctx.font = '13px Bahnschrift';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 3;
      if (cap >= 7) {
        ctx.fillText('Next Bullet Slot: MAX', x + 12, y + 22);
      } else {
        ctx.fillText(`Next Bullet Slot In: ${countdownSec.toFixed(1)}s`, x + 12, y + 22);
      }
      ctx.fillText(`Unlocked Slots: ${cap}/7`, x + 12, y + 42);
      ctx.fillText(`You/Enemy HP: ${myHealth}/3 - ${enemyHealth}/3`, x + 12, y + 62);
      ctx.shadowBlur = 0;
    }
  }

  function updateOffline(dtSec) {
    if (game.mode === 'countdown') {
      updateLocalInputs();
      updateAimOnly();
      if (game.bot && game.players.p2 && game.players.p1) {
        game.bot.update(game.players.p2, game.players.p1, game.boosters, game.bullets, performance.now());
        updateAimOnly();
      }
      if (isCountdownOver()) {
        game.mode = 'playing';
        game.runningStartAt = performance.now();
      }
      return;
    }

    if (game.mode !== 'playing') {
      return;
    }

    updateLocalInputs();

    if (game.bot && game.players.p2 && game.players.p1) {
      game.bot.update(game.players.p2, game.players.p1, game.boosters, game.bullets, performance.now());
    }

    updatePlayers(dtSec);
    updateBullets(dtSec);
    pickupBoosters();
    checkHitsLocal();

    if (performance.now() >= game.nextBoosterAt) {
      spawnBooster();
      game.nextBoosterAt = performance.now() + randomRange(10000, 15000);
    }
  }

  function updateOnline(dtSec) {
    if (!game.socket) {
      return;
    }
    sendOnlineInput();

    const playerBlend = clamp(dtSec * 14, 0, 1);
    ['p1', 'p2'].forEach((role) => {
      const target = game.players[role];
      if (!target) {
        game.renderPlayers[role] = null;
        return;
      }

      if (!game.renderPlayers[role]) {
        game.renderPlayers[role] = { ...target };
        return;
      }

      const view = game.renderPlayers[role];
      view.x = lerp(view.x, target.x, playerBlend);
      view.y = lerp(view.y, target.y, playerBlend);
      view.angle = target.angle;
      view.role = target.role;
      view.radius = target.radius;
      view.bulletSpeedMultiplier = target.bulletSpeedMultiplier;
      view.health = target.health;
      view.movementSpeedMultiplier = target.movementSpeedMultiplier;
      view.shield = target.shield;
      view.extraBullets = target.extraBullets;
      view.connected = target.connected;
    });

    const bulletBlend = clamp(dtSec * 18, 0, 1);
    if (game.renderBullets.length > game.bullets.length + 6) {
      game.renderBullets = game.bullets.map((b) => ({ ...b }));
      return;
    }

    const nextRenderBullets = [];
    for (let i = 0; i < game.bullets.length; i += 1) {
      const target = game.bullets[i];
      const view = game.renderBullets[i] || { ...target };
      view.x = lerp(view.x, target.x, bulletBlend);
      view.y = lerp(view.y, target.y, bulletBlend);
      view.vx = target.vx;
      view.vy = target.vy;
      view.owner = target.owner;
      view.radius = target.radius;
      nextRenderBullets.push(view);
    }
    game.renderBullets = nextRenderBullets;
  }

  function render() {
    const now = performance.now();
    if (now < game.hitShakeUntil) {
      const left = (game.hitShakeUntil - now) / Math.max(1, game.hitShakeUntil - (game.hitShakeUntil - 180));
      const intensity = game.hitShakePower * Math.max(0, Math.min(1, left));
      const sx = (Math.random() * 2 - 1) * intensity;
      const sy = (Math.random() * 2 - 1) * intensity;
      canvas.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px)`;
    } else {
      canvas.style.transform = 'translate(0px, 0px)';
    }

    drawArena();
    drawBoosters();
    const displayPlayers = game.subMode === 'online'
      ? {
        p1: game.renderPlayers.p1 || game.players.p1,
        p2: game.renderPlayers.p2 || game.players.p2
      }
      : game.players;
    const displayBullets = game.subMode === 'online'
      ? (game.renderBullets.length ? game.renderBullets : game.bullets)
      : game.bullets;
    drawBullets(displayBullets);

    drawPlayerShip(displayPlayers.p1, {
      body: '#ff8f3f',
      accent: '#ffd3a8',
      shadow: 'rgba(64, 28, 9, 0.5)'
    }, game.localRole === 'p1');

    drawPlayerShip(displayPlayers.p2, {
      body: '#59a0ff',
      accent: '#d4e8ff',
      shadow: 'rgba(9, 34, 61, 0.5)'
    }, game.localRole === 'p2' && game.subMode === 'online');

    if (now < game.hitFlashUntil) {
      const alpha = Math.max(0, (game.hitFlashUntil - now) / 140) * 0.25;
      ctx.fillStyle = `rgba(255, 70, 70, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    renderHud();
  }

  function enterMenu() {
    game.mode = 'menu';
    game.subMode = null;
    game.winner = null;
    game.players.p1 = null;
    game.players.p2 = null;
    game.bullets = [];
    game.boosters = [];
    game.onlineArena.width = null;
    game.onlineArena.height = null;
    game.runningStartAt = 0;
    game.hitFreezeUntil = 0;
    game.hitFlashUntil = 0;
    game.hitShakeUntil = 0;
    game.hitShakePower = 0;
    game.renderPlayers.p1 = null;
    game.renderPlayers.p2 = null;
    game.renderBullets = [];
    canvas.style.transform = 'translate(0px, 0px)';
    stopMusic();

    if (game.socket) {
      game.socket.disconnect();
      game.socket = null;
    }

    setPanelVisible(menuScreen, true);
    setPanelVisible(lobbyScreen, false);
    setPanelVisible(resultScreen, false);
    countdownScreen.classList.add('hidden');
    hideSubPanels();
    game.roomCode = '';
    game.isRoomCreator = false;
    game.lobby.p1Joined = false;
    game.lobby.p2Joined = false;
    game.lobby.canStart = false;
    resizeCanvas();
  }

  let lastFrame = performance.now();
  function tick(ts) {
    const dtSec = Math.min(0.05, (ts - lastFrame) / 1000);
    lastFrame = ts;

    const isFrozen = performance.now() < game.hitFreezeUntil;

    if (!isFrozen) {
      if (game.subMode === 'online') {
        updateOnline(dtSec);
      } else {
        updateOffline(dtSec);
      }
    }

    render();
    requestAnimationFrame(tick);
  }

  btnBot.addEventListener('click', () => {
    ensureAudioReady();
    startBotMode();
  });

  btnCreateRoom.addEventListener('click', () => {
    ensureAudioReady();
    hideSubPanels();
    createRoomPanel.classList.remove('hidden');
    roomCodeLabel.textContent = 'Creating room...';
    createOnlineRoom();
  });

  btnJoinRoom.addEventListener('click', () => {
    ensureAudioReady();
    hideSubPanels();
    joinRoomPanel.classList.remove('hidden');
  });

  btnHowToPlay.addEventListener('click', () => {
    openTutorial();
  });

  btnLobbyStart.addEventListener('click', () => {
    ensureAudioReady();
    if (game.localRole !== 'p1') {
      showToast('Only host can start the match.');
      return;
    }
    if (!game.socket || !game.lobby.canStart) {
      showToast('Need both players in lobby.');
      return;
    }
    game.socket.emit('start-match');
  });

  btnLobbyExit.addEventListener('click', () => {
    if (game.subMode === 'online' && game.socket) {
      game.socket.emit('leave-match');
    }
    enterMenu();
  });

  btnConnectRoom.addEventListener('click', () => {
    ensureAudioReady();
    const code = joinRoomInput.value.trim().toUpperCase();
    if (!code) {
      showToast('Please enter room code.');
      return;
    }
    joinOnlineRoom(code);
  });

  btnRematch.addEventListener('click', () => {
    if (game.subMode === 'online' && game.socket) {
      game.socket.emit('rematch');
      setPanelVisible(resultScreen, false);
      showToast('Rematch vote sent.');
    } else if (game.subMode === 'bot') {
      setPanelVisible(resultScreen, false);
      startBotMode();
    }
  });

  btnExit.addEventListener('click', () => {
    if (game.subMode === 'online' && game.socket) {
      game.socket.emit('leave-match');
    }
    enterMenu();
  });

  btnCloseTutorial.addEventListener('click', () => {
    closeTutorial();
  });

  tutorialOverlay.addEventListener('click', (e) => {
    if (e.target === tutorialOverlay) {
      closeTutorial();
    }
  });

  tutorialPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  window.addEventListener('resize', resizeCanvas);

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'escape' && !tutorialOverlay.classList.contains('hidden')) {
      closeTutorial();
      return;
    }

    inputState.keys.add(e.key.toLowerCase());

    if (e.key.toLowerCase() === 'escape' && game.mode !== 'menu') {
      enterMenu();
    }
  });

  window.addEventListener('keyup', (e) => {
    inputState.keys.delete(e.key.toLowerCase());
  });

  // When browser focus changes between host/join tabs, keyup can be missed.
  // Clear pressed keys to prevent a permanent sideways movement lock.
  window.addEventListener('blur', () => {
    inputState.keys.clear();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      inputState.keys.clear();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    inputState.mouseX = (e.clientX - rect.left) * scaleX;
    inputState.mouseY = (e.clientY - rect.top) * scaleY;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) {
      return;
    }

    if (game.subMode === 'online' && game.socket) {
      game.socket.emit('shoot');
    } else if (game.subMode === 'bot') {
      tryShootLocal('p1');
    }
  });

  resizeCanvas();
  enterMenu();
  requestAnimationFrame(tick);
})();