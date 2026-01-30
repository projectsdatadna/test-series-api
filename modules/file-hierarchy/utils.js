// ID Generation & Validation Utilities

const generateSyllabusId = (name) => {
  const prefix = name.toUpperCase().slice(0, 3);
  return `SYL_${prefix}`;
};

const generateStandardId = (standard) => {
  return `STD_${standard}`;
};

const generateSubjectId = (subject) => {
  const prefix = subject.toUpperCase().slice(0, 3);
  return `SUB_${prefix}`;
};

const generateChapterId = () => {
  return `CH_${Date.now().toString(36).toUpperCase()}`;
};

const generateSectionId = (chapterNumber, sectionNumber) => {
  return `SEC_${chapterNumber}.${sectionNumber}`;
};

const generateFileId = (anthropicFileId) => {
  return `FILE_${anthropicFileId}`;
};

const validateHierarchy = (syllabusId, standardId, subjectId) => {
  if (!syllabusId || !standardId || !subjectId) {
    throw new Error('Invalid hierarchy: syllabusId, standardId, subjectId required');
  }
};

module.exports = {
  generateSyllabusId,
  generateStandardId,
  generateSubjectId,
  generateChapterId,
  generateSectionId,
  generateFileId,
  validateHierarchy,
};
