require('dotenv').config();

// Use native fetch (Node.js 18+) or import node-fetch
let fetch;
try {
  fetch = globalThis.fetch;
} catch (e) {
  fetch = require('node-fetch');
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - Anthropic API limit

// Upload files to Anthropic
async function uploadFile(req, res) {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Anthropic API key not configured'
      });
    }

    // Extract metadata from request body (optional)
    const { topicName, contentType } = req.body;

    // Get files from multer
    const files = req.files || [];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    // Check individual file sizes
    const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      return res.status(413).json({
        success: false,
        message: 'One or more files exceed the 10MB size limit',
        oversizedFiles: oversizedFiles.map(f => ({
          filename: f.originalname,
          size: `${(f.size / 1024 / 1024).toFixed(2)}MB`,
          limit: '10MB'
        }))
      });
    }

    // Calculate total size
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`Uploading ${files.length} file(s) to Anthropic in single API call`);
    console.log(`Total payload size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);

    // Manually construct multipart form data with all files
    const boundary = `----formdata-${Math.random().toString(36)}`;
    
    const parts = [];
    
    // Add each file to the multipart body
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      console.log(`Adding file ${i + 1}/${files.length}:`, {
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: `${(file.size / 1024 / 1024).toFixed(2)}MB`
      });

      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.originalname}"\r\n`));
      parts.push(Buffer.from(`Content-Type: ${file.mimetype}\r\n\r\n`));
      parts.push(file.buffer);
      parts.push(Buffer.from(`\r\n`));
    }
    
    // Add final boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const bodySize = body.length;

    console.log(`Multipart body size: ${(bodySize / 1024 / 1024).toFixed(2)}MB`);

    if (bodySize > MAX_FILE_SIZE) {
      return res.status(413).json({
        success: false,
        message: 'Total payload size exceeds 10MB limit',
        totalSize: `${(bodySize / 1024 / 1024).toFixed(2)}MB`,
        limit: '10MB',
        suggestion: 'Please upload fewer files or smaller files'
      });
    }

    console.log(`Sending ${files.length} file(s) to Anthropic API...`);

    // Call Anthropic Files API with all files in single request
    const response = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString()
      },
      body: body
    });

    if (!response.ok) {
      const error = await response.json();
      console.error(`Error uploading files:`, error);
      return res.status(400).json({
        success: false,
        message: 'Failed to upload files',
        error: error.message || 'Upload failed'
      });
    }

    const data = await response.json();
    console.log(`Files uploaded successfully:`, data);

    // Handle both single file and multiple files response
    const uploadedFiles = Array.isArray(data) ? data : [data];

    res.status(200).json({
      success: true,
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
      data: {
        uploadedCount: uploadedFiles.length,
        topicName,
        contentType,
        files: uploadedFiles.map(file => ({
          fileId: file.id,
          filename: file.filename,
          size: file.size,
          createdAt: file.created_at,
          expiresAt: file.expires_at
        }))
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'File upload failed',
      error: error.message
    });
  }
}

module.exports = {
  uploadFile
};
