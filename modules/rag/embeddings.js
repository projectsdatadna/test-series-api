/**
 * Azure OpenAI Embeddings Service
 * Generates vector embeddings for text chunks using Azure OpenAI
 */

const { AzureOpenAI } = require('openai');
const ragConfig = require('./config');

let embeddingsClient = null;

/**
 * Initialize Azure OpenAI client for embeddings
 */
function initializeEmbeddingsClient() {
  if (embeddingsClient) {
    return embeddingsClient;
  }

  const { apiKey, endpoint, deploymentName, apiVersion } = ragConfig.azure;

  if (!apiKey || !endpoint) {
    const missingVars = [];
    if (!apiKey) missingVars.push('AZURE_OPENAI_API_KEY');
    if (!endpoint) missingVars.push('AZURE_OPENAI_ENDPOINT');

    const errorMsg = `Missing required Azure OpenAI configuration: ${missingVars.join(', ')}. See modules/rag/SETUP_GUIDE.md for setup instructions.`;
    console.error('[RAG]', errorMsg);
    throw new Error(errorMsg);
  }

  console.log('[RAG] Initializing Azure OpenAI client with:');
  console.log('[RAG]   Endpoint:', endpoint);
  console.log('[RAG]   Deployment:', deploymentName);
  console.log('[RAG]   API Version:', apiVersion);
  console.log('[RAG]   (deploymentName from config:', ragConfig.azure.deploymentName, ')');

  embeddingsClient = new AzureOpenAI({
    apiKey: apiKey,
    endpoint: endpoint,
    apiVersion: apiVersion,
    defaultQuery: { 'api-version': apiVersion }
  });
  console.log('[RAG] Azure OpenAI embeddings client initialized successfully');

  return embeddingsClient;
}

/**
 * Generate embeddings for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Vector embedding
 */
async function generateEmbedding(text) {
  try {
    const client = initializeEmbeddingsClient();
    const { deploymentName } = ragConfig.azure;

    const response = await client.embeddings.create({
      model: deploymentName,
      input: text
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('No embeddings returned from Azure OpenAI');
    }

    return response.data[0].embedding;
  } catch (error) {
    console.error('[RAG] Error generating embedding:', error.message);

    if (error.status === 429) {
      const retryAfter = parseInt(error.headers?.['retry-after'] || '60');
      console.error(`[RAG] Rate limit hit. Waiting ${retryAfter} seconds...`);
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));

      const retryResponse = await client.embeddings.create({
        model: deploymentName,
        input: text
      });

      if (retryResponse.data && retryResponse.data.length > 0) {
        return retryResponse.data[0].embedding;
      }
    }

    throw error;
  }
}

/**
 * Generate embeddings for multiple texts with batch processing and rate limiting
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} Array of vector embeddings
 */
async function generateEmbeddings(texts) {
  try {
    const client = initializeEmbeddingsClient();
    const { deploymentName } = ragConfig.azure;

    console.log(`[RAG] Calling Azure OpenAI embeddings API for ${texts.length} texts...`);

    // Process in batches to avoid rate limits
    const batchSize = 50; // Process 50 texts at a time
    const allEmbeddings = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(texts.length / batchSize);

      console.log(`[RAG] Processing batch ${batchNum}/${totalBatches} (${batch.length} texts)...`);

      try {
        const response = await client.embeddings.create({
          model: deploymentName,
          input: batch
        });

        if (!response.data || response.data.length === 0) {
          throw new Error('No embeddings returned from Azure OpenAI');
        }

        allEmbeddings.push(...response.data.map(item => item.embedding));

        // Reduced delay between batches: 100ms instead of 1000ms
        // This is enough for rate limiting without excessive delay
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (batchError) {
        if (batchError.status === 429) {
          const retryAfter = parseInt(batchError.headers?.['retry-after'] || '60');
          console.error(`[RAG] Rate limit hit. Waiting ${retryAfter} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));

          // Retry this batch
          console.log(`[RAG] Retrying batch ${batchNum}...`);
          const retryResponse = await client.embeddings.create({
            model: deploymentName,
            input: batch
          });

          if (retryResponse.data && retryResponse.data.length > 0) {
            allEmbeddings.push(...retryResponse.data.map(item => item.embedding));
          }
        } else {
          throw batchError;
        }
      }
    }

    console.log(`[RAG] Successfully generated ${allEmbeddings.length} embeddings`);
    return allEmbeddings;
  } catch (error) {
    console.error('[RAG] Error generating embeddings:', error.message);

    // Provide helpful error messages
    if (error.status === 404) {
      console.error('[RAG] Deployment not found. Check:');
      console.error('[RAG]   1. Deployment name is correct: ' + ragConfig.azure.deploymentName);
      console.error('[RAG]   2. Deployment exists in Azure Portal');
      console.error('[RAG]   3. Endpoint is correct: ' + ragConfig.azure.endpoint);
    } else if (error.status === 401) {
      console.error('[RAG] Authentication failed. Check your API key.');
    } else if (error.status === 429) {
      console.error('[RAG] Rate limit exceeded even after retry.');
      console.error('[RAG] Consider upgrading your Azure OpenAI pricing tier.');
    }

    throw error;
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vec1 - First vector
 * @param {number[]} vec2 - Second vector
 * @returns {number} Similarity score (0-1)
 */
function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same dimension');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);

  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (norm1 * norm2);
}

module.exports = {
  initializeEmbeddingsClient,
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity
};
