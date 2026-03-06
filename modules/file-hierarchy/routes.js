// Routes for File Hierarchy

const express = require('express');
const controller = require('./controller');

const router = express.Router();

// Syllabus routes
router.get('/syllabi', controller.getAllSyllabi);

// Standards routes
router.get('/all-standards', controller.getAllStandards); // NEW: Get all standards
router.get('/standards/:syllabusId', controller.getStandardsBySyllabus);

// Subjects routes
router.get('/all-subjects', controller.getAllSubjects); // NEW: Get all subjects
router.get('/subjects/:standardId', controller.getSubjectsByStandard);

// Chapters routes - requires syllabusId, standardId, subjectId as query params
router.get('/chapters', controller.getChaptersBySubject);
router.post('/chapters', controller.createChapterWithFile);

// Book Files routes
router.get('/files/:fileId', controller.getBookFileById);
router.get('/files/chapter/:chapterId', controller.getBookFilesByChapter);

module.exports = router;
