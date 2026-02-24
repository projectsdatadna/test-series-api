/**
 * Initialize RAG Tables
 * Creates necessary DynamoDB tables if they don't exist
 */

const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB({
  region: process.env.AWS_REGION || 'ap-south-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || undefined
});

const SECTIONS_TABLE = process.env.SECTIONS_TABLE || 'SectionsTable';

/**
 * Create SectionsTable if it doesn't exist
 */
async function initializeSectionsTable() {
  try {
    // Check if table exists
    const tables = await dynamodb.listTables().promise();

    if (tables.TableNames.includes(SECTIONS_TABLE)) {
      console.log('[RAG] SectionsTable already exists');
      return;
    }

    console.log('[RAG] Creating SectionsTable...');

    const params = {
      TableName: SECTIONS_TABLE,
      KeySchema: [
        { AttributeName: 'chapterId', KeyType: 'HASH' },
        { AttributeName: 'sectionId', KeyType: 'RANGE' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'chapterId', AttributeType: 'S' },
        { AttributeName: 'sectionId', AttributeType: 'S' },
        { AttributeName: 'syllabusId', AttributeType: 'S' },
        { AttributeName: 'standardId', AttributeType: 'S' },
        { AttributeName: 'subjectId', AttributeType: 'S' }
      ],
      BillingMode: 'PAY_PER_REQUEST',
      GlobalSecondaryIndexes: [
        {
          IndexName: 'syllabus-index',
          KeySchema: [{ AttributeName: 'syllabusId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' }
        },
        {
          IndexName: 'standard-index',
          KeySchema: [{ AttributeName: 'standardId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' }
        },
        {
          IndexName: 'subject-index',
          KeySchema: [{ AttributeName: 'subjectId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' }
        }
      ]
    };

    await dynamodb.createTable(params).promise();
    console.log('[RAG] ✅ SectionsTable created successfully');
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('[RAG] SectionsTable already exists');
    } else {
      console.warn('[RAG] Warning: Could not initialize SectionsTable:', error.message);
      console.warn('[RAG] Table will need to be created manually or via serverless deploy');
    }
  }
}

module.exports = {
  initializeSectionsTable
};
