// Buyuk dosya okuma uyarisi (100KB uzeri)
let input = "";
process.stdin.on("data", d => input += d);
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const file = data.tool_input && data.tool_input.file_path;
    if (!file) process.exit(0);
    const fs = require("fs");
    const stat = fs.statSync(file);
    if (stat.size > 102400) {
      console.error(`UYARI: ${file} ${(stat.size/1024).toFixed(0)}KB. Once grep/head kullan.`);
    }
  } catch (e) {
    // sessiz gec, hook engellemesin
  }
  process.exit(0);
});
