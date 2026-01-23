const express = require('express');
const localizedContentController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Localized Content Management Routes
router.post('/', handler(localizedContentController.createLocalizedContent));
router.get('/materials/:materialId/localized', handler(localizedContentController.getLocalizedVersionsByMaterial));
router.get('/:localizedId', handler(localizedContentController.getLocalizedContentById));
router.put('/:localizedId', handler(localizedContentController.updateLocalizedContent));
router.delete('/:localizedId', handler(localizedContentController.deleteLocalizedContent));
router.get('/language/:langCode', handler(localizedContentController.getLocalizedContentByLanguage));

module.exports = router;