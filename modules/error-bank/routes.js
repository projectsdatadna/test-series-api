const express = require('express');
const errorBankController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Error Bank Management Routes
router.post('/', handler(errorBankController.logError));
router.get('/users/:userId/error-bank', handler(errorBankController.getUserErrorBank));
router.get('/:errorId', handler(errorBankController.getErrorDetails));
router.put('/:errorId/retry', handler(errorBankController.updateRetryCount));
router.delete('/:errorId', handler(errorBankController.deleteErrorRecord));
router.get('/users/:userId/error-bank/top-topics', handler(errorBankController.getTopErrorTopics));

module.exports = router;