/**
 * Script to create SectionsTable in local DynamoDB
 * Run with: node scripts/create-sections-table.js
 */

const AWS = require('aws-sdk');

// Configure AWS SDK for local DynamoDB
const dynamodb = new AWS.DynamoDB({
  region: 'ap-south-1',
  endpoint: 'http://localhost:8000',
  accessKeyId: 'local',
  secretAccessKey: 'local'
});

const tableName = 'SectionsTable';

const params = {
  TableName: tableName,
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

console.log(`Creating table: ${tableName}...`);

dynamodb.createTable(params, (err, data) => {
  if (err) {
    if (err.code === 'ResourceInUseException') {
      console.log(`✅ Table ${tableName} already exists`);
    } else {
      console.error('❌ Error creating table:', err.message);
      process.exit(1);
    }
  } else {
    console.log(`✅ Table ${tableName} created successfully`);
    console.log('Table details:', JSON.stringify(data.TableDescription, null, 2));
  }
});
