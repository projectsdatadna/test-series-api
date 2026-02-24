const express = require('express');
const {
  generatePresignedUrlForRAG,
  processRAGFileFromS3,
  retrieveContextAPI,
  retrieveContextBatchAPI,
  getDocumentVectors,
  splitByPageRangesAPI
} = require('./controller');
const chatRoutes = require('./chatRoutes');
const router = express.Router();

router.post('/generate-upload-url', generatePresignedUrlForRAG);
router.post('/process-from-s3', processRAGFileFromS3);
router.post('/split-by-page-ranges', splitByPageRangesAPI);
router.post('/retrieve', retrieveContextAPI);
router.post('/retrieve-batch', retrieveContextBatchAPI);
router.get('/vectors/:documentId', getDocumentVectors);
router.use('/', chatRoutes);

module.exports = router;
