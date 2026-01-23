const express = require('express');
const multer = require('multer');
const claudeAIController = require('./controller');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ============ CLAUDE AI ROUTES ============

// Basic Claude AI Routes
router.post('/teacher/upload-to-claude', upload.single('file'), claudeAIController.uploadToClaudeAPI);
router.post('/teacher/analyze', claudeAIController.analyzeDocument);
router.post('/teacher/generate-content', claudeAIController.generateContent);

// Advanced Claude AI Routes with Enhanced Processing
router.post('/file/teacher/upload-to-claude', upload.single('file'), claudeAIController.uploadToClaudeAdvanced);
router.post('/file/teacher/analyze', claudeAIController.analyzeDocumentAdvanced);
router.post('/file/teacher/generate-content', claudeAIController.generateContentAdvanced);

module.exports = router;