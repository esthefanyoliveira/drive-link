require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { iniciarSocket } = require('./sockets');

const PORT = process.env.PORT || 3000;
const origensPermitidas = process.env.CORS_ORIGIN || '*';

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: origensPermitidas === '*' ? '*' : origensPermitidas.split(',') },
});

iniciarSocket(io);

server.listen(PORT, () => {
  console.log(`Drive Link API rodando em http://localhost:${PORT}`);
  console.log('WebSocket disponível na mesma porta.');
});
