const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || 'ap-south-1'
});

// Generate pre-signed URL for file upload
async function generatePresignedUrl(req, res) {
  try {
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({
        success: false,
        message: 'fileName and fileType are required'
      });
    }

    // Validate file size (max 100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return res.status(413).json({
        success: false,
        message: 'File size exceeds 100MB limit',
        maxSize: '100MB',
        providedSize: `${(fileSize / 1024 / 1024).toFixed(2)}MB`
      });
    }

    const bucketName = process.env.S3_UPLOAD_BUCKET || 'test-api-uploads-ap-south-1';
    const userId = req.user?.userId || 'anonymous';
    const timestamp = Date.now();
    
    // Create unique key with user ID and timestamp
    const fileKey = `uploads/${userId}/${timestamp}-${fileName}`;

    // Generate pre-signed URL valid for 1 hour
    const presignedUrl = s3.getSignedUrl('putObject', {
      Bucket: bucketName,
      Key: fileKey,
      ContentType: fileType,
      Expires: 3600, // 1 hour
      Metadata: {
        userId: userId,
        uploadedAt: new Date().toISOString()
      }
    });

    console.log(`Generated pre-signed URL for ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

    res.status(200).json({
      success: true,
      message: 'Pre-signed URL generated successfully',
      data: {
        presignedUrl,
        fileKey,
        bucketName,
        expiresIn: 3600,
        uploadInstructions: {
          method: 'PUT',
          headers: {
            'Content-Type': fileType
          }
        }
      }
    });

  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate pre-signed URL',
      error: error.message
    });
  }
}

// Process uploaded file from S3
async function processUploadedFile(req, res) {
  try {
    const { fileKey, fileName, fileType } = req.body;

    if (!fileKey) {
      return res.status(400).json({
        success: false,
        message: 'fileKey is required'
      });
    }

    const bucketName = process.env.S3_UPLOAD_BUCKET || 'test-api-uploads-ap-south-1';

    // Verify file exists in S3
    try {
      await s3.headObject({
        Bucket: bucketName,
        Key: fileKey
      }).promise();
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found in S3',
        fileKey
      });
    }

    // Get file metadata
    const fileMetadata = await s3.headObject({
      Bucket: bucketName,
      Key: fileKey
    }).promise();

    const fileSize = fileMetadata.ContentLength;

    console.log(`Processing file: ${fileKey} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

    // Here you can add logic to:
    // 1. Send file to Anthropic API
    // 2. Process file content
    // 3. Store metadata in database
    // etc.

    res.status(200).json({
      success: true,
      message: 'File processed successfully',
      data: {
        fileKey,
        fileName,
        fileType,
        fileSize: `${(fileSize / 1024 / 1024).toFixed(2)}MB`,
        bucketName,
        uploadedAt: fileMetadata.LastModified
      }
    });

  } catch (error) {
    console.error('Error processing uploaded file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process file',
      error: error.message
    });
  }
}

// Get file from S3 and send to Anthropic
async function uploadToAnthropicFromS3(req, res) {
  try {
    const { fileKey } = req.body;
    const apiKey = process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Anthropic API key not configured'
      });
    }

    if (!fileKey) {
      return res.status(400).json({
        success: false,
        message: 'fileKey is required'
      });
    }

    const bucketName = process.env.S3_UPLOAD_BUCKET || 'test-api-uploads-ap-south-1';

    // Get file from S3
    const s3Object = await s3.getObject({
      Bucket: bucketName,
      Key: fileKey
    }).promise();

    const fileBuffer = s3Object.Body;
    const fileName = fileKey.split('/').pop();
    const contentType = s3Object.ContentType || 'application/octet-stream';

    console.log(`Uploading ${fileName} to Anthropic (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);

    // Use native fetch (Node.js 18+)
    let fetch;
    try {
      fetch = globalThis.fetch;
    } catch (e) {
      fetch = require('node-fetch');
    }

    // Construct multipart form data
    const boundary = `----formdata-${Math.random().toString(36)}`;
    const parts = [];

    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`));
    parts.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n`));
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    // Call Anthropic Files API
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
      console.error('Error uploading to Anthropic:', error);
      return res.status(400).json({
        success: false,
        message: 'Failed to upload to Anthropic',
        error: error.message || 'Upload failed'
      });
    }

    const data = await response.json();
    console.log('File uploaded to Anthropic:', data);

    res.status(200).json({
      success: true,
      message: 'File uploaded to Anthropic successfully',
      data: {
        fileId: data.id,
        fileName: data.filename,
        size: data.size,
        createdAt: data.created_at,
        expiresAt: data.expires_at,
        s3FileKey: fileKey
      }
    });

  } catch (error) {
    console.error('Error uploading to Anthropic from S3:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file to Anthropic',
      error: error.message
    });
  }
}

module.exports = {
  generatePresignedUrl,
  processUploadedFile,
  uploadToAnthropicFromS3
};
