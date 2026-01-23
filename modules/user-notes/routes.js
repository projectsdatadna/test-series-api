const express = require('express');
const userNotesController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// User Notes Management Routes
router.post('/materials/:materialId/notes', handler(userNotesController.addNote));
router.get('/materials/:materialId/notes', handler(userNotesController.getNotesForMaterial));
router.get('/users/:userId/notes', handler(userNotesController.getUserNotes));
router.put('/notes/:noteId', handler(userNotesController.updateNote));
router.delete('/notes/:noteId', handler(userNotesController.deleteNote));
router.get('/courses/:courseId/notes', handler(userNotesController.filterNotesByCourse));

module.exports = router;