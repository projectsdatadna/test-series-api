/**
 * RAG Module Test
 * Quick test to verify RAG setup and Azure OpenAI connection
 */

require('dotenv').config({ path: '../../.env' });

const { initializeEmbeddingsClient, generateEmbedding, cosineSimilarity } = require('./embeddings');
const { splitText, splitBySections } = require('./textSplitter');

async function testRAG() {
  console.log('=== RAG Module Test ===\n');

  try {
    // Test 1: Check environment variables
    console.log('1. Checking environment variables...');
    const requiredEnvVars = [
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_DEPLOYMENT_NAME'
    ];

    const missingVars = requiredEnvVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      console.error(`❌ Missing environment variables: ${missingVars.join(', ')}`);
      return;
    }
    console.log('✓ All required environment variables are set\n');

    // Test 2: Initialize Azure OpenAI client
    console.log('2. Initializing Azure OpenAI client...');
    const client = initializeEmbeddingsClient();
    console.log('✓ Azure OpenAI client initialized\n');

    // Test 3: Generate embedding
    console.log('3. Testing embedding generation...');
    const testText = 'Photosynthesis is the process by which plants convert light energy into chemical energy.';
    const embedding = await generateEmbedding(testText);
    console.log(`✓ Generated embedding with dimension: ${embedding.length}`);
    console.log(`  First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]\n`);

    // Test 4: Test text splitting
    console.log('4. Testing text splitting...');
    const sampleText = `Chapter 1: Introduction to Biology
Biology is the study of life. It encompasses all living organisms and their interactions.

Chapter 2: Cell Structure
Cells are the basic unit of life. They contain various organelles that perform specific functions.

Chapter 3: Photosynthesis
Photosynthesis is the process by which plants convert light energy into chemical energy.`;

    const chunks = splitText(sampleText, 100, 20);
    console.log(`✓ Text split into ${chunks.length} chunks (size: 100, overlap: 20)`);
    console.log(`  First chunk: "${chunks[0].substring(0, 50)}..."\n`);

    // Test 5: Test section splitting
    console.log('5. Testing section splitting...');
    const sections = splitBySections(sampleText);
    console.log(`✓ Text split into ${sections.length} sections`);
    sections.forEach(s => console.log(`  - ${s.title}: ${s.content.length} characters`));
    console.log();

    // Test 6: Test cosine similarity
    console.log('6. Testing cosine similarity...');
    const embedding2 = await generateEmbedding('Photosynthesis converts light into chemical energy');
    const similarity = cosineSimilarity(embedding, embedding2);
    console.log(`✓ Cosine similarity between similar texts: ${(similarity * 100).toFixed(2)}%\n`);

    console.log('=== All tests passed! ===');
    console.log('\nNext steps:');
    console.log('1. Upload a PDF: POST /rag/upload with file and documentId');
    console.log('2. Retrieve context: POST /rag/retrieve with query and documentId');
    console.log('3. Check vectors: GET /rag/vectors/:documentId');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  }
}

// Run tests
testRAG();
