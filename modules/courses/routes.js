const express = require('express');
const coursesController = require('./controller');
const examsController = require('../exams/controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Courses Management Routes
router.post('/', handler(coursesController.createCourse));
router.get('/', handler(coursesController.getAllCourses));
router.get('/:courseId', handler(coursesController.getCourseDetails));
router.put('/:courseId', handler(coursesController.updateCourse));
router.delete('/:courseId', handler(coursesController.deleteCourse));
router.put('/:courseId/instructor', handler(coursesController.assignInstructor));
router.get('/:courseId/materials', handler(coursesController.getCourseMaterials));
router.get('/:courseId/structure', handler(coursesController.getCourseStructure));

// Cross-module routes for courses
router.get('/:courseId/exams', handler(examsController.getExamsByCourse));

module.exports = router;