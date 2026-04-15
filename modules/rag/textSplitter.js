const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const pdfParse = require('pdf-parse');
const ragConfig = require('./config');

async function extractTextWithPageInfo(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    const pages = [];

    // Extract text page by page
    for (let i = 0; i < data.numpages; i++) {
      pages.push({
        pageNumber: i + 1,
        text: data.text.split('\n').slice(i * 50, (i + 1) * 50).join('\n')
      });
    }

    return {
      totalPages: data.numpages,
      pages: pages,
      fullText: data.text
    };
  } catch (error) {
    console.error('[RAG] Error extracting text with page info:', error.message);
    throw error;
  }
}

function splitByPageRanges(fullText, pageRanges) {
  const sections = [];

  // Estimate average characters per page
  const lines = fullText.split('\n');
  const avgLinesPerPage = Math.ceil(lines.length / (pageRanges[pageRanges.length - 1].endPage || 1));

  for (let i = 0; i < pageRanges.length; i++) {
    const range = pageRanges[i];
    const startPage = range.startPage;
    const endPage = range.endPage;
    const title = range.title;

    // Calculate line positions based on page numbers
    const startLineIndex = (startPage - 1) * avgLinesPerPage;
    const endLineIndex = endPage * avgLinesPerPage;

    // Extract lines for this page range
    const sectionLines = lines.slice(startLineIndex, endLineIndex);
    const content = sectionLines.join('\n').trim();

    if (content.length > 0) {
      sections.push({
        sectionNumber: `${i + 1}`,
        title: title,
        content: content,
        pageRange: `${startPage}-${endPage}`
      });
    }
  }

  console.log(`[RAG] splitByPageRanges - Text split by PAGE_RANGES pattern: ${sections.length} sections created`);
  return sections.length > 0 ? sections : [{
    sectionNumber: '1',
    title: 'Full Chapter',
    content: fullText.trim()
  }];
}

function splitByManualAnchors(text, anchors) {
  const sections = [];
  const foundAnchors = [];

  // Find all anchor positions with flexible matching
  for (let i = 0; i < anchors.length; i++) {
    const searchTerm = anchors[i].start.toLowerCase();
    const regex = new RegExp(searchTerm.replace(/\s+/g, '\\s+'), 'i');
    const match = regex.exec(text);

    if (match) {
      foundAnchors.push({
        index: i,
        position: match.index,
        endPosition: match.index + match[0].length,
        title: anchors[i].title
      });
    }
  }

  // Sort by position
  foundAnchors.sort((a, b) => a.position - b.position);

  // Extract sections between anchors
  for (let i = 0; i < foundAnchors.length; i++) {
    const startPos = foundAnchors[i].endPosition;
    const endPos = i < foundAnchors.length - 1 ? foundAnchors[i + 1].position : text.length;

    const content = text.substring(startPos, endPos).trim();

    if (content && content.length > 0) {
      sections.push({
        sectionNumber: `${i + 1}`,
        title: foundAnchors[i].title,
        content: content
      });
    }
  }

  console.log(`[RAG] splitByManualAnchors - Text split by MANUAL_ANCHORS pattern: ${sections.length} sections created`);
  return sections.length > 0 ? sections : [{
    sectionNumber: '1',
    title: 'Full Chapter',
    content: text.trim()
  }];
}

function splitByRegex(text, regex) {
  const sections = [];
  const matches = [];
  let match;
  const seenSectionNumbers = new Set();

  const imagePatterns = /^\s*(?:figure|fig|image|img|photo|plate|diagram|chart|graph|table|exhibit|illustration|picture|visual|graphic|map|sketch|drawing|appendix|annex|attachment|box|sidebar|infobox)\s*[\d\.\s]*:?/i;

  // Split text into lines for better title extraction
  const lines = text.split('\n');

  while ((match = regex.exec(text)) !== null) {
    const fullMatch = match[0].trim();

    if (imagePatterns.test(fullMatch)) {
      console.log(`[RAG] Skipping image/figure reference: "${fullMatch}"`);
      continue;
    }

    const numberMatch = fullMatch.match(/^(\d+(?:\.\d+)*)\s*[:|-]?\s*(.*)$/);
    const sectionNumber = numberMatch ? numberMatch[1] : fullMatch;
    let sectionTitle = numberMatch && numberMatch[2] ? numberMatch[2].trim() : fullMatch;

    // Clean up tabs and extra whitespace
    sectionTitle = sectionTitle.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();

    // Remove trailing numbers
    sectionTitle = sectionTitle.replace(/\d+\.\d+(?:\.\d+)*\s*$/g, '').trim();
    const parts = sectionTitle.split(/\d+\.\d+(?:\.\d+)*\s*/);
    if (parts.length > 1) {
      const meaningfulParts = parts.filter(p => p.trim().length > 0);
      if (meaningfulParts.length > 0) {
        sectionTitle = meaningfulParts[0].trim();
      }
    }

    sectionTitle = sectionTitle.replace(/[\d\.\s]+$/g, '').trim();

    // VALIDATION 1: Title must start with uppercase letter
    if (sectionTitle.length > 0 && sectionTitle[0] !== sectionTitle[0].toUpperCase()) {
      console.log(`[RAG] Skipping section ${sectionNumber} - title doesn't start with uppercase: "${sectionTitle}"`);
      continue;
    }

    // VALIDATION 2: Title must have minimum length and not be just punctuation
    if (sectionTitle.length < 3 || /^[\d.\s\-:,;|]*$/.test(sectionTitle)) {
      console.log(`[RAG] Skipping section ${sectionNumber} - invalid title: "${sectionTitle}"`);
      continue;
    }

    // VALIDATION 3: Check if title looks incomplete (ends with preposition or conjunction)
    const incompleteTitlePattern = /\b(in|on|at|to|for|of|and|or|but|with|from|by|the|a|an|different|various|several|many|some|other)\s*$/i;
    if (incompleteTitlePattern.test(sectionTitle)) {
      console.log(`[RAG] Title appears incomplete: "${sectionTitle}", attempting to find continuation...`);

      // Find the line in the original text and check next line
      const matchLineIndex = text.substring(0, match.index).split('\n').length - 1;
      if (matchLineIndex + 1 < lines.length) {
        const nextLine = lines[matchLineIndex + 1].trim();

        // If next line starts with uppercase and is not a section number, it's likely a continuation
        if (nextLine.length > 0 &&
            nextLine[0] === nextLine[0].toUpperCase() &&
            !nextLine.match(/^\d+\.\d+/)) {

          // Extract the first word or phrase from next line (likely the rest of the title)
          // Look for the first complete word (up to punctuation or lowercase word)
          const continuationMatch = nextLine.match(/^([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
          if (continuationMatch) {
            const continuation = continuationMatch[1].trim();
            sectionTitle = `${sectionTitle} ${continuation}`.trim();
            console.log(`[RAG] Extended title to: "${sectionTitle}"`);
          } else {
            // Fallback: take first word only
            const firstWord = nextLine.split(/\s+/)[0];
            if (firstWord && firstWord[0] === firstWord[0].toUpperCase()) {
              sectionTitle = `${sectionTitle} ${firstWord}`.trim();
              console.log(`[RAG] Extended title to: "${sectionTitle}"`);
            }
          }
        }
      }
    }

    if (seenSectionNumbers.has(sectionNumber)) {
      console.log(`[RAG] Skipping duplicate section ${sectionNumber} - already processed`);
      continue;
    }
    seenSectionNumbers.add(sectionNumber);

    console.log(`[RAG] Found section ${sectionNumber} with title: "${sectionTitle}"`);

    matches.push({
      sectionNumber: sectionNumber,
      sectionTitle: sectionTitle,
      startIndex: match.index,
      headerEndIndex: match.index + match[0].length
    });
  }

  if (matches.length === 0) {
    return [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];
  }

  if (matches[0].startIndex > 0) {
    const preContent = text.substring(0, matches[0].startIndex).trim();
    if (preContent.length > 0) {
      const firstSectionNumber = matches[0].sectionNumber;
      const chapterNumber = firstSectionNumber.split('.')[0];

      const firstSectionTitle = matches[0].sectionTitle.toLowerCase();
      const isFirstSectionIntroduction = /introduction|preface|preamble|foreword|prologue/.test(firstSectionTitle);

      // Only create X.0 introduction if first section is NOT already an introduction
      if (!isFirstSectionIntroduction) {
        sections.push({
          sectionNumber: `${chapterNumber}.0`,
          title: 'Introduction',
          content: preContent
        });
      } else {
        console.log(`[RAG] Skipping X.0 introduction - first section "${matches[0].sectionTitle}" is already an introduction`);
      }
    }
  }

  matches.forEach((match, index) => {
    const contentStart = match.headerEndIndex;
    const contentEnd = index < matches.length - 1 ? matches[index + 1].startIndex : text.length;

    const sectionContent = text.substring(contentStart, contentEnd).trim();

    if (sectionContent.length > 0) {
      sections.push({
        sectionNumber: match.sectionNumber,
        title: match.sectionTitle,
        content: sectionContent
      });
    }
  });

  return sections;
}

function splitByHeadings(text, sectionTitles = []) {
  if (!Array.isArray(sectionTitles) || sectionTitles.length === 0) {
    console.log('[RAG] No section titles provided. Returning full chapter.');
    return [{
      sectionNumber: '1',
      sectionTitle: 'Full Chapter',
      content: text.trim()
    }];
  }

  // Helper function to normalize text for matching
  function normalizeForMatching(str) {
    return str
      .toLowerCase()
      .replace(/\s+/g, ' ')           // normalize whitespace
      .replace(/[^\w\s]/g, '')        // remove special chars
      .trim();
  }

  const matches = [];

  for (let i = 0; i < sectionTitles.length; i++) {
    const title = sectionTitles[i].trim();
    const normalizedTitle = normalizeForMatching(title);

    // Try multiple matching strategies
    let match = null;
    let matchStrategy = null;

    // Strategy 1: Exact match with flexible whitespace
    let escapedTitle = title
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // escape regex chars
      .replace(/\s+/g, '\\s+');                  // flexible whitespace
    let regex = new RegExp(escapedTitle, 'i');
    match = regex.exec(text);
    if (match) matchStrategy = 'exact with flexible whitespace';

    // Strategy 2: If not found, try word-by-word matching (handles line breaks)
    if (!match) {
      const words = title.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 0) {
        // Create regex that allows any whitespace/newlines between words
        const wordPattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        regex = new RegExp(wordPattern, 'i');
        match = regex.exec(text);
        if (match) matchStrategy = 'word-by-word with flexible spacing';
      }
    }

    // Strategy 3: If still not found, try normalized matching (removes special chars)
    if (!match) {
      const normalizedText = normalizeForMatching(text);
      const index = normalizedText.indexOf(normalizedTitle);
      if (index !== -1) {
        // Find the original position in the non-normalized text
        // We need to find where this normalized text appears in the original
        let charCount = 0;
        let normalizedCount = 0;
        for (let j = 0; j < text.length; j++) {
          const char = text[j];
          const normalizedChar = normalizeForMatching(char);
          if (normalizedCount === index) {
            charCount = j;
            break;
          }
          if (normalizedChar.length > 0) {
            normalizedCount += normalizedChar.length;
          }
        }
        // Create a fake match object
        match = {
          index: charCount,
          0: title,
          length: title.length
        };
        matchStrategy = 'normalized text matching (special chars removed)';
      }
    }

    // Strategy 4: If still not found, try partial matching (first 3+ words)
    if (!match && title.split(/\s+/).length > 2) {
      const firstWords = title.split(/\s+/).slice(0, 3).join('\\s+');
      regex = new RegExp(firstWords, 'i');
      match = regex.exec(text);
      if (match) matchStrategy = 'partial match (first 3 words)';
    }

    // Strategy 5: Fuzzy matching - search for all words in order (case-insensitive)
    if (!match) {
      const words = title.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 0) {
        // Create pattern that finds all words in order with any content between them
        const fuzzyPattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*?');
        regex = new RegExp(fuzzyPattern, 'i');
        match = regex.exec(text);
        if (match) matchStrategy = 'fuzzy matching (words in order)';
      }
    }

    if (match) {
      console.log(`[RAG] Found title "${title}" at position ${match.index} using strategy: ${matchStrategy}`);
      matches.push({
        title,
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    } else {
      console.warn(`[RAG] Title not found in text: "${title}"`);
      // Log a sample of text for debugging
      const textSample = text.substring(0, 1000);
      console.log(`[RAG] First 1000 chars of text:\n${textSample}`);
      console.log(`[RAG] Normalized title: "${normalizedTitle}"`);
    }
  }

  if (matches.length === 0) {
    console.log('[RAG] No matching headings found. Returning full chapter.');
    return [{
      sectionNumber: '1',
      sectionTitle: 'Full Chapter',
      content: text.trim()
    }];
  }

  // Sort by position in text
  matches.sort((a, b) => a.startIndex - b.startIndex);

  const sections = [];

  matches.forEach((match, index) => {
    const contentStart = match.endIndex;
    const contentEnd =
      index < matches.length - 1
        ? matches[index + 1].startIndex
        : text.length;

    const content = text.substring(contentStart, contentEnd).trim();

    // Create section even if content is empty (for last sections)
    // This ensures all provided section titles are created
    sections.push({
      sectionNumber: `${index + 1}`,
      sectionTitle: match.title,
      content: content.length > 0 ? content : `[No content found for section: ${match.title}]`
    });
  });

  console.log(`[RAG] splitByHeadings - ${sections.length} sections created using UI-provided titles`);

  return sections;
}

function splitByChaptersAndSections(text) {
  const sections = [];

  // Find all chapters (CHAPTER 1, CHAPTER 2, etc.)
  const chapterRegex = /CHAPTER\s+(\d+)/gi;
  const chapters = [];
  let chapterMatch;

  while ((chapterMatch = chapterRegex.exec(text)) !== null) {
    chapters.push({
      chapterNumber: parseInt(chapterMatch[1]),
      position: chapterMatch.index,
      endPosition: chapterMatch.index + chapterMatch[0].length,
      title: chapterMatch[0].trim()
    });
  }

  if (chapters.length === 0) {
    // No chapters found, fall back to unit-based splitting
    return splitByManualAnchors(text, [
      { title: 'The Day the River Spoke', start: 'The Day the River Spoke' },
      { title: 'Try Again', start: 'Try Again' },
      { title: 'Three Days to See', start: 'Three Days to See' }
    ]);
  }

  // Extract content for each chapter
  for (let i = 0; i < chapters.length; i++) {
    const chapterStart = chapters[i].endPosition;
    const chapterEnd = i < chapters.length - 1 ? chapters[i + 1].position : text.length;
    const chapterContent = text.substring(chapterStart, chapterEnd).trim();
    const chapterNumber = chapters[i].chapterNumber;

    // Find sections within this chapter using decimal numbering (1.1, 1.2, 2.1, etc.)
    // Match patterns like "1.1", "1.2", "2.1" at the start of a line or after whitespace
    const sectionRegex = /^\s*(\d+)\.(\d+)\s*[:|-]?\s*(.+?)$/gm;
    const sectionMatches = [];
    let sectionMatch;

    while ((sectionMatch = sectionRegex.exec(chapterContent)) !== null) {
      const matchChapterNum = parseInt(sectionMatch[1]);
      const matchSectionNum = parseInt(sectionMatch[2]);

      // Only include sections that belong to this chapter
      if (matchChapterNum === chapterNumber) {
        sectionMatches.push({
          chapterNumber: matchChapterNum,
          sectionNumber: matchSectionNum,
          sectionName: sectionMatch[3]?.trim() || `Section ${matchSectionNum}`,
          position: sectionMatch.index,
          endPosition: sectionMatch.index + sectionMatch[0].length,
          fullTitle: sectionMatch[0].trim()
        });
      }
    }

    if (sectionMatches.length === 0) {
      // No sections found in chapter, treat entire chapter as one section
      sections.push({
        sectionNumber: `${chapterNumber}.0`,
        title: `Chapter ${chapterNumber}`,
        content: chapterContent
      });
    } else {
      // Sort sections by section number
      sectionMatches.sort((a, b) => a.sectionNumber - b.sectionNumber);

      // Check if there's content before the first section
      if (sectionMatches[0].position > 0) {
        const preContent = chapterContent.substring(0, sectionMatches[0].position).trim();
        if (preContent.length > 0) {
          sections.push({
            sectionNumber: `${chapterNumber}.0`,
            title: `Chapter ${chapterNumber} - Introduction`,
            content: preContent
          });
        }
      }

      // Extract content for each section
      for (let j = 0; j < sectionMatches.length; j++) {
        const sectionStart = sectionMatches[j].endPosition;
        const sectionEnd = j < sectionMatches.length - 1 ? sectionMatches[j].position : chapterContent.length;
        const sectionContent = chapterContent.substring(sectionStart, sectionEnd).trim();
        const sectionNumber = sectionMatches[j].sectionNumber;
        const sectionName = sectionMatches[j].sectionName;

        if (sectionContent.length > 0) {
          sections.push({
            sectionNumber: `${chapterNumber}.${sectionNumber}`,
            title: sectionName,
            content: sectionContent
          });
        }
      }
    }
  }

  console.log(`[RAG] splitByChaptersAndSections - Text split by CHAPTER_BASED pattern: ${sections.length} sections created`);
  return sections.length > 0 ? sections : [{
    sectionNumber: '1',
    title: 'Full Chapter',
    content: text.trim()
  }];
}

function splitByDetectedPattern(text) {
  const pattern = 'HEADING_BASED';

  // Manual anchors for CHAPTER-based books
  const chapterAnchors = [];
  for (let i = 1; i <= 50; i++) {
    chapterAnchors.push({
      title: `CHAPTER ${i}`,
      start: `CHAPTER ${i}`
    });
  }

  // Manual anchors for LESSON-based books
  const lessonAnchors = [];
  for (let i = 1; i <= 50; i++) {
    lessonAnchors.push({
      title: `LESSON ${i}`,
      start: `LESSON ${i}`
    });
  }

  switch (pattern) {
  case 'HEADING_BASED':
    return splitByHeadings(text);

  case 'CHAPTER_BASED':
    return splitByChaptersAndSections(text);

  case 'LESSON_BASED':
    return splitByManualAnchors(text, lessonAnchors);

  case 'NUMBERED_DECIMAL':
    return splitByRegex(text, /^\s*(\d+\.\d+(?:\.\d+)*.*?)$/gm);
  case 'NUMBERED_SIMPLE':
    return splitByRegex(text, /^\s*(\d+\.\s+.*?)$/gm);

  default:
    return [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];
  }
}

/**
 * Split TN State Board Math books with chapter and section detection
 * Detects both chapter numbers (1, 2, 3...) and section numbers (1.1, 1.2, 1.3...)
 * Optionally filters to only include specified chapters and sections
 * 
 * @param {string} text - The full text of the book
 * @param {Array} chapterSections - Optional array of {chapterNumber, sections: [1, 2, 3]} to filter
 * @returns {Array} Array of sections with sectionNumber, title, and content
 */
function splitTNMathBook(text, chapterSections = null) {
  try {
    console.log('[RAG] splitTNMathBook - Analyzing TN Math book with chapter and section detection');
    
    if (chapterSections && Array.isArray(chapterSections) && chapterSections.length > 0) {
      console.log('[RAG] splitTNMathBook - Filtering to specific chapters and sections:', 
        chapterSections.map(c => `Chapter ${c.chapterNumber}: sections [${c.sections.join(', ')}]`).join('; '));
    }

    const sections = [];
    const seenSectionNumbers = new Set();

    // Step 1: Detect chapters (pattern: "1 SET LANGUAGE", "2 REAL NUMBERS", etc.)
    // Enhanced regex to capture chapter titles with various formats
    const chapterRegex = /^\s*(\d+)\s+([A-Z][A-Za-z\s\-&:,()]+?)(?=\n|$)/gm;
    const chapters = [];
    let chapterMatch;

    console.log('[RAG] DEBUG: Searching for chapters with regex...');
    const textSample = text.substring(0, 2000);
    console.log('[RAG] DEBUG: First 2000 chars sample:\n', textSample);

    while ((chapterMatch = chapterRegex.exec(text)) !== null) {
      const chapterNum = parseInt(chapterMatch[1]);
      const chapterTitle = chapterMatch[2].trim();
      
      // Filter out false matches:
      // 1. Chapter numbers should be 1-14 (TN Math typically has 14 chapters max)
      // 2. "1.1 Introduction" (section, not chapter) - starts with digit.digit
      // 3. "Part 1", "Part 2", etc. - generic part labels
      // 4. "Learning Objectives", "CHAPTER", etc. - metadata
      // 5. Too short titles (< 4 chars)
      // 6. Titles that are just numbers or single letters (like "C", "O", "Mg", "Al")
      const isValidChapter = chapterNum >= 1 && chapterNum <= 14 &&
                            chapterTitle.length > 3 && 
                            !chapterTitle.match(/^\d+\./) &&
                            !chapterTitle.match(/^Part\s+\d+$/i) &&
                            !chapterTitle.match(/^(Learning|CHAPTER|Introduction|Contents?|Index|Glossary|Practicals?|Appendix)/i) &&
                            !chapterTitle.match(/^[A-Z]{1,2}(\s|$)/) && // Filter single/double letter elements
                            !chapterTitle.match(/^[A-Z][a-z]?\s*\d+/) && // Filter "C 2", "O 2", etc.
                            !chapterTitle.match(/^(Hz|Pa|V|A|K|C|O|N|H|He|Li|Be|Ne|Na|Mg|Al|Si|Cl|Ar|Ca|Cr|Co|Mg|Ni|Cu|Zn|Br|Ag|Sn|I|Pb|Au|Hg|Pb|U|Os|Pt|Au|Hg|Pb|Bi|Po|At|Rn|Fr|Ra|Ac|Th|Pa|U|Np|Pu|Am|Cm|Bk|Cf|Es|Fm|Md|No|Lr|Rf|Db|Sg|Bh|Hs|Mt|Ds|Rg|Cn|Nh|Fl|Mc|Lv|Ts|Og)(\s|$)/i); // Filter chemical symbols
      
      if (isValidChapter) {
        chapters.push({
          chapterNumber: chapterNum,
          chapterTitle: chapterTitle,
          position: chapterMatch.index,
          endPosition: chapterMatch.index + chapterMatch[0].length
        });
        
        console.log(`[RAG] Found chapter ${chapterNum}: "${chapterTitle}"`);
      } else {
        console.log(`[RAG] DEBUG: Filtered out false match - Chapter ${chapterNum}: "${chapterTitle}" (reason: chapterNum=${chapterNum}, titleLen=${chapterTitle.length})`);
      }
    }

    console.log(`[RAG] DEBUG: Detected ${chapters.length} valid chapters total`);

    if (chapters.length === 0) {
      console.log('[RAG] No chapters detected, falling back to section-only splitting');
      return splitBySections(text);
    }

    // Build filter map if chapterSections provided
    const filterMap = {};
    if (chapterSections && Array.isArray(chapterSections) && chapterSections.length > 0) {
      for (const cs of chapterSections) {
        const chNum = cs.chapterNumber;
        filterMap[chNum] = new Set(cs.sections.map(s => parseInt(s)));
      }
      console.log('[RAG] Filter map created:', Object.entries(filterMap).map(([ch, secs]) => 
        `Chapter ${ch}: [${Array.from(secs).join(', ')}]`).join('; '));
    }

    // Step 2: For each chapter, detect sections (pattern: "1.1 Introduction", "1.2 Set", etc.)
    for (let i = 0; i < chapters.length; i++) {
      const chapterStart = chapters[i].endPosition;
      const chapterEnd = i < chapters.length - 1 ? chapters[i + 1].position : text.length;
      const chapterContent = text.substring(chapterStart, chapterEnd);
      const chapterNumber = chapters[i].chapterNumber;
      const chapterTitle = chapters[i].chapterTitle;

      // Skip chapter if filtering and chapter not in filter
      if (filterMap && !filterMap[chapterNumber]) {
        console.log(`[RAG] Skipping chapter ${chapterNumber} (not in filter)`);
        continue;
      }

      console.log(`[RAG] Processing chapter ${chapterNumber}: "${chapterTitle}"`);

      // Find sections within this chapter using decimal numbering (1.1, 1.2, 1.3, etc.)
      // Match patterns like "1.1 Introduction", "1.2 Set" at the start of a line
      // Enhanced regex to capture section titles with various formats
      const sectionRegex = /^\s*(\d+)\.(\d+)\s*[:|-]?\s*([a-zA-Z][a-zA-Z\s\-&:,()]+?)(?:\s*\n|$)/gm;
      const sectionMatches = [];
      let sectionMatch;

      console.log(`[RAG] DEBUG: Searching for sections in chapter ${chapterNumber}...`);
      console.log(`[RAG] DEBUG: First 500 chars of chapter content:\n`, chapterContent.substring(0, 500));

      while ((sectionMatch = sectionRegex.exec(chapterContent)) !== null) {
        const matchChapterNum = parseInt(sectionMatch[1]);
        const matchSectionNum = parseInt(sectionMatch[2]);
        const sectionTitle = sectionMatch[3].trim();

        console.log(`[RAG] DEBUG: Regex match found: "${sectionMatch[0]}" -> Chapter ${matchChapterNum}, Section ${matchSectionNum}, Title: "${sectionTitle}"`);

        // Only include sections that belong to this chapter
        if (matchChapterNum === chapterNumber) {
          // If filtering, only include sections in the filter
          if (filterMap && filterMap[chapterNumber] && !filterMap[chapterNumber].has(matchSectionNum)) {
            console.log(`[RAG] Skipping section ${matchChapterNum}.${matchSectionNum} (not in filter)`);
            continue;
          }

          sectionMatches.push({
            chapterNumber: matchChapterNum,
            sectionNumber: matchSectionNum,
            sectionTitle: sectionTitle,
            position: sectionMatch.index,
            endPosition: sectionMatch.index + sectionMatch[0].length,
            fullMatch: sectionMatch[0].trim()
          });

          console.log(`[RAG] Found section ${matchChapterNum}.${matchSectionNum}: "${sectionTitle}"`);
        }
      }

      console.log(`[RAG] DEBUG: Found ${sectionMatches.length} sections in chapter ${chapterNumber}`);

      if (sectionMatches.length === 0) {
        // No sections found in chapter, treat entire chapter as one section (only if not filtering)
        if (!filterMap || !filterMap[chapterNumber]) {
          console.log(`[RAG] No sections found in chapter ${chapterNumber}, treating as single section`);
          
          const sectionNumber = `${chapterNumber}.0`;
          if (!seenSectionNumbers.has(sectionNumber)) {
            sections.push({
              sectionNumber: sectionNumber,
              title: chapterTitle,
              content: chapterContent.trim()
            });
            seenSectionNumbers.add(sectionNumber);
          }
        } else {
          console.log(`[RAG] No matching sections found in chapter ${chapterNumber} (all filtered out)`);
        }
      } else {
        // Sort sections by section number
        sectionMatches.sort((a, b) => a.sectionNumber - b.sectionNumber);

        // Check if there's content before the first section (introduction)
        if (sectionMatches[0].position > 0) {
          const preContent = chapterContent.substring(0, sectionMatches[0].position).trim();
          if (preContent.length > 50) {
            const introNumber = `${chapterNumber}.0`;
            if (!seenSectionNumbers.has(introNumber)) {
              sections.push({
                sectionNumber: introNumber,
                title: `${chapterTitle} - Introduction`,
                content: preContent
              });
              seenSectionNumbers.add(introNumber);
              console.log(`[RAG] Added introduction for chapter ${chapterNumber}`);
            }
          }
        }

        // Extract content for each section
        for (let j = 0; j < sectionMatches.length; j++) {
          const sectionStart = sectionMatches[j].endPosition;
          const sectionEnd = j < sectionMatches.length - 1 
            ? sectionMatches[j + 1].position 
            : chapterContent.length;
          
          const sectionContent = chapterContent.substring(sectionStart, sectionEnd).trim();
          const sectionNumber = `${sectionMatches[j].chapterNumber}.${sectionMatches[j].sectionNumber}`;
          const sectionTitle = sectionMatches[j].sectionTitle;

          if (sectionContent.length > 0 && !seenSectionNumbers.has(sectionNumber)) {
            sections.push({
              sectionNumber: sectionNumber,
              title: sectionTitle,
              content: sectionContent
            });
            seenSectionNumbers.add(sectionNumber);
            console.log(`[RAG] Added section ${sectionNumber}: "${sectionTitle}" (${sectionContent.length} chars)`);
          }
        }
      }
    }

    console.log(`[RAG] splitTNMathBook - Successfully split into ${sections.length} sections`);
    return sections.length > 0 ? sections : [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];

  } catch (error) {
    console.error('[RAG] Error in splitTNMathBook:', error.message);
    console.log('[RAG] Falling back to standard section splitting');
    return splitBySections(text);
  }
}

/**
 * Split TN State Board Science books (8th, 9th, 10th) with unit and section detection
 * Detects both unit numbers (1, 2, 3...) and section numbers (1.1, 1.2, 1.3...)
 * Optionally filters to only include specified units and sections
 * 
 * @param {string} text - The full text of the book
 * @param {Array} unitSections - Optional array of {unitNumber, sections: [1, 2, 3]} to filter
 * @returns {Array} Array of sections with sectionNumber, title, and content
 */
function splitTNScienceBook(text, unitSections = null) {
  try {
    console.log('[RAG] splitTNScienceBook - Analyzing TN Science book with unit and section detection');
    
    if (unitSections && Array.isArray(unitSections) && unitSections.length > 0) {
      console.log('[RAG] splitTNScienceBook - Filtering to specific units and sections:', 
        unitSections.map(u => `Unit ${u.unitNumber}: sections [${u.sections.join(', ')}]`).join('; '));
    }

    const sections = [];
    const seenSectionNumbers = new Set();

    // Skip table of contents and front matter
    // Look for the first actual unit header (usually "1 Measurement" or similar)
    // Table of contents typically ends before the first unit starts
    let contentStartIndex = 0;
    const tocEndRegex = /(?:Table of Contents?|Practicals?|Glossary|Index)[\s\S]*?(?=\n\s*\n\s*\n)/i;
    const tocMatch = tocEndRegex.exec(text);
    if (tocMatch) {
      contentStartIndex = tocMatch.index + tocMatch[0].length;
      console.log('[RAG] DEBUG: Skipping table of contents (first ${contentStartIndex} characters)');
    }
    
    const contentText = text.substring(contentStartIndex);

    // Step 1: Detect units (pattern: "1 Measurement", "2 Motion", etc.)
    // Units are typically at the start of a line with just number and title
    // The title should be at least 4 characters and not start with a digit (to avoid "1.1 Introduction")
    // Also filter out common false positives like "Part 1", "Part 2", etc.
    const unitRegex = /^\s*(\d+)\s+([A-Z][A-Za-z\s\-&:,()]+?)(?=\n|$)/gm;
    const units = [];
    let unitMatch;

    console.log('[RAG] DEBUG: Searching for units with regex...');
    const textSample = contentText.substring(0, 2000);
    console.log('[RAG] DEBUG: First 2000 chars of content (after TOC):\n', textSample);

    while ((unitMatch = unitRegex.exec(contentText)) !== null) {
      const unitNum = parseInt(unitMatch[1]);
      const unitTitle = unitMatch[2].trim();
      
      // Filter out false matches:
      // 1. Unit numbers should be 1-25 (TN Science has 25 units max)
      // 2. "1.1 Introduction" (section, not unit) - starts with digit.digit
      // 3. "Part 1", "Part 2", etc. - generic part labels
      // 4. "Learning Objectives", "UNIT", etc. - metadata
      // 5. Too short titles (< 4 chars)
      // 6. Titles that are just numbers or single letters (like "C", "O", "Mg", "Al")
      const isValidUnit = unitNum >= 1 && unitNum <= 25 &&
                         unitTitle.length > 3 && 
                         !unitTitle.match(/^\d+\./) &&
                         !unitTitle.match(/^Part\s+\d+$/i) &&
                         !unitTitle.match(/^(Learning|UNIT|Introduction|Contents?|Index|Glossary|Practicals?|Appendix)/i) &&
                         !unitTitle.match(/^[A-Z]{1,2}(\s|$)/) && // Filter single/double letter elements
                         !unitTitle.match(/^[A-Z][a-z]?\s*\d+/) && // Filter "C 2", "O 2", etc.
                         !unitTitle.match(/^(Hz|Pa|V|A|K|C|O|N|H|He|Li|Be|Ne|Na|Mg|Al|Si|Cl|Ar|Ca|Cr|Co|Mg|Ni|Cu|Zn|Br|Ag|Sn|I|Pb|Au|Hg|Pb|U|Os|Pt|Au|Hg|Pb|Bi|Po|At|Rn|Fr|Ra|Ac|Th|Pa|U|Np|Pu|Am|Cm|Bk|Cf|Es|Fm|Md|No|Lr|Rf|Db|Sg|Bh|Hs|Mt|Ds|Rg|Cn|Nh|Fl|Mc|Lv|Ts|Og)(\s|$)/i); // Filter chemical symbols
      
      if (isValidUnit) {
        units.push({
          unitNumber: unitNum,
          unitTitle: unitTitle,
          position: contentStartIndex + unitMatch.index,
          endPosition: contentStartIndex + unitMatch.index + unitMatch[0].length
        });
        
        console.log(`[RAG] Found unit ${unitNum}: "${unitTitle}"`);
      } else {
        console.log(`[RAG] DEBUG: Filtered out false match - Unit ${unitNum}: "${unitTitle}" (reason: unitNum=${unitNum}, titleLen=${unitTitle.length})`);
      }
    }

    if (units.length === 0) {
      console.log('[RAG] No units detected, falling back to section-only splitting');
      return splitBySections(text);
    }

    console.log(`[RAG] DEBUG: Detected ${units.length} valid units total`);

    // Build filter map if unitSections provided
    const filterMap = {};
    if (unitSections && Array.isArray(unitSections) && unitSections.length > 0) {
      for (const us of unitSections) {
        const unitNum = us.unitNumber;
        filterMap[unitNum] = new Set(us.sections.map(s => parseInt(s)));
      }
      console.log('[RAG] Filter map created:', Object.entries(filterMap).map(([unit, secs]) => 
        `Unit ${unit}: [${Array.from(secs).join(', ')}]`).join('; '));
    }

    // Step 2: For each unit, detect sections (pattern: "1.1 Physical Quantities", "1.2 Units", etc.)
    for (let i = 0; i < units.length; i++) {
      const unitStart = units[i].endPosition;
      const unitEnd = i < units.length - 1 ? units[i + 1].position : text.length;
      const unitContent = text.substring(unitStart, unitEnd);
      const unitNumber = units[i].unitNumber;
      const unitTitle = units[i].unitTitle;

      // Skip unit if filtering and unit not in filter
      if (filterMap && !filterMap[unitNumber]) {
        console.log(`[RAG] Skipping unit ${unitNumber} (not in filter)`);
        continue;
      }

      console.log(`[RAG] Processing unit ${unitNumber}: "${unitTitle}"`);
      console.log(`[RAG] DEBUG: Unit content length: ${unitContent.length} chars`);
      console.log(`[RAG] DEBUG: First 500 chars of unit content:\n`, unitContent.substring(0, 500));

      // Find sections within this unit using decimal numbering (1.1, 1.2, 1.3, etc.)
      // Match patterns like "1.1 Physical Quantities", "1.2 Units" at the start of a line
      // Enhanced regex to capture section titles with various formats
      const sectionRegex = /^\s*(\d+)\.(\d+)\s*[:|-]?\s*([a-zA-Z][a-zA-Z\s\-&:,()]+?)(?:\s*\n|$)/gm;
      const sectionMatches = [];
      let sectionMatch;

      console.log(`[RAG] DEBUG: Searching for sections in unit ${unitNumber}...`);

      while ((sectionMatch = sectionRegex.exec(unitContent)) !== null) {
        const matchUnitNum = parseInt(sectionMatch[1]);
        const matchSectionNum = parseInt(sectionMatch[2]);
        const sectionTitle = sectionMatch[3].trim();

        console.log(`[RAG] DEBUG: Regex match found: "${sectionMatch[0]}" -> Unit ${matchUnitNum}, Section ${matchSectionNum}, Title: "${sectionTitle}"`);

        // Only include sections that belong to this unit
        if (matchUnitNum === unitNumber) {
          // If filtering, only include sections in the filter
          if (filterMap && filterMap[unitNumber] && !filterMap[unitNumber].has(matchSectionNum)) {
            console.log(`[RAG] Skipping section ${matchUnitNum}.${matchSectionNum} (not in filter)`);
            continue;
          }

          sectionMatches.push({
            unitNumber: matchUnitNum,
            sectionNumber: matchSectionNum,
            sectionTitle: sectionTitle,
            position: sectionMatch.index,
            endPosition: sectionMatch.index + sectionMatch[0].length,
            fullMatch: sectionMatch[0].trim()
          });

          console.log(`[RAG] Found section ${matchUnitNum}.${matchSectionNum}: "${sectionTitle}"`);
        }
      }

      console.log(`[RAG] DEBUG: Found ${sectionMatches.length} sections in unit ${unitNumber}`);

      if (sectionMatches.length === 0) {
        // No sections found in unit, treat entire unit as one section (only if not filtering)
        if (!filterMap || !filterMap[unitNumber]) {
          console.log(`[RAG] No sections found in unit ${unitNumber}, treating as single section`);
          
          const sectionNumber = `${unitNumber}.0`;
          if (!seenSectionNumbers.has(sectionNumber)) {
            sections.push({
              sectionNumber: sectionNumber,
              title: unitTitle,
              content: unitContent.trim()
            });
            seenSectionNumbers.add(sectionNumber);
          }
        } else {
          console.log(`[RAG] No matching sections found in unit ${unitNumber} (all filtered out)`);
        }
      } else {
        // Sort sections by section number
        sectionMatches.sort((a, b) => a.sectionNumber - b.sectionNumber);

        // Check if there's content before the first section (introduction)
        if (sectionMatches[0].position > 0) {
          const preContent = unitContent.substring(0, sectionMatches[0].position).trim();
          if (preContent.length > 50) {
            const introNumber = `${unitNumber}.0`;
            if (!seenSectionNumbers.has(introNumber)) {
              sections.push({
                sectionNumber: introNumber,
                title: `${unitTitle} - Introduction`,
                content: preContent
              });
              seenSectionNumbers.add(introNumber);
              console.log(`[RAG] Added introduction for unit ${unitNumber}`);
            }
          }
        }

        // Extract content for each section
        for (let j = 0; j < sectionMatches.length; j++) {
          const sectionStart = sectionMatches[j].endPosition;
          const sectionEnd = j < sectionMatches.length - 1 
            ? sectionMatches[j + 1].position 
            : unitContent.length;
          
          const sectionContent = unitContent.substring(sectionStart, sectionEnd).trim();
          const sectionNumber = `${sectionMatches[j].unitNumber}.${sectionMatches[j].sectionNumber}`;
          const sectionTitle = sectionMatches[j].sectionTitle;

          if (sectionContent.length > 0 && !seenSectionNumbers.has(sectionNumber)) {
            sections.push({
              sectionNumber: sectionNumber,
              title: sectionTitle,
              content: sectionContent
            });
            seenSectionNumbers.add(sectionNumber);
            console.log(`[RAG] Added section ${sectionNumber}: "${sectionTitle}" (${sectionContent.length} chars)`);
          }
        }
      }
    }

    console.log(`[RAG] splitTNScienceBook - Successfully split into ${sections.length} sections`);
    return sections.length > 0 ? sections : [{
      sectionNumber: '1',
      title: 'Full Unit',
      content: text.trim()
    }];

  } catch (error) {
    console.error('[RAG] Error in splitTNScienceBook:', error.message);
    console.log('[RAG] Falling back to standard section splitting');
    return splitBySections(text);
  }
}

function splitBySections(text) {
  try {
    // Improved regex pattern:
    // - Matches section numbers like 1.1, 1.2, 2.1 (max 2 decimal levels)
    // - Requires at least one letter after the number (to avoid matching pure decimals like 0.142857)
    // - Requires meaningful text following the number (not just punctuation)
    // - Negative lookahead (?![a-zA-Z]) ensures number isn't part of a larger word
    const sectionRegex = /^\s*(\d+\.\d+)(?!\d)(?![a-zA-Z])\s*[:|-]?\s*([a-zA-Z].+?)$/gm;
    const sections = splitByRegex(text, sectionRegex);
    console.log(`[RAG] splitBySections - Text split by REGEX_BASED pattern: ${sections.length} sections created`);
    return sections;
  } catch (error) {
    console.error('[RAG] Error in splitBySections:', error.message);
    // Fallback to treating entire text as one section
    return [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];
  }
}

async function splitTextWithLangChain(text, chunkSize = null, chunkOverlap = null) {
  try {
    const size = chunkSize || ragConfig.textSplitter.chunkSize;
    const overlap = chunkOverlap || ragConfig.textSplitter.chunkOverlap;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: size,
      chunkOverlap: overlap,
      separators: ['\n\n', '\n', ' ', '']
    });

    const chunks = await splitter.splitText(text);
    return chunks;
  } catch (error) {
    console.error('[RAG] Error splitting text with LangChain:', error.message);
    throw error;
  }
}

/**
 * Split text based on token count (~2000 tokens per chunk)
 * Used for direct_upload pattern to create chunks without structural splitting
 * Estimates tokens using character count (rough approximation: 1 token ≈ 4 characters)
 * 
 * @param {string} text - The text to split
 * @param {number} targetTokens - Target tokens per chunk (default: 2000)
 * @returns {Promise<Array>} Array of text chunks
 */
async function splitTextByTokenCount(text, targetTokens = 2000) {
  try {
    console.log(`[RAG] splitTextByTokenCount - START with targetTokens: ${targetTokens}`);
    
    // Rough token estimation: 1 token ≈ 4 characters
    // For safety, use 3.5 characters per token (more conservative)
    const CHARS_PER_TOKEN = 3.5;
    const targetChunkSize = Math.floor(targetTokens * CHARS_PER_TOKEN);
    const overlapSize = Math.floor(targetChunkSize * 0.1); // 10% overlap
    
    console.log(`[RAG] splitTextByTokenCount - Calculated chunkSize: ${targetChunkSize} chars, overlap: ${overlapSize} chars`);
    
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: targetChunkSize,
      chunkOverlap: overlapSize,
      separators: ['\n\n', '\n', ' ', '']
    });

    const chunks = await splitter.splitText(text);
    
    console.log(`[RAG] splitTextByTokenCount - Created ${chunks.length} chunks`);
    console.log(`[RAG] splitTextByTokenCount - Chunk sizes: min=${Math.min(...chunks.map(c => c.length))}, max=${Math.max(...chunks.map(c => c.length))}, avg=${Math.round(chunks.reduce((a, c) => a + c.length, 0) / chunks.length)}`);
    
    return chunks;
  } catch (error) {
    console.error('[RAG] Error splitting text by token count:', error.message);
    throw error;
  }
}

async function createChunksForSection(text, sectionNumber, sectionTitle, sectionType = null, chapterId = null, division = null, useTokenBasedChunking = false) {
  console.log(`[RAG] createChunksForSection - START for section ${sectionNumber}, sectionType: ${sectionType}, chapterId: ${chapterId}, division: ${division}, useTokenBasedChunking: ${useTokenBasedChunking}`);
  try {
    // Use token-based chunking for direct_upload, otherwise use character-based chunking
    const chunks = useTokenBasedChunking 
      ? await splitTextByTokenCount(text, 2000)  // ~2000 tokens per chunk
      : await splitTextWithLangChain(text);

    // Verify no content was lost during chunking
    const totalChunkLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const contentLoss = text.length - totalChunkLength;

    if (contentLoss > 50) {
      console.warn(`[RAG] createChunksForSection - WARNING: Potential content loss in section ${sectionNumber}! ${contentLoss} characters not captured`);
    }

    const result = chunks.map((chunk, index) => ({
      text: chunk,
      sectionNumber,
      sectionTitle,
      sectionType: sectionType || null,
      chapterId: chapterId || null,
      division: division || null,
      chunkIndex: index
    }));

    console.log(`[RAG] createChunksForSection - Created ${result.length} chunks for section ${sectionNumber}, sectionType: ${sectionType}, division: ${division}, useTokenBasedChunking: ${useTokenBasedChunking}`);
    console.log('[RAG] createChunksForSection - First chunk:', {
      sectionNumber: result[0]?.sectionNumber,
      sectionType: result[0]?.sectionType,
      chapterId: result[0]?.chapterId,
      division: result[0]?.division
    });

    return result;
  } catch (error) {
    console.error('[RAG] Error creating chunks for section:', error.message);
    throw error;
  }
}

async function processSectionsToChunks(sections) {
  try {
    console.log('[RAG] processSectionsToChunks - START with sections:', sections.map(s => ({
      sectionNumber: s.sectionNumber,
      sectionTitle: s.title || s.sectionTitle,
      sectionType: s.sectionType,
      chapterId: s.chapterId,
      division: s.division,
      useTokenBasedChunking: s.useTokenBasedChunking
    })));

    const allChunks = [];

    for (const section of sections) {
      console.log('[RAG] processSectionsToChunks - Processing section:', {
        sectionNumber: section.sectionNumber,
        sectionType: section.sectionType,
        chapterId: section.chapterId,
        division: section.division,
        useTokenBasedChunking: section.useTokenBasedChunking
      });

      const sectionChunks = await createChunksForSection(
        section.content,
        section.sectionNumber,
        section.title || section.sectionTitle,
        section.sectionType || null,
        section.chapterId || null,
        section.division || null,
        section.useTokenBasedChunking || false  // Pass the flag
      );

      console.log('[RAG] processSectionsToChunks - Created chunks for section:', {
        sectionNumber: section.sectionNumber,
        chunkCount: sectionChunks.length,
        firstChunkSectionType: sectionChunks[0]?.sectionType,
        firstChunkChapterId: sectionChunks[0]?.chapterId,
        firstChunkDivision: sectionChunks[0]?.division
      });

      allChunks.push(...sectionChunks);
    }

    console.log('[RAG] processSectionsToChunks - Total chunks created:', allChunks.length);
    console.log('[RAG] processSectionsToChunks - Sample chunks:', allChunks.slice(0, 3).map(c => ({
      sectionNumber: c.sectionNumber,
      sectionType: c.sectionType,
      chapterId: c.chapterId,
      division: c.division
    })));

    return allChunks;
  } catch (error) {
    console.error('[RAG] Error processing sections to chunks:', error.message);
    throw error;
  }
}

/**
 * Split Science books (9th and 10th) with NCERT-specific structure
 * Handles two-column layouts where sections appear out of order
 *
 * NCERT Science books use:
 * - Main sections: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, etc.
 * - Subsections: 1.1.1, 1.1.2, 1.2.1, etc.
 * - Activities: Activity 1.1, Activity 1.2, etc.
 *
 * Strategy:
 * 1. Find ALL section headers (including those with formatting issues)
 * 2. Sort by section number (not by appearance) to handle two-column layouts
 * 3. Extract content between consecutive sections
 * 4. Include subsections and activities as part of their parent section
 */

/**
 * Helper function to split Science book using custom section titles
 * This bypasses regex detection and uses provided section numbers and titles
 *
 * @param {string} text - The full text of the chapter
 * @param {Array} customSectionTitles - Array of {number: "1.1", title: "Section Title"}
 * @returns {Array} Array of sections with sectionNumber, title, and content
 */
function splitScienceBookWithCustomTitles(text, customSectionTitles) {
  try {
    console.log('[RAG] splitScienceBookWithCustomTitles - Using custom titles for ' + customSectionTitles.length + ' sections');

    const sections = [];

    // Sort custom titles by section number
    const sortedTitles = [...customSectionTitles].sort((a, b) => {
      const aParts = a.number.split('.').map(Number);
      const bParts = b.number.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });

    // Find positions of each section title in the text
    const sectionPositions = [];

    sortedTitles.forEach(titleObj => {
      const sectionNumber = titleObj.number;
      const sectionTitle = titleObj.title;

      let foundIndex = -1;

      // Strategy 1: Look for the exact title
      const titleRegex = new RegExp(
        sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
        'i'
      );
      const match = titleRegex.exec(text);
      if (match) {
        foundIndex = match.index;
      }

      // Strategy 2: If not found, look for section number followed by title
      if (foundIndex === -1) {
        const numberTitleRegex = new RegExp(
          sectionNumber.replace(/\./g, '\\.') + '\\s+' +
          sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
          'i'
        );
        const match2 = numberTitleRegex.exec(text);
        if (match2) {
          foundIndex = match2.index;
        }
      }

      // Strategy 3: If still not found, look for just the section number
      if (foundIndex === -1) {
        const numberRegex = new RegExp('^\\s*' + sectionNumber.replace(/\./g, '\\.') + '\\s*$', 'gm');
        const match3 = numberRegex.exec(text);
        if (match3) {
          foundIndex = match3.index;
        }
      }

      if (foundIndex !== -1) {
        sectionPositions.push({
          number: sectionNumber,
          title: sectionTitle,
          index: foundIndex
        });
        console.log('[RAG] Found section ' + sectionNumber + ' at position ' + foundIndex);
      } else {
        console.warn('[RAG] Could not find section ' + sectionNumber + ' in text');
        // Still add it to maintain order, but mark as not found
        sectionPositions.push({
          number: sectionNumber,
          title: sectionTitle,
          index: -1
        });
      }
    });

    // Handle introduction (content before first found section)
    const firstFoundIndex = sectionPositions.find(s => s.index !== -1);
    if (firstFoundIndex && firstFoundIndex.index > 0) {
      const preContent = text.substring(0, firstFoundIndex.index).trim();
      if (preContent.length > 100) {
        sections.push({
          sectionNumber: '0',
          title: 'Introduction',
          content: preContent
        });
        console.log('[RAG] Added introduction section');
      }
    }

    // CRITICAL: Sort section positions by their index in text (not by section number)
    // This ensures we extract content in the order it appears in the text
    const sortedByPosition = sectionPositions
      .filter(s => s.index !== -1)
      .sort((a, b) => a.index - b.index);

    console.log('[RAG] Sections sorted by text position:', sortedByPosition.map(s => `${s.number} at ${s.index}`).join(', '));

    // Extract content for each section based on text position
    for (let i = 0; i < sortedByPosition.length; i++) {
      const currentSection = sortedByPosition[i];

      // Find the next section in text position
      let nextIndex = text.length;
      if (i + 1 < sortedByPosition.length) {
        nextIndex = sortedByPosition[i + 1].index;
      }

      const contentStart = currentSection.index;
      const contentEnd = nextIndex;
      const sectionContent = text.substring(contentStart, contentEnd).trim();

      if (sectionContent.length > 0) {
        sections.push({
          sectionNumber: currentSection.number,
          title: currentSection.title,
          content: sectionContent
        });
        console.log('[RAG] Added section ' + currentSection.number + ': "' + currentSection.title + '" (' + sectionContent.length + ' chars)');
      }
    }

    console.log('[RAG] splitScienceBookWithCustomTitles - Successfully split into ' + sections.length + ' sections');
    return sections.length > 0 ? sections : [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];

  } catch (error) {
    console.error('[RAG] Error in splitScienceBookWithCustomTitles:', error.message);
    return [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];
  }
}

function splitScienceBook(text, subjectId = null, customSectionTitles = null) {
  try {
    console.log('[RAG] splitScienceBook - Analyzing NCERT Science book with two-column layout handling');

    // If custom section titles are provided, use them directly
    if (customSectionTitles && Array.isArray(customSectionTitles) && customSectionTitles.length > 0) {
      console.log('[RAG] splitScienceBook - Using custom section titles:', customSectionTitles.map(s => `${s.number}: ${s.title}`).join(', '));
      return splitScienceBookWithCustomTitles(text, customSectionTitles);
    }

    const allMatches = [];
    const seenSectionNumbers = new Set();

    // Helper function to check if a number is a main section (X.Y) not a subsection (X.Y.Z)
    const isMainSection = (numberStr) => {
      const parts = numberStr.split('.');
      return parts.length === 2 && parts[0] && parts[1];
    };

    // Helper function to check if a line looks like a section header (not content)
    // Section headers typically have 1-5 words, content lines have more
    const looksLikeSectionTitle = (text) => {
      if (!text || text.length === 0) return false;
      const words = text.trim().split(/\s+/);
      // Section titles are usually 1-6 words and don't contain numbers in the middle
      if (words.length > 6) return false;
      // Check if it looks like content (has numbers, formulas, etc.)
      if (/\d+\.\d+\s*[=×÷+\-]/.test(text)) return false; // Looks like math/formula
      if (/\(\d+\)/.test(text)) return false; // Looks like numbered list
      return true;
    };

    // Pattern 1: Standard section with title on same line (1.1 Title)
    const pattern1 = /^\s*(\d+\.\d+(?:\.\d+)?)\s+([A-Z][a-zA-Z\s\-:,;?!]+?)$/gm;
    let match;
    while ((match = pattern1.exec(text)) !== null) {
      const sectionNumber = match[1];

      // Skip subsections (X.Y.Z format)
      if (!isMainSection(sectionNumber)) continue;

      let sectionTitle = match[2].trim();
      sectionTitle = sectionTitle.replace(/\s+/g, ' ').trim();

      // Skip if invalid title (only numbers/symbols)
      if (sectionTitle.length > 0 && /^[\d.\s\-:,;|]*$/.test(sectionTitle)) {
        sectionTitle = '';
      }

      // Skip if doesn't look like a section title
      if (!looksLikeSectionTitle(sectionTitle)) {
        sectionTitle = '';
      }

      // If title doesn't end with punctuation, check if it continues on next line
      if (sectionTitle && !sectionTitle.match(/[?.!]$/)) {
        const matchEndLine = text.indexOf('\n', match.index);
        if (matchEndLine !== -1) {
          const nextLineStart = matchEndLine + 1;
          const nextLineEnd = text.indexOf('\n', nextLineStart);
          const nextLine = text.substring(nextLineStart, nextLineEnd).trim();

          // If next line is short and starts with a letter, it's likely a continuation
          if (nextLine && /^[a-zA-Z]/.test(nextLine) && nextLine.length < 50 && !nextLine.match(/^(On|The|In|For|With|By|As|At|From|To|And|Or|But|If|When|Where|Why|How|This|That|These|Those|Which|Who|What|Where|When|Why|How)\s/)) {
            sectionTitle = sectionTitle + ' ' + nextLine;
            sectionTitle = sectionTitle.replace(/\s+/g, ' ').trim();
          }
        }
      }

      const lineNum = text.substring(0, match.index).split('\n').length - 1;
      const key = sectionNumber + ':' + lineNum;
      if (!seenSectionNumbers.has(key)) {
        seenSectionNumbers.add(key);
        allMatches.push({
          number: sectionNumber,
          title: sectionTitle,
          index: match.index,
          line: lineNum
        });
      }
    }

    // Pattern 2: Section number alone on a line (1.3, 1.4) - these are activities
    const pattern2 = /^\s*(\d+\.\d+)\s*$/gm;
    while ((match = pattern2.exec(text)) !== null) {
      const sectionNumber = match[1];

      // Skip subsections
      if (!isMainSection(sectionNumber)) continue;

      const lineNum = text.substring(0, match.index).split('\n').length - 1;

      // For standalone section numbers, try to get title from next line
      const nextLineStart = match.index + match[0].length;
      const nextLineEnd = text.indexOf('\n', nextLineStart);
      let nextLine = text.substring(nextLineStart, nextLineEnd).trim();

      // If next line starts with bullet or is activity content, no title
      if (nextLine.startsWith('ΓÇó') || nextLine.startsWith('•') || nextLine.startsWith('-')) {
        nextLine = '';
      }

      allMatches.push({
        number: sectionNumber,
        title: nextLine,
        index: match.index,
        line: lineNum
      });
    }

    // Pattern 3: Section number with title on next line (1.2\nCharacteristics...)
    // This handles cases where title wraps to next line
    const pattern3 = /^\s*(\d+\.\d+)\s*\n\s*([A-Z][a-zA-Z\s\-:,;?!]+?)$/gm;
    while ((match = pattern3.exec(text)) !== null) {
      const sectionNumber = match[1];

      // Skip subsections
      if (!isMainSection(sectionNumber)) continue;

      let sectionTitle = match[2].trim();
      sectionTitle = sectionTitle.replace(/\s+/g, ' ').trim();

      // Skip if invalid title
      if (sectionTitle.length > 0 && /^[\d.\s\-:,;|]*$/.test(sectionTitle)) {
        sectionTitle = '';
      }

      // Skip if doesn't look like a section title
      if (!looksLikeSectionTitle(sectionTitle)) {
        sectionTitle = '';
      }

      const lineNum = text.substring(0, match.index).split('\n').length - 1;

      allMatches.push({
        number: sectionNumber,
        title: sectionTitle,
        index: match.index,
        line: lineNum
      });
    }

    // Pattern 4: Section number directly followed by title (1.2Characteristics...)
    // This handles cases where there's no space between number and title
    const pattern4 = /^\s*(\d+\.\d+)([A-Z][a-zA-Z\s\-:,;?!]+?)$/gm;
    while ((match = pattern4.exec(text)) !== null) {
      const sectionNumber = match[1];

      // Skip subsections
      if (!isMainSection(sectionNumber)) continue;

      let sectionTitle = match[2].trim();
      sectionTitle = sectionTitle.replace(/\s+/g, ' ').trim();

      // Skip if invalid title
      if (sectionTitle.length > 0 && /^[\d.\s\-:,;|]*$/.test(sectionTitle)) {
        sectionTitle = '';
      }

      // Skip if doesn't look like a section title
      if (!looksLikeSectionTitle(sectionTitle)) {
        sectionTitle = '';
      }

      // If title doesn't end with punctuation, check if it continues on next line
      if (sectionTitle && !sectionTitle.match(/[?.!]$/)) {
        const matchEndLine = text.indexOf('\n', match.index);
        if (matchEndLine !== -1) {
          const nextLineStart = matchEndLine + 1;
          const nextLineEnd = text.indexOf('\n', nextLineStart);
          const nextLine = text.substring(nextLineStart, nextLineEnd).trim();

          // If next line is short and starts with a letter, it's likely a continuation
          if (nextLine && /^[a-zA-Z]/.test(nextLine) && nextLine.length < 50 && !nextLine.match(/^(On|The|In|For|With|By|As|At|From|To|And|Or|But|If|When|Where|Why|How|This|That|These|Those|Which|Who|What|Where|When|Why|How)\s/)) {
            sectionTitle = sectionTitle + ' ' + nextLine;
            sectionTitle = sectionTitle.replace(/\s+/g, ' ').trim();
          }
        }
      }

      const lineNum = text.substring(0, match.index).split('\n').length - 1;

      allMatches.push({
        number: sectionNumber,
        title: sectionTitle,
        index: match.index,
        line: lineNum
      });
    }

    // Pattern 5: Section number with multi-line title (1.2\nWhat are the Types of\nPure Substances)
    // This handles wrapped titles that span 2-3 lines
    const pattern5 = /^\s*(\d+\.\d+)\s*\n\s*([A-Z][a-zA-Z\s\-:,;?!]+?)\n\s*([a-z][a-zA-Z\s\-:,;?!]+?)$/gm;
    while ((match = pattern5.exec(text)) !== null) {
      const sectionNumber = match[1];

      // Skip subsections
      if (!isMainSection(sectionNumber)) continue;

      let sectionTitle = (match[2] + ' ' + match[3]).trim();
      sectionTitle = sectionTitle.replace(/\s+/g, ' ').trim();

      // Skip if invalid title
      if (sectionTitle.length > 0 && /^[\d.\s\-:,;|]*$/.test(sectionTitle)) {
        sectionTitle = '';
      }

      // Skip if doesn't look like a section title
      if (!looksLikeSectionTitle(sectionTitle)) {
        sectionTitle = '';
      }

      const lineNum = text.substring(0, match.index).split('\n').length - 1;

      allMatches.push({
        number: sectionNumber,
        title: sectionTitle,
        index: match.index,
        line: lineNum
      });
    }

    // IMPORTANT: Remove duplicate section numbers, keeping the one with a title
    // This handles cases where a section appears multiple times (e.g., activity 1.3 vs main section 1.3)
    const uniqueSections = {};
    allMatches.forEach(match => {
      if (!uniqueSections[match.number]) {
        uniqueSections[match.number] = match;
      } else {
        // If new match has a title and existing doesn't, replace it
        if (match.title && !uniqueSections[match.number].title) {
          uniqueSections[match.number] = match;
        }
        // If both have titles, keep the one that appears later (more likely to be the main section)
        else if (match.title && uniqueSections[match.number].title && match.index > uniqueSections[match.number].index) {
          uniqueSections[match.number] = match;
        }
        // If existing has no title and new has no title, keep the one that appears later
        else if (!match.title && !uniqueSections[match.number].title && match.index > uniqueSections[match.number].index) {
          uniqueSections[match.number] = match;
        }
      }
    });

    // Convert back to array
    allMatches.length = 0;
    Object.values(uniqueSections).forEach(match => allMatches.push(match));

    if (allMatches.length === 0) {
      console.log('[RAG] splitScienceBook - No sections found, using fallback');
      return [{
        sectionNumber: '1',
        title: 'Full Chapter',
        content: text.trim()
      }];
    }

    // CRITICAL: Sort by section number (not by appearance) to handle two-column layouts
    allMatches.sort((a, b) => {
      const aParts = a.number.split('.').map(Number);
      const bParts = b.number.split('.').map(Number);

      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });

    console.log('[RAG] splitScienceBook - Found ' + allMatches.length + ' sections (sorted by number):');
    allMatches.forEach(m => {
      console.log('[RAG]   ' + m.number + ': ' + (m.title || '(no title)') + ' (appears at line ' + m.line + ')');
    });

    const sections = [];

    // Handle introduction (content before first section)
    const firstSectionIndex = Math.min(...allMatches.map(m => m.index));
    if (firstSectionIndex > 0) {
      const preContent = text.substring(0, firstSectionIndex).trim();
      if (preContent.length > 100) {
        sections.push({
          sectionNumber: '0',
          title: 'Introduction',
          content: preContent
        });
        console.log('[RAG] splitScienceBook - Added introduction section');
      }
    }

    // Extract content for each section
    allMatches.forEach((match, idx) => {
      // Find the next section that appears after this one in the original text
      let nextIndex = text.length;

      for (let i = 0; i < allMatches.length; i++) {
        if (allMatches[i].index > match.index && allMatches[i].index < nextIndex) {
          nextIndex = allMatches[i].index;
        }
      }

      const contentStart = match.index;
      const contentEnd = nextIndex;
      const sectionContent = text.substring(contentStart, contentEnd).trim();

      if (sectionContent.length > 0) {
        sections.push({
          sectionNumber: match.number,
          title: match.title || match.number,
          content: sectionContent
        });
        console.log('[RAG] splitScienceBook - Added section ' + match.number + ': "' + (match.title || match.number) + '" (' + sectionContent.length + ' chars)');
      }
    });

    console.log('[RAG] splitScienceBook - Successfully split into ' + sections.length + ' sections');
    return sections.length > 0 ? sections : [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];

  } catch (error) {
    console.error('[RAG] Error in splitScienceBook:', error.message);
    return [{
      sectionNumber: '1',
      title: 'Full Chapter',
      content: text.trim()
    }];
  }
}


module.exports = {
  splitByHeadings,
  splitBySections,
  splitTNMathBook,
  splitTNScienceBook,
  splitTextWithLangChain,
  splitTextByTokenCount,
  createChunksForSection,
  processSectionsToChunks,
  extractTextWithPageInfo,
  splitByPageRanges,
  splitByChaptersAndSections,
  splitByManualAnchors,
  splitByRegex,
  splitScienceBook
};
