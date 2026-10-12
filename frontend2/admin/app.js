let token = localStorage.getItem('dl_admin_token');
let usuario = JSON.parse(localStorage.getItem('dl_admin_usuario') || 'null');

const $ = (id) => document.getElementById(id);

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

async function fazerLogin() {
  $('erroLogin').textContent = '';
  try {
    const dados = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('loginEmail').value, senha: $('loginSenha').value }),
    });
    if (dados.usuario.tipo !== 'admin') throw new Error('Esta conta não é de administrador.');
    token = dados.token; usuario = dados.usuario;
    localStorage.setItem('dl_admin_token', token);
    localStorage.setItem('dl_admin_usuario', JSON.stringify(usuario));
    entrarNoPainel();
  } catch (e) { $('erroLogin').textContent = e.message; }
}

function sair() {
  localStorage.removeItem('dl_admin_token');
  localStorage.removeItem('dl_admin_usuario');
  location.reload();
}

function entrarNoPainel() {
  $('usuarioNome').textContent = usuario.nome;
  $('telaLogin').classList.add('oculto');
  $('telaPainel').classList.remove('oculto');
  carregarTudo();
}

async function carregarTudo() {
  await Promise.all([carregarDashboard(), carregarMotoristas(), carregarCorridas(), carregarConfig()]);
}

async function carregarDashboard() {
  const d = await api('/api/admin/dashboard');
  $('dMotoristas').textContent = d.motoristasCadastrados;
  $('dOnline').textContent = d.motoristasOnline;
  $('dOffline').textContent = d.motoristasOffline;
  $('dSolicitadas').textContent = d.corridasSolicitadas;
  $('dAndamento').textContent = d.corridasEmAndamento;
  $('dConcluidas').textContent = d.corridasConcluidas;
  $('dCanceladas').textContent = d.corridasCanceladas;
  $('dFaturamento').textContent = `R$ ${d.faturamento.toFixed(2)}`;
}

async function carregarMotoristas() {
  const lista = await api('/api/admin/motoristas');
  $('tabelaMotoristas').innerHTML = lista.map((m) => `
    <tr>
      <td>${m.nome}</td>
      <td>${m.status}</td>
      <td>${m.online ? 'Sim' : 'Não'}</td>
      <td>${m.marca || ''} ${m.modelo || ''} — ${m.placa || ''}</td>
      <td>
        ${m.status !== 'aprovado' ? `<button style="width:auto;padding:6px 10px;margin:2px" onclick="mudarStatusMotorista('${m.id}','aprovado')">Aprovar</button>` : ''}
        ${m.status !== 'bloqueado' ? `<button class="perigo" style="width:auto;padding:6px 10px;margin:2px" onclick="mudarStatusMotorista('${m.id}','bloqueado')">Bloquear</button>` : ''}
      </td>
    </tr>`).join('');
}

async function mudarStatusMotorista(id, status) {
  await api(`/api/admin/motoristas/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
  carregarMotoristas();
  carregarDashboard();
}

async function carregarCorridas() {
  const lista = await api('/api/admin/corridas');
  const trajeto = (c) => c.origem_endereco && c.destino_endereco
    ? `${c.origem_endereco.split(',')[0]} → ${c.destino_endereco.split(',')[0]}`
    : `${c.distancia_km.toFixed(1)} km`;
  $('tabelaCorridas').innerHTML = lista.slice(0, 30).map((c) => `
    <tr>
      <td>${new Date(c.data_solicitacao).toLocaleString('pt-BR')}</td>
      <td>${trajeto(c)}</td>
      <td>${c.status}</td>
      <td>R$ ${(c.valor_final ?? c.valor_estimado).toFixed(2)}</td>
    </tr>`).join('');
}

async function carregarConfig() {
  const c = await api('/api/admin/configuracao');
  $('cfgTaxaBase').value = c.taxa_base;
  $('cfgValorKm').value = c.valor_por_km;
  $('cfgTarifaMinima').value = c.tarifa_minima;
}

async function salvarConfiguracao() {
  $('okConfig').textContent = '';
  await api('/api/admin/configuracao', {
    method: 'PUT',
    body: JSON.stringify({
      taxaBase: Number($('cfgTaxaBase').value),
      valorPorKm: Number($('cfgValorKm').value),
      tarifaMinima: Number($('cfgTarifaMinima').value),
    }),
  });
  $('okConfig').textContent = 'Configuração salva.';
}

if (token && usuario) entrarNoPainel();
