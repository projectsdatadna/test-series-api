const express = require('express');
const standardsController = require('./controller');
const coursesController = require('../courses/controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Standards Management Routes
router.post('/', handler(standardsController.createStandard));
router.get('/', handler(standardsController.getAllStandards));
router.get('/:standardId', handler(standardsController.getStandardDetails));
router.put('/:standardId', handler(standardsController.updateStandard));
router.delete('/:standardId', handler(standardsController.deleteStandard));
router.get('/:standardId/subjects', handler(standardsController.getStandardSubjects));

// Related routes for courses by standard
router.get('/:standardId/courses', handler(coursesController.getCoursesByStandard));

module.exports = router;