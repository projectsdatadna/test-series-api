require('dotenv').config();
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let fetch;
try {
  fetch = globalThis.fetch;
} catch (e) {
  fetch = require('node-fetch');
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// Generate pre-signed URLs for file upload
async function getUploadUrls(req, res) {
  try {
    const { files } = req.body; // Array of { filename, contentType, size }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Files array is required with filename, contentType, and size'
      });
    }

    // Validate file sizes
    const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      return res.status(413).json({
        success: false,
        message: 'File size exceeds limit',
        oversizedFiles: oversizedFiles.map(f => ({
          filename: f.filename,
          size: `${(f.size / 1024 / 1024).toFixed(2)}MB`,
          limit: '100MB'
        }))
      });
    }

    const uploadUrls = [];

    for (const file of files) {
      const fileKey = `uploads/${req.user.userId}/${Date.now()}-${file.filename}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        ContentType: file.contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600 // 1 hour
      });

      uploadUrls.push({
        filename: file.filename,
        uploadUrl,
        fileKey
      });
    }

    res.status(200).json({
      success: true,
      message: 'Pre-signed URLs generated',
      data: {
        uploadUrls,
        expiresIn: 3600
      }
    });

  } catch (error) {
    console.error('Error generating upload URLs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload URLs',
      error: error.message
    });
  }
}

// Confirm upload and process files from S3
async function confirmUpload(req, res) {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Anthropic API key not configured'
      });
    }

    const { fileKeys, topicName, contentType } = req.body;

    if (!fileKeys || !Array.isArray(fileKeys) || fileKeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'fileKeys array is required'
      });
    }

    // Download files from S3
    const files = [];
    for (const fileKey of fileKeys) {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey
      });

      const response = await s3Client.send(command);
      const buffer = await streamToBuffer(response.Body);

      files.push({
        buffer,
        originalname: response.Metadata?.originalname || fileKey.split('/').pop(),
        mimetype: response.ContentType,
        size: buffer.length
      });
    }

    // Upload to Anthropic
    const boundary = `----formdata-${Math.random().toString(36)}`;
    const parts = [];

    for (const file of files) {
      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.originalname}"\r\n`));
      parts.push(Buffer.from(`Content-Type: ${file.mimetype}\r\n\r\n`));
      parts.push(file.buffer);
      parts.push(Buffer.from(`\r\n`));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    console.log(`Sending ${files.length} file(s) to Anthropic API...`);

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/files', {
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

    if (!anthropicResponse.ok) {
      const error = await anthropicResponse.json();
      console.error(`Error uploading files:`, error);
      return res.status(400).json({
        success: false,
        message: 'Failed to upload files to Anthropic',
        error: error.message || 'Upload failed'
      });
    }

    const data = await anthropicResponse.json();
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

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// LEGACY: Direct upload for small files
async function uploadFile(req, res) {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Anthropic API key not configured'
      });
    }

    const { topicName, contentType } = req.body;
    const files = req.files || [];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    // This endpoint now only handles files < 5MB
    const oversizedFiles = files.filter(f => f.size > 5 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      return res.status(413).json({
        success: false,
        message: 'Files over 5MB must use the pre-signed URL upload flow',
        hint: 'Use /get-upload-urls and /confirm-upload endpoints for large files'
      });
    }

    const boundary = `----formdata-${Math.random().toString(36)}`;
    const parts = [];

    for (const file of files) {
      parts.push(Buffer.from(`--${boundary}\r\n`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.originalname}"\r\n`));
      parts.push(Buffer.from(`Content-Type: ${file.mimetype}\r\n\r\n`));
      parts.push(file.buffer);
      parts.push(Buffer.from(`\r\n`));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

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
      return res.status(400).json({
        success: false,
        message: 'Failed to upload files',
        error: error.message || 'Upload failed'
      });
    }

    const data = await response.json();
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
  getUploadUrls,
  confirmUpload,
  uploadFile
};
