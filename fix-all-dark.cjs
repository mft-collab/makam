const fs = require('fs');
const path = require('path');

const walkSync = function(dir, filelist) {
  let files = fs.readdirSync(dir);
  filelist = filelist || [];
  files.forEach(function(file) {
    if (fs.statSync(path.join(dir, file)).isDirectory()) {
      filelist = walkSync(path.join(dir, file), filelist);
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        filelist.push(path.join(dir, file));
      }
    }
  });
  return filelist;
};

const files = walkSync('src/components', []);
files.push('src/App.tsx'); // Add App.tsx just in case

let updatedFiles = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf-8');
  let originalContent = content;

  // Background replacements
  content = content.replace(/bg-white\/(80|60|50|40|30|20|10|5)/g, 'bg-makam-glass');
  // Need to be careful with bg-white without slash, use word boundary but avoid hovering or text-white
  // Match bg-white not followed by /
  content = content.replace(/(?<!:)bg-white(?!\/|-)/g, 'bg-surface-elevated');
  content = content.replace(/hover:bg-white(?!\/|-)/g, 'hover:bg-surface-elevated');

  // Border replacements
  content = content.replace(/border-white\/(80|60|50|40|30|20|10|5)/g, 'border-surface-border');
  content = content.replace(/border-white(?!\/|-)/g, 'border-surface-border');
  content = content.replace(/hover:border-white(?!\/|-)/g, 'hover:border-surface-border');

  // Fix hardcoded text slate colors that don't look good in dark mode
  content = content.replace(/text-slate-800/g, 'text-text-heading');
  content = content.replace(/text-slate-700/g, 'text-text-heading');
  content = content.replace(/text-slate-600/g, 'text-text-muted');
  content = content.replace(/text-slate-500/g, 'text-text-muted');
  content = content.replace(/text-slate-400/g, 'text-text-tertiary');
  content = content.replace(/text-slate-300/g, 'text-text-tertiary');
  
  content = content.replace(/hover:text-slate-800/g, 'hover:text-text-heading');
  content = content.replace(/hover:text-slate-600/g, 'hover:text-text-heading');

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf-8');
    updatedFiles++;
    console.log('Fixed:', file);
  }
});

console.log('Total files fixed:', updatedFiles);
