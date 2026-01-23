const express = require('express');
const examQuestionsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Exam Questions Management Routes
router.post('/exams/:examId/questions', handler(examQuestionsController.addQuestionToExam));
router.get('/exams/:examId/questions', handler(examQuestionsController.getExamQuestions));
router.put('/:mappingId', handler(examQuestionsController.updateExamQuestion));
router.delete('/:mappingId', handler(examQuestionsController.removeQuestionFromExam));
router.post('/exams/:examId/questions/shuffle', handler(examQuestionsController.shuffleExamQuestions));

module.exports = router;