const express = require('express');
const subjectsController = require('./controller');
const coursesController = require('../courses/controller');
const flashcardsController = require('../flashcards/controller');
const questionsController = require('../questions/controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Subjects Management Routes
router.post('/', handler(subjectsController.createSubject));
router.get('/', handler(subjectsController.getAllSubjects));
router.get('/:subjectId', handler(subjectsController.getSubjectDetails));
router.put('/:subjectId', handler(subjectsController.updateSubject));
router.delete('/:subjectId', handler(subjectsController.deleteSubject));
router.get('/:subjectId/chapters', handler(subjectsController.getSubjectChapters));

// Cross-module routes for subjects
router.get('/:subjectId/courses', handler(coursesController.getCoursesBySubject));
router.get('/:subjectId/flashcards', handler(flashcardsController.getFlashcardsBySubject));
router.get('/:subjectId/questions', handler(questionsController.getQuestionsBySubject));

module.exports = router;