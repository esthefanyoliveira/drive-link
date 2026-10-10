const db = require('../db/database');

function dashboard(req, res) {
  const contar = (sql, ...params) => db.prepare(sql).get(...params).total;

  res.json({
    motoristasCadastrados: contar('SELECT COUNT(*) AS total FROM motoristas'),
    motoristasOnline: contar('SELECT COUNT(*) AS total FROM motoristas WHERE online = 1'),
    motoristasOffline: contar('SELECT COUNT(*) AS total FROM motoristas WHERE online = 0'),
    corridasSolicitadas: contar(
      `SELECT COUNT(*) AS total FROM corridas WHERE status IN ('SOLICITADA','PROCURANDO_MOTORISTA')`
    ),
    corridasEmAndamento: contar(
      `SELECT COUNT(*) AS total FROM corridas
       WHERE status IN ('ACEITA','MOTORISTA_A_CAMINHO','MOTORISTA_CHEGOU','EM_ANDAMENTO')`
    ),
    corridasConcluidas: contar(`SELECT COUNT(*) AS total FROM corridas WHERE status = 'FINALIZADA'`),
    corridasCanceladas: contar(`SELECT COUNT(*) AS total FROM corridas WHERE status = 'CANCELADA'`),
    faturamento: db
      .prepare(`SELECT COALESCE(SUM(valor_final), 0) AS total FROM corridas WHERE status = 'FINALIZADA'`)
      .get().total,
  });
}

function listarMotoristas(req, res) {
  const linhas = db
    .prepare(
      `SELECT m.id, m.status, m.online, m.cpf, m.cnh, u.nome, u.telefone, u.email,
              v.marca, v.modelo, v.cor, v.placa
       FROM motoristas m
       JOIN usuarios u ON u.id = m.usuario_id
       LEFT JOIN veiculos v ON v.motorista_id = m.id
       ORDER BY u.nome`
    )
    .all();
  res.json(linhas);
}

/** Aprova, bloqueia ou reabre o cadastro de um motorista. */
function atualizarStatusMotorista(req, res) {
  const { status } = req.body; // 'aprovado' | 'bloqueado' | 'pendente'
  if (!['aprovado', 'bloqueado', 'pendente'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }
  const motorista = db.prepare('SELECT * FROM motoristas WHERE id = ?').get(req.params.id);
  if (!motorista) return res.status(404).json({ erro: 'Motorista não encontrado.' });

  const online = status === 'aprovado' ? motorista.online : 0;
  db.prepare('UPDATE motoristas SET status = ?, online = ? WHERE id = ?').run(status, online, motorista.id);
  res.json({ ok: true });
}

function listarPassageiros(req, res) {
  const linhas = db
    .prepare(`SELECT id, nome, telefone, email, data_cadastro FROM usuarios WHERE tipo = 'passageiro' ORDER BY nome`)
    .all();
  res.json(linhas);
}

function listarCorridas(req, res) {
  const linhas = db.prepare('SELECT * FROM corridas ORDER BY data_solicitacao DESC LIMIT 200').all();
  res.json(linhas);
}

function obterConfiguracao(req, res) {
  res.json(db.prepare('SELECT * FROM configuracoes WHERE id = 1').get());
}

function atualizarConfiguracao(req, res) {
  const { taxaBase, valorPorKm, tarifaMinima } = req.body;
  db.prepare(
    `UPDATE configuracoes SET
       taxa_base = COALESCE(?, taxa_base),
       valor_por_km = COALESCE(?, valor_por_km),
       tarifa_minima = COALESCE(?, tarifa_minima)
     WHERE id = 1`
  ).run(taxaBase ?? null, valorPorKm ?? null, tarifaMinima ?? null);
  res.json(db.prepare('SELECT * FROM configuracoes WHERE id = 1').get());
}

module.exports = {
  dashboard,
  listarMotoristas,
  atualizarStatusMotorista,
  listarPassageiros,
  listarCorridas,
  obterConfiguracao,
  atualizarConfiguracao,
};
