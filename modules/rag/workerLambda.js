/**
 * Lambda Handler for RAG Background Worker
 * Deploy as a separate Lambda function triggered by CloudWatch Events
 * 
 * CloudWatch Event Rule:
 * - Rate: rate(5 minutes) or rate(10 minutes)
 * - Target: This Lambda function
 * 
 * Environment Variables:
 * - AWS_REGION: AWS region (default: ap-south-1)
 * - S3_BUCKET_NAME: S3 bucket for PDFs (default: test-series-books)
 * - JOBS_TABLE: DynamoDB table name (default: RAGProcessingJobs)
 * - SECTIONS_TABLE: DynamoDB table name (default: SectionsTable)
 */

const { lambdaHandler } = require('./backgroundWorker');

/**
 * Main Lambda handler
 * Triggered by CloudWatch Events every N minutes
 */
exports.handler = async (event, context) => {
  console.log('[RAG-LAMBDA] Worker Lambda invoked');
  console.log('[RAG-LAMBDA] Event:', JSON.stringify(event));

  try {
    // Set timeout to 5 minutes (300 seconds) to allow processing
    context.callbackWaitsForEmptyEventLoop = false;

    // Process up to 5 jobs per invocation
    const result = await lambdaHandler(
      { maxJobs: 5 },
      context
    );

    console.log('[RAG-LAMBDA] Result:', result);
    return result;

  } catch (error) {
    console.error('[RAG-LAMBDA] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: error.message
      })
    };
  }
};
