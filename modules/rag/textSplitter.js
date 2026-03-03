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

async function createChunksForSection(text, sectionNumber, sectionTitle, sectionType = null) {
  console.log(`[RAG] createChunksForSection - START for section ${sectionNumber}, sectionType: ${sectionType}`);
  try {
    const chunks = await splitTextWithLangChain(text);

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
      chunkIndex: index
    }));

    console.log(`[RAG] createChunksForSection - Created ${result.length} chunks for section ${sectionNumber}, sectionType: ${sectionType}`);
    console.log('[RAG] createChunksForSection - First chunk:', {
      sectionNumber: result[0]?.sectionNumber,
      sectionType: result[0]?.sectionType
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
      sectionType: s.sectionType
    })));

    const allChunks = [];

    for (const section of sections) {
      console.log('[RAG] processSectionsToChunks - Processing section:', {
        sectionNumber: section.sectionNumber,
        sectionType: section.sectionType
      });

      const sectionChunks = await createChunksForSection(
        section.content,
        section.sectionNumber,
        section.title || section.sectionTitle,
        section.sectionType || null
      );

      console.log('[RAG] processSectionsToChunks - Created chunks for section:', {
        sectionNumber: section.sectionNumber,
        chunkCount: sectionChunks.length,
        firstChunkSectionType: sectionChunks[0]?.sectionType
      });

      allChunks.push(...sectionChunks);
    }

    console.log('[RAG] processSectionsToChunks - Total chunks created:', allChunks.length);
    console.log('[RAG] processSectionsToChunks - Sample chunks:', allChunks.slice(0, 3).map(c => ({
      sectionNumber: c.sectionNumber,
      sectionType: c.sectionType
    })));

    return allChunks;
  } catch (error) {
    console.error('[RAG] Error processing sections to chunks:', error.message);
    throw error;
  }
}

module.exports = {
  splitByHeadings,
  splitBySections,
  splitTextWithLangChain,
  createChunksForSection,
  processSectionsToChunks,
  extractTextWithPageInfo,
  splitByPageRanges,
  splitByChaptersAndSections,
  splitByManualAnchors,
  splitByRegex
};
