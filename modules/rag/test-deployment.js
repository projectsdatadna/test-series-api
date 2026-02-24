/**
 * Test script to find the correct Azure OpenAI deployment name
 * Run: node modules/rag/test-deployment.js
 */

const { AzureOpenAI } = require('openai');

async function testDeployment() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'text-embedding-3-large';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

  console.log('\n=== Azure OpenAI Deployment Test ===\n');
  console.log('Configuration:');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  API Key: ${apiKey ? '✓ Set' : '✗ Missing'}`);
  console.log(`  Deployment: ${deploymentName}`);
  console.log(`  API Version: ${apiVersion}`);

  if (!apiKey || !endpoint) {
    console.error('\n❌ Missing required environment variables:');
    if (!apiKey) console.error('   - AZURE_OPENAI_API_KEY');
    if (!endpoint) console.error('   - AZURE_OPENAI_ENDPOINT');
    process.exit(1);
  }

  try {
    console.log('\n⏳ Initializing Azure OpenAI client...');
    const client = new AzureOpenAI({
      apiKey: apiKey,
      endpoint: endpoint,
      apiVersion: apiVersion,
      defaultQuery: { 'api-version': apiVersion }
    });

    console.log('✓ Client initialized');

    console.log('\n⏳ Testing embeddings API with deployment: ' + deploymentName);
    const response = await client.embeddings.create({
      model: deploymentName,
      input: 'This is a test string to generate embeddings.'
    });

    console.log('✓ Success! Embeddings generated');
    console.log(`  Embedding dimension: ${response.data[0].embedding.length}`);
    console.log(`  First 5 values: [${response.data[0].embedding.slice(0, 5).join(', ')}]`);
    console.log('\n✅ Deployment is working correctly!');
    console.log(`\nUse this deployment name: ${deploymentName}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.status === 404) {
      console.error('\n⚠️  Deployment not found!');
      console.error('\nCommon deployment names to try:');
      console.error('  - text-embedding-ada-002');
      console.error('  - text-embedding-3-large');
      console.error('  - text-embedding-3-large');
      console.error('  - embedding');
      console.error('  - embeddings');
      console.error('\nSet the correct deployment name:');
      console.error('  $env:AZURE_OPENAI_DEPLOYMENT_NAME="your-deployment-name"');
    } else if (error.status === 401) {
      console.error('\n⚠️  Authentication failed!');
      console.error('Check your API key is correct.');
    } else if (error.status === 429) {
      console.error('\n⚠️  Rate limit exceeded!');
      console.error('Wait a moment and try again.');
    }

    console.error('\nFull error:', error);
    process.exit(1);
  }
}

testDeployment();
