const db = require('../db/database');

/**
 * Distância aproximada em km entre dois pontos (fórmula de Haversine).
 * Em uma versão futura isso pode ser trocado por uma API de rotas real
 * (ex.: OSRM ou Google Directions), mantendo a mesma assinatura de função.
 */
function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // raio da Terra em km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Lê a configuração de tarifa atual (editável pelo administrador). */
function obterConfiguracao() {
  return db.prepare('SELECT * FROM configuracoes WHERE id = 1').get();
}

/** Calcula o valor da corrida a partir da distância, usando a config vigente. */
function calcularValor(distanciaKm) {
  const config = obterConfiguracao();
  const bruto = config.taxa_base + distanciaKm * config.valor_por_km;
  return Math.max(bruto, config.tarifa_minima);
}

module.exports = { calcularDistanciaKm, calcularValor, obterConfiguracao };
