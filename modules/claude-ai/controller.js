require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

if (!process.env.CLAUDE_API_KEY) {
  console.error('❌ CLAUDE_API_KEY environment variable is missing!');
}

// Fetch polyfill setup
let fetch;
try {
  if (typeof global.fetch === 'function') {
    fetch = global.fetch;
  } else {
    fetch = require('node-fetch');
  }
} catch (error) {
  console.error('Failed to load fetch:', error);
  const axios = require('axios');
  fetch = async (url, options) => {
    const response = await axios({
      url,
      method: options.method || 'GET',
      headers: options.headers,
      data: options.body,
      responseType: 'json'
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.data,
      text: async () => JSON.stringify(response.data)
    };
  };
}

// Upload file to Claude Files API
async function uploadToClaudeAPI(req, res) {
  try {
    const file = req.file;
    if (!file || file.buffer.length === 0) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    console.log('📤 Uploading to Claude Files API:', file.originalname, `${file.buffer.length} bytes`);

    const boundary = `----formdata-${Math.random().toString(36)}`;
    
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.originalname}"\r\n`));
    parts.push(Buffer.from(`Content-Type: ${file.mimetype}\r\n\r\n`));
    parts.push(file.buffer);
    parts.push(Buffer.from(`\r\n--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="purpose"\r\n\r\n`));
    parts.push(Buffer.from(`assistants\r\n`));
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30000);

    const response = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-beta': 'files-api-2025-04-14',
        'anthropic-version': '2023-06-01',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString()
      },
      body: body,
      signal: controller.signal
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Claude API error:', errorData);
      return res.status(400).json({ success: false, message: errorData });
    }

    const claudeData = await response.json();
    console.log('✅ File uploaded to Claude:', claudeData.id);
    
    res.json({
      success: true,
      fileId: claudeData.id,
      filename: file.originalname
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(408).json({ success: false, message: 'Upload timeout - file too large' });
    }
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

// Analyze uploaded document
async function analyzeDocument(req, res) {
  try {
    const { fileId } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ success: false, message: 'fileId required' });
    }

    console.log('🔍 Analyzing fileId:', fileId);

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Please analyze the uploaded document with file ID: ${fileId}

Extract ALL headers, sections, tables, and images separately. Return ONLY valid JSON in this exact format:

{
  "indexes": [
    {
      "type": "header" | "section" | "table" | "image",
      "content": "exact text content from document", 
      "page": 1
    }
  ]
}`
      }]
    });

    let indexes = [];
    try {
      const text = message.content[0].text;
      const cleanJson = text.replace(/```json?\s*|`*\s*```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      indexes = parsed.indexes || [];
      console.log(`✅ Extracted ${indexes.length} sections from ${fileId}`);
    } catch (e) {
      console.error('JSON parse error:', e);
      console.log('Raw Claude response:', message.content[0].text);
      
      const rawText = message.content[0].text.slice(0, 2000);
      indexes = [{
        type: 'document',
        content: rawText + '...',
        page: 1
      }];
    }

    res.json({
      success: true,
      indexes,
      totalSections: indexes.length,
      fileId
    });

  } catch (error) {
    console.error('Analyze error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
}

// Generate content from analyzed document
async function generateContent(req, res) {
  try {
    const { userId, category, selectedIndex } = req.body;

    if (!selectedIndex || !category) {
      return res.status(400).json({ success: false, message: 'selectedIndex and category required' });
    }

    const prompts = {
      mcq: `Generate 8 MCQs from ONLY this specific content. Each question should have 4 options and mark the correct answer. Return ONLY clean HTML.`,
      'fill-blanks': `Generate 8 fill-in-the-blank questions from ONLY this content. Return ONLY clean HTML.`,
      'true-false': `Generate 8 true/false questions from ONLY this content. Return ONLY clean HTML.`
    };

    const contentBlock = `
Type: ${selectedIndex.type}
Page: ${selectedIndex.page || 'N/A'}
Content: ${selectedIndex.content}`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      messages: [{ 
        role: 'user', 
        content: `${prompts[category]}

${contentBlock}

Generate exactly 8 questions from ONLY this content. Return ONLY HTML.`
      }]
    });

    const html = message.content[0].text;

    res.json({
      success: true,
      data: { 
        html, 
        category,
        totalQuestions: 8
      }
    });

  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Generation failed', 
      error: error.message 
    });
  }
}

// Advanced file upload with document processing
async function uploadToClaudeAdvanced(req, res) {
  try {
    const file = req.file;
    if (!file || file.buffer.length === 0) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    console.log('📤 Uploading to Claude Files API (Advanced):', file.originalname, `${file.buffer.length} bytes`);

    const boundary = `----formdata-${Math.random().toString(36)}`;
    
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.originalname}"\r\n`));
    parts.push(Buffer.from(`Content-Type: ${file.mimetype}\r\n\r\n`));
    parts.push(file.buffer);
    parts.push(Buffer.from(`\r\n--${boundary}\r\n`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="purpose"\r\n\r\n`));
    parts.push(Buffer.from(`assistants\r\n`));
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30000);

    const response = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-beta': 'files-api-2025-04-14',
        'anthropic-version': '2023-06-01',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString()
      },
      body: body,
      signal: controller.signal
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Claude API error:', errorData);
      return res.status(400).json({ success: false, message: errorData });
    }

    const claudeData = await response.json();
    console.log('✅ File uploaded to Claude (Advanced):', claudeData.id);
    
    res.json({
      success: true,
      fileId: claudeData.id,
      filename: file.originalname
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(408).json({ success: false, message: 'Upload timeout - file too large' });
    }
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

// Advanced document analysis with enriched content
async function analyzeDocumentAdvanced(req, res) {
  try {
    const { fileId } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ success: false, message: 'fileId required' });
    }

    console.log('🔍 Analyzing fileId (Advanced):', fileId);

    const firstMessage = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the MAIN TITLE and all SECTION HEADERS from this document. List them separately with page numbers if available. Return ONLY valid JSON format:\n\n{\n  \"indexes\": [\n    {\"type\": \"header\", \"content\": \"Main Title\", \"page\": 1},\n    {\"type\": \"section\", \"content\": \"Section 1 Title\", \"page\": 2}\n  ]\n}"
          },
          {
            type: "document",
            source: {
              type: "file",
              file_id: fileId
            }
          }
        ]
      }] 
    },{
      headers: {
        "anthropic-beta": "files-api-2025-04-14"
      }
  });

   const extractIndexes = (text) => {
      const cleaners = [
        (t) => t.replace(/```(?:json)?\s*|\s*```/g, '').trim(),
        (t) => t.replace(/[^\{].*?(?=\{)/s, '').trim(),
        (t) => t.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/)?.[0] || '{}'
      ];

      for (const clean of cleaners) {
        try {
          const cleaned = clean(text);
          if (cleaned) {
            const parsed = JSON.parse(cleaned);
            if (parsed.indexes && Array.isArray(parsed.indexes)) {
              return parsed.indexes;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      return [{
        type: 'document',
        content: 'Complete document content for teaching',
        page: 1
      }];
    };

    let indexes = extractIndexes(firstMessage.content[0].text);
    console.log(`📋 Found ${indexes.length} raw indexes`);

    const enrichedIndexes = [];
    for (let i = 0; i < Math.min(indexes.length, 5); i++) {
      const index = indexes[i];
      console.log(`✍️ Generating content for ${index.type} (${i + 1}/${indexes.length})`);

      const contentPrompt = await anthropic.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `Based on this document section:

**Type:** ${index.type}
**Page:** ${index.page || 'N/A'}
**Content:** ${index.content.substring(0, 1000)}

Write EXACTLY TWO detailed paragraphs (100-120 words each) explaining this content for students. Use clear teaching language. Separate paragraphs with "¶¶¶".

PARAGRAPH 1: [first paragraph here]
¶¶¶
PARAGRAPH 2: [second paragraph here]`
        }]
      });

      const responseText = contentPrompt.content[0].text;
      const paragraphs = responseText.split('¶¶¶');
      
      const paragraph1 = paragraphs[0]?.trim() || index.content.substring(0, 200) || 'This section introduces key concepts and foundational knowledge essential for understanding the topic.';
      const paragraph2 = paragraphs[1]?.trim() || index.content.substring(200, 400) || 'The content provides practical examples and applications to build strong foundational understanding.';

      enrichedIndexes.push({
        id: i + 1,
        ...index,
        paragraph1: paragraph1.substring(0, 300),
        paragraph2: paragraph2.substring(0, 300),
        fullContent: `${paragraph1}\n\n${paragraph2}`
      });
    }

    console.log(`✅ Enriched ${enrichedIndexes.length} indexes with 2 paragraphs each`);

    res.json({
      success: true,
      indexes: enrichedIndexes,
      totalSections: enrichedIndexes.length,
      fileId
    });

  } catch (error) {
    console.error('Analyze error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
}

// Advanced content generation with enriched paragraphs
async function generateContentAdvanced(req, res) {
  try {
    const { category, selectedIndex } = req.body;

    if (!selectedIndex || !category) {
      return res.status(400).json({ success: false, message: 'selectedIndex and category required' });
    }

    const prompts = {
      mcq: `Generate 8 MCQs from ONLY these 2 detailed paragraphs. Each question should have 4 options A,B,C,D and mark correct answer. Use this HTML structure:
<div class="question"><h3>Q1.</h3><p>question?</p><div class="options"><span class="option correct">A) answer ✓</span></div></div>
Return ONLY complete HTML.`,

      'fill-blanks': `Generate 8 fill-in-the-blank questions from ONLY these 2 detailed paragraphs. Use _____ for blanks. Return ONLY clean HTML.`,

      'true-false': `Generate 8 true/false questions from ONLY these 2 detailed paragraphs. Include brief explanation. Return ONLY clean HTML.`
    };

    const contentBlock = `
Type: ${selectedIndex.type}
Page: ${selectedIndex.page || 'N/A'}
Paragraph 1: ${selectedIndex.paragraph1}
Paragraph 2: ${selectedIndex.paragraph2}`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      messages: [{ 
        role: 'user', 
        content: `${prompts[category]}

FULL CONTENT (use ONLY this):
${contentBlock}

Generate exactly 8 questions. Return ONLY styled HTML with proper classes.`
      }]
    });

    const html = message.content[0].text;

    res.json({
      success: true,
      data: { 
        html, 
        category,
        totalQuestions: 8,
        sourceContent: selectedIndex.fullContent
      }
    });

  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Generation failed', 
      error: error.message 
    });
  }
}

module.exports = {
  uploadToClaudeAPI,
  analyzeDocument,
  generateContent,
  uploadToClaudeAdvanced,
  analyzeDocumentAdvanced,
  generateContentAdvanced
};