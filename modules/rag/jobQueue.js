/**
 * Job Queue Service for RAG Processing
 * Handles queuing and status tracking of PDF processing jobs
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const JOBS_TABLE = process.env.JOBS_TABLE || 'RAGProcessingJobs';

// Job status constants
const JOB_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * Create a new processing job
 */
async function createJob(jobData) {
  try {
    const jobId = uuidv4();
    const now = new Date().toISOString();

    const item = {
      jobId,
      documentId: jobData.documentId,
      fileKey: jobData.fileKey,
      fileName: jobData.fileName,
      syllabusId: jobData.syllabusId,
      standardId: jobData.standardId,
      subjectId: jobData.subjectId,
      chapterName: jobData.chapterName,
      fileSize: jobData.fileSize,
      term: jobData.term || null,
      bookType: jobData.bookType || null,
      splitPattern: jobData.splitPattern || 'regex_based',
      sectionTitles: jobData.sectionTitles || null,
      unitSectionTitles: jobData.unitSectionTitles || null,
      isTNStateBoard: jobData.isTNStateBoard || false,
      status: JOB_STATUS.QUEUED,
      progress: 0,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };

    await docClient.send(new PutCommand({
      TableName: JOBS_TABLE,
      Item: item
    }));

    console.log(`[RAG] Job created: ${jobId} for document: ${jobData.documentId}`);
    return { jobId, status: JOB_STATUS.QUEUED };
  } catch (error) {
    console.error('[RAG] Error creating job:', error.message);
    throw new Error(`Failed to create job: ${error.message}`);
  }
}

/**
 * Get job status
 */
async function getJobStatus(jobId) {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: JOBS_TABLE,
      Key: { jobId }
    }));

    if (!result.Item) {
      throw new Error(`Job not found: ${jobId}`);
    }

    return {
      jobId: result.Item.jobId,
      documentId: result.Item.documentId,
      status: result.Item.status,
      progress: result.Item.progress || 0,
      message: getStatusMessage(result.Item.status, result.Item.progress),
      error: result.Item.errorMessage || null,
      createdAt: result.Item.createdAt,
      completedAt: result.Item.completedAt
    };
  } catch (error) {
    console.error('[RAG] Error getting job status:', error.message);
    throw error;
  }
}

/**
 * Update job status
 */
async function updateJobStatus(jobId, status, progress = null, errorMessage = null) {
  try {
    const now = new Date().toISOString();
    const updateData = {
      status,
      updatedAt: now
    };

    if (progress !== null) {
      updateData.progress = progress;
    }

    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }

    if (status === JOB_STATUS.COMPLETED) {
      updateData.completedAt = now;
      updateData.progress = 100;
    }

    let updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
    const expressionAttributeNames = { '#status': 'status' };
    const expressionAttributeValues = {
      ':status': status,
      ':updatedAt': now
    };

    if (progress !== null) {
      updateExpression += ', progress = :progress';
      expressionAttributeValues[':progress'] = progress;
    }

    if (errorMessage) {
      updateExpression += ', errorMessage = :errorMessage';
      expressionAttributeValues[':errorMessage'] = errorMessage;
    }

    if (status === JOB_STATUS.COMPLETED) {
      updateExpression += ', completedAt = :completedAt';
      expressionAttributeValues[':completedAt'] = now;
    }

    await docClient.send(new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { jobId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }));

    console.log(`[RAG] Job ${jobId} status updated to: ${status}`);
  } catch (error) {
    console.error('[RAG] Error updating job status:', error.message);
    throw error;
  }
}

/**
 * Get job details for processing
 */
async function getJobForProcessing(jobId) {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: JOBS_TABLE,
      Key: { jobId }
    }));

    if (!result.Item) {
      throw new Error(`Job not found: ${jobId}`);
    }

    return result.Item;
  } catch (error) {
    console.error('[RAG] Error getting job for processing:', error.message);
    throw error;
  }
}

/**
 * Get all queued jobs
 */
async function getQueuedJobs(limit = 10) {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: JOBS_TABLE,
      IndexName: 'statusIndex', // Requires GSI on status
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': JOB_STATUS.QUEUED },
      Limit: limit
    }));

    return result.Items || [];
  } catch (error) {
    // Fallback to scan if GSI doesn't exist
    console.warn('[RAG] QueryCommand failed, falling back to scan:', error.message);
    const result = await docClient.send(new ScanCommand({
      TableName: JOBS_TABLE,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': JOB_STATUS.QUEUED },
      Limit: limit
    }));

    return result.Items || [];
  }
}

/**
 * Get job status message
 */
function getStatusMessage(status, progress = 0) {
  const messages = {
    [JOB_STATUS.QUEUED]: 'Waiting to be processed...',
    [JOB_STATUS.PROCESSING]: `Processing PDF... ${progress}%`,
    [JOB_STATUS.COMPLETED]: 'Processing completed successfully',
    [JOB_STATUS.FAILED]: 'Processing failed'
  };

  return messages[status] || 'Unknown status';
}

module.exports = {
  createJob,
  getJobStatus,
  updateJobStatus,
  getJobForProcessing,
  getQueuedJobs,
  JOB_STATUS
};
