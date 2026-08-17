/**
 * Build the viewer into a single dependency-free page: dist/index.html.
 * The bundle (TypeScript + CSS + sample archive) is inlined into the
 * template, so the output file works from disk with no server and no
 * network access.
 */

const root = import.meta.dir;

const result = await Bun.build({
  entrypoints: [`${root}/src/main.ts`],
  target: "browser",
  minify: true,
  loader: { ".ged": "text" },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const js = (await result.outputs[0]!.text())
  // a "</script>" inside the bundle would end the inline script tag early
  .replaceAll("</script>", "<\\/script>");
const css = await Bun.file(`${root}/src/styles.css`).text();
const template = await Bun.file(`${root}/template.html`).text();

const html = template
  .replace("/*__CSS__*/", () => css)
  .replace("//__JS__", () => js);

await Bun.write(`${root}/dist/index.html`, html);
console.log(`dist/index.html — ${(html.length / 1024).toFixed(1)} kB`);
