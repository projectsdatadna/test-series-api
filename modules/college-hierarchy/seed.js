/**
 * College Hierarchy Seed Data
 * Initializes departments, semesters, and subjects for college education
 */

require('dotenv').config();

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  COLLEGE_DEPARTMENTS: process.env.COLLEGE_DEPARTMENTS_TABLE || 'CollegeDepartmentsTable',
  COLLEGE_SEMESTERS: process.env.COLLEGE_SEMESTERS_TABLE || 'CollegeSemestersTable',
  COLLEGE_SUBJECTS: process.env.COLLEGE_SUBJECTS_TABLE || 'CollegeSubjectsTable',
};

// Seed data
const SEED_DATA = {
  departments: [
    { departmentId: 'DEPT_CSE', departmentName: 'Computer Science & Engineering' },
    { departmentId: 'DEPT_ECE', departmentName: 'Electronics & Communication Engineering' },
    { departmentId: 'DEPT_ME', departmentName: 'Mechanical Engineering' },
    { departmentId: 'DEPT_CE', departmentName: 'Civil Engineering' },
    { departmentId: 'DEPT_EE', departmentName: 'Electrical Engineering' },
    { departmentId: 'DEPT_IT', departmentName: 'Information Technology' },
    { departmentId: 'DEPT_BT', departmentName: 'Biotechnology' },
    { departmentId: 'DEPT_CH', departmentName: 'Chemical Engineering' }
  ],

  semesters: [
    { semesterId: 'SEM_1', semesterName: 'Semester 1' },
    { semesterId: 'SEM_2', semesterName: 'Semester 2' },
    { semesterId: 'SEM_3', semesterName: 'Semester 3' },
    { semesterId: 'SEM_4', semesterName: 'Semester 4' },
    { semesterId: 'SEM_5', semesterName: 'Semester 5' },
    { semesterId: 'SEM_6', semesterName: 'Semester 6' },
    { semesterId: 'SEM_7', semesterName: 'Semester 7' },
    { semesterId: 'SEM_8', semesterName: 'Semester 8' }
  ],

  subjects: [
    // CSE Semester 1
    { subjectId: 'SUB_CALC', subjectName: 'Applied Calculus', departmentId: 'DEPT_CSE', semesterId: 'SEM_1' },
    { subjectId: 'SUB_PROG', subjectName: 'Programming Fundamentals', departmentId: 'DEPT_CSE', semesterId: 'SEM_1' },
    { subjectId: 'SUB_DISCRETE', subjectName: 'Discrete Mathematics', departmentId: 'DEPT_CSE', semesterId: 'SEM_1' },
    { subjectId: 'SUB_PHYSICS', subjectName: 'Physics', departmentId: 'DEPT_CSE', semesterId: 'SEM_1' },
    { subjectId: 'SUB_CHEM', subjectName: 'Chemistry', departmentId: 'DEPT_CSE', semesterId: 'SEM_1' },

    // CSE Semester 2
    { subjectId: 'SUB_LA', subjectName: 'Linear Algebra', departmentId: 'DEPT_CSE', semesterId: 'SEM_2' },
    { subjectId: 'SUB_DSA', subjectName: 'Data Structures & Algorithms', departmentId: 'DEPT_CSE', semesterId: 'SEM_2' },
    { subjectId: 'SUB_DBMS', subjectName: 'Database Management Systems', departmentId: 'DEPT_CSE', semesterId: 'SEM_2' },
    { subjectId: 'SUB_DIGITAL', subjectName: 'Digital Logic Design', departmentId: 'DEPT_CSE', semesterId: 'SEM_2' },
    { subjectId: 'SUB_ENGLISH', subjectName: 'English Communication', departmentId: 'DEPT_CSE', semesterId: 'SEM_2' },

    // CSE Semester 3
    { subjectId: 'SUB_OOP', subjectName: 'Object Oriented Programming', departmentId: 'DEPT_CSE', semesterId: 'SEM_3' },
    { subjectId: 'SUB_OS', subjectName: 'Operating Systems', departmentId: 'DEPT_CSE', semesterId: 'SEM_3' },
    { subjectId: 'SUB_CN', subjectName: 'Computer Networks', departmentId: 'DEPT_CSE', semesterId: 'SEM_3' },
    { subjectId: 'SUB_PROB', subjectName: 'Probability & Statistics', departmentId: 'DEPT_CSE', semesterId: 'SEM_3' },
    { subjectId: 'SUB_WEB', subjectName: 'Web Development', departmentId: 'DEPT_CSE', semesterId: 'SEM_3' },

    // ECE Semester 1
    { subjectId: 'SUB_ECALC', subjectName: 'Applied Calculus', departmentId: 'DEPT_ECE', semesterId: 'SEM_1' },
    { subjectId: 'SUB_EPHYS', subjectName: 'Physics', departmentId: 'DEPT_ECE', semesterId: 'SEM_1' },
    { subjectId: 'SUB_ECHEM', subjectName: 'Chemistry', departmentId: 'DEPT_ECE', semesterId: 'SEM_1' },
    { subjectId: 'SUB_EPROG', subjectName: 'Programming Fundamentals', departmentId: 'DEPT_ECE', semesterId: 'SEM_1' },

    // ME Semester 1
    { subjectId: 'SUB_MCALC', subjectName: 'Applied Calculus', departmentId: 'DEPT_ME', semesterId: 'SEM_1' },
    { subjectId: 'SUB_MPHYS', subjectName: 'Physics', departmentId: 'DEPT_ME', semesterId: 'SEM_1' },
    { subjectId: 'SUB_MENG', subjectName: 'Engineering Mechanics', departmentId: 'DEPT_ME', semesterId: 'SEM_1' },
    { subjectId: 'SUB_MDRAW', subjectName: 'Engineering Drawing', departmentId: 'DEPT_ME', semesterId: 'SEM_1' },

    // IT Semester 1
    { subjectId: 'SUB_ICALC', subjectName: 'Applied Calculus', departmentId: 'DEPT_IT', semesterId: 'SEM_1' },
    { subjectId: 'SUB_IPROG', subjectName: 'Programming Fundamentals', departmentId: 'DEPT_IT', semesterId: 'SEM_1' },
    { subjectId: 'SUB_IDISCRETE', subjectName: 'Discrete Mathematics', departmentId: 'DEPT_IT', semesterId: 'SEM_1' },
    { subjectId: 'SUB_IPHYS', subjectName: 'Physics', departmentId: 'DEPT_IT', semesterId: 'SEM_1' }
  ]
};

/**
 * Check if data already exists
 */
async function checkIfDataExists() {
  try {
    const result = await docClient.send(
      new ScanCommand({ TableName: TABLES.COLLEGE_DEPARTMENTS, Limit: 1 })
    );
    return result.Items && result.Items.length > 0;
  } catch (error) {
    console.log('Could not check existing data:', error.message);
    return false;
  }
}

/**
 * Seed departments
 */
async function seedDepartments() {
  console.log('📚 Seeding departments...');
  let count = 0;

  for (const dept of SEED_DATA.departments) {
    try {
      const item = {
        ...dept,
        createdAt: new Date().toISOString()
      };
      await docClient.send(
        new PutCommand({ TableName: TABLES.COLLEGE_DEPARTMENTS, Item: item })
      );
      count++;
      console.log(`  ✓ Created department: ${dept.departmentName}`);
    } catch (error) {
      console.error(`  ✗ Failed to create department ${dept.departmentId}:`, error.message);
    }
  }

  console.log(`✅ Seeded ${count}/${SEED_DATA.departments.length} departments\n`);
  return count;
}

/**
 * Seed semesters
 */
async function seedSemesters() {
  console.log('📚 Seeding semesters...');
  let count = 0;

  for (const sem of SEED_DATA.semesters) {
    try {
      const item = {
        ...sem,
        createdAt: new Date().toISOString()
      };
      await docClient.send(
        new PutCommand({ TableName: TABLES.COLLEGE_SEMESTERS, Item: item })
      );
      count++;
      console.log(`  ✓ Created semester: ${sem.semesterName}`);
    } catch (error) {
      console.error(`  ✗ Failed to create semester ${sem.semesterId}:`, error.message);
    }
  }

  console.log(`✅ Seeded ${count}/${SEED_DATA.semesters.length} semesters\n`);
  return count;
}

/**
 * Seed subjects
 */
async function seedSubjects() {
  console.log('📚 Seeding subjects...');
  let count = 0;

  for (const subj of SEED_DATA.subjects) {
    try {
      const item = {
        ...subj,
        createdAt: new Date().toISOString()
      };
      await docClient.send(
        new PutCommand({ TableName: TABLES.COLLEGE_SUBJECTS, Item: item })
      );
      count++;
      console.log(`  ✓ Created subject: ${subj.subjectName} (${subj.departmentId}/${subj.semesterId})`);
    } catch (error) {
      console.error(`  ✗ Failed to create subject ${subj.subjectId}:`, error.message);
    }
  }

  console.log(`✅ Seeded ${count}/${SEED_DATA.subjects.length} subjects\n`);
  return count;
}

/**
 * Main seed function
 */
async function seedCollegeHierarchy() {
  console.log('\n========== COLLEGE HIERARCHY SEED ==========\n');

  try {
    // Check if data already exists
    const dataExists = await checkIfDataExists();
    if (dataExists) {
      console.log('⚠️  Data already exists in database. Skipping seed.\n');
      return;
    }

    // Seed all data
    await seedDepartments();
    await seedSemesters();
    await seedSubjects();

    console.log('========== SEED COMPLETE ==========\n');
    console.log('✅ College hierarchy data seeded successfully!');
    console.log(`   - ${SEED_DATA.departments.length} departments`);
    console.log(`   - ${SEED_DATA.semesters.length} semesters`);
    console.log(`   - ${SEED_DATA.subjects.length} subjects\n`);

  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }
}

// Run seed if called directly
if (require.main === module) {
  seedCollegeHierarchy().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  seedCollegeHierarchy,
  SEED_DATA
};
