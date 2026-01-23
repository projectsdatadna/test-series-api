exports.hello = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Hello from Serverless Lambda 🚀",
      method: event.requestContext.http.method,
      path: event.rawPath,
      timestamp: new Date().toISOString()
    }),
  };
};
