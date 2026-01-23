const express = require('express');
const questionsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Questions Management Routes
router.post('/', handler(questionsController.createQuestion));
router.get('/', handler(questionsController.getAllQuestions));
router.get('/search', handler(questionsController.searchQuestions));
router.get('/:questionId', handler(questionsController.getQuestionDetails));
router.put('/:questionId', handler(questionsController.updateQuestion));
router.delete('/:questionId', handler(questionsController.deleteQuestion));

module.exports = router;