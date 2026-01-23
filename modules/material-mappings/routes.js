const express = require('express');
const materialMappingsController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Material Mappings Management Routes
router.post('/', handler(materialMappingsController.createMaterialMapping));
router.get('/', handler(materialMappingsController.getAllMaterialMappings));
router.get('/:mappingId', handler(materialMappingsController.getMaterialMappingById));
router.put('/:mappingId', handler(materialMappingsController.updateMaterialMapping));
router.delete('/:mappingId', handler(materialMappingsController.deleteMaterialMapping));

module.exports = router;