const path = require('path');
const express = require('express');
const userController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

router.post('/', handler(userController.createUser));
router.get('/', handler(userController.getAllUsers));
router.get('/:userId', handler(userController.getUserById));
router.put('/:userId', handler(userController.updateUser));
router.delete('/:userId', handler(userController.deleteUser));
router.get('/:userId/enrollments', handler(userController.getUserEnrollments));
router.get('/:userId/viewed-materials', handler(userController.getUserViewedMaterials));
router.put('/:userId/preferences', handler(userController.updateUserPreferences));
router.put('/:userId/notification-settings', handler(userController.updateNotificationSettings));

module.exports = router;
