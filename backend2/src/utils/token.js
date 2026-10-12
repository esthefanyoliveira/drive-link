const jwt = require('jsonwebtoken');
require('dotenv').config();

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, tipo: usuario.tipo, nome: usuario.nome },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = { gerarToken };
