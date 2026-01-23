const express = require('express');
const assignmentsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Course Assignments Management Routes
router.post('/', handler(assignmentsController.createAssignment));
router.get('/', handler(assignmentsController.getAllAssignments));
router.get('/:assignmentId', handler(assignmentsController.getAssignmentDetails));
router.put('/:assignmentId', handler(assignmentsController.updateAssignment));
router.delete('/:assignmentId', handler(assignmentsController.deleteAssignment));
router.get('/:assignmentId/materials', handler(assignmentsController.getAssignmentMaterials));

module.exports = router;