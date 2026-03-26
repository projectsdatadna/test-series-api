const handler = (controller) => async (req, res, next) => {
  try {
    const result = await controller({
      body: JSON.stringify(req.body),
      pathParameters: req.params,
      queryStringParameters: req.query,
      headers: req.headers
    });

    if (!result || !result.statusCode || !result.body) {
      console.error('[HANDLER] Invalid controller response:', result);
      return res.status(500).json({
        success: false,
        message: 'Internal server error - invalid response format'
      });
    }

    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (error) {
    console.error('[HANDLER] Error executing controller:', {
      message: error.message,
      stack: error.stack,
      controller: controller.name
    });

    // Pass to Express error handler
    next(error);
  }
};

module.exports = handler;
