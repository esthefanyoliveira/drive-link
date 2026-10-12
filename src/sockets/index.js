const jwt = require('jsonwebtoken');
const db = require('../db/database');

// Mapas em memória: usuarioId -> socket.id (para notificações diretas)
const socketsPorUsuario = new Map();
let ioRef = null;

function iniciarSocket(io) {
  ioRef = io;

  // Autentica a conexão do socket usando o mesmo JWT do REST API.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Token não informado.'));
      socket.usuario = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch (e) {
      next(new Error('Token inválido.'));
    }
  });

  io.on('connection', (socket) => {
    const { id: usuarioId, tipo } = socket.usuario;
    socketsPorUsuario.set(usuarioId, socket.id);

    // Entra na sala da corrida (passageiro e motorista acompanham juntos).
    socket.on('entrar_corrida', (corridaId) => {
      socket.join(`corrida:${corridaId}`);
    });

    socket.on('sair_corrida', (corridaId) => {
      socket.leave(`corrida:${corridaId}`);
    });

    // Motorista envia sua posição periodicamente enquanto online ou em corrida.
    socket.on('atualizar_localizacao', ({ latitude, longitude, corridaId }) => {
      if (tipo !== 'motorista') return;
      db.prepare(
        `UPDATE motoristas SET latitude = ?, longitude = ?, atualizado_em = datetime('now')
         WHERE usuario_id = ?`
      ).run(latitude, longitude, usuarioId);

      if (corridaId) {
        io.to(`corrida:${corridaId}`).emit('localizacao_motorista', { latitude, longitude });
      }
    });

    socket.on('disconnect', () => {
      if (socketsPorUsuario.get(usuarioId) === socket.id) {
        socketsPorUsuario.delete(usuarioId);
      }
    });
  });
}

/** Envia um evento para um usuário específico, se ele estiver conectado. */
function notificarUsuario(usuarioId, evento, dados) {
  const socketId = socketsPorUsuario.get(usuarioId);
  if (socketId && ioRef) ioRef.to(socketId).emit(evento, dados);
}

/** Envia um evento para todos que estão acompanhando uma corrida. */
function notificarCorrida(corridaId, evento, dados) {
  if (ioRef) ioRef.to(`corrida:${corridaId}`).emit(evento, dados);
}

function usuarioEstaConectado(usuarioId) {
  return socketsPorUsuario.has(usuarioId);
}

module.exports = { iniciarSocket, notificarUsuario, notificarCorrida, usuarioEstaConectado };
