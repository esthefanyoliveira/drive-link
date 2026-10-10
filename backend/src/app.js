const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const rideRoutes = require('./routes/rideRoutes');
const driverRoutes = require('./routes/driverRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
app.use(cors({
  origin: 'https://vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Serve os três apps (passageiro, motorista, admin) direto por este mesmo
// servidor, assim só precisa hospedar UMA coisa, não duas separadas.
const pastaFrontend = path.join(process.cwd(), 'frontend');
app.use(express.static(pastaFrontend));

// '*' precisa ser passado como string (libera qualquer origem); uma lista de
// domínios específicos é passada como array. Passar ['*'] por engano faz o
// navegador bloquear a conexão, mesmo com o servidor funcionando normalmente.
const origensPermitidas = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: origensPermitidas === '*' ? '*' : origensPermitidas.split(',') }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, servico: 'Drive Link API' }));

app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/admin', adminRoutes);

// Tratamento de erros central — nunca vaza detalhes internos para o cliente.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

module.exports = app;
