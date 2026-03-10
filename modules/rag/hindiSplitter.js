/**
 * Hindi Textbook Splitter
 * Specialized regex-based splitting for NCERT Hindi books
 * Handles Hindi-specific content patterns and exercise removal
 */

// Hindi stop headings (exercises, activities, etc. to be removed)
const HINDI_STOP_HEADINGS = [
  'पाठ से',
  'मेरी समझ से',
  'मिलकर करें',
  'मिलान',
  'पंक्तियों पर चर्चा',
  'सोच-विचार के लिए',
  'शब्द पहेली',
  'पाठ से आगे',
  'आपकी बात',
  'सृजन',
  'खोजबीन',
  'अभ्यास',
  'प्रश्न',
  'उत्तर दीजिए',
  'भाषा की बात',
  'लेखक परिचय',
  'शब्दार्थ',
  'व्याकरण',
  'रचना',
  'पाठ्यक्रम'
];

/**
 * Detect if text is a poem based on line structure
 * Poems have: short lines, frequent line breaks
 * @param {string} text - Text to analyze
 * @returns {boolean} - True if text appears to be a poem
 */
function isPoem(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 3) return false;
  
  const shortLines = lines.filter(l => l.trim().length < 40);
  const ratio = shortLines.length / lines.length;
  
  return ratio > 0.6;
}

/**
 * Clean Hindi text by removing noise and formatting artifacts
 * @param {string} text - Raw text from PDF
 * @returns {string} - Cleaned text
 */
function cleanHindiText(text) {
  return text
    // Remove page numbers and headers
    .replace(/Reprint.*?\n/g, '')
    .replace(/Chapter.*?\.indd/g, '')
    .replace(/\n\d+\n/g, '\n')
    // Remove multiple spaces
    .replace(/\s+/g, ' ')
    // Remove extra newlines
    .replace(/\n\n+/g, '\n')
    .trim();
}

/**
 * Remove exercise sections from Hindi text
 * @param {string} text - Text content
 * @returns {string} - Text with exercises removed
 */
function removeExercises(text) {
  const lines = text.split('\n');
  let result = [];
  let skipMode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if this line is EXACTLY a stop heading (not just contains it)
    const isStopHeading = HINDI_STOP_HEADINGS.some(heading => 
      line === heading || 
      line.startsWith(heading + ' ') ||
      line.startsWith(heading + ':') ||
      line.startsWith(heading + '।')
    );

    if (isStopHeading) {
      skipMode = true;
      continue;
    }

    // Check if we're back to main content (new chapter or section)
    if (skipMode && /^(अध्याय|Chapter|पाठ|Lesson)\s+\d+/i.test(line)) {
      skipMode = false;
    }

    if (!skipMode) {
      result.push(lines[i]);
    }
  }

  return result.join('\n').trim();
}

/**
 * Split Hindi text into chapters using regex patterns
 * @param {string} text - Full text content
 * @returns {Array} - Array of chapter objects
 */
function splitHindiChapters(text) {
  const chapters = [];
  
  // More flexible pattern for chapter headers
  // Matches: "अध्याय 1", "Chapter 1", "पाठ 1", "Lesson 1", "1.", "1 -", etc.
  const chapterPattern = /(?:अध्याय|Chapter|पाठ|Lesson|अध्य|Ch\.?)\s*(\d+)\s*[.:\-]?\s*([^\n\r]*)/gi;
  
  let match;
  const matches = [];

  // Collect all matches first
  while ((match = chapterPattern.exec(text)) !== null) {
    matches.push({
      chapterNum: match[1],
      chapterTitle: match[2].trim() || `Chapter ${match[1]}`,
      startIndex: match.index,
      fullMatch: match[0]
    });
  }

  // If no chapters found with pattern, treat entire text as one chapter
  if (matches.length === 0) {
    console.log('[Hindi Splitter] No chapter pattern found, treating entire text as single chapter');
    return [{
      chapterNumber: 1,
      chapterTitle: 'Content',
      content: text.trim(),
      contentLength: text.length,
      isPoem: isPoem(text)
    }];
  }

  // Create chapters from matches
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];
    
    const startIndex = currentMatch.startIndex + currentMatch.fullMatch.length;
    const endIndex = nextMatch ? nextMatch.startIndex : text.length;
    
    const content = text.substring(startIndex, endIndex).trim();

    if (content.length > 0) {
      chapters.push({
        chapterNumber: parseInt(currentMatch.chapterNum),
        chapterTitle: currentMatch.chapterTitle,
        content: content,
        contentLength: content.length,
        isPoem: isPoem(content)
      });
    }
  }

  return chapters;
}

/**
 * Split chapter content into chunks
 * Chunk size: 300-700 words for optimal embedding and retrieval
 * @param {string} text - Chapter content
 * @param {number} chunkSize - Target words per chunk (default: 500)
 * @returns {Array} - Array of text chunks
 */
function chunkContent(text, chunkSize = 500) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Split Hindi book into sections with metadata
 * Main entry point for Hindi book processing
 * Automatically detects and splits by NCERT Hindi section headings
 * @param {string} text - Full book text
 * @returns {Array} - Array of section objects with metadata
 */
function splitHindiBook(text) {
  console.log('[Hindi Splitter] Starting Hindi book processing');
  
  // Step 1: Clean text
  const cleanedText = cleanHindiText(text);
  console.log(`[Hindi Splitter] Cleaned text: ${cleanedText.length} characters`);

  // Step 2: Common NCERT Hindi section headings (in order of appearance)
  const ncertSectionHeadings = [
    'कविता',
    'कहानी',
    'कवि से परिचय',
    'लेखक परिचय',
    'पाठ से',
    'मेरी समझ से',
    'मिलकर करें मिलान',
    'पंक्तियों पर चर्चा',
    'सोच-विचार के लिए',
    'शब्द पहेली',
    'पाठ से आगे',
    'आपकी बात',
    'सृजन',
    'खोजबीन',
    'भाषा की बात',
    'शब्दार्थ',
    'व्याकरण',
    'रचना'
  ];

  // Step 3: Find all section headings present in the text with their positions
  const foundSections = [];
  ncertSectionHeadings.forEach(heading => {
    let searchIndex = 0;
    let index;
    while ((index = cleanedText.indexOf(heading, searchIndex)) !== -1) {
      foundSections.push({
        heading: heading,
        index: index
      });
      searchIndex = index + 1;
    }
  });

  // Step 4: Sort by position in text
  foundSections.sort((a, b) => a.index - b.index);

  console.log(`[Hindi Splitter] Found ${foundSections.length} section headings`);
  foundSections.forEach(s => {
    console.log(`[Hindi Splitter] - "${s.heading}" at position ${s.index}`);
  });

  // Step 5: If we found section headings, split by them
  if (foundSections.length > 0) {
    console.log('[Hindi Splitter] Splitting by detected section headings');
    return splitByDetectedHeadings(cleanedText, foundSections);
  }

  // Step 6: Fallback - split into chapters if no section headings found
  console.log('[Hindi Splitter] No section headings found, falling back to chapter-based splitting');
  const chapters = splitHindiChapters(cleanedText);
  console.log(`[Hindi Splitter] Found ${chapters.length} chapters`);

  // Step 7: Process each chapter into sections
  const sections = [];
  let sectionNumber = '1';

  chapters.forEach((chapter) => {
    console.log(`[Hindi Splitter] Processing Chapter ${chapter.chapterNumber}: "${chapter.chapterTitle}"`);
    
    const contentType = chapter.isPoem ? 'poem' : 'story';
    console.log(`[Hindi Splitter] Content type detected: ${contentType}`);

    const chunks = chunkContent(chapter.content);
    console.log(`[Hindi Splitter] Chapter split into ${chunks.length} chunks`);

    chunks.forEach((chunk, chunkIndex) => {
      let sectionTitle;
      if (chunks.length === 1) {
        sectionTitle = chapter.chapterTitle;
      } else {
        const partNum = chunkIndex + 1;
        const totalParts = chunks.length;
        sectionTitle = `${chapter.chapterTitle} (Part ${partNum}/${totalParts})`;
      }

      sections.push({
        sectionNumber: sectionNumber,
        sectionTitle: sectionTitle,
        sectionType: contentType,
        content: chunk,
        metadata: {
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.chapterTitle,
          chunkIndex: chunkIndex,
          totalChunks: chunks.length,
          contentType: contentType,
          wordCount: chunk.split(/\s+/).length
        }
      });
      sectionNumber = String(parseInt(sectionNumber) + 1);
    });
  });

  console.log(`[Hindi Splitter] Total sections created: ${sections.length}`);
  return sections;
}

/**
 * Split text by detected section headings
 * @param {string} text - Full text
 * @param {Array} foundSections - Array of {heading, index} objects
 * @returns {Array} - Array of section objects
 */
function splitByDetectedHeadings(text, foundSections) {
  const sections = [];
  let sectionNumber = '1';

  for (let i = 0; i < foundSections.length; i++) {
    const currentSection = foundSections[i];
    const nextSection = foundSections[i + 1];

    // Extract content between current heading and next heading
    const contentStart = currentSection.index + currentSection.heading.length;
    const contentEnd = nextSection ? nextSection.index : text.length;
    
    const sectionContent = text.substring(contentStart, contentEnd).trim();

    if (sectionContent.length > 0) {
      console.log(`[Hindi Splitter] Creating section: "${currentSection.heading}" (${sectionContent.length} chars)`);
      
      sections.push({
        sectionNumber: sectionNumber,
        sectionTitle: currentSection.heading,
        sectionType: isPoem(sectionContent) ? 'poem' : 'content',
        content: sectionContent,
        metadata: {
          wordCount: sectionContent.split(/\s+/).length,
          contentType: isPoem(sectionContent) ? 'poem' : 'content'
        }
      });
      sectionNumber = String(parseInt(sectionNumber) + 1);
    }
  }

  console.log(`[Hindi Splitter] Total sections created: ${sections.length}`);
  return sections;
}

/**
 * Split Hindi book by headings - NCERT specific
 * Only for NCERT Hindi books - stops parsing after "पाठ से"
 * @param {string} text - Full book text
 * @returns {Array} - Array of section objects
 */
function splitHindiBookByHeadings(text) {
  console.log('[Hindi Splitter] Starting heading-based splitting for NCERT Hindi books');
  
  // Step 1: Clean text
  const cleanedText = cleanHindiText(text);
  console.log(`[Hindi Splitter] Cleaned text: ${cleanedText.length} characters`);

  // Step 2: Find the "पाठ से" marker - stop parsing after this
  const stopMarker = 'पाठ से';
  const stopIndex = cleanedText.indexOf(stopMarker);
  
  let contentToProcess = cleanedText;
  if (stopIndex !== -1) {
    console.log(`[Hindi Splitter] Found stop marker "${stopMarker}" at position ${stopIndex}`);
    contentToProcess = cleanedText.substring(0, stopIndex);
    console.log(`[Hindi Splitter] Processing only content before "${stopMarker}": ${contentToProcess.length} characters`);
  } else {
    console.log(`[Hindi Splitter] Stop marker "${stopMarker}" not found, processing entire text`);
  }

  // Step 3: NCERT Hindi section headings to detect (before पाठ से)
  const ncertHeadings = [
    'कविता',
    'कहानी',
    'कवि से परिचय',
    'लेखक परिचय',
    'मातृभूमि',
    'बुद्धिमान हाथी',
    'शेर और चूहा',
    'लोमड़ी की चाल'
  ];

  // Step 4: Find all headings in the content
  const foundHeadings = [];
  ncertHeadings.forEach(heading => {
    let searchIndex = 0;
    let index;
    while ((index = contentToProcess.indexOf(heading, searchIndex)) !== -1) {
      foundHeadings.push({
        heading: heading,
        index: index
      });
      searchIndex = index + 1;
    }
  });

  // Step 5: Sort by position
  foundHeadings.sort((a, b) => a.index - b.index);

  console.log(`[Hindi Splitter] Found ${foundHeadings.length} headings`);
  foundHeadings.forEach(h => {
    console.log(`[Hindi Splitter] - "${h.heading}" at position ${h.index}`);
  });

  // Step 6: If headings found, split by them
  if (foundHeadings.length > 0) {
    console.log('[Hindi Splitter] Splitting by detected headings');
    return splitByHeadings(contentToProcess, foundHeadings);
  }

  // Step 7: Fallback - treat entire content as single section
  console.log('[Hindi Splitter] No headings found, treating as single section');
  return [{
    sectionNumber: '1',
    sectionTitle: 'Content',
    sectionType: isPoem(contentToProcess) ? 'poem' : 'story',
    content: contentToProcess.trim(),
    metadata: {
      wordCount: contentToProcess.split(/\s+/).length,
      contentType: isPoem(contentToProcess) ? 'poem' : 'story'
    }
  }];
}

/**
 * Split content by detected headings
 * @param {string} text - Text to split
 * @param {Array} headings - Array of {heading, index} objects
 * @returns {Array} - Array of section objects
 */
function splitByHeadings(text, headings) {
  const sections = [];
  let sectionNumber = '1';

  for (let i = 0; i < headings.length; i++) {
    const currentHeading = headings[i];
    const nextHeading = headings[i + 1];

    // Extract content between current heading and next heading
    const contentStart = currentHeading.index + currentHeading.heading.length;
    const contentEnd = nextHeading ? nextHeading.index : text.length;
    
    const sectionContent = text.substring(contentStart, contentEnd).trim();

    if (sectionContent.length > 0) {
      console.log(`[Hindi Splitter] Creating section: "${currentHeading.heading}" (${sectionContent.length} chars)`);
      
      sections.push({
        sectionNumber: sectionNumber,
        sectionTitle: currentHeading.heading,
        sectionType: isPoem(sectionContent) ? 'poem' : 'content',
        content: sectionContent,
        metadata: {
          wordCount: sectionContent.split(/\s+/).length,
          contentType: isPoem(sectionContent) ? 'poem' : 'content'
        }
      });
      sectionNumber = String(parseInt(sectionNumber) + 1);
    }
  }

  console.log(`[Hindi Splitter] Total sections created: ${sections.length}`);
  return sections;
}

/**
 * Split Hindi book with custom section titles
 * Allows frontend to specify exact section boundaries
 * @param {string} text - Full book text
 * @param {Array} sectionTitles - Array of section title strings
 * @returns {Array} - Array of section objects
 */
function splitHindiBookWithTitles(text, sectionTitles = []) {
  console.log(`[Hindi Splitter] Splitting with ${sectionTitles.length} custom section titles`);

  const cleanedText = cleanHindiText(text);
  const textWithoutExercises = removeExercises(cleanedText);

  const sections = [];
  let currentIndex = 0;
  let sectionNumber = '1';

  for (let i = 0; i < sectionTitles.length; i++) {
    const title = sectionTitles[i];
    
    // Find the position of this title in the text
    const titleIndex = textWithoutExercises.indexOf(title, currentIndex);
    
    if (titleIndex === -1) {
      console.warn(`[Hindi Splitter] Section title not found: "${title}"`);
      continue;
    }

    // Find the start of next section or end of text
    const nextTitleIndex = i < sectionTitles.length - 1 
      ? textWithoutExercises.indexOf(sectionTitles[i + 1], titleIndex + 1)
      : textWithoutExercises.length;

    const endIndex = nextTitleIndex === -1 ? textWithoutExercises.length : nextTitleIndex;
    
    // Extract section content (skip the title itself)
    const sectionContent = textWithoutExercises
      .substring(titleIndex + title.length, endIndex)
      .trim();

    if (sectionContent.length > 0) {
      sections.push({
        sectionNumber: sectionNumber,
        sectionTitle: title,
        sectionType: isPoem(sectionContent) ? 'poem' : 'story',
        content: sectionContent,
        metadata: {
          wordCount: sectionContent.split(/\s+/).length,
          contentType: isPoem(sectionContent) ? 'poem' : 'story'
        }
      });
      sectionNumber = String(parseInt(sectionNumber) + 1);
    }

    currentIndex = endIndex;
  }

  console.log(`[Hindi Splitter] Created ${sections.length} sections with custom titles`);
  return sections;
}

module.exports = {
  splitHindiBook,
  splitHindiBookByHeadings,
  splitByHeadings,
  splitHindiBookWithTitles,
  splitHindiChapters,
  splitByDetectedHeadings,
  chunkContent,
  removeExercises,
  cleanHindiText,
  isPoem,
  HINDI_STOP_HEADINGS
};
