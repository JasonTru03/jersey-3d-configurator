export function createBrowserDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  return {
    filename,
    release: () => URL.revokeObjectURL(url),
    url,
  };
}
