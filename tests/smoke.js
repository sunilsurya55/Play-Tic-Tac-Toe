// Simulates two real clients: create room, join, play to a win, rematch.
const assert = require('assert');
const { io } = require('socket.io-client');
const { server, findWin, GAMES } = require('../server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (socket, event) => new Promise((r) => socket.once(event, r));
const ask = (socket, event, data) => new Promise((r) => socket.emit(event, data, r));

async function run() {
  // Pure logic checks
  const b = Array(9).fill(null);
  [0, 4, 8].forEach((i) => (b[i] = 1));
  assert.deepStrictEqual(findWin(b, GAMES.tictactoe).line, [0, 4, 8]);
  assert.strictEqual(findWin(Array(42).fill(null), GAMES.connect4), null);

  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = io(url);
  const c = io(url);
  await Promise.all([once(a, 'connect'), once(c, 'connect')]);

  // Tic-Tac-Toe flow
  const created = await ask(a, 'createRoom', { name: 'Asha', game: 'tictactoe' });
  assert.ok(created.ok && created.code.length === 4);
  const bad = await ask(c, 'joinRoom', { name: 'Ravi', code: 'ZZZZ' });
  assert.strictEqual(bad.ok, false);

  let latestA, latestC;
  a.on('state', (s) => (latestA = s));
  c.on('state', (s) => (latestC = s));
  assert.ok((await ask(c, 'joinRoom', { name: 'Ravi', code: created.code.toLowerCase() })).ok);
  await wait(100);
  assert.strictEqual(latestA.status, 'playing');

  // Ravi tries to move out of turn: ignored
  c.emit('move', { cell: 0 });
  await wait(50);
  assert.strictEqual(latestA.board[0], null);

  // Asha takes the top row, Ravi plays the middle row
  for (const [sock, cell] of [[a, 0], [c, 3], [a, 1], [c, 4], [a, 2]]) {
    sock.emit('move', { cell });
    await wait(40);
  }
  assert.strictEqual(latestA.status, 'won');
  assert.strictEqual(latestA.winner, 0);
  assert.deepStrictEqual(latestA.line, [0, 1, 2]);

  // Rematch needs both players, and the starter swaps
  a.emit('rematch');
  await wait(40);
  assert.strictEqual(latestC.status, 'won');
  c.emit('rematch');
  await wait(60);
  assert.strictEqual(latestA.status, 'playing');
  assert.strictEqual(latestA.turn, 1);

  // Opponent leaving is reported
  c.disconnect();
  await wait(80);
  assert.strictEqual(latestA.status, 'abandoned');
  a.disconnect();

  // Connect Four: pieces stack and a vertical win is detected
  const p = io(url);
  const q = io(url);
  await Promise.all([once(p, 'connect'), once(q, 'connect')]);
  let lp;
  p.on('state', (s) => (lp = s));
  const room = await ask(p, 'createRoom', { name: 'P', game: 'connect4' });
  await ask(q, 'joinRoom', { name: 'Q', code: room.code });
  for (const [sock, col] of [[p, 0], [q, 1], [p, 0], [q, 1], [p, 0], [q, 1], [p, 0]]) {
    sock.emit('move', { col });
    await wait(40);
  }
  assert.strictEqual(lp.status, 'won');
  assert.strictEqual(lp.winner, 0);
  assert.strictEqual(lp.line.length, 4);
  p.disconnect();
  q.disconnect();

  console.log('All smoke tests passed');
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
