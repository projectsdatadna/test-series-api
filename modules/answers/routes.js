const express = require('express');
const answersController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Answers Management Routes
router.post('/exams/:examId/start', handler(answersController.startExam));
router.post('/exams/:examId/questions/:questionId/answer', handler(answersController.submitAnswer));
router.get('/exams/:examId/users/:userId/answers', handler(answersController.getUserAnswers));
router.put('/:answerId', handler(answersController.updateAnswer));
router.put('/:answerId/evaluate', handler(answersController.evaluateAnswer));
router.get('/exams/:examId/answers', handler(answersController.getAllExamAnswers));
router.delete('/:answerId', handler(answersController.deleteAnswer));
router.post('/exams/:examId/auto-evaluate', handler(answersController.autoEvaluate));
router.post('/exams/:examId/submit', handler(answersController.submitExam));

module.exports = router;