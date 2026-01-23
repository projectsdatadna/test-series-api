const handler = (controller) => async (req, res) => {
  const result = await controller({
    body: JSON.stringify(req.body),
    pathParameters: req.params,
    queryStringParameters: req.query,
    headers: req.headers,
  });
  res.status(result.statusCode).json(JSON.parse(result.body));
};

module.exports = handler;
