const fs = require('fs');
const path = require('path');
const logoPath = path.join(__dirname, 'public', 'logo1.jpg');
const b64 = fs.readFileSync(logoPath).toString('base64');
const content = `// Auto-generated - DO NOT EDIT\nmodule.exports = 'data:image/jpeg;base64,${b64}';\n`;
fs.writeFileSync(path.join(__dirname, 'logo-embedded.js'), content);
console.log('Generated logo-embedded.js, size:', fs.statSync(path.join(__dirname, 'logo-embedded.js')).size, 'bytes');
