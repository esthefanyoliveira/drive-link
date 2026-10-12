const express = require('express');
const { registrarPassageiro, registrarMotorista, login } = require('../controllers/authController');

const router = express.Router();

router.post('/registrar/passageiro', registrarPassageiro);
router.post('/registrar/motorista', registrarMotorista);
router.post('/login', login);

module.exports = router;
