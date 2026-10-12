const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/rideController');

const router = express.Router();
router.use(requireAuth);

router.post('/estimar', requireRole('passageiro'), ctrl.estimar);
router.post('/', requireRole('passageiro'), ctrl.solicitar);
router.get('/minhas', ctrl.minhasCorridas);
router.get('/:id', ctrl.detalhar);
router.post('/:id/aceitar', requireRole('motorista'), ctrl.aceitar);
router.post('/:id/status', requireRole('motorista'), ctrl.atualizarStatus);
router.post('/:id/cancelar', requireRole('passageiro', 'motorista'), ctrl.cancelar);
router.post('/:id/avaliar', requireRole('passageiro', 'motorista'), ctrl.avaliar);

module.exports = router;
