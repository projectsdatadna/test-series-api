const express = require('express');
const materialsController = require('./controller');
const flashcardsController = require('../flashcards/controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Learning Materials Management Routes
router.post('/', handler(materialsController.createMaterial));
router.get('/', handler(materialsController.getAllMaterials));
router.get('/search', handler(materialsController.searchMaterials));
router.get('/:materialId', handler(materialsController.getMaterialDetails));
router.put('/:materialId', handler(materialsController.updateMaterial));
router.delete('/:materialId', handler(materialsController.deleteMaterial));

// Cross-module routes for materials
router.get('/:materialId/flashcards', handler(flashcardsController.getFlashcardsByMaterial));

module.exports = router;