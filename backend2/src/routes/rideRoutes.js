const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/rideController');
const chatCtrl = require('../controllers/chatController');

const router = express.Router();
router.use(requireAuth);

router.post('/estimar', requireRole('passageiro'), ctrl.estimar);
router.post('/', requireRole('passageiro'), ctrl.solicitar);
router.get('/minhas', ctrl.minhasCorridas);
router.get('/:id', ctrl.detalhar);
router.post('/:id/aceitar', requireRole('motorista'), ctrl.aceitar);
router.post('/:id/recusar', requireRole('motorista'), ctrl.recusar);
router.post('/:id/status', requireRole('motorista'), ctrl.atualizarStatus);
router.post('/:id/cancelar', requireRole('passageiro', 'motorista'), ctrl.cancelar);
router.post('/:id/avaliar', requireRole('passageiro', 'motorista'), ctrl.avaliar);
router.get('/:id/mensagens', requireRole('passageiro', 'motorista'), chatCtrl.listarMensagens);
router.post('/:id/mensagens', requireRole('passageiro', 'motorista'), chatCtrl.enviarMensagem);

module.exports = router;

