const express = require('express');
const chaptersController = require('./controller');
const questionsController = require('../questions/controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Chapters Management Routes
router.post('/', handler(chaptersController.createChapter));
router.get('/', handler(chaptersController.getAllChapters));
router.get('/:chapterId', handler(chaptersController.getChapterDetails));
router.put('/:chapterId', handler(chaptersController.updateChapter));
router.delete('/:chapterId', handler(chaptersController.deleteChapter));
router.get('/:chapterId/sections', handler(chaptersController.getChapterSections));

// Cross-module routes for chapters
router.get('/:chapterId/questions', handler(questionsController.getQuestionsByChapter));

module.exports = router;