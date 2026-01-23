const express = require('express');
const assignmentQuestionOptionsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Assignment Question Options Management Routes
router.post('/assignment-questions/:AquestionId/options', handler(assignmentQuestionOptionsController.addOption));
router.get('/assignment-questions/:AquestionId/options', handler(assignmentQuestionOptionsController.getOptionsByQuestion));
router.put('/assignment-options/:AoptionId', handler(assignmentQuestionOptionsController.updateOption));
router.delete('/assignment-options/:AoptionId', handler(assignmentQuestionOptionsController.deleteOption));

module.exports = router;