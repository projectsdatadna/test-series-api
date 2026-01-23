const express = require('express');
const profilesController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// User Profiles Management Routes
router.post('/', handler(profilesController.createProfile));
router.get('/', handler(profilesController.getAllProfiles));
router.get('/:userId', handler(profilesController.getProfile));
router.get('/id/:profileId', handler(profilesController.getProfileById));
router.put('/:userId', handler(profilesController.updateProfile));
router.delete('/:userId', handler(profilesController.deleteProfile));
router.post('/:userId/picture', handler(profilesController.uploadProfilePicture));
router.delete('/:userId/picture', handler(profilesController.deleteProfilePicture));
router.get('/:userId/statistics', handler(profilesController.getProfileStatistics));

module.exports = router;