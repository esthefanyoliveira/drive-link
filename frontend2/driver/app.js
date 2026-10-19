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

// Converte um arquivo escolhido em <input type="file"> para base64, pra mandar pro backend como texto.
function arquivoParaBase64(inputId) {
return new Promise((resolve) => {
const input = $(inputId);
const arquivo = input?.files?.[0];
if (!arquivo) return resolve(null);
const leitor = new FileReader();
leitor.onload = () => resolve(leitor.result); // já vem como "data:image/...;base64,...."
leitor.onerror = () => resolve(null);
leitor.readAsDataURL(arquivo);
});
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
if (!$('cadAceiteTermos').checked) {
$('erroCadastro').textContent = 'É preciso aceitar os termos de uso e a política de privacidade.';
return;
}
try {
const [cnhFoto, documentoFoto] = await Promise.all([
arquivoParaBase64('cadCnhFoto'),
arquivoParaBase64('cadDocumentoFoto'),
]);
const dados = await api('/api/auth/registrar/motorista', {
method: 'POST',
body: JSON.stringify({
nome: $('cadNome').value, telefone: $('cadTelefone').value,
email: $('cadEmail').value, senha: $('cadSenha').value,
cpf: $('cadCpf').value, cnh: $('cadCnh').value, cnhFoto,
veiculo: {
marca: $('cadMarca').value, modelo: $('cadModelo').value,
cor: $('cadCor').value, placa: $('cadPlaca').value, documentoFoto,
},
aceiteTermos: true,
}),
});
salvarSessao(dados);
} catch (e) { $('erroCadastro').textContent = e.message; }
}

function salvarSessao(dados) {
token = dados.token; usuario = dados.usuario;
localStorage.setItem('dl_driver_token', token);
localStorage.setItem('dl_driver_usuario', JSON.stringify(usuario));
destravarAudio();
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
if (!online) destravarAudio(); // precisa de um clique do usuário pra liberar o som
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
// Chega uma oferta de cada vez (o backend oferece a 1 motorista por vez, em
// cascata), mas se uma segunda chegar enquanto o motorista ainda está
// decidindo a primeira, ela entra numa fila em vez de se perder.
let ofertaAtual = null;
let filaOfertas = [];
let temporizadorOferta = null;

function mostrarSolicitacao(dados) {
ofertaAtual = dados;
$('reqOrigem').textContent = dados.origemEndereco || `${dados.origemLat.toFixed(4)}, ${dados.origemLng.toFixed(4)}`;
$('reqDestino').textContent = dados.destinoEndereco || `${dados.destinoLat.toFixed(4)}, ${dados.destinoLng.toFixed(4)}`;
$('reqDistancia').textContent = `${dados.distanciaKm} km`;
$('reqValor').textContent = `R$ ${dados.valorEstimado.toFixed(2)}`;
iniciarContagemOferta(dados.prazoSegundos || 20);
atualizarIndicadorFila();
mostrar('painelSolicitacao');
}

function iniciarContagemOferta(segundos) {
pararContagemOferta();
let restante = segundos;
atualizarBarraTempo(restante, segundos);
temporizadorOferta = setInterval(() => {
restante -= 1;
atualizarBarraTempo(restante, segundos);
if (restante <= 0) {
// O backend também vai expirar essa oferta e já ofereceu pro próximo
// motorista; aqui só tiramos ela da tela deste motorista.
pararContagemOferta();
ofertaAtual = null;
esconder('painelSolicitacao');
avancarFilaDeOfertas();
}
}, 1000);
}

function pararContagemOferta() {
if (temporizadorOferta) { clearInterval(temporizadorOferta); temporizadorOferta = null; }
}

function atualizarBarraTempo(restante, total) {
const barra = $('barraTempoOferta');
if (barra) barra.style.width = `${Math.max(0, (restante / total) * 100)}%`;
const texto = $('tempoOfertaTexto');
if (texto) texto.textContent = `${Math.max(0, restante)}s`;
}

function atualizarIndicadorFila() {
const el = $('filaIndicador');
if (!el) return;
if (filaOfertas.length > 0) {
el.textContent = `+${filaOfertas.length} corrida${filaOfertas.length > 1 ? 's' : ''} esperando você responder essa`;
el.classList.remove('oculto');
} else {
el.classList.add('oculto');
}
}

/** Mostra a próxima oferta da fila, se tiver alguma (e o motorista não estiver ocupado). */
function avancarFilaDeOfertas() {
if (corridaAtiva) { filaOfertas = []; return; }
const proxima = filaOfertas.shift();
atualizarIndicadorFila();
if (proxima) mostrarSolicitacao(proxima);
}

async function recusarCorrida() {
if (!ofertaAtual) return;
const idCorrida = ofertaAtual.id;
pararContagemOferta();
ofertaAtual = null;
esconder('painelSolicitacao');
try { await api(`/api/rides/${idCorrida}/recusar`, { method: 'POST' }); } catch (e) { /* segue mesmo assim */ }
avancarFilaDeOfertas();
}

async function aceitarCorrida() {
if (!ofertaAtual) return;
const idCorrida = ofertaAtual.id;
try {
const corrida = await api(`/api/rides/${idCorrida}/aceitar`, { method: 'POST' });
pararContagemOferta();
ofertaAtual = null;
filaOfertas = []; // o motorista ficou ocupado: as outras ofertas na fila não valem mais pra ele
corridaAtiva = corrida;
socket.emit('entrar_corrida', corrida.id);
esconder('painelSolicitacao');
mostrarCorridaAtiva(corrida);
} catch (e) {
// Outro motorista foi mais rápido — sem alert() feio, só avisa no próprio painel e segue a fila.
pararContagemOferta();
ofertaAtual = null;
esconder('painelSolicitacao');
avancarFilaDeOfertas();
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
carregarMensagensChat();
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

async function carregarNotaMotorista() {
try {
const { notaMedia, totalAvaliacoes } = await api('/api/driver/perfil');
$('notaMotorista').textContent = notaMedia != null
? `⭐ ${notaMedia.toFixed(1)} (${totalAvaliacoes} avaliações)`
: 'Ainda sem avaliações';
} catch (e) { /* silencioso */ }
}

// --- Chat com o passageiro ---
function renderizarMensagemChat(msg) {
const container = $('chatMensagens');
const vazio = container.querySelector('.chat-vazio');
if (vazio) vazio.remove();
const bolha = document.createElement('div');
bolha.className = `chat-bolha ${msg.remetente_id === usuario.id ? 'minha' : ''}`;
bolha.textContent = msg.texto;
container.appendChild(bolha);
container.scrollTop = container.scrollHeight;
}

async function carregarMensagensChat() {
const container = $('chatMensagens');
container.innerHTML = '<div class="chat-vazio">Nenhuma mensagem ainda.</div>';
if (!corridaAtiva) return;
try {
const mensagens = await api(`/api/rides/${corridaAtiva.id}/mensagens`);
if (mensagens.length > 0) container.innerHTML = '';
mensagens.forEach(renderizarMensagemChat);
} catch (e) { /* silencioso */ }
}

async function enviarMensagemChat() {
const texto = $('chatTexto').value.trim();
if (!texto || !corridaAtiva) return;
$('chatTexto').value = '';
try { await api(`/api/rides/${corridaAtiva.id}/mensagens`, { method: 'POST', body: JSON.stringify({ texto }) }); }
catch (e) { alert(e.message); }
}

// --- Ajuda / suporte ---
function irParaAjuda() {
esconder('telaPainel');
mostrar('telaAjuda');
carregarChamadosAjuda();
}

async function enviarChamadoAjuda() {
$('erroAjuda').textContent = '';
const assunto = $('ajudaAssunto').value.trim();
const mensagem = $('ajudaMensagem').value.trim();
if (!assunto || !mensagem) { $('erroAjuda').textContent = 'Preencha assunto e mensagem.'; return; }
try {
await api('/api/conta/chamados', {
method: 'POST',
body: JSON.stringify({ assunto, mensagem, corridaId: corridaAtiva?.id || undefined }),
});
$('ajudaAssunto').value = ''; $('ajudaMensagem').value = '';
carregarChamadosAjuda();
} catch (e) { $('erroAjuda').textContent = e.message; }
}

async function carregarChamadosAjuda() {
const chamados = await api('/api/conta/chamados');
const html = ['<h2>Meus chamados</h2>'];
if (chamados.length === 0) html.push('<p style="color:var(--cinza)">Nenhum chamado aberto.</p>');
chamados.forEach((c) => {
html.push(`
<div style="padding:10px 0;border-bottom:1px solid var(--borda);">
<div class="linha" style="border:none;padding:0 0 2px;">
<span>${new Date(c.data_abertura).toLocaleDateString('pt-BR')} — ${c.assunto}</span>
<strong>${c.status}</strong>
</div>
<div style="color:var(--cinza);font-size:.78rem;">${c.mensagem}</div>
${c.resposta ? `<div style="color:var(--ciano);font-size:.8rem;margin-top:4px;">Resposta: ${c.resposta}</div>` : ''}
</div>`);
});
$('listaChamadosAjuda').innerHTML = html.join('');
}

// --- Socket ---
function conectarSocket() {
socket = io(API_URL, { auth: { token } });
socket.on('nova_corrida', (dados) => {
if (corridaAtiva) return; // já está em outra corrida (não deveria acontecer, mas por garantia)
tocarSomNovaCorrida();
vibrar([300, 150, 300]);
if (ofertaAtual) {
// já tem uma oferta na tela: essa entra na fila pra ser mostrada em seguida
filaOfertas.push(dados);
atualizarIndicadorFila();
} else {
mostrarSolicitacao(dados);
}
});
socket.on('corrida_indisponivel', ({ corridaId } = {}) => {
if (ofertaAtual && ofertaAtual.id === corridaId) {
pararContagemOferta();
ofertaAtual = null;
esconder('painelSolicitacao');
avancarFilaDeOfertas();
} else if (corridaId) {
filaOfertas = filaOfertas.filter((o) => o.id !== corridaId);
atualizarIndicadorFila();
}
});
socket.on('nova_mensagem', (msg) => {
if (msg.remetente_id !== usuario.id) renderizarMensagemChat(msg);
});
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
await carregarNotaMotorista();
}

if (token && usuario) { iniciarAppLogado(); }

