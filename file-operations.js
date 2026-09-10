'use strict';

const fs = require('fs');
const path = require('path');

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const WINDOWS_INVALID = /[<>:"/\\|?*\x00-\x1F]/;

function validateEntryName(name) {
  if (typeof name !== 'string') throw new Error('A name is required.');
  const value = name.trim();
  if (!value || value === '.' || value === '..') throw new Error('A name is required.');
  if (WINDOWS_INVALID.test(value)) throw new Error('The name contains characters that Windows does not allow.');
  if (/[ .]$/.test(value)) throw new Error('A name cannot end with a space or period.');
  if (WINDOWS_RESERVED.test(value)) throw new Error('That name is reserved by Windows.');
  return value;
}

function canonical(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function isInsideOrEqual(rootPath, targetPath) {
  const root = canonical(rootPath);
  const target = canonical(targetPath);
  return target === root || target.startsWith(root + path.sep.toLowerCase());
}

function assertDirectoryInRoot(rootPath, directoryPath) {
  if (!rootPath || !directoryPath || !isInsideOrEqual(rootPath, directoryPath)) {
    throw new Error('The destination must be inside the open folder.');
  }
  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) throw new Error('The destination is not a folder.');
  return path.resolve(directoryPath);
}

function assertMutableTarget(rootPath, targetPath) {
  if (!rootPath || !targetPath || !isInsideOrEqual(rootPath, targetPath)) {
    throw new Error('The selected item must be inside the open folder.');
  }
  if (canonical(rootPath) === canonical(targetPath)) {
    throw new Error('The open folder itself cannot be changed here.');
  }
  if (!fs.existsSync(targetPath)) throw new Error('The selected item no longer exists.');
  return path.resolve(targetPath);
}

function assertAvailable(targetPath) {
  if (fs.existsSync(targetPath)) throw new Error('An item with that name already exists.');
}

function markdownName(name) {
  const value = validateEntryName(name);
  return /\.md$/i.test(value) ? value : value + '.md';
}

function createMarkdown(rootPath, directoryPath, name) {
  const directory = assertDirectoryInRoot(rootPath, directoryPath);
  const targetPath = path.join(directory, markdownName(name));
  assertAvailable(targetPath);
  fs.writeFileSync(targetPath, '', { encoding: 'utf8', flag: 'wx' });
  return targetPath;
}

function createDirectory(rootPath, directoryPath, name) {
  const directory = assertDirectoryInRoot(rootPath, directoryPath);
  const targetPath = path.join(directory, validateEntryName(name));
  assertAvailable(targetPath);
  fs.mkdirSync(targetPath);
  return targetPath;
}

function renameEntry(rootPath, targetPath, newName) {
  const sourcePath = assertMutableTarget(rootPath, targetPath);
  const destinationPath = path.join(path.dirname(sourcePath), validateEntryName(newName));
  if (sourcePath === destinationPath) return sourcePath;
  if (canonical(sourcePath) === canonical(destinationPath)) {
    fs.renameSync(sourcePath, destinationPath);
    return destinationPath;
  }
  assertAvailable(destinationPath);
  fs.renameSync(sourcePath, destinationPath);
  return destinationPath;
}

function duplicateFile(rootPath, targetPath) {
  const sourcePath = assertMutableTarget(rootPath, targetPath);
  if (!fs.statSync(sourcePath).isFile()) throw new Error('Only files can be duplicated.');
  const ext = path.extname(sourcePath);
  const stem = path.basename(sourcePath, ext);
  const directory = path.dirname(sourcePath);
  let n = 1;
  let destinationPath;
  do {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`;
    destinationPath = path.join(directory, stem + suffix + ext);
    n++;
  } while (fs.existsSync(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  return destinationPath;
}

module.exports = {
  validateEntryName,
  isInsideOrEqual,
  assertDirectoryInRoot,
  assertMutableTarget,
  markdownName,
  createMarkdown,
  createDirectory,
  renameEntry,
  duplicateFile,
};
