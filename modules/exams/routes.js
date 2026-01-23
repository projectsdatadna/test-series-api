const express = require('express');
const examsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Exams Management Routes
router.post('/', handler(examsController.createExam));
router.get('/', handler(examsController.getAllExams));
router.get('/active', handler(examsController.getActiveExams));
router.get('/schedule', handler(examsController.getExamSchedule));
router.get('/:examId', handler(examsController.getExamDetails));
router.put('/:examId', handler(examsController.updateExam));
router.delete('/:examId', handler(examsController.deleteExam));
router.put('/:examId/publish', handler(examsController.publishExam));
router.put('/:examId/complete', handler(examsController.completeExam));

module.exports = router;