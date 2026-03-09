const express = require('express');
const {
  batchGeneratePresignedUrls,
  batchProcessFromS3,
  generatePresignedUrlForRAG,
  processRAGFileFromS3,
  retrieveContextAPI,
  retrieveContextBatchAPI,
  getDocumentVectors,
  splitByPageRangesAPI,
  queueProcessFromS3,
  getJobStatusAPI,
  triggerBackgroundWorker,
  getJobDetails
} = require('./controller');
const chatRoutes = require('./chatRoutes');
const router = express.Router();

router.post('/batch-generate-upload-urls', batchGeneratePresignedUrls);
router.post('/batch-process-from-s3', batchProcessFromS3);
router.post('/generate-upload-url', generatePresignedUrlForRAG);
router.post('/process-from-s3', processRAGFileFromS3);
router.post('/queue-process-from-s3', queueProcessFromS3);
router.get('/job-status/:jobId', getJobStatusAPI);
router.get('/job-details/:jobId', getJobDetails);
router.post('/trigger-worker', triggerBackgroundWorker);
router.post('/split-by-page-ranges', splitByPageRangesAPI);
router.post('/retrieve', retrieveContextAPI);
router.post('/retrieve-batch', retrieveContextBatchAPI);
router.get('/vectors/:documentId', getDocumentVectors);
router.use('/', chatRoutes);

module.exports = router;
