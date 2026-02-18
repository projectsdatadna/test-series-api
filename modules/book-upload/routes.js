// Book Upload Routes

const express = require('express');
const controller = require('./controller');

const router = express.Router();

// Upload book file and create chapter
router.post('/upload', controller.uploadBookFile);

// Get all books
router.get('/books', controller.getAllBooks);

// Get chapters for a subject
router.get('/chapters/:subjectId', controller.getChaptersForSubject);

// Get book files for a chapter
router.get('/files/:chapterId', controller.getBookFilesForChapter);

module.exports = router;
