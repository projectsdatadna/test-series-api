/**
 * English Book Splitter
 * Specialized splitting logic for 9th and 10th English books
 * Handles three book types: Main (Beehive), Supplementary (Moments), Workbook
 */

/**
 * Split English book by division type
 * @param {string} text - Full book text
 * @param {string} division - 'Chapters', 'Poems', or 'Workbook'
 * @returns {Array} Sections with type information
 */
function splitEnglishBook(text, division) {
  console.log(`[RAG] splitEnglishBook - START with division: ${division}`);

  switch (division) {
    case 'Chapters':
      console.log('[RAG] splitEnglishBook - Calling splitMainBook');
      const mainBookSections = splitMainBook(text);
      console.log('[RAG] splitEnglishBook - splitMainBook returned:', mainBookSections.map(s => ({
        sectionNumber: s.sectionNumber,
        sectionType: s.sectionType
      })));
      return mainBookSections;
    case 'Poems':
      console.log('[RAG] splitEnglishBook - Calling splitPoemsBook');
      const poemsBookSections = splitPoemsBook(text);
      console.log('[RAG] splitEnglishBook - splitPoemsBook returned:', poemsBookSections.map(s => ({
        sectionNumber: s.sectionNumber,
        sectionType: s.sectionType
      })));
      return poemsBookSections;
    case 'Workbook':
      console.log('[RAG] splitEnglishBook - Calling splitWorkbook');
      const workbookSections = splitWorkbook(text);
      console.log('[RAG] splitEnglishBook - splitWorkbook returned:', workbookSections.map(s => ({
        sectionNumber: s.sectionNumber,
        sectionType: s.sectionType
      })));
      return workbookSections;
    default:
      console.warn(`[RAG] splitEnglishBook - Unknown division: ${division}, defaulting to main book splitting`);
      return splitMainBook(text);
  }
}

/**
 * Split Main Book (Beehive) - Prose chapters with subsections
 * Structure:
 * 1. The Fun They Had
 *    - Story Content
 *    - Thinking about the Text
 *    - Thinking about Language
 *    - Writing
 *    - Speaking
 *    - Project
 */
function splitMainBook(text) {
  console.log('[RAG] splitMainBook - START');
  const sections = [];
  
  // Regex to find chapter headers: "1. Chapter Name", "2. Another Chapter", etc.
  const chapterRegex = /^\d+\.\s+[A-Z][^\n]*$/gm;
  const matches = [];
  let match;

  while ((match = chapterRegex.exec(text)) !== null) {
    matches.push({
      text: match[0],
      index: match.index,
      endIndex: match.index + match[0].length
    });
  }

  console.log('[RAG] splitMainBook - Found chapters:', matches.length);

  if (matches.length === 0) {
    console.log('[RAG] splitMainBook - No chapters found, treating as single section');
    return [{
      sectionNumber: '1',
      sectionTitle: 'Full Chapter',
      type: 'story',
      content: text.trim()
    }];
  }

  // Extract chapter number and name
  matches.forEach((match, idx) => {
    const chapterMatch = match.text.match(/^(\d+)\.\s+(.+)$/);
    if (!chapterMatch) return;

    const chapterNum = chapterMatch[1];
    const chapterName = chapterMatch[2].trim();

    // Get content from end of header to start of next chapter (or end of text)
    const contentStart = match.endIndex;
    const contentEnd = idx < matches.length - 1 ? matches[idx + 1].index : text.length;
    const chapterContent = text.substring(contentStart, contentEnd).trim();

    if (!chapterContent) return;

    // Split chapter content by subsection markers
    const subsections = splitChapterSubsections(chapterContent, chapterNum, chapterName);
    console.log(`[RAG] splitMainBook - Chapter ${chapterNum} split into ${subsections.length} subsections`);
    sections.push(...subsections);
  });

  console.log('[RAG] splitMainBook - Total sections created:', sections.length);
  console.log('[RAG] splitMainBook - Sections:', sections.map(s => ({
    sectionNumber: s.sectionNumber,
    sectionType: s.sectionType
  })));

  return sections.length > 0 ? sections : [{
    sectionNumber: '1',
    sectionTitle: 'Full Chapter',
    sectionType: 'story',
    content: text.trim()
  }];
}

/**
 * Split chapter into subsections (story, questions, grammar, etc.)
 */
function splitChapterSubsections(chapterContent, chapterNum, chapterName) {
  const subsections = [];
  const sectionMarkers = [
    { marker: /^Thinking about the Text/im, type: 'questions' },
    { marker: /^Thinking about Language/im, type: 'grammar' },
    { marker: /^Writing/im, type: 'writing' },
    { marker: /^Speaking/im, type: 'speaking' },
    { marker: /^Project/im, type: 'project' }
  ];

  // Find all section markers
  const foundMarkers = [];
  sectionMarkers.forEach(({ marker, type }) => {
    let match;
    const regex = new RegExp(marker.source, 'gm');
    while ((match = regex.exec(chapterContent)) !== null) {
      foundMarkers.push({
        index: match.index,
        type: type,
        text: match[0]
      });
    }
  });

  // Sort by index
  foundMarkers.sort((a, b) => a.index - b.index);

  if (foundMarkers.length === 0) {
    // No subsections found, treat entire chapter as story
    subsections.push({
      sectionNumber: `${chapterNum}.0`,
      sectionTitle: chapterName,
      sectionType: 'story',
      content: chapterContent
    });
  } else {
    // Add story content (before first marker)
    const storyContent = chapterContent.substring(0, foundMarkers[0].index).trim();
    if (storyContent.length > 0) {
      subsections.push({
        sectionNumber: `${chapterNum}.0`,
        sectionTitle: chapterName,
        sectionType: 'story',
        content: storyContent
      });
    }

    // Add each subsection
    foundMarkers.forEach((marker, idx) => {
      const contentStart = marker.index;
      const contentEnd = idx < foundMarkers.length - 1 ? foundMarkers[idx + 1].index : chapterContent.length;
      const content = chapterContent.substring(contentStart, contentEnd).trim();

      if (content.length > 0) {
        subsections.push({
          sectionNumber: `${chapterNum}.${idx + 1}`,
          sectionTitle: `${chapterName} - ${marker.type}`,
          type: marker.type,
          content: content
        });
      }
    });
  }

  return subsections;
}

/**
 * Split Poems Book (Supplementary) - Simpler structure
 * Structure:
 * 1. Poem Title
 *    - Poem Content
 *    - Questions
 *    - Suggested Reading
 */
function splitPoemsBook(text) {
  const sections = [];

  // Regex to find poem headers: "1. Poem Name", "2. Another Poem", etc.
  const poemRegex = /^\d+\.\s+[A-Z][^\n]*$/gm;
  const matches = [];
  let match;

  while ((match = poemRegex.exec(text)) !== null) {
    matches.push({
      text: match[0],
      index: match.index,
      endIndex: match.index + match[0].length
    });
  }

  if (matches.length === 0) {
    console.log('[RAG] No poems found, treating as single section');
    return [{
      sectionNumber: '1',
      sectionTitle: 'Full Chapter',
      sectionType: 'poem',
      content: text.trim()
    }];
  }

  // Extract poem number and name
  matches.forEach((match, idx) => {
    const poemMatch = match.text.match(/^(\d+)\.\s+(.+)$/);
    if (!poemMatch) return;

    const poemNum = poemMatch[1];
    const poemName = poemMatch[2].trim();

    // Get content from end of header to start of next poem (or end of text)
    const contentStart = match.endIndex;
    const contentEnd = idx < matches.length - 1 ? matches[idx + 1].index : text.length;
    const poemContent = text.substring(contentStart, contentEnd).trim();

    if (!poemContent) return;

    // Split poem content by subsection markers
    const subsections = splitPoemSubsections(poemContent, poemNum, poemName);
    sections.push(...subsections);
  });

  console.log(`[RAG] Poems book split into ${sections.length} sections`);
  return sections.length > 0 ? sections : [{
    sectionNumber: '1',
    sectionTitle: 'Full Chapter',
    sectionType: 'poem',
    content: text.trim()
  }];
}

/**
 * Split poem into subsections (poem, questions, suggested reading)
 */
function splitPoemSubsections(poemContent, poemNum, poemName) {
  const subsections = [];
  const sectionMarkers = [
    { marker: /^Questions/im, type: 'questions' },
    { marker: /^Suggested Reading/im, type: 'suggested_reading' }
  ];

  // Find all section markers
  const foundMarkers = [];
  sectionMarkers.forEach(({ marker, type }) => {
    let match;
    const regex = new RegExp(marker.source, 'gm');
    while ((match = regex.exec(poemContent)) !== null) {
      foundMarkers.push({
        index: match.index,
        type: type,
        text: match[0]
      });
    }
  });

  // Sort by index
  foundMarkers.sort((a, b) => a.index - b.index);

  if (foundMarkers.length === 0) {
    // No subsections found, treat entire poem as poem content
    subsections.push({
      sectionNumber: `${poemNum}.0`,
      sectionTitle: poemName,
      sectionType: 'poem',
      content: poemContent
    });
  } else {
    // Add poem content (before first marker)
    const poemTextContent = poemContent.substring(0, foundMarkers[0].index).trim();
    if (poemTextContent.length > 0) {
      subsections.push({
        sectionNumber: `${poemNum}.0`,
        sectionTitle: poemName,
        sectionType: 'poem',
        content: poemTextContent
      });
    }

    // Add each subsection
    foundMarkers.forEach((marker, idx) => {
      const contentStart = marker.index;
      const contentEnd = idx < foundMarkers.length - 1 ? foundMarkers[idx + 1].index : poemContent.length;
      const content = poemContent.substring(contentStart, contentEnd).trim();

      if (content.length > 0) {
        subsections.push({
          sectionNumber: `${poemNum}.${idx + 1}`,
          sectionTitle: `${poemName} - ${marker.type}`,
          sectionType: marker.type,
          content: content
        });
      }
    });
  }

  return subsections;
}

/**
 * Split Workbook - Activity-based structure
 * Structure:
 * Unit 1
 *   - Reading
 *   - Vocabulary
 *   - Grammar
 *   - Writing Tasks
 *   - Listening
 *   - Speaking
 */
function splitWorkbook(text) {
  const sections = [];

  // Regex to find unit headers: "Unit 1", "Unit 2", etc.
  const unitRegex = /^Unit\s+(\d+)/im;
  const matches = [];
  let match;
  const regex = new RegExp(unitRegex.source, 'gm');

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      text: match[0],
      unitNum: match[1],
      index: match.index,
      endIndex: match.index + match[0].length
    });
  }

  if (matches.length === 0) {
    console.log('[RAG] No units found in workbook, treating as single section');
    return [{
      sectionNumber: '1',
      sectionTitle: 'Full Workbook',
      sectionType: 'activity',
      content: text.trim()
    }];
  }

  // Extract unit content and split by activity types
  matches.forEach((match, idx) => {
    const unitNum = match.unitNum;

    // Get content from end of header to start of next unit (or end of text)
    const contentStart = match.endIndex;
    const contentEnd = idx < matches.length - 1 ? matches[idx + 1].index : text.length;
    const unitContent = text.substring(contentStart, contentEnd).trim();

    if (!unitContent) return;

    // Split unit content by activity markers
    const activities = splitWorkbookActivities(unitContent, unitNum);
    sections.push(...activities);
  });

  console.log(`[RAG] Workbook split into ${sections.length} sections`);
  return sections.length > 0 ? sections : [{
    sectionNumber: '1',
    sectionTitle: 'Full Workbook',
    sectionType: 'activity',
    content: text.trim()
  }];
}

/**
 * Split workbook unit into activities
 */
function splitWorkbookActivities(unitContent, unitNum) {
  const activities = [];
  const activityMarkers = [
    { marker: /^Reading/im, type: 'reading' },
    { marker: /^Vocabulary/im, type: 'vocabulary' },
    { marker: /^Grammar/im, type: 'grammar' },
    { marker: /^Writing/im, type: 'writing' },
    { marker: /^Listening/im, type: 'listening' },
    { marker: /^Speaking/im, type: 'speaking' }
  ];

  // Find all activity markers
  const foundMarkers = [];
  activityMarkers.forEach(({ marker, type }) => {
    let match;
    const regex = new RegExp(marker.source, 'gm');
    while ((match = regex.exec(unitContent)) !== null) {
      foundMarkers.push({
        index: match.index,
        type: type,
        text: match[0]
      });
    }
  });

  // Sort by index
  foundMarkers.sort((a, b) => a.index - b.index);

  if (foundMarkers.length === 0) {
    // No activities found, treat entire unit as single activity
    activities.push({
      sectionNumber: `${unitNum}.0`,
      sectionTitle: `Unit ${unitNum}`,
      sectionType: 'activity',
      content: unitContent
    });
  } else {
    // Add each activity
    foundMarkers.forEach((marker, idx) => {
      const contentStart = marker.index;
      const contentEnd = idx < foundMarkers.length - 1 ? foundMarkers[idx + 1].index : unitContent.length;
      const content = unitContent.substring(contentStart, contentEnd).trim();

      if (content.length > 0) {
        activities.push({
          sectionNumber: `${unitNum}.${idx + 1}`,
          sectionTitle: `Unit ${unitNum} - ${marker.type}`,
          sectionType: marker.type,
          content: content
        });
      }
    });
  }

  return activities;
}

module.exports = {
  splitEnglishBook,
  splitMainBook,
  splitPoemsBook,
  splitWorkbook
};
