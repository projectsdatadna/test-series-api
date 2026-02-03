// Adaptive Content Library Routes

const express = require('express');
const controller = require('./controller');
const { verifyJWT } = require('../../middleware/jwtMiddleware');

const router = express.Router();

// Create adaptive content
router.post('/', verifyJWT, controller.createAdaptiveContent);

// ⚠️ IMPORTANT: Specific routes MUST come before generic /:contentId route
// Get adaptive content by standard
router.get('/standard/:standardId', verifyJWT, controller.getAdaptiveContentByStandard);

// Get adaptive content by subject
router.get('/subject/:subjectId', verifyJWT, controller.getAdaptiveContentBySubject);

// Get adaptive content by chapter
router.get('/chapter/:chapterId', verifyJWT, controller.getAdaptiveContentByChapter);

// Get adaptive content by type
router.get('/type/:contentType', verifyJWT, controller.getAdaptiveContentByType);

// Get all adaptive content for user (no params)
router.get('/', verifyJWT, controller.getAdaptiveContentByUser);

// Get adaptive content by ID (generic - must be last)
router.get('/:contentId', verifyJWT, controller.getAdaptiveContentById);

// Update adaptive content
router.put('/:contentId', verifyJWT, controller.updateAdaptiveContent);

// Delete adaptive content
router.delete('/:contentId', verifyJWT, controller.deleteAdaptiveContent);

module.exports = router;
