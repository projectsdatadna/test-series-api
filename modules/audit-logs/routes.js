const express = require('express');
const auditLogsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Audit Logs Management Routes
router.post('/', handler(auditLogsController.logAction));
router.get('/', handler(auditLogsController.getAllLogs));
router.get('/details/:logId', handler(auditLogsController.getLogDetails));
router.get('/user/:userId', handler(auditLogsController.getUserLogs));
router.get('/module/:moduleName', handler(auditLogsController.getLogsByModule));
router.get('/action/:action', handler(auditLogsController.getLogsByAction));
router.get('/statistics', handler(auditLogsController.getAuditStatistics));
router.get('/export', (req, res) => {
  // Special handling for CSV export
  auditLogsController.exportLogs({
    headers: req.headers,
    queryStringParameters: req.query,
  }).then(result => {
    if (req.query.format === 'csv') {
      res.set(result.headers);
      res.status(result.statusCode).send(result.body);
    } else {
      res.status(result.statusCode).json(JSON.parse(result.body));
    }
  }).catch(error => {
    res.status(500).json({ success: false, message: error.message });
  });
});
router.delete('/cleanup', handler(auditLogsController.deleteOldLogs));

module.exports = router;