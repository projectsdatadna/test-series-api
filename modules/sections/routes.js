const express = require('express');
const sectionsController = require('./controller');
const materialsController = require('../materials/controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Sections Management Routes
router.post('/', handler(sectionsController.createSection));
router.get('/', handler(sectionsController.getAllSections));
router.get('/:sectionId', handler(sectionsController.getSectionDetails));
router.put('/:sectionId', handler(sectionsController.updateSection));
router.delete('/:sectionId', handler(sectionsController.deleteSection));

// Cross-module routes for sections
router.get('/:sectionId/materials', handler(materialsController.getMaterialsBySection));

module.exports = router;