/**
 * Sections Routes
 * API endpoints for retrieving sections with chunks and embeddings
 */

const express = require('express');
const controller = require('./controller');

const router = express.Router();

// Get all sections for a chapter
router.get('/chapter/:chapterId', controller.getSectionsForChapter);

// Get specific section details with all chunks and embeddings
router.get('/:sectionId', controller.getSectionDetails);

// Search sections by metadata
router.get('/', controller.searchSectionsAPI);

module.exports = router;
