const express = require('express');
const questionOptionsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Question Options Management Routes
router.post('/questions/:questionId/options', handler(questionOptionsController.addOption));
router.get('/questions/:questionId/options', handler(questionOptionsController.getOptionsByQuestion));
router.put('/options/:optionId', handler(questionOptionsController.updateOption));
router.delete('/options/:optionId', handler(questionOptionsController.deleteOption));

module.exports = router;