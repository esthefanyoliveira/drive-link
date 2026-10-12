// --- Estado local ---
let token = localStorage.getItem('dl_passenger_token');
let usuario = JSON.parse(localStorage.getItem('dl_passenger_usuario') || 'null');
let socket = null;
let mapa, marcadorOrigem, marcadorDestino;
let origem = null, destino = null;
let corridaAtualId = localStorage.getItem('dl_passenger_corrida_atual') || null;
let mapaAcompanhar, marcadorMotorista;

const $ = (id) => document.getElementById(id);
function mostrar(id) { $(id).classList.remove('oculto'); }
function esconder(id) { $(id).classList.add('oculto'); }
function todasTelas() {
  return ['telaAuth', 'telaSolicitar', 'telaProcurando', 'telaAcompanhar', 'telaAvaliar', 'telaHistorico'];
}
function irPara(id) {
  todasTelas().forEach(esconder);
  mostrar(id);
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
    if (dados.usuario.tipo !== 'passageiro') throw new Error('Esta conta não é de passageiro.');
    salvarSessao(dados);
  } catch (e) { $('erroLogin').textContent = e.message; }
}

async function fazerCadastro() {
  $('erroCadastro').textContent = '';
  try {
    const dados = await api('/api/auth/registrar/passageiro', {
      method: 'POST',
      body: JSON.stringify({
        nome: $('cadNome').value, telefone: $('cadTelefone').value,
        email: $('cadEmail').value, senha: $('cadSenha').value,
      }),
    });
    salvarSessao(dados);
  } catch (e) { $('erroCadastro').textContent = e.message; }
}

function salvarSessao(dados) {
  token = dados.token; usuario = dados.usuario;
  localStorage.setItem('dl_passenger_token', token);
  localStorage.setItem('dl_passenger_usuario', JSON.stringify(usuario));
  iniciarAppLogado();
}

function sair() {
  localStorage.removeItem('dl_passenger_token');
  localStorage.removeItem('dl_passenger_usuario');
  localStorage.removeItem('dl_passenger_corrida_atual');
  location.reload();
}

// --- Mapa de solicitação ---
let origemEndereco = '', destinoEndereco = '';

function initMapaSolicitar() {
  if (mapa) return;
  mapa = L.map('mapa').setView([-25.15, -49.75], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapa);
  mapa.on('click', (e) => {
    if (!origem) definirOrigem(e.latlng.lat, e.latlng.lng, 'Ponto marcado no mapa');
    else if (!destino) definirDestino(e.latlng.lat, e.latlng.lng, 'Ponto marcado no mapa');
  });
}

function definirOrigem(lat, lng, label) {
  if (marcadorOrigem) mapa.removeLayer(marcadorOrigem);
  origem = { lat, lng };
  origemEndereco = label;
  $('origemBusca').value = label;
  marcadorOrigem = L.marker(origem, { title: 'Origem' }).addTo(mapa).bindPopup('Origem').openPopup();
  mapa.panTo(origem);
  if (destino) atualizarEstimativa();
}

function definirDestino(lat, lng, label) {
  if (marcadorDestino) mapa.removeLayer(marcadorDestino);
  destino = { lat, lng };
  destinoEndereco = label;
  $('destinoBusca').value = label;
  marcadorDestino = L.marker(destino, { title: 'Destino' }).addTo(mapa).bindPopup('Destino').openPopup();
  if (origem) {
    mapa.fitBounds([[origem.lat, origem.lng], [destino.lat, destino.lng]], { padding: [40, 40] });
    atualizarEstimativa();
  } else {
    mapa.panTo(destino);
  }
}

function limparPontos() {
  [marcadorOrigem, marcadorDestino].forEach((m) => m && mapa.removeLayer(m));
  origem = null; destino = null;
  origemEndereco = ''; destinoEndereco = '';
  $('origemBusca').value = ''; $('destinoBusca').value = '';
  $('painelEstimativa').style.display = 'none';
}

// --- Busca de endereço com sugestões (OpenStreetMap Nominatim, sem custo/chave) ---
// Caixa que delimita a região Curitiba–Ponta Grossa–Carambeí–Castro, usada só
// para priorizar resultados dessa área nas sugestões (não bloqueia outras).
const CAIXA_REGIAO = '-50.3,-24.6,-49.1,-25.6';

function debounce(fn, atrasoMs) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), atrasoMs);
  };
}

async function buscarEnderecos(texto) {
  if (!texto || texto.length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&countrycodes=br&viewbox=${CAIXA_REGIAO}&limit=5&accept-language=pt-BR`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  return resp.json();
}

function configurarBuscaEndereco(inputId, listaId, aoSelecionar) {
  const input = $(inputId);
  const lista = $(listaId);

  const buscar = debounce(async () => {
    const texto = input.value.trim();
    if (texto.length < 3) { lista.classList.add('oculto'); return; }
    lista.innerHTML = '<div class="carregando">Buscando...</div>';
    lista.classList.remove('oculto');
    const resultados = await buscarEnderecos(texto);
    if (input.value.trim() !== texto) return; // resposta de uma busca antiga, ignora
    if (resultados.length === 0) {
      lista.innerHTML = '<div class="vazio">Nenhum endereço encontrado.</div>';
      return;
    }
    lista.innerHTML = '';
    resultados.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'item';
      item.textContent = r.display_name;
      item.onclick = () => {
        aoSelecionar(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
        lista.classList.add('oculto');
      };
      lista.appendChild(item);
    });
  }, 450);

  input.addEventListener('input', buscar);
  input.addEventListener('blur', () => setTimeout(() => lista.classList.add('oculto'), 150));
}

async function atualizarEstimativa() {
  try {
    const dados = await api('/api/rides/estimar', {
      method: 'POST',
      body: JSON.stringify({
        origemLat: origem.lat, origemLng: origem.lng,
        destinoLat: destino.lat, destinoLng: destino.lng,
      }),
    });
    $('estDistancia').textContent = `${dados.distanciaKm} km`;
    $('estValor').textContent = `R$ ${dados.valorEstimado.toFixed(2)}`;
    $('painelEstimativa').style.display = 'block';
  } catch (e) { alert(e.message); }
}

async function solicitarCorrida() {
  try {
    const corrida = await api('/api/rides', {
      method: 'POST',
      body: JSON.stringify({
        origemLat: origem.lat, origemLng: origem.lng,
        destinoLat: destino.lat, destinoLng: destino.lng,
        origemEndereco, destinoEndereco,
        formaPagamento: $('formaPagamento').value,
      }),
    });
    corridaAtualId = corrida.id;
    localStorage.setItem('dl_passenger_corrida_atual', corridaAtualId);
    socket.emit('entrar_corrida', corridaAtualId);
    irPara('telaProcurando');
  } catch (e) { alert(e.message); }
}

async function cancelarCorrida() {
  if (!corridaAtualId) return;
  try {
    await api(`/api/rides/${corridaAtualId}/cancelar`, { method: 'POST' });
  } catch (e) { /* ignora se já não puder cancelar */ }
  encerrarCorridaLocal();
  voltarParaSolicitar();
}

function encerrarCorridaLocal() {
  corridaAtualId = null;
  localStorage.removeItem('dl_passenger_corrida_atual');
}

function voltarParaSolicitar() {
  limparPontos();
  irPara('telaSolicitar');
}

// --- Acompanhamento ---
function initMapaAcompanhar() {
  setTimeout(() => {
    if (mapaAcompanhar) { mapaAcompanhar.remove(); mapaAcompanhar = null; }
    mapaAcompanhar = L.map('mapaAcompanhar').setView([-25.15, -49.75], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapaAcompanhar);
  }, 50);
}

function mostrarInfoMotorista(motorista, veiculo) {
  $('painelMotorista').innerHTML = `
    <div class="linha"><span>Motorista</span><strong>${motorista.nome}</strong></div>
    <div class="linha"><span>Telefone</span><strong>${motorista.telefone}</strong></div>
    <div class="linha"><span>Veículo</span><strong>${veiculo.marca} ${veiculo.modelo} · ${veiculo.cor}</strong></div>
    <div class="linha"><span>Placa</span><strong>${veiculo.placa}</strong></div>
  `;
}

async function verHistorico() {
  irPara('telaHistorico');
  const corridas = await api('/api/rides/minhas');
  const html = ['<h2>Histórico</h2>'];
  if (corridas.length === 0) html.push('<p style="color:var(--cinza)">Nenhuma corrida ainda.</p>');
  corridas.forEach((c) => {
    const trajeto = c.origem_endereco && c.destino_endereco
      ? `${c.origem_endereco.split(',')[0]} → ${c.destino_endereco.split(',')[0]}`
      : `${c.distancia_km.toFixed(1)} km`;
    html.push(`
      <div style="padding:10px 0;border-bottom:1px solid var(--borda);">
        <div class="linha" style="border:none;padding:0 0 2px;">
          <span>${new Date(c.data_solicitacao).toLocaleDateString('pt-BR')} — ${c.status}</span>
          <strong>R$ ${(c.valor_final ?? c.valor_estimado).toFixed(2)}</strong>
        </div>
        <div style="color:var(--cinza);font-size:.78rem;">${trajeto}</div>
      </div>`);
  });
  $('listaHistorico').innerHTML = html.join('');
}

// --- Avaliação ---
let valorFinalCorrida = 0;
let notaSelecionada = 5;

function montarEstrelasAvaliacao() {
  notaSelecionada = 5;
  const container = $('estrelasAvaliacao');
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const estrela = document.createElement('span');
    estrela.className = `estrela ${i <= notaSelecionada ? 'ativa' : ''}`;
    estrela.textContent = '★';
    estrela.onclick = () => {
      notaSelecionada = i;
      [...container.children].forEach((el, idx) => el.classList.toggle('ativa', idx < i));
    };
    container.appendChild(estrela);
  }
}

async function enviarAvaliacao() {
  try {
    await api(`/api/rides/${corridaAtualId}/avaliar`, {
      method: 'POST',
      body: JSON.stringify({
        nota: notaSelecionada,
        comentario: $('comentarioAvaliacao').value,
      }),
    });
  } catch (e) { /* segue mesmo se já avaliada */ }
  encerrarCorridaLocal();
  voltarParaSolicitar();
}

// --- Socket / tempo real ---
function conectarSocket() {
  socket = io(API_URL, { auth: { token } });

  socket.on('nenhum_motorista_disponivel', () => {
    alert('Nenhum motorista disponível no momento. Tente novamente em instantes.');
    encerrarCorridaLocal();
    voltarParaSolicitar();
  });

  socket.on('motorista_aceitou', ({ motorista, veiculo }) => {
    irPara('telaAcompanhar');
    initMapaAcompanhar();
    mostrarInfoMotorista(motorista, veiculo);
    $('statusCorrida').textContent = 'Motorista a caminho';
  });

  socket.on('status_atualizado', ({ status }) => {
    const textos = {
      ACEITA: 'Motorista aceitou',
      MOTORISTA_A_CAMINHO: 'Motorista a caminho',
      MOTORISTA_CHEGOU: 'Motorista chegou',
      EM_ANDAMENTO: 'Corrida em andamento',
      FINALIZADA: 'Corrida finalizada',
      CANCELADA: 'Corrida cancelada',
    };
    if ($('statusCorrida')) $('statusCorrida').textContent = textos[status] || status;

    if (status === 'CANCELADA') {
      alert('A corrida foi cancelada.');
      encerrarCorridaLocal();
      voltarParaSolicitar();
    }
    if (status === 'FINALIZADA') {
      api(`/api/rides/${corridaAtualId}`).then((c) => {
        $('valorFinalTexto').textContent = `R$ ${c.valor_final.toFixed(2)}`;
        montarEstrelasAvaliacao();
        irPara('telaAvaliar');
      });
    }
  });

  socket.on('localizacao_motorista', ({ latitude, longitude }) => {
    if (!mapaAcompanhar) return;
    if (marcadorMotorista) mapaAcompanhar.removeLayer(marcadorMotorista);
    marcadorMotorista = L.marker([latitude, longitude]).addTo(mapaAcompanhar).bindPopup('Motorista');
    mapaAcompanhar.panTo([latitude, longitude]);
  });
}

// --- Boot ---
function iniciarAppLogado() {
  $('usuarioNome').textContent = usuario.nome;
  conectarSocket();
  if (corridaAtualId) {
    socket.emit('entrar_corrida', corridaAtualId);
    api(`/api/rides/${corridaAtualId}`).then((c) => {
      if (['FINALIZADA', 'CANCELADA'].includes(c.status)) { encerrarCorridaLocal(); voltarParaSolicitar(); return; }
      if (c.status === 'PROCURANDO_MOTORISTA') { irPara('telaProcurando'); return; }
      irPara('telaAcompanhar');
      initMapaAcompanhar();
      $('statusCorrida').textContent = c.status;
    });
  } else {
    voltarParaSolicitar();
  }
  initMapaSolicitar();
  configurarBuscaEndereco('origemBusca', 'sugestoesOrigem', definirOrigem);
  configurarBuscaEndereco('destinoBusca', 'sugestoesDestino', definirDestino);
}

if (token && usuario) { iniciarAppLogado(); } else { irPara('telaAuth'); }
