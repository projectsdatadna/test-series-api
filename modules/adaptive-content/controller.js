require('dotenv').config();
const { getPrompt } = require('./prompts');

// Use native fetch (Node.js 18+) or import node-fetch
let fetch;
try {
  fetch = globalThis.fetch;
} catch (e) {
  fetch = require('node-fetch');
}

/**
 * Generate adaptive content from section data with embeddings
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function generateAdaptiveContentFromSection(req, res) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000); // 35 second timeout for generation

  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      clearTimeout(timeoutId);
      return res.status(400).json({
        success: false,
        message: 'Anthropic API key not configured'
      });
    }

    // Extract parameters from request body
    const {
      sectionIds,
      sectionNumbers,
      sectionTitles,
      chunks,
      contentType,
      contentTypeId,
      contentDepth,
      visualStyle,
      outputLanguage,
      difficulty,
      learningStyle,
      maxTokens,
      topic,
      documentId,
      userId
    } = req.body;

    // Support both old single-section format and new multi-section format
    const finalSectionIds = sectionIds || (req.body.sectionId ? [req.body.sectionId] : null);
    const finalSectionNumbers = sectionNumbers || (req.body.sectionNumber ? [req.body.sectionNumber] : null);
    const finalSectionTitles = sectionTitles || (req.body.sectionTitle ? [req.body.sectionTitle] : null);

    // Validate required fields
    const requiredFields = ['chunks', 'contentType'];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      clearTimeout(timeoutId);
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        requiredFields,
        missingFields
      });
    }

    if (!Array.isArray(chunks) || chunks.length === 0) {
      clearTimeout(timeoutId);
      return res.status(400).json({
        success: false,
        message: 'chunks must be a non-empty array'
      });
    }

    // Set defaults for optional parameters
    const depth = contentDepth || difficulty || 'intermediate';
    const style = visualStyle || learningStyle || 'academic';
    const language = outputLanguage || 'english';
    const maxTokensValue = maxTokens || 2048;

    // Combine all chunk texts for context
    const combinedChunkText = chunks
      .map((chunk, idx) => `Chunk ${idx + 1}:\n${chunk.text}`)
      .join('\n\n---\n\n');

    // Get dynamic prompt based on content type
    const prompt = getPrompt(contentTypeId, {
      sectionNumber: finalSectionNumbers?.[0] || req.body.sectionNumber,
      topicName: finalSectionTitles?.[0] || req.body.sectionTitle,
      contentDepth: depth,
      visualStyle: style,
      outputLanguage: language,
      contentType: contentType
    });


    // Call Anthropic Messages API with section content
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: maxTokensValue,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${prompt}\n\nHere is the section content to work with:\n\n${combinedChunkText}`
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();
      console.error('[ADAPTIVE-CONTENT] Error from Anthropic API:', error);
      return res.status(400).json({
        success: false,
        message: 'Failed to generate adaptive content',
        error: error.message || 'API request failed'
      });
    }

    const data = await response.json();

    // Extract token usage from first API call
    const firstCallTokens = data.usage || { input_tokens: 0, output_tokens: 0 };
    let totalInputTokens = firstCallTokens.input_tokens || 0;
    let totalOutputTokens = firstCallTokens.output_tokens || 0;

    // Extract the content from the response
    const content =
      data.content && data.content.length > 0 ? data.content[0].text : '';

    // Call second API to extract pure HTML from the content
    const htmlResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: maxTokensValue,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Extract pure HTML content from the following text and return only the HTML content without any additional text or explanation:\n\n' +
                  content
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!htmlResponse.ok) {
      const error = await htmlResponse.json();
      console.error('[ADAPTIVE-CONTENT] Error from second Anthropic API call:', error);
      return res.status(400).json({
        success: false,
        message: 'Failed to extract HTML content',
        error: error.message || 'API request failed'
      });
    }

    const htmlData = await htmlResponse.json();
    console.log('[ADAPTIVE-CONTENT] Second API response received');

    // Extract token usage from second API call
    const secondCallTokens = htmlData.usage || { input_tokens: 0, output_tokens: 0 };
    totalInputTokens += secondCallTokens.input_tokens || 0;
    totalOutputTokens += secondCallTokens.output_tokens || 0;

    // Extract HTML content from second API response
    const htmlContent =
      htmlData.content && htmlData.content.length > 0
        ? htmlData.content[0].text
        : content;

    // Always convert generated HTML to images
    console.log('[ADAPTIVE-CONTENT] Converting generated HTML to images...');

    const conversionController = new AbortController();
    const conversionTimeoutId = setTimeout(
      () => conversionController.abort(),
      70000
    ); // 70 second timeout for conversion

    try {
      const conversionResponse = await fetch(
        'https://api-s7ossubabq-uc.a.run.app/apizip/convert-to-images',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            pages: 1,
            htmlText: [htmlContent]
          }),
          signal: conversionController.signal
        }
      );

      clearTimeout(conversionTimeoutId);

      if (conversionResponse.ok) {
        const respContentType =
          conversionResponse.headers.get('content-type') || '';
        console.log('[ADAPTIVE-CONTENT] Conversion response content-type:', respContentType);

        if (respContentType.includes('application/json')) {
          const imageRes = await conversionResponse.json();
          console.log('[ADAPTIVE-CONTENT] Conversion API JSON response received');

          if (imageRes && Array.isArray(imageRes.images)) {
            return res.status(200).json({
              success: true,
              images: imageRes.images,
              sectionIds: finalSectionIds,
              sectionNumbers: finalSectionNumbers,
              sectionTitles: finalSectionTitles,
              topic,
              documentId,
              userId,
              contentTypeId,
              difficulty: depth,
              learningStyle: style,
              tokenUsage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens
              }
            });
          }

          // Some variants might wrap result differently; return as-is for UI handling
          return res.status(200).json({
            success: true,
            conversion: imageRes,
            sectionIds: finalSectionIds,
            sectionNumbers: finalSectionNumbers,
            sectionTitles: finalSectionTitles,
            topic,
            documentId,
            userId,
            contentTypeId,
            difficulty: depth,
            learningStyle: style,
            tokenUsage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              totalTokens: totalInputTokens + totalOutputTokens
            }
          });
        }
      }
    } catch (conversionError) {
      clearTimeout(conversionTimeoutId);
      console.error('[ADAPTIVE-CONTENT] HTML conversion error:', conversionError);

      if (conversionError.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          message: 'Image conversion timeout',
          error: 'The image conversion took too long. Please try again.'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to convert adaptive content to images',
        error: conversionError.message
      });
    }
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      console.error('[ADAPTIVE-CONTENT] API request timeout (35s exceeded)');
      return res.status(504).json({
        success: false,
        message: 'Request timeout',
        error:
          'The adaptive content generation took too long. Please try again.'
      });
    }

    console.error('[ADAPTIVE-CONTENT] Generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate adaptive content',
      error: error.message
    });
  }
}

// Generate adaptive content from uploaded file and convert to images
async function generateAdaptiveContent(req, res) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000); // 35 second timeout for generation

  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      clearTimeout(timeoutId);
      return res.status(400).json({
        success: false,
        message: "Anthropic API key not configured"
      });
    }

    // Extract all parameters from request body
    const {
      fileId,
      sectionNumber,
      topicName,
      contentType,
      contentTypeId,
      contentDepth,
      visualStyle,
      outputLanguage
    } = req.body;

    // Validate required fields
    const requiredFields = [
      "fileId",
      "sectionNumber",
      "topicName",
      "contentType"
    ];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      clearTimeout(timeoutId);
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        requiredFields,
        missingFields
      });
    }

    // Set defaults for optional parameters
    const depth = contentDepth || "intermediate";
    const style = visualStyle || "academic";
    const language = outputLanguage || "english";

    // Get dynamic prompt based on content type
    const prompt = getPrompt(contentTypeId, {
      sectionNumber,
      topicName,
      contentDepth: depth,
      visualStyle: style,
      outputLanguage: language,
      contentType: contentType
    });
    console.log("Calling Anthropic API...");

    // Call Anthropic Messages API with file reference
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "document",
                source: {
                  type: "file",
                  file_id: fileId
                }
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();
      console.error("Error from Anthropic API:", error);
      return res.status(400).json({
        success: false,
        message: "Failed to generate adaptive content",
        error: error.message || "API request failed"
      });
    }

    const data = await response.json();
    console.log('Adaptive content generated successfully');
    console.log('Response data:', data);

    // Extract token usage from first API call
    const firstCallTokens = data.usage || { input_tokens: 0, output_tokens: 0 };
    let totalInputTokens = firstCallTokens.input_tokens || 0;
    let totalOutputTokens = firstCallTokens.output_tokens || 0;

    // Extract the content from the response
    const content =
      data.content && data.content.length > 0 ? data.content[0].text : '';

    console.log("First API response content:", content);

    // Call second API to extract pure HTML from the content
    const htmlResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Extract pure HTML content from the following text and return only the HTML content without any additional text or explanation:\n\n" +
                  content
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!htmlResponse.ok) {
      const error = await htmlResponse.json();
      console.error("Error from second Anthropic API call:", error);
      return res.status(400).json({
        success: false,
        message: "Failed to extract HTML content",
        error: error.message || "API request failed"
      });
    }

    const htmlData = await htmlResponse.json();
    console.log('Second API response:', htmlData);

    // Extract token usage from second API call
    const secondCallTokens = htmlData.usage || { input_tokens: 0, output_tokens: 0 };
    totalInputTokens += secondCallTokens.input_tokens || 0;
    totalOutputTokens += secondCallTokens.output_tokens || 0;

    // Extract HTML content from second API response
    const htmlContent =
      htmlData.content && htmlData.content.length > 0
        ? htmlData.content[0].text
        : content;

    // Always convert generated HTML to images
    console.log("Converting generated HTML to images...");

    const conversionController = new AbortController();
    const conversionTimeoutId = setTimeout(
      () => conversionController.abort(),
      70000
    ); // 70 second timeout for conversion

    try {
      const conversionResponse = await fetch(
        "https://api-s7ossubabq-uc.a.run.app/apizip/convert-to-images",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            pages: 1,
            htmlText: [htmlContent]
          }),
          signal: conversionController.signal
        }
      );

      clearTimeout(conversionTimeoutId);

      if (conversionResponse.ok) {
        const respContentType =
          conversionResponse.headers.get("content-type") || "";
        console.log("Conversion response content-type:", respContentType);

        if (respContentType.includes("application/json")) {
          const imageRes = await conversionResponse.json();
          console.log('Conversion API JSON response:', imageRes);

          if (imageRes && Array.isArray(imageRes.images)) {
            return res.status(200).json({
              success: true,
              images: imageRes.images,
              tokenUsage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens
              }
            });
          }

          // Some variants might wrap result differently; return as-is for UI handling
          return res.status(200).json({
            success: true,
            conversion: imageRes,
            tokenUsage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              totalTokens: totalInputTokens + totalOutputTokens
            }
          });
        }
      }
    } catch (conversionError) {
      clearTimeout(conversionTimeoutId);
      console.error("HTML conversion error:", conversionError);

      if (conversionError.name === "AbortError") {
        return res.status(504).json({
          success: false,
          message: "Image conversion timeout",
          error: "The image conversion took too long. Please try again."
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to convert adaptive content to images",
        error: conversionError.message
      });
    }
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      console.error("API request timeout (20s exceeded)");
      return res.status(504).json({
        success: false,
        message: "Request timeout",
        error:
          "The adaptive content generation took too long. Please try again."
      });
    }

    console.error('Adaptive content generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate adaptive content',
      error: error.message
    });
  }
}

module.exports = {
  generateAdaptiveContent,
  generateAdaptiveContentFromSection
};
