const express = require('express');
const enrollmentsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Enrollments Management Routes
router.post('/', handler(enrollmentsController.enrollInCourse));
router.post('/bulk', handler(enrollmentsController.bulkEnrollUsers));
router.get('/statistics', handler(enrollmentsController.getEnrollmentStatistics));
router.get('/user/:userId', handler(enrollmentsController.getUserEnrollments));
router.get('/course/:courseId', handler(enrollmentsController.getCourseEnrollments));
router.get('/:enrollmentId', handler(enrollmentsController.getEnrollmentDetails));
router.put('/:enrollmentId/progress', handler(enrollmentsController.updateEnrollmentProgress));
router.put('/:enrollmentId/reactivate', handler(enrollmentsController.reactivateEnrollment));
router.delete('/:enrollmentId', handler(enrollmentsController.unenrollFromCourse));

module.exports = router;