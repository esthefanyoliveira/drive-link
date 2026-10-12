// Popula o banco com dados de teste: 1 admin, 2 passageiros, 8 motoristas.
// Rode com: npm run seed
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./database');

function criarUsuario({ nome, telefone, email, senha, tipo }) {
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existente) return existente.id;
  const id = uuid();
  const senha_hash = bcrypt.hashSync(senha, 10);
  db.prepare(`INSERT INTO usuarios (id, nome, telefone, email, senha_hash, tipo)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, nome, telefone, email, senha_hash, tipo);
  return id;
}

// Admin
criarUsuario({
  nome: 'Administrador Drive Link',
  telefone: '(11) 90000-0000',
  email: 'admin@drivelink.com',
  senha: 'admin123',
  tipo: 'admin',
});

// Passageiros
const passageiros = [
  { nome: 'Ana Souza', telefone: '(11) 91111-1111', email: 'ana@teste.com' },
  { nome: 'Bruno Lima', telefone: '(11) 92222-2222', email: 'bruno@teste.com' },
];
passageiros.forEach((p) =>
  criarUsuario({ ...p, senha: 'senha123', tipo: 'passageiro' })
);

// Motoristas (8), coordenadas espalhadas perto de um ponto central de exemplo (São Paulo)
const motoristas = [
  { nome: 'Carlos Pereira', cpf: '111.111.111-11', placa: 'ABC1A11' },
  { nome: 'Daniela Alves', cpf: '222.222.222-22', placa: 'ABC1B22' },
  { nome: 'Eduardo Santos', cpf: '333.333.333-33', placa: 'ABC1C33' },
  { nome: 'Fernanda Costa', cpf: '444.444.444-44', placa: 'ABC1D44' },
  { nome: 'Gustavo Rocha', cpf: '555.555.555-55', placa: 'ABC1E55' },
  { nome: 'Helena Martins', cpf: '666.666.666-66', placa: 'ABC1F66' },
  { nome: 'Igor Fernandes', cpf: '777.777.777-77', placa: 'ABC1G77' },
  { nome: 'Juliana Ramos', cpf: '888.888.888-88', placa: 'ABC1H88' },
];

// Cidades reais atendidas pela Drive Link. Os motoristas de teste são
// distribuídos entre elas (em vez de um único ponto) para simular melhor
// uma operação cobrindo toda a região.
const cidades = [
  { nome: 'Curitiba', lat: -25.4284, lng: -49.2733 },
  { nome: 'Ponta Grossa', lat: -25.0950, lng: -50.1619 },
  { nome: 'Carambeí', lat: -24.9150, lng: -50.0975 },
  { nome: 'Castro', lat: -24.7908, lng: -50.0119 },
];

motoristas.forEach((m, i) => {
  const email = `motorista${i + 1}@teste.com`;
  const usuarioId = criarUsuario({
    nome: m.nome,
    telefone: `(11) 9${3000 + i}-0000`,
    email,
    senha: 'senha123',
    tipo: 'motorista',
  });

  const motoristaExistente = db
    .prepare('SELECT id FROM motoristas WHERE usuario_id = ?')
    .get(usuarioId);
  if (motoristaExistente) return;

  // Pequeno deslocamento aleatório para não empilhar todos no mesmo ponto exato.
  const cidade = cidades[i % cidades.length];
  const jitter = () => (Math.random() - 0.5) * 0.03; // ~ +/- 1.5km
  const lat = cidade.lat + jitter();
  const lng = cidade.lng + jitter();

  const motoristaId = uuid();
  db.prepare(`INSERT INTO motoristas (id, usuario_id, cpf, cnh, status, online, latitude, longitude, atualizado_em)
              VALUES (?, ?, ?, ?, 'aprovado', 1, ?, ?, datetime('now'))`)
    .run(motoristaId, usuarioId, m.cpf, `CNH${1000 + i}`, lat, lng);

  db.prepare(`INSERT INTO veiculos (id, motorista_id, marca, modelo, cor, placa, documento)
              VALUES (?, ?, 'Chevrolet', 'Onix', 'Prata', ?, 'CRLV-OK')`)
    .run(uuid(), motoristaId, m.placa);
});

console.log('Seed concluído.');
console.log('Login admin: admin@drivelink.com / admin123');
console.log('Login passageiro: ana@teste.com / senha123');
console.log('Login motorista: motorista1@teste.com / senha123');
