const express = require('express');
const sessionsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// User Sessions Management Routes
router.post('/login', handler(sessionsController.login));
router.post('/logout', handler(sessionsController.logout));
router.get('/validate', handler(sessionsController.validateToken));
router.post('/refresh', handler(sessionsController.refreshSession));
router.get('/:userId', handler(sessionsController.getActiveSessions));
router.get('/:userId/all', handler(sessionsController.getAllSessions));
router.get('/details/:sessionId', handler(sessionsController.getSessionDetails));
router.delete('/:sessionId', handler(sessionsController.revokeSession));
router.delete('/:userId/all', handler(sessionsController.revokeAllSessions));

module.exports = router;