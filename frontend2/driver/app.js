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

// --- Som e vibração de nova corrida (funciona com o site aberto) ---
let audioCtx = null;

// Chamada no clique de "Ficar online": o navegador só libera o som depois de um toque.
function liberarSom() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}

// Chamada quando chega uma corrida: 4 bipes + vibração.
function alertaCorrida() {
  if (!audioCtx) return;
  let vezes = 0;
  const tocar = () => {
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
    } catch (e) {}
    vezes++;
    if (vezes < 4) setTimeout(tocar, 600);
  };
  tocar();
}

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
  liberarSom();
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
  $('reqValor').textContent = `R$ ${dados.valorEstimado.toFixed(2)}`
