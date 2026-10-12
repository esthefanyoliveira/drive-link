let token = localStorage.getItem('dl_driver_token');
let usuario = JSON.parse(localStorage.getItem('dl_driver_usuario') || 'null');
let socket = null;
let online = false;
let watchId = null;
let corridaAtiva = null; // { id, status, origemLat, ... }
let mapaCorrida, marcadorPassageiro;

const $ = (id) => document.getElementById(id);
function mostrar(id) { $(id).classList.remove('oculto'); }
function esconder(id) { $(id).classList.add('oculto'); }

async function api(caminho, opcoes = {}) {
  const resp = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opcoes.headers || {}),
    },
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || 'Erro na requisição.');
  return dados;
}

// --- Autenticação ---
function mostrarCadastro() { esconder('formLogin'); mostrar('formCadastro'); }
function mostrarLogin() { esconder('formCadastro'); mostrar('formLogin'); }

async function fazerLogin() {
  $('erroLogin').textContent = '';
  try {
    const dados = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('loginEmail').value, senha: $('loginSenha').value }),
    });
    if (dados.usuario.tipo !== 'motorista') throw new Error('Esta conta não é de motorista.');
    salvarSessao(dados);
  } catch (e) { $('erroLogin').textContent = e.message; }
}

async function fazerCadastro() {
  $('erroCadastro').textContent = '';
  try {
    const dados = await api('/api/auth/registrar/motorista', {
      method: 'POST',
      body: JSON.stringify({
        nome: $('cadNome').value, telefone: $('cadTelefone').value,
        email: $('cadEmail').value, senha: $('cadSenha').value,
        cpf: $('cadCpf').value, cnh: $('cadCnh').value,
        veiculo: { marca: $('cadMarca').value, modelo: $('cadModelo').value, cor: $('cadCor').value, placa: $('cadPlaca').value },
      }),
    });
    salvarSessao(dados);
  } catch (e) { $('erroCadastro').textContent = e.message; }
}

function salvarSessao(dados) {
  token = dados.token; usuario = dados.usuario;
  localStorage.setItem('dl_driver_token', token);
  localStorage.setItem('dl_driver_usuario', JSON.stringify(usuario));
  iniciarAppLogado();
}

function sair() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  localStorage.removeItem('dl_driver_token');
  localStorage.removeItem('dl_driver_usuario');
  location.reload();
}

// --- Online / offline ---
function alternarOnline() {
  if (online) { ficarOffline(); } else { ficarOnline(); }
}

function ficarOnline() {
  if ($('usarLocalManual').checked) {
    const lat = Number($('latManual').value);
    const lng = Number($('lngManual').value);
    if (!lat || !lng) return alert('Preencha latitude e longitude manuais antes de ficar online.');
    ativarOnlineComCoordenadas(lat, lng);
    return;
  }
  if (!navigator.geolocation) return alert('Geolocalização não disponível neste navegador.');
  navigator.geolocation.getCurrentPosition(
    (pos) => ativarOnlineComCoordenadas(pos.coords.latitude, pos.coords.longitude),
    () => alert('Não foi possível obter sua localização. Marque "Usar localização manual" para digitar as coordenadas.')
  );
}

async function ativarOnlineComCoordenadas(latitude, longitude) {
  try {
    await api('/api/driver/status', {
      method: 'POST',
      body: JSON.stringify({ online: true, latitude, longitude }),
    });
    online = true;
    atualizarBadgeOnline();
    iniciarRastreamento(latitude, longitude);
  } catch (e) { alert(e.message); }
}

async function ficarOffline() {
  await api('/api/driver/status', { method: 'POST', body: JSON.stringify({ online: false }) }).catch(() => {});
  online = false;
  atualizarBadgeOnline();
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

function atualizarBadgeOnline() {
  $('badgeOnline').textContent = online ? 'Online' : 'Offline';
  $('badgeOnline').className = `badge ${online ? 'online' : 'offline'}`;
  $('btnToggle').textContent = online ? 'Ficar offline' : 'Ficar online';
}

function iniciarRastreamento(latitudeInicial, longitudeInicial) {
  if ($('usarLocalManual').checked) {
    // Localização manual: envia a posição fixa uma vez, sem ficar atualizando via GPS.
    socket.emit('atualizar_localizacao', {
      latitude: latitudeInicial, longitude: longitudeInicial, corridaId: corridaAtiva?.id || null,
    });
    return;
  }
  watchId = navigator.geolocation.watchPosition((pos) => {
    socket.emit('atualizar_localizacao', {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      corridaId: corridaAtiva?.id || null,
    });
  }, null, { enableHighAccuracy: true, maximumAge: 5000 });
}

// --- Solicitações de corrida ---
let solicitacaoAtual = null;

function mostrarSolicitacao(dados) {
  solicitacaoAtual = dados;
  $('reqOrigem').textContent = dados.origemEndereco || `${dados.origemLat.toFixed(4)}, ${dados.origemLng.toFixed(4)}`;
  $('reqDestino').textContent = dados.destinoEndereco || `${dados.destinoLat.toFixed(4)}, ${dados.destinoLng.toFixed(4)}`;
  $('reqDistancia').textContent = `${dados.distanciaKm} km`;
  $('reqValor').textContent = `R$ ${dados.valorEstimado.toFixed(2)}`;
  mostrar('painelSolicitacao');
}

function recusarCorrida() {
  solicitacaoAtual = null;
  esconder('painelSolicitacao');
}

async function aceitarCorrida() {
  if (!solicitacaoAtual) return;
  try {
    const corrida = await api(`/api/rides/${solicitacaoAtual.id}/aceitar`, { method: 'POST' });
    corridaAtiva = corrida;
    socket.emit('entrar_corrida', corrida.id);
    esconder('painelSolicitacao');
    mostrarCorridaAtiva(corrida);
  } catch (e) {
    alert(e.message); // provavelmente outro motorista já aceitou
    recusarCorrida();
  }
}

// --- Corrida ativa ---
const PROXIMO = {
  ACEITA: { label: 'Estou a caminho', status: 'MOTORISTA_A_CAMINHO' },
  MOTORISTA_A_CAMINHO: { label: 'Cheguei ao local', status: 'MOTORISTA_CHEGOU' },
  MOTORISTA_CHEGOU: { label: 'Iniciar corrida', status: 'EM_ANDAMENTO' },
  EM_ANDAMENTO: { label: 'Finalizar corrida', status: 'FINALIZADA' },
};

function mostrarCorridaAtiva(corrida) {
  mostrar('painelCorridaAtiva');
  $('statusCorridaAtiva').textContent = corrida.status;
  const origemTexto = corrida.origem_endereco || `${corrida.origem_lat.toFixed(4)}, ${corrida.origem_lng.toFixed(4)}`;
  const destinoTexto = corrida.destino_endereco || `${corrida.destino_lat.toFixed(4)}, ${corrida.destino_lng.toFixed(4)}`;
  $('infoPassageiro').innerHTML = `
    <div class="linha"><span>Origem</span><strong style="text-align:right;max-width:65%;">${origemTexto}</strong></div>
    <div class="linha"><span>Destino</span><strong style="text-align:right;max-width:65%;">${destinoTexto}</strong></div>
    <div class="linha"><span>Valor estimado</span><strong>R$ ${corrida.valor_estimado.toFixed(2)}</strong></div>
  `;
  atualizarBotaoProximo(corrida.status);

  setTimeout(() => {
    if (mapaCorrida) { mapaCorrida.remove(); mapaCorrida = null; }
    mapaCorrida = L.map('mapaCorrida').setView([corrida.origem_lat, corrida.origem_lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapaCorrida);
    L.marker([corrida.origem_lat, corrida.origem_lng]).addTo(mapaCorrida).bindPopup('Origem');
    L.marker([corrida.destino_lat, corrida.destino_lng]).addTo(mapaCorrida).bindPopup('Destino');
  }, 50);
}

function atualizarBotaoProximo(status) {
  const proximo = PROXIMO[status];
  const btn = $('btnProximoStatus');
  if (!proximo) { btn.disabled = true; btn.textContent = 'Aguardando...'; return; }
  btn.disabled = false;
  btn.textContent = proximo.label;
}

async function avancarStatus() {
  const proximo = PROXIMO[corridaAtiva.status];
  if (!proximo) return;
  try {
    const atualizada = await api(`/api/rides/${corridaAtiva.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: proximo.status }),
    });
    corridaAtiva = atualizada;
    if (atualizada.status === 'FINALIZADA') {
      await avaliarPassageiro();
      finalizarCorridaLocal();
    } else {
      $('statusCorridaAtiva').textContent = atualizada.status;
      atualizarBotaoProximo(atualizada.status);
    }
  } catch (e) { alert(e.message); }
}

async function avaliarPassageiro() {
  const nota = prompt('Avalie o passageiro de 1 a 5:', '5');
  if (nota) {
    await api(`/api/rides/${corridaAtiva.id}/avaliar`, {
      method: 'POST',
      body: JSON.stringify({ nota: Number(nota) }),
    }).catch(() => {});
  }
}

async function cancelarCorridaAtiva() {
  if (!corridaAtiva) return;
  try { await api(`/api/rides/${corridaAtiva.id}/cancelar`, { method: 'POST' }); } catch (e) {}
  finalizarCorridaLocal();
}

function finalizarCorridaLocal() {
  corridaAtiva = null;
  esconder('painelCorridaAtiva');
  carregarGanhos();
}

async function carregarGanhos() {
  const dados = await api('/api/driver/ganhos');
  $('ganhoCorridas').textContent = dados.corridasFinalizadas;
  $('ganhoTotal').textContent = `R$ ${dados.totalGanho.toFixed(2)}`;
}

// --- Socket ---
function conectarSocket() {
  socket = io(API_URL, { auth: { token } });
  socket.on('nova_corrida', (dados) => { if (!corridaAtiva) mostrarSolicitacao(dados); });
  socket.on('corrida_indisponivel', () => recusarCorrida());
  socket.on('status_atualizado', ({ status }) => {
    if (!corridaAtiva) return;
    corridaAtiva.status = status;
    $('statusCorridaAtiva').textContent = status;
    atualizarBotaoProximo(status);
    if (status === 'CANCELADA') { alert('O passageiro cancelou a corrida.'); finalizarCorridaLocal(); }
  });
}

// --- Boot ---
async function iniciarAppLogado() {
  $('usuarioNome').textContent = usuario.nome;
  esconder('telaAuth');
  mostrar('telaPainel');
  conectarSocket();

  const { motorista } = await api('/api/driver/perfil');
  if (motorista.status !== 'aprovado') mostrar('painelAprovacao');
  await carregarGanhos();
}

if (token && usuario) { iniciarAppLogado(); }
