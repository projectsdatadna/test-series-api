const express = require('express');
const profilesController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// ⚠️ Static routes MUST come before dynamic /:userId
router.get('/id/:profileId',         handler(profilesController.getProfileById));

// Dynamic routes
router.post('/',                     handler(profilesController.createProfile));
router.get('/',                      handler(profilesController.getAllProfiles));
router.get('/:userId',               handler(profilesController.getProfile));
router.get('/:userId/statistics',    handler(profilesController.getProfileStatistics));
router.put('/:userId',               handler(profilesController.updateProfile));
router.delete('/:userId',            handler(profilesController.deleteProfile));
router.post('/:userId/picture',      handler(profilesController.uploadProfilePicture));
router.delete('/:userId/picture',    handler(profilesController.deleteProfilePicture));

module.exports = router;