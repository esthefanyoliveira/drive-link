const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/driverController');

const router = express.Router();
router.use(requireAuth, requireRole('motorista'));

router.get('/perfil', ctrl.meuPerfil);
router.post('/status', ctrl.alternarStatus);
router.get('/ganhos', ctrl.meusGanhos);

module.exports = router;
