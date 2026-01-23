const express = require('express');
const courseBundlesController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Course Bundles Management Routes
router.post('/', handler(courseBundlesController.createBundle));
router.get('/', handler(courseBundlesController.getAllBundles));
router.get('/:bundleId', handler(courseBundlesController.getBundleDetails));
router.put('/:bundleId', handler(courseBundlesController.updateBundle));
router.delete('/:bundleId', handler(courseBundlesController.deleteBundle));
router.put('/:bundleId/add-course', handler(courseBundlesController.addCoursesToBundle));

module.exports = router;