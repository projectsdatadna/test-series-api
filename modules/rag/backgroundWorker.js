/**
 * Background Worker for RAG Processing
 * Polls for queued jobs and processes them asynchronously
 */

const AWS = require('aws-sdk');
const { getQueuedJobs, updateJobStatus, getJobForProcessing, JOB_STATUS } = require('./jobQueue');
const { processPDFToSections } = require('./pdfProcessor');

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1'
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'test-series-books';

/**
 * Process a single job
 */
async function processJob(job) {
  const { jobId, fileKey, documentId, fileName } = job;

  try {
    console.log(`[RAG-WORKER] Processing job ${jobId} for file: ${fileName}`);

    // Update status to processing
    await updateJobStatus(jobId, JOB_STATUS.PROCESSING, 10);

    // Download file from S3
    console.log(`[RAG-WORKER] Downloading file from S3: ${fileKey}`);
    const s3Object = await s3.getObject({
      Bucket: S3_BUCKET,
      Key: fileKey
    }).promise();

    const pdfBuffer = s3Object.Body;
    const fileSizeBytes = pdfBuffer.length;
    const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(2);

    console.log(`[RAG-WORKER] File downloaded: ${fileSizeMB}MB`);

    // Update progress
    await updateJobStatus(jobId, JOB_STATUS.PROCESSING, 25);

    // Process PDF to sections
    console.log(`[RAG-WORKER] Processing PDF to sections...`);
    const storedSections = await processPDFToSections(pdfBuffer, {
      chapterId: documentId,
      documentId: documentId,
      chapterName: job.chapterName || fileName || null,
      syllabusId: job.syllabusId,
      standardId: job.standardId,
      subjectId: job.subjectId,
      division: null,
      bookType: job.bookType || null,
      pageRanges: null,
      splitPattern: job.splitPattern || 'regex_based',
      sectionTitles: job.sectionTitles || null,
      isTNStateBoard: job.isTNStateBoard || false,
      term: job.term || null,
      unitSectionTitles: job.unitSectionTitles || null,
      // College-specific fields
      isCollegeEducation: job.isCollegeEducation || false,
      departmentId: job.departmentId || null,
      semesterId: job.semesterId || null,
      subject: job.subject || null,
      sectionTitle: job.sectionTitle || null
    });

    console.log(`[RAG-WORKER] Created ${storedSections.length} sections with embeddings`);

    // Update progress
    await updateJobStatus(jobId, JOB_STATUS.PROCESSING, 90);

    // Mark job as completed
    await updateJobStatus(jobId, JOB_STATUS.COMPLETED, 100);

    console.log(`[RAG-WORKER] ✅ Job ${jobId} completed successfully`);

    return {
      success: true,
      jobId,
      documentId,
      totalSections: storedSections.length,
      fileSizeMB
    };

  } catch (error) {
    console.error(`[RAG-WORKER] ❌ Error processing job ${jobId}:`, error.message);

    // Mark job as failed
    await updateJobStatus(jobId, JOB_STATUS.FAILED, 0, error.message);

    return {
      success: false,
      jobId,
      documentId,
      error: error.message
    };
  }
}

/**
 * Poll and process queued jobs
 * This function should be called periodically (e.g., every 5-10 seconds)
 */
async function pollAndProcessJobs(maxJobsPerPoll = 5) {
  try {
    console.log(`[RAG-WORKER] Polling for queued jobs (max ${maxJobsPerPoll})...`);

    // Get queued jobs
    const queuedJobs = await getQueuedJobs(maxJobsPerPoll);

    if (queuedJobs.length === 0) {
      console.log('[RAG-WORKER] No queued jobs found');
      return { processed: 0, results: [] };
    }

    console.log(`[RAG-WORKER] Found ${queuedJobs.length} queued jobs`);

    const results = [];

    // Process each job sequentially to avoid overwhelming the system
    for (const job of queuedJobs) {
      const result = await processJob(job);
      results.push(result);

      // Add small delay between jobs to avoid throttling
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`[RAG-WORKER] Poll complete: ${successCount} succeeded, ${failureCount} failed`);

    return {
      processed: results.length,
      results,
      summary: {
        successful: successCount,
        failed: failureCount
      }
    };

  } catch (error) {
    console.error('[RAG-WORKER] Error in pollAndProcessJobs:', error.message);
    return {
      processed: 0,
      results: [],
      error: error.message
    };
  }
}

/**
 * Start background worker (for local development or long-running Lambda)
 * Polls every N seconds
 */
function startBackgroundWorker(pollIntervalSeconds = 10) {
  console.log(`[RAG-WORKER] Starting background worker (polling every ${pollIntervalSeconds}s)`);

  // Initial poll
  pollAndProcessJobs();

  // Set up recurring polls
  setInterval(() => {
    pollAndProcessJobs();
  }, pollIntervalSeconds * 1000);
}

/**
 * Lambda handler for processing jobs
 * Can be invoked by CloudWatch Events, SQS, or API Gateway
 */
async function lambdaHandler(event, context) {
  console.log('[RAG-WORKER] Lambda handler invoked');

  try {
    const maxJobs = event.maxJobs || 5;
    const result = await pollAndProcessJobs(maxJobs);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: result
      })
    };
  } catch (error) {
    console.error('[RAG-WORKER] Lambda handler error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: error.message
      })
    };
  }
}

module.exports = {
  processJob,
  pollAndProcessJobs,
  startBackgroundWorker,
  lambdaHandler
};
