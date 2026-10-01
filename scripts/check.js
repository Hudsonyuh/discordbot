const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const directory of ['src', 'scripts', 'test']) {
  for (const file of fs.readdirSync(path.join(__dirname, '..', directory))) {
    if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(__dirname, '..', directory, file)], { stdio: 'inherit' });
  }
}
const commands = require('../src/commands').buildCommands();
console.log(`Syntax checks passed; ${commands.length} slash command definitions validated.`);
