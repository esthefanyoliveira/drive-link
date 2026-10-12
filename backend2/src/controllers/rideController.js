const { v4: uuid } = require('uuid');
const db = require('../db/database');
const { calcularDistanciaKm, calcularValor } = require('../utils/fare');
const { notificarUsuario, notificarCorrida } = require('../sockets');

// Transições de estado permitidas. Qualquer transição fora deste mapa é rejeitada.
const TRANSICOES = {
  SOLICITADA: ['PROCURANDO_MOTORISTA', 'CANCELADA'],
  PROCURANDO_MOTORISTA: ['ACEITA', 'CANCELADA'],
  ACEITA: ['MOTORISTA_A_CAMINHO', 'CANCELADA'],
  MOTORISTA_A_CAMINHO: ['MOTORISTA_CHEGOU', 'CANCELADA'],
  MOTORISTA_CHEGOU: ['EM_ANDAMENTO', 'CANCELADA'],
  EM_ANDAMENTO: ['FINALIZADA'],
  FINALIZADA: [],
  CANCELADA: [],
};

function transicaoValida(de, para) {
  return TRANSICOES[de]?.includes(para);
}

function buscarCorridaOuFalhar(id, res) {
  const corrida = db.prepare('SELECT * FROM corridas WHERE id = ?').get(id);
  if (!corrida) {
    res.status(404).json({ erro: 'Corrida não encontrada.' });
    return null;
  }
  return corrida;
}

/** Calcula distância/valor estimado sem criar a corrida (tela de solicitação). */
function estimar(req, res) {
  const { origemLat, origemLng, destinoLat, destinoLng } = req.body;
  if ([origemLat, origemLng, destinoLat, destinoLng].some((v) => v === undefined)) {
    return res.status(400).json({ erro: 'Informe origem e destino (latitude/longitude).' });
  }
  const distanciaKm = calcularDistanciaKm(origemLat, origemLng, destinoLat, destinoLng);
  const valorEstimado = calcularValor(distanciaKm);
  res.json({ distanciaKm: Number(distanciaKm.toFixed(2)), valorEstimado: Number(valorEstimado.toFixed(2)) });
}

/** Passageiro solicita uma corrida: cria o registro e dispara o matching. */
function solicitar(req, res) {
  const passageiroId = req.usuario.id;
  const { origemEndereco, destinoEndereco, origemLat, origemLng, destinoLat, destinoLng, formaPagamento } = req.body;

  if ([origemLat, origemLng, destinoLat, destinoLng].some((v) => v === undefined)) {
    return res.status(400).json({ erro: 'Informe origem e destino (latitude/longitude).' });
  }

  // Impede que o mesmo passageiro tenha duas corridas ativas ao mesmo tempo.
  const corridaAtiva = db
    .prepare(
      `SELECT id FROM corridas WHERE passageiro_id = ?
       AND status NOT IN ('FINALIZADA','CANCELADA') LIMIT 1`
    )
    .get(passageiroId);
  if (corridaAtiva) return res.status(409).json({ erro: 'Você já tem uma corrida em andamento.' });

  const distanciaKm = calcularDistanciaKm(origemLat, origemLng, destinoLat, destinoLng);
  const valorEstimado = calcularValor(distanciaKm);
  const id = uuid();

  db.prepare(
    `INSERT INTO corridas
      (id, passageiro_id, origem_endereco, destino_endereco, origem_lat, origem_lng, destino_lat, destino_lng,
       distancia_km, valor_estimado, forma_pagamento, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCURANDO_MOTORISTA')`
  ).run(
    id, passageiroId, origemEndereco || null, destinoEndereco || null,
    origemLat, origemLng, destinoLat, destinoLng,
    distanciaKm, valorEstimado, formaPagamento || 'dinheiro'
  );

  const corrida = db.prepare('SELECT * FROM corridas WHERE id = ?').get(id);
  despacharParaMotoristas(corrida);
  res.status(201).json(corrida);
}

/** Encontra motoristas online/aprovados mais próximos e os notifica em tempo real. */
function despacharParaMotoristas(corrida) {
  const candidatos = db
    .prepare(
      `SELECT m.*, u.nome, u.telefone FROM motoristas m
       JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.online = 1 AND m.status = 'aprovado'
       AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL`
    )
    .all()
    .map((m) => ({
      ...m,
      distancia: calcularDistanciaKm(corrida.origem_lat, corrida.origem_lng, m.latitude, m.longitude),
    }))
    .filter((m) => m.distancia <= 120) // raio de busca em km — ajustável
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, 5); // notifica os 5 mais próximos

  candidatos.forEach((m) => {
    notificarUsuario(m.usuario_id, 'nova_corrida', {
      id: corrida.id,
      origemEndereco: corrida.origem_endereco,
      destinoEndereco: corrida.destino_endereco,
      origemLat: corrida.origem_lat,
      origemLng: corrida.origem_lng,
      destinoLat: corrida.destino_lat,
      destinoLng: corrida.destino_lng,
      distanciaKm: corrida.distancia_km,
      valorEstimado: corrida.valor_estimado,
    });
  });

  if (candidatos.length === 0) {
    notificarUsuario(corrida.passageiro_id, 'nenhum_motorista_disponivel', { corridaId: corrida.id });
  }
}

/** Motorista aceita a corrida. Só o primeiro a aceitar consegue (transação atômica). */
function aceitar(req, res) {
  const usuarioId = req.usuario.id;
  const motorista = db.prepare('SELECT * FROM motoristas WHERE usuario_id = ?').get(usuarioId);
  if (!motorista || motorista.status !== 'aprovado') {
    return res.status(403).json({ erro: 'Motorista não aprovado.' });
  }

  const corrida = buscarCorridaOuFalhar(req.params.id, res);
  if (!corrida) return;

  // Node executa este bloco de forma síncrona (sem "await" no meio), então
  // nenhuma outra requisição consegue intercalar aqui — já é atômico por si só.
  let resultado = null;
  const atual = db.prepare('SELECT status FROM corridas WHERE id = ?').get(corrida.id);
  if (atual.status === 'PROCURANDO_MOTORISTA') {
    db.prepare(`UPDATE corridas SET motorista_id = ?, status = 'ACEITA' WHERE id = ?`)
      .run(motorista.id, corrida.id);
    resultado = db.prepare('SELECT * FROM corridas WHERE id = ?').get(corrida.id);
  }

  if (!resultado) {
    return res.status(409).json({ erro: 'Esta corrida já foi aceita por outro motorista ou não está mais disponível.' });
  }

  const veiculo = db.prepare('SELECT * FROM veiculos WHERE motorista_id = ?').get(motorista.id);
  const usuarioMotorista = db.prepare('SELECT nome, telefone FROM usuarios WHERE id = ?').get(usuarioId);

  notificarUsuario(resultado.passageiro_id, 'motorista_aceitou', {
    corridaId: resultado.id,
    motorista: { nome: usuarioMotorista.nome, telefone: usuarioMotorista.telefone },
    veiculo,
  });
  notificarCorrida(resultado.id, 'status_atualizado', { status: 'ACEITA' });

  res.json(resultado);
}

/** Atualiza o status da corrida respeitando a máquina de estados. */
function atualizarStatus(req, res) {
  const { status: novoStatus } = req.body;
  const corrida = buscarCorridaOuFalhar(req.params.id, res);
  if (!corrida) return;

  if (!transicaoValida(corrida.status, novoStatus)) {
    return res.status(400).json({
      erro: `Transição inválida de "${corrida.status}" para "${novoStatus}".`,
    });
  }

  const campos = { status: novoStatus };
  if (novoStatus === 'EM_ANDAMENTO') campos.data_inicio = new Date().toISOString();
  if (novoStatus === 'FINALIZADA') {
    campos.data_finalizacao = new Date().toISOString();
    campos.valor_final = corrida.valor_estimado;
  }

  const colunas = Object.keys(campos);
  const sql = `UPDATE corridas SET ${colunas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...colunas.map((c) => campos[c]), corrida.id);

  const atualizada = db.prepare('SELECT * FROM corridas WHERE id = ?').get(corrida.id);
  notificarCorrida(corrida.id, 'status_atualizado', { status: novoStatus, corrida: atualizada });
  res.json(atualizada);
}

/** Cancelamento por passageiro ou motorista, permitido apenas em estados iniciais. */
function cancelar(req, res) {
  const corrida = buscarCorridaOuFalhar(req.params.id, res);
  if (!corrida) return;

  if (!transicaoValida(corrida.status, 'CANCELADA')) {
    return res.status(400).json({ erro: 'Esta corrida não pode mais ser cancelada.' });
  }

  db.prepare(`UPDATE corridas SET status = 'CANCELADA' WHERE id = ?`).run(corrida.id);
  notificarCorrida(corrida.id, 'status_atualizado', { status: 'CANCELADA' });
  res.json({ ok: true });
}

/** Histórico de corridas do usuário logado (passageiro ou motorista). */
function minhasCorridas(req, res) {
  const { id, tipo } = req.usuario;
  let linhas;
  if (tipo === 'motorista') {
    const motorista = db.prepare('SELECT id FROM motoristas WHERE usuario_id = ?').get(id);
    linhas = motorista
      ? db.prepare('SELECT * FROM corridas WHERE motorista_id = ? ORDER BY data_solicitacao DESC').all(motorista.id)
      : [];
  } else {
    linhas = db.prepare('SELECT * FROM corridas WHERE passageiro_id = ? ORDER BY data_solicitacao DESC').all(id);
  }
  res.json(linhas);
}

function detalhar(req, res) {
  const corrida = buscarCorridaOuFalhar(req.params.id, res);
  if (!corrida) return;
  res.json(corrida);
}

/** Avaliação mútua ao final da corrida (nota 1-5 + comentário opcional). */
function avaliar(req, res) {
  const { nota, comentario } = req.body;
  const avaliadorId = req.usuario.id;
  const corrida = buscarCorridaOuFalhar(req.params.id, res);
  if (!corrida) return;

  if (corrida.status !== 'FINALIZADA') {
    return res.status(400).json({ erro: 'Só é possível avaliar corridas finalizadas.' });
  }
  if (!nota || nota < 1 || nota > 5) {
    return res.status(400).json({ erro: 'Nota deve ser entre 1 e 5.' });
  }

  const motoristaUsuarioId = corrida.motorista_id
    ? db.prepare('SELECT usuario_id FROM motoristas WHERE id = ?').get(corrida.motorista_id)?.usuario_id
    : null;

  const avaliadoId = avaliadorId === corrida.passageiro_id ? motoristaUsuarioId : corrida.passageiro_id;
  if (!avaliadoId) return res.status(400).json({ erro: 'Não foi possível determinar quem está sendo avaliado.' });

  try {
    db.prepare(
      `INSERT INTO avaliacoes (id, corrida_id, avaliador_id, avaliado_id, nota, comentario)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuid(), corrida.id, avaliadorId, avaliadoId, nota, comentario || null);
  } catch (e) {
    return res.status(409).json({ erro: 'Você já avaliou esta corrida.' });
  }

  res.status(201).json({ ok: true });
}

module.exports = { estimar, solicitar, aceitar, atualizarStatus, cancelar, minhasCorridas, detalhar, avaliar };
