const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/dashboard', ctrl.dashboard);
router.get('/motoristas', ctrl.listarMotoristas);
router.post('/motoristas/:id/status', ctrl.atualizarStatusMotorista);
router.get('/passageiros', ctrl.listarPassageiros);
router.get('/corridas', ctrl.listarCorridas);
router.get('/configuracao', ctrl.obterConfiguracao);
router.put('/configuracao', ctrl.atualizarConfiguracao);

module.exports = router;
