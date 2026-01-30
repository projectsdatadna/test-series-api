// One-time seed data for Syllabus, Standards, Subjects

require('dotenv').config();

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const {
  generateSyllabusId,
  generateStandardId,
  generateSubjectId,
} = require('../file-hierarchy/utils');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  SYLLABUS: process.env.SYLLABUS_TABLE || 'SyllabusTable',
  STANDARDS: process.env.STANDARDS_TABLE || 'StandardsTable',
  SUBJECTS: process.env.SUBJECTS_TABLE || 'SubjectsTable',
};

// Seed data structure
const SEED_DATA = {
  syllabi: [
    { name: 'NCERT', id: 'SYL_NCERT' },
    { name: 'TN State Board', id: 'SYL_TNST' },
  ],
  standards: [
    { standard: '6', id: 'STD_6', label: 'Class 6' },
    { standard: '7', id: 'STD_7', label: 'Class 7' },
    { standard: '8', id: 'STD_8', label: 'Class 8' },
    { standard: '9', id: 'STD_9', label: 'Class 9' },
    { standard: '10', id: 'STD_10', label: 'Class 10' },
    { standard: '11', id: 'STD_11', label: 'Class 11' },
    { standard: '12', id: 'STD_12', label: 'Class 12' },
  ],
  subjects: {
    '6-10': [
      { name: 'Tamil', id: 'SUB_TAM' },
      { name: 'English', id: 'SUB_ENG' },
      { name: 'Mathematics', id: 'SUB_MAT' },
      { name: 'Science', id: 'SUB_SCI' },
      { name: 'Social Science', id: 'SUB_SOC' },
    ],
    '11-12': [
      { name: 'Tamil', id: 'SUB_TAM' },
      { name: 'English', id: 'SUB_ENG' },
      { name: 'Physics', id: 'SUB_PHY' },
      { name: 'Chemistry', id: 'SUB_CHE' },
      { name: 'Biology', id: 'SUB_BIO' },
      { name: 'Mathematics', id: 'SUB_MAT' },
      { name: 'History', id: 'SUB_HIS' },
      { name: 'Geography', id: 'SUB_GEO' },
      { name: 'Economics', id: 'SUB_ECO' },
      { name: 'Political Science', id: 'SUB_POL' },
    ],
  },
};

const seedSyllabi = async () => {
  console.log('Seeding Syllabi...');
  for (const syllabus of SEED_DATA.syllabi) {
    const item = {
      syllabusId: syllabus.id,
      syllabusName: syllabus.name,
      linkedAt: new Date().toISOString(),
    };
    try {
      await docClient.send(new PutCommand({ TableName: TABLES.SYLLABUS, Item: item }));
      console.log(`✓ Created syllabus: ${syllabus.name}`);
    } catch (error) {
      console.error(`✗ Failed to create syllabus ${syllabus.name}:`, error.message);
    }
  }
};

const seedStandards = async () => {
  console.log('Seeding Standards...');
  // Standards are common for all syllabi, seed only once
  for (const standard of SEED_DATA.standards) {
    const item = {
      standardId: standard.id,
      standardName: standard.label,
      linkedAt: new Date().toISOString(),
    };
    try {
      await docClient.send(new PutCommand({ TableName: TABLES.STANDARDS, Item: item }));
      console.log(`✓ Created standard: ${standard.label}`);
    } catch (error) {
      console.error(
        `✗ Failed to create standard ${standard.label}:`,
        error.message
      );
    }
  }
};

const seedSubjects = async () => {
  console.log('Seeding Subjects...');
  
  // Combine all subjects (common for all standards)
  const allSubjects = [
    ...SEED_DATA.subjects['6-10'],
    ...SEED_DATA.subjects['11-12'].filter(s => !SEED_DATA.subjects['6-10'].some(c => c.id === s.id))
  ];

  for (const subject of allSubjects) {
    const item = {
      subjectId: subject.id,
      subjectName: subject.name,
      linkedAt: new Date().toISOString(),
    };
    try {
      await docClient.send(new PutCommand({ TableName: TABLES.SUBJECTS, Item: item }));
      console.log(`✓ Created subject: ${subject.name}`);
    } catch (error) {
      console.error(
        `✗ Failed to create subject ${subject.name}:`,
        error.message
      );
    }
  }
};

const runSeed = async () => {
  try {
    console.log('Starting hierarchy seed...\n');
    await seedSyllabi();
    console.log();
    await seedStandards();
    console.log();
    await seedSubjects();
    console.log('\n✓ Seed completed successfully!');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
};

module.exports = { runSeed };

// Run if called directly
if (require.main === module) {
  runSeed();
}
