const db = require('../db/database');

function meuPerfil(req, res) {
  const motorista = db.prepare('SELECT * FROM motoristas WHERE usuario_id = ?').get(req.usuario.id);
  if (!motorista) return res.status(404).json({ erro: 'Perfil de motorista não encontrado.' });
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE motorista_id = ?').get(motorista.id);
  res.json({ motorista, veiculo });
}

/** Alterna online/offline. Só motoristas aprovados podem ficar online. */
function alternarStatus(req, res) {
  const { online, latitude, longitude } = req.body;
  const motorista = db.prepare('SELECT * FROM motoristas WHERE usuario_id = ?').get(req.usuario.id);
  if (!motorista) return res.status(404).json({ erro: 'Perfil de motorista não encontrado.' });

  if (online && motorista.status !== 'aprovado') {
    return res.status(403).json({ erro: 'Sua conta ainda não foi aprovada pela administração.' });
  }

  db.prepare(
    `UPDATE motoristas SET online = ?, latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
     atualizado_em = datetime('now') WHERE usuario_id = ?`
  ).run(online ? 1 : 0, latitude ?? null, longitude ?? null, req.usuario.id);

  res.json({ ok: true, online: !!online });
}

/** Total de ganhos do motorista em corridas finalizadas. */
function meusGanhos(req, res) {
  const motorista = db.prepare('SELECT id FROM motoristas WHERE usuario_id = ?').get(req.usuario.id);
  if (!motorista) return res.status(404).json({ erro: 'Perfil de motorista não encontrado.' });

  const linha = db
    .prepare(
      `SELECT COUNT(*) AS corridas, COALESCE(SUM(valor_final), 0) AS total
       FROM corridas WHERE motorista_id = ? AND status = 'FINALIZADA'`
    )
    .get(motorista.id);

  res.json({ corridasFinalizadas: linha.corridas, totalGanho: linha.total });
}

module.exports = { meuPerfil, alternarStatus, meusGanhos };
