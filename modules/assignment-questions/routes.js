const express = require('express');
const assignmentQuestionsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Assignment Questions Management Routes
router.post('/assignments/:assignmentId/questions', handler(assignmentQuestionsController.addQuestion));
router.get('/assignments/:assignmentId/questions', handler(assignmentQuestionsController.getAllQuestions));
router.get('/:AquestionId', handler(assignmentQuestionsController.getQuestionDetails));
router.put('/:AquestionId', handler(assignmentQuestionsController.updateQuestion));
router.delete('/:AquestionId', handler(assignmentQuestionsController.deleteQuestion));

module.exports = router;