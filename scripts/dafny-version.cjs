'use strict';

const PINNED_DAFNY_VERSION = '4.11.0';
const OFFICIAL_NUGET_BUILD_HASH = /^[0-9a-f]{40}$/;

function isPinnedDafnyVersion(output) {
  const version = output.trim();
  if (version === PINNED_DAFNY_VERSION) return true;
  const buildMetadata = version.match(/^4\.11\.0\+(.+)$/)?.[1];
  return buildMetadata !== undefined && OFFICIAL_NUGET_BUILD_HASH.test(buildMetadata);
}

module.exports = { isPinnedDafnyVersion };
