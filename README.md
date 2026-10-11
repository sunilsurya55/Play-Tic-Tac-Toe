# Table for Two

Real-time multiplayer **Tic-Tac-Toe** and **Connect Four**. One player creates a room, shares a 4-letter code, and a friend joins from any browser. Moves sync live over WebSockets.

Live Demo Link: [ ]

## Features

- Room codes: create a room or join one with a code
- Live sync with Socket.IO: both boards update instantly
- Server-authoritative game logic: the server checks turns, valid moves and wins, so clients can't cheat
- Rematch with the starting player swapping each round
- Handles disconnects (the other player is told when someone leaves)
- Responsive, keyboard-accessible UI with no frontend framework
- Automated smoke test that simulates two real clients

## Tech stack

Node.js, Express, Socket.IO, vanilla HTML/CSS/JS

## How it works

| Event (client to server) | What it does |
| --- | --- |
| `createRoom` | Makes a room with a unique code and puts the creator in it |
| `joinRoom` | Adds the second player and starts the game |
| `move` | Sends `{cell}` (Tic-Tac-Toe) or `{col}` (Connect Four) |
| `rematch` | Votes for another round; it starts when both players vote |

The server keeps all rooms in memory and sends each player a `state` event after every change. A single `findWin` function handles both games by checking for N equal marks in a row across four directions.

## Project structure

```
server.js          Express + Socket.IO server and game rules
public/index.html  Lobby and game UI
tests/smoke.js     Two-client end-to-end test
```

## Deploy

Deployed on Render to live access. (please wait for 20 seconds to load) 

## Ideas to extend

- Quiz Battle mode (shared questions, timed answers, live scores)
- Save results and a leaderboard in MongoDB
- Spectators and room chat
- Reconnect support so a refresh doesn't drop a player
