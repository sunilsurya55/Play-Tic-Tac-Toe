const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// ---------- Game rules ----------
const GAMES = {
  tictactoe: { rows: 3, cols: 3, need: 3, gravity: false },
  connect4: { rows: 6, cols: 7, need: 4, gravity: true },
};

const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function freshBoard(game) {
  const { rows, cols } = GAMES[game];
  return Array(rows * cols).fill(null);
}

// Looks for `need` equal marks in a row. Works for both games.
function findWin(board, { rows, cols, need }) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mark = board[r * cols + c];
      if (mark === null) continue;
      for (const [dr, dc] of dirs) {
        const line = [];
        for (let k = 0; k < need; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) break;
          if (board[rr * cols + cc] !== mark) break;
          line.push(rr * cols + cc);
        }
        if (line.length === need) return { winner: mark, line };
      }
    }
  }
  return null;
}

function snapshot(room) {
  const { rows, cols } = GAMES[room.game];
  return {
    code: room.code,
    game: room.game,
    rows,
    cols,
    board: room.board,
    turn: room.turn,
    status: room.status, // waiting | playing | won | draw | abandoned
    winner: room.winner,
    line: room.line,
    players: room.players.map((p) => p.name),
    rematch: [...room.rematch],
  };
}

function broadcast(room) {
  const data = snapshot(room);
  room.players.forEach((p, i) => io.to(p.id).emit('state', { ...data, you: i }));
}

function cleanName(raw) {
  const name = String(raw || '').trim().slice(0, 16);
  return name || 'Player';
}

// ---------- Sockets ----------
io.on('connection', (socket) => {
  socket.on('createRoom', (data = {}, cb = () => {}) => {
    if (socket.data.code) return cb({ ok: false, error: 'You are already in a room.' });
    if (!GAMES[data.game]) return cb({ ok: false, error: 'Unknown game.' });

    const room = {
      code: makeCode(),
      game: data.game,
      players: [{ id: socket.id, name: cleanName(data.name) }],
      board: freshBoard(data.game),
      turn: 0,
      starter: 0,
      status: 'waiting',
      winner: null,
      line: [],
      rematch: new Set(),
    };
    rooms.set(room.code, room);
    socket.join(room.code);
    socket.data.code = room.code;
    cb({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('joinRoom', (data = {}, cb = () => {}) => {
    if (socket.data.code) return cb({ ok: false, error: 'You are already in a room.' });
    const room = rooms.get(String(data.code || '').trim().toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.status !== 'waiting' || room.players.length >= 2) {
      return cb({ ok: false, error: 'That room is already full.' });
    }

    room.players.push({ id: socket.id, name: cleanName(data.name) });
    room.status = 'playing';
    socket.join(room.code);
    socket.data.code = room.code;
    cb({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('move', (data = {}) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.status !== 'playing') return;

    const me = room.players.findIndex((p) => p.id === socket.id);
    if (me !== room.turn) return; // not your turn

    const rules = GAMES[room.game];
    let cell = -1;

    if (rules.gravity) {
      const col = Number(data.col);
      if (!Number.isInteger(col) || col < 0 || col >= rules.cols) return;
      for (let r = rules.rows - 1; r >= 0; r--) {
        if (room.board[r * rules.cols + col] === null) {
          cell = r * rules.cols + col;
          break;
        }
      }
    } else {
      const c = Number(data.cell);
      if (Number.isInteger(c) && c >= 0 && c < room.board.length && room.board[c] === null) cell = c;
    }
    if (cell === -1) return; // column full or cell taken

    room.board[cell] = me;
    const win = findWin(room.board, rules);
    if (win) {
      room.status = 'won';
      room.winner = win.winner;
      room.line = win.line;
    } else if (room.board.every((v) => v !== null)) {
      room.status = 'draw';
    } else {
      room.turn = 1 - room.turn;
    }
    broadcast(room);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.code);
    if (!room || (room.status !== 'won' && room.status !== 'draw')) return;

    room.rematch.add(room.players.findIndex((p) => p.id === socket.id));
    if (room.rematch.size === 2) {
      room.starter = 1 - room.starter; // swap who goes first
      room.board = freshBoard(room.game);
      room.turn = room.starter;
      room.status = 'playing';
      room.winner = null;
      room.line = [];
      room.rematch = new Set();
    }
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }
    room.status = 'abandoned';
    broadcast(room);
  });
});

function listenOnPort(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const fallbackPort = port + 1;
      console.warn(`Port ${port} is busy. Retrying on ${fallbackPort}...`);
      listenOnPort(fallbackPort);
      return;
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`Table for Two running on http://localhost:${port}`);
  });
}

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  listenOnPort(PORT);
}

module.exports = { server, findWin, GAMES };
