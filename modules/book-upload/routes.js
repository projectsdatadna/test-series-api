// Book Upload Routes

const express = require('express');
const controller = require('./controller');
const tnStateBoard = require('./tn-state-board-controller');

const router = express.Router();

// Upload book file and create chapter
router.post('/upload', controller.uploadBookFile);

// Get all books
router.get('/books', controller.getAllBooks);

// Get book details
router.get('/books/:bookId/:fileId', controller.getBookDetails);

// Download book file
router.get('/download/:bookId/:fileId', controller.downloadBook);

// Get divisions for 9th and 10th English
router.get('/divisions/:standardId/:subjectId', controller.getDivisionsForEnglish);

// Get chapters for a subject (with optional division filter)
router.get('/chapters/:subjectId/:standardId/:syllabusId', controller.getChaptersForSubject);

// Get book files for a chapter
router.get('/files/:chapterId', controller.getBookFilesForChapter);

// Delete book file
router.delete('/books/:bookId/:fileId', controller.deleteBook);

// ========== TN STATE BOARD ROUTES ==========

// Extract chapters from TN State Board book using AI
router.post('/tn-state-board/extract-chapters', tnStateBoard.extractChapters);

// Get extracted chapters for a book
router.get('/tn-state-board/chapters/:syllabusId/:standardId/:subjectId', tnStateBoard.getExtractedChapters);

// Get chapter details with sections
router.get('/tn-state-board/chapters/:chapterId', tnStateBoard.getChapterDetails);

module.exports = router;
