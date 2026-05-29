const fs = require('node:fs');
const path = require('node:path');

function readCssWithImports(filePath, seen = new Set()) {
    const resolvedPath = path.resolve(filePath);
    if (seen.has(resolvedPath)) {
        return '';
    }
    seen.add(resolvedPath);
    const source = fs.readFileSync(resolvedPath, 'utf8');
    return source.replace(/^@import\s+"\.\/([^"]+)";\s*$/gm, (_match, importName) => {
        return readCssWithImports(path.join(path.dirname(resolvedPath), importName), seen);
    });
}

function readDashboardCssSource(repoRoot) {
    return readCssWithImports(path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css'));
}

module.exports = {
    readDashboardCssSource,
};
