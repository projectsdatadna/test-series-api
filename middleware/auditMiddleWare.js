const auditLogs = require('../components/auditLogs');

/**
 * Middleware to automatically log API actions
 */
const auditMiddleware = (module, action) => {
  return async (req, res, next) => {
    // Store original send function
    const originalSend = res.send;

    // Override send function to capture response
    res.send = function(data) {
      // Parse response data
      let responseData;
      try {
        responseData = typeof data === 'string' ? JSON.parse(data) : data;
      } catch (e) {
        responseData = data;
      }

      // Extract user ID from request (you may need to adjust this based on your auth setup)
      const userId = req.user?.userId || req.body?.userId || req.params?.userId || 'system';
      
      // Determine status based on response
      const status = res.statusCode >= 200 && res.statusCode < 300 ? 'success' : 'failure';

      // Create audit log
      const logData = {
        body: JSON.stringify({
          userId: userId,
          action: action,
          module: module,
          details: {
            method: req.method,
            path: req.path,
            params: req.params,
            query: req.query,
            // Only log body for certain actions to avoid logging sensitive data
            ...(action !== 'login' && action !== 'change_password' ? { body: req.body } : {})
          },
          resourceId: req.params?.id || req.params?.userId || req.params?.roleId,
          resourceType: module,
          status: status,
          errorMessage: responseData?.message || null
        }),
        headers: req.headers,
        requestContext: {
          identity: {
            sourceIp: req.ip
          }
        }
      };

      // Log asynchronously (don't wait)
      auditLogs.logAction(logData).catch(err => {
        console.error('Failed to create audit log:', err);
      });

      // Call original send
      originalSend.call(this, data);
    };

    next();
  };
};

module.exports = auditMiddleware;
