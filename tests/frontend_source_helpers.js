const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function listSourceFiles(relative) {
    const absolute = path.join(repoRoot, relative);
    if (fs.statSync(absolute).isFile()) return [absolute];
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) return listSourceFiles(child);
        return /\.(jsx?|mjs)$/.test(entry.name) ? [path.join(repoRoot, child)] : [];
    });
}

// Source of every file that may own a moved cluster. A retained negative pin must pass an
// anchor (a string that exists today) so it cannot go vacuous when the code moves.
function readOwnerSource(relatives, { anchor } = {}) {
    const source = relatives.flatMap(listSourceFiles).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    if (anchor && !source.includes(anchor)) throw new Error(`owner source is missing anchor: ${anchor}`);
    return source;
}

module.exports = { readOwnerSource, repoRoot };
