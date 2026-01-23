const express = require('express');
const materialAnalyticsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Material Analytics Management Routes
router.post('/materials/:materialId/analytics', handler(materialAnalyticsController.recordAnalytics));
router.get('/materials/:materialId/analytics', handler(materialAnalyticsController.getAnalyticsForMaterial));
router.put('/analytics/:analyticsId', handler(materialAnalyticsController.updateAnalytics));
router.get('/analytics', handler(materialAnalyticsController.getAllAnalytics));
router.get('/courses/:courseId/analytics', handler(materialAnalyticsController.getAnalyticsByCourse));
router.get('/analytics/top-viewed', handler(materialAnalyticsController.getTopViewedMaterials));
router.get('/analytics/top-rated', handler(materialAnalyticsController.getTopRatedMaterials));

module.exports = router;