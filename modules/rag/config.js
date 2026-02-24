/**
 * RAG Configuration
 * Azure OpenAI and DynamoDB settings for vector embeddings
 */

try { require('dotenv').config(); } catch (e) { /* .env not found */ }

// Debug: Log environment variable
console.log('[CONFIG] AZURE_OPENAI_DEPLOYMENT_NAME from env:', process.env.AZURE_OPENAI_DEPLOYMENT_NAME);

const ragConfig = {
  // Azure OpenAI Configuration
  azure: {
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'text-embedding-3-large',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview'
  },

  // Text Splitter Configuration
  textSplitter: {
    chunkSize: parseInt(process.env.CHUNK_SIZE || '1000'),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200')
  },

  // DynamoDB Configuration
  dynamodb: {
    region: process.env.AWS_REGION || 'ap-south-1',
    tableName: process.env.DYNAMODB_TABLE_NAME || 'documents',
    vectorColumnName: 'vectorData',
    sectionsColumnName: 'sections'
  },

  // Vector Configuration
  vector: {
    dimension: 3072, // For text-embedding-3-large
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7')
  }
};

module.exports = ragConfig;
