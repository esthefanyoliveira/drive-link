const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db/database');
const { gerarToken } = require('../utils/token');

function usuarioPublico(u) {
  const { senha_hash, ...resto } = u;
  return resto;
}

/** Cadastro de passageiro (uso público, sem autenticação). */
function registrarPassageiro(req, res) {
  const { nome, telefone, email, senha } = req.body;
  if (!nome || !telefone || !email || !senha) {
    return res.status(400).json({ erro: 'Nome, telefone, e-mail e senha são obrigatórios.' });
  }
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existente) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

  const id = uuid();
  const senha_hash = bcrypt.hashSync(senha, 10);
  db.prepare(`INSERT INTO usuarios (id, nome, telefone, email, senha_hash, tipo)
              VALUES (?, ?, ?, ?, ?, 'passageiro')`)
    .run(id, nome, telefone, email, senha_hash);

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  res.status(201).json({ usuario: usuarioPublico(usuario), token: gerarToken(usuario) });
}

/** Cadastro de motorista: fica pendente de aprovação pelo administrador. */
function registrarMotorista(req, res) {
  const { nome, telefone, email, senha, cpf, cnh, veiculo } = req.body;
  if (!nome || !telefone || !email || !senha || !cpf || !cnh || !veiculo) {
    return res.status(400).json({ erro: 'Dados incompletos para cadastro de motorista.' });
  }
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existente) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

  const usuarioId = uuid();
  const senha_hash = bcrypt.hashSync(senha, 10);
  db.prepare(`INSERT INTO usuarios (id, nome, telefone, email, senha_hash, tipo)
              VALUES (?, ?, ?, ?, ?, 'motorista')`)
    .run(usuarioId, nome, telefone, email, senha_hash);

  const motoristaId = uuid();
  db.prepare(`INSERT INTO motoristas (id, usuario_id, cpf, cnh, status, online)
              VALUES (?, ?, ?, ?, 'pendente', 0)`)
    .run(motoristaId, usuarioId, cpf, cnh);

  db.prepare(`INSERT INTO veiculos (id, motorista_id, marca, modelo, cor, placa, documento)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), motoristaId, veiculo.marca, veiculo.modelo, veiculo.cor, veiculo.placa, veiculo.documento || null);

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  res.status(201).json({
    usuario: usuarioPublico(usuario),
    token: gerarToken(usuario),
    aviso: 'Cadastro recebido. Sua conta ficará pendente até aprovação da administração.',
  });
}

/** Login unificado para os três perfis. */
function login(req, res) {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  let dadosMotorista = null;
  if (usuario.tipo === 'motorista') {
    dadosMotorista = db.prepare('SELECT * FROM motoristas WHERE usuario_id = ?').get(usuario.id);
  }

  res.json({
    usuario: usuarioPublico(usuario),
    motorista: dadosMotorista,
    token: gerarToken(usuario),
  });
}

module.exports = { registrarPassageiro, registrarMotorista, login };
