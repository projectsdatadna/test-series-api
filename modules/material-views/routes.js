const express = require('express');
const materialViewsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Material Views Management Routes
router.post('/', handler(materialViewsController.recordMaterialView));
router.get('/analytics', handler(materialViewsController.getLearningAnalytics));
router.get('/enrollment/:enrollmentId', handler(materialViewsController.getViewsByEnrollment));
router.get('/user/:userId', handler(materialViewsController.getViewsByUser));
router.get('/material/:materialId', handler(materialViewsController.getViewsByMaterial));
router.get('/:materialId/notes/:userId', handler(materialViewsController.getMaterialNotes));
router.get('/:viewId', handler(materialViewsController.getViewDetails));
router.put('/:viewId', handler(materialViewsController.updateViewCompletion));
router.delete('/:viewId', handler(materialViewsController.deleteMaterialView));

module.exports = router;