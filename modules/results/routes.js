const express = require('express');
const resultsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Results Management Routes
router.post('/generate', handler(resultsController.generateResult));
router.get('/users/:userId/exams/:examId/result', handler(resultsController.getUserResult));
router.get('/exams/:examId/results', handler(resultsController.getAllResultsForExam));
router.get('/users/:userId/results', handler(resultsController.getAllResultsForUser));
router.put('/:resultId', handler(resultsController.updateResult));
router.delete('/:resultId', handler(resultsController.deleteResult));
router.get('/exams/:examId/leaderboard', handler(resultsController.getLeaderboard));
router.get('/exams/:examId/result-summary', handler(resultsController.getResultSummary));
router.get('/exams/:examId/results/export', (req, res) => {
  // Special handling for CSV export
  resultsController.exportResults({
    pathParameters: { examId: req.params.examId },
    headers: req.headers,
  }).then(result => {
    if (result.headers && result.headers['Content-Type'] === 'text/csv') {
      res.set(result.headers);
      res.status(result.statusCode).send(result.body);
    } else {
      res.status(result.statusCode).json(JSON.parse(result.body));
    }
  }).catch(error => {
    res.status(500).json({ success: false, message: error.message });
  });
});

module.exports = router;