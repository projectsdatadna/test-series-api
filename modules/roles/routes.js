const express = require('express');
const rolesController = require('./controller');
const handler = require('../../helpers/handler');

const router = express.Router();

// Role Management Routes
router.post('/', handler(rolesController.createRole));
router.get('/', handler(rolesController.getAllRoles));
router.post('/initialize', handler(rolesController.initializeDefaultRoles));
router.get('/name/:roleName', handler(rolesController.getRoleByName));
router.get('/:roleId', handler(rolesController.getRole));
router.put('/:roleId', handler(rolesController.updateRole));
router.delete('/:roleId', handler(rolesController.deleteRole));
router.get('/:roleId/permissions', handler(rolesController.getRolePermissions));
router.put('/:roleId/permissions', handler(rolesController.updateRolePermissions));
router.get('/:roleId/users', handler(rolesController.getUsersByRole));

module.exports = router;