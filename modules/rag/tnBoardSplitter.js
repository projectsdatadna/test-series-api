/**
 * TN State Board Book Splitter
 * Specialized splitting logic for TN State Board textbooks
 * Two-level hierarchy: Units (Chapters) → Content Types (Sections)
 */

/**
 * Split TN State Board book by units first, then by content types within each unit
 * Detects patterns like "Unit 1", "Unit 2", etc.
 * Within each unit, detects "Prose: Title", "Poem: Title", "Supplementary: Title"
 * @param {string} text - Full book text
 * @returns {Array} Units with sections inside each unit
 */
function splitByUnitsAndChapters(text) {
  console.log('[RAG] tnBoardSplitter - splitByUnitsAndChapters START');
  
  // Split by lines to find unit headers at line start
  const lines = text.split('\n');
  const units = [];
  const unitMatches = [];
  let currentPosition = 0;

  // Find all unit headers - must be at start of line with word boundary
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const unitMatch = line.match(/^\s*Unit\s+(\d+)\s*$/i);
    
    if (unitMatch) {
      const unitNumber = parseInt(unitMatch[1]);
      console.log(`[RAG] tnBoardSplitter - Found unit: Unit ${unitNumber} at line ${i}`);
      
      unitMatches.push({
        unitNumber: unitNumber,
        lineIndex: i,
        startIndex: currentPosition
      });
    }
    
    currentPosition += line.length + 1; // +1 for newline
  }

  console.log(`[RAG] tnBoardSplitter - Total units found: ${unitMatches.length}`);

  // If no units found, treat entire book as single unit
  if (unitMatches.length === 0) {
    console.log('[RAG] tnBoardSplitter - No units found, treating as single unit');
    const sections = splitByContentTypes(text, 1);
    return [{
      unitNumber: 1,
      unitTitle: 'Unit 1',
      sections: sections,
      sectionCount: sections.length
    }];
  }

  // Extract content for each unit and split by content types
  unitMatches.forEach((um, index) => {
    const contentStartLine = um.lineIndex + 1;
    const contentEndLine = index < unitMatches.length - 1 
      ? unitMatches[index + 1].lineIndex 
      : lines.length;
    
    const unitContent = lines.slice(contentStartLine, contentEndLine).join('\n').trim();

    console.log(`[RAG] tnBoardSplitter - Unit ${um.unitNumber}: ${unitContent.length} characters`);

    // Split this unit by content types (Prose, Poem, Supplementary)
    const sections = splitByContentTypes(unitContent, um.unitNumber);

    console.log(`[RAG] tnBoardSplitter - Unit ${um.unitNumber} split into ${sections.length} sections`);

    units.push({
      unitNumber: um.unitNumber,
      unitTitle: `Unit ${um.unitNumber}`,
      sections: sections,
      sectionCount: sections.length,
      startIndex: um.startIndex,
      endIndex: um.startIndex + unitContent.length
    });
  });

  console.log(`[RAG] tnBoardSplitter - splitByUnitsAndChapters COMPLETE: ${units.length} units extracted`);
  console.log('[RAG] tnBoardSplitter - Units:', units.map(u => ({
    unitNumber: u.unitNumber,
    unitTitle: u.unitTitle,
    sectionCount: u.sectionCount
  })));

  return units;
}

/**
 * Split content by content types: Prose, Poem, Supplementary
 * @param {string} content - Unit content to split
 * @param {number} unitNumber - Unit number for hierarchical numbering
 * @returns {Array} Sections with hierarchical numbering
 */
function splitByContentTypes(content, unitNumber) {
  console.log(`[RAG] tnBoardSplitter - splitByContentTypes START for unit ${unitNumber}`);
  
  const lines = content.split('\n');
  const sections = [];
  const matches = [];

  // Find all content type headers - more flexible matching
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Match: "Prose: Title", "Poem: Title", "Supplementary: Title"
    // Case-insensitive, allows for variations
    const contentTypeMatch = line.match(/^(prose|poem|supplementary)\s*:\s*(.+?)(?:\s*$)/i);
    
    if (contentTypeMatch) {
      const contentType = contentTypeMatch[1].charAt(0).toUpperCase() + contentTypeMatch[1].slice(1).toLowerCase();
      let title = contentTypeMatch[2].trim();
      
      // Clean up title - remove common garbage patterns
      title = title
        .replace(/\d+\.\w+\s+\d+.*$/i, '') // Remove file references like "087-108.indd"
        .replace(/\d{1,2}-\d{1,2}-\d{4}.*$/i, '') // Remove dates
        .replace(/\d{1,2}:\d{1,2}:\d{1,2}.*$/i, '') // Remove times
        .replace(/\s+\d+\s*$/i, '') // Remove trailing page numbers
        .trim();
      
      // If title is empty after cleanup, use content type as title
      if (!title) {
        title = contentType;
      }
      
      console.log(`[RAG] tnBoardSplitter - Found content type: ${contentType}: ${title} at line ${i}`);
      
      matches.push({
        type: contentType.toLowerCase(),
        title: `${contentType}: ${title}`,
        lineIndex: i
      });
    }
  }

  console.log(`[RAG] tnBoardSplitter - Total content types found in unit ${unitNumber}: ${matches.length}`);

  // If no content types found, try alternative patterns
  if (matches.length === 0) {
    console.log(`[RAG] tnBoardSplitter - No standard content types found, trying alternative patterns for unit ${unitNumber}`);
    
    // Try to find any section-like headers (lines that look like titles)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and very short lines
      if (!line || line.length < 3) continue;
      
      // Look for lines that might be section headers
      // (lines that are relatively short and don't look like body text)
      if (line.length < 100 && !line.match(/^[\s\d]+$/) && line.match(/[A-Z]/)) {
        // Check if this line is followed by substantial content
        let hasContent = false;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].trim().length > 20) {
            hasContent = true;
            break;
          }
        }
        
        if (hasContent) {
          console.log(`[RAG] tnBoardSplitter - Found potential section header at line ${i}: "${line}"`);
          matches.push({
            type: 'content',
            title: line,
            lineIndex: i
          });
        }
      }
    }
  }

  // If still no content types found, return full content as single section
  if (matches.length === 0) {
    console.log(`[RAG] tnBoardSplitter - No content types found in unit ${unitNumber}, treating as single section`);
    return [{
      sectionNumber: `${unitNumber}.1`,
      sectionTitle: 'Content',
      sectionType: 'content',
      content: content,
      contentLength: content.length,
      unitNumber: unitNumber
    }];
  }

  // Extract content for each content type
  matches.forEach((m, index) => {
    const contentStartLine = m.lineIndex + 1;
    const contentEndLine = index < matches.length - 1 
      ? matches[index + 1].lineIndex 
      : lines.length;
    
    const sectionContent = lines.slice(contentStartLine, contentEndLine).join('\n').trim();

    console.log(`[RAG] tnBoardSplitter - Section "${m.title}": ${sectionContent.length} characters`);

    sections.push({
      sectionNumber: `${unitNumber}.${index + 1}`,
      sectionTitle: m.title,
      sectionType: m.type,
      content: sectionContent,
      contentLength: sectionContent.length,
      unitNumber: unitNumber
    });
  });

  console.log(`[RAG] tnBoardSplitter - splitByContentTypes COMPLETE for unit ${unitNumber}: ${sections.length} sections`);

  return sections;
}

/**
 * Legacy function for backward compatibility
 * Split TN State Board book by chapter types only (no unit hierarchy)
 * @param {string} text - Full book text
 * @returns {Array} Chapters with title and content
 */
function splitByChapters(text) {
  console.log('[RAG] tnBoardSplitter - splitByChapters START (legacy)');
  
  const lines = text.split('\n');
  const chapters = [];
  const matches = [];

  // Find all chapter headers at line start
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Match: "Prose: Title", "Poem: Title", "Supplementary: Title"
    const contentTypeMatch = line.match(/^(Prose|Poem|Supplementary)\s*:\s*(.+?)(?:\s*$)/i);
    
    if (contentTypeMatch) {
      const contentType = contentTypeMatch[1];
      let title = contentTypeMatch[2].trim();
      
      // Clean up title
      title = title
        .replace(/\d+\.\w+\s+\d+.*$/i, '')
        .replace(/\d{1,2}-\d{1,2}-\d{4}.*$/i, '')
        .replace(/\d{1,2}:\d{1,2}:\d{1,2}.*$/i, '')
        .trim();
      
      if (!title) {
        title = contentType;
      }
      
      console.log(`[RAG] tnBoardSplitter - Found chapter: ${contentType}: ${title}`);
      
      matches.push({
        type: contentType.toLowerCase(),
        title: `${contentType}: ${title}`,
        lineIndex: i
      });
    }
  }

  console.log(`[RAG] tnBoardSplitter - Total chapters found: ${matches.length}`);

  // If no chapters found, return full book as single chapter
  if (matches.length === 0) {
    console.log('[RAG] tnBoardSplitter - No chapters found, treating as full book');
    return [{
      chapterTitle: 'Full Book',
      chapterType: 'content',
      content: text,
      contentLength: text.length
    }];
  }

  // Extract content for each chapter
  matches.forEach((m, index) => {
    const contentStartLine = m.lineIndex + 1;
    const contentEndLine = index < matches.length - 1 
      ? matches[index + 1].lineIndex 
      : lines.length;
    
    const content = lines.slice(contentStartLine, contentEndLine).join('\n').trim();

    console.log(`[RAG] tnBoardSplitter - Chapter "${m.title}": ${content.length} characters`);

    chapters.push({
      chapterTitle: m.title,
      chapterType: m.type,
      content: content,
      contentLength: content.length
    });
  });

  console.log(`[RAG] tnBoardSplitter - splitByChapters COMPLETE: ${chapters.length} chapters extracted`);
  console.log('[RAG] tnBoardSplitter - Chapters:', chapters.map(c => ({
    title: c.chapterTitle,
    type: c.chapterType,
    contentLength: c.contentLength
  })));

  return chapters;
}

/**
 * Validate if text appears to be a TN State Board book
 * Checks for presence of unit markers (Unit 1, Unit 2, etc.)
 * @param {string} text - Book text to validate
 * @returns {boolean} True if text appears to be TN State Board format
 */
function isTNBoardFormat(text) {
  const unitRegex = /^Unit\s+\d+/mi;
  const hasUnits = unitRegex.test(text);
  
  console.log(`[RAG] tnBoardSplitter - isTNBoardFormat: ${hasUnits}`);
  
  return hasUnits;
}

/**
 * Get unit statistics
 * @param {Array} units - Array of units from splitByUnitsAndChapters
 * @returns {Object} Statistics about units and sections
 */
function getUnitStatistics(units) {
  const stats = {
    totalUnits: units.length,
    totalSections: 0,
    byContentType: {
      prose: 0,
      poem: 0,
      supplementary: 0,
      full: 0
    },
    totalContent: 0
  };

  units.forEach(unit => {
    stats.totalSections += unit.sections.length;
    unit.sections.forEach(section => {
      if (section.sectionType in stats.byContentType) {
        stats.byContentType[section.sectionType]++;
      }
      stats.totalContent += section.contentLength || 0;
    });
  });

  console.log('[RAG] tnBoardSplitter - Unit statistics:', stats);

  return stats;
}

module.exports = {
  splitByUnitsAndChapters,
  splitByContentTypes,
  splitByChapters,
  isTNBoardFormat,
  getUnitStatistics
};
