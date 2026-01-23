const express = require('express');
const materialTagsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Material Tags Management Routes
router.post('/', handler(materialTagsController.createTag));
router.get('/', handler(materialTagsController.getAllTags));
router.get('/:tagId', handler(materialTagsController.getTagDetails));
router.put('/:tagId', handler(materialTagsController.updateTag));
router.delete('/:tagId', handler(materialTagsController.deleteTag));
router.get('/:tagId/materials', handler(materialTagsController.getMaterialsByTag));

module.exports = router;