const express = require('express');
const hierarchyController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Hierarchy Linking Routes
router.post('/syllabus/:syllabusId/courses/:courseId', handler(hierarchyController.linkSyllabusToCourse));
router.post('/courses/:courseId/standards/:standardId', handler(hierarchyController.linkStandardToCourse));
router.post('/standards/:standardId/subjects/:subjectId', handler(hierarchyController.linkSubjectToStandard));
router.post('/subjects/:subjectId/chapters/:chapterId', handler(hierarchyController.linkChapterToSubject));
router.post('/chapters/:chapterId/sections/:sectionId', handler(hierarchyController.linkSectionToChapter));
router.post('/syllabus/:syllabusId/subjects/:subjectId', handler(hierarchyController.linkSyllabusToSubject));

module.exports = router;