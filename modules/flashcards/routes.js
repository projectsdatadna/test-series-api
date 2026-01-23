const express = require('express');
const flashcardsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Flashcards Management Routes
router.post('/', handler(flashcardsController.createFlashcard));
router.get('/', handler(flashcardsController.getAllFlashcards));
router.get('/:flashcardId', handler(flashcardsController.getFlashcardDetails));
router.put('/:flashcardId', handler(flashcardsController.updateFlashcard));
router.delete('/:flashcardId', handler(flashcardsController.deleteFlashcard));

module.exports = router;