const { packager } = require('@electron/packager');

function shouldIgnore(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  return (
    /^\/?\.git(\/|$)/.test(normalized) ||
    /^\/?release(\/|$)/.test(normalized) ||
    /^\/?release-portable[^/]*(\/|$)/.test(normalized) ||
    /(^|\/)server\/browser-data(\/|$)/.test(normalized) ||
    /(^|\/)server\/browser-profiles(\/|$)/.test(normalized) ||
    /^\/?PROJECT_FILE_DUMP\.txt$/.test(normalized)
  );
}

async function main() {
  const appPaths = await packager({
    dir: process.cwd(),
    name: 'ScriptForge',
    platform: 'win32',
    arch: 'x64',
    out: 'release-portable-clean',
    overwrite: true,
    asar: false,
    prune: false,
    ignore: shouldIgnore,
  });

  console.log('Windows portable folder created:');
  for (const appPath of appPaths) {
    console.log(appPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
