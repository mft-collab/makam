const fs = require('fs');

const fixDarkThemeClasses = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Replace Modal specific bg
  content = content.replace(/bg-white\/95/g, 'bg-makam-elevated'); // wait, let's use bg-surface-elevated
  
  // Generic replacements
  content = content.replace(/bg-white\/[0-9]+/g, 'bg-makam-glass');
  content = content.replace(/border-white\/[0-9]+/g, 'border-surface-border');
  
  // Specific fix for "hover:bg-white" in Modal or TaskDetails buttons
  content = content.replace(/hover:bg-white(?!\/)/g, 'hover:bg-makam-card');
  
  // For Modal.tsx: bg-white/95 border border-white/60
  // "bg-makam-glass" will map to glass-bg which is rgba(30,30,28, 0.5) in dark.
  
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('Fixed:', filePath);
};

// Also Modal.tsx
let modalContent = fs.readFileSync('src/components/ui/Modal.tsx', 'utf-8');
modalContent = modalContent.replace(/bg-white\/95/g, 'bg-surface-elevated');
modalContent = modalContent.replace(/border-white\/60/g, 'border-surface-border');
modalContent = modalContent.replace(/hover:bg-white/g, 'hover:bg-surface-glass');
fs.writeFileSync('src/components/ui/Modal.tsx', modalContent, 'utf-8');

fixDarkThemeClasses('src/components/TaskDetails.tsx');

console.log("Done");
