const ts = require("typescript");
const fs = require("fs");
const { execSync } = require("child_process");
const p = "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx";
const cur = fs.readFileSync(p, "utf8");
const head = execSync(`git show HEAD:"${p}"`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

function tokens(src) {
  const s = ts.createScanner(ts.ScriptTarget.ES2022, false, ts.LanguageVariant.JSX, src);
  const out = [];
  let k;
  while ((k = s.scan()) !== ts.SyntaxKind.EndOfFile) out.push(k);
  return out;
}
const a = tokens(head), b = tokens(cur);
console.log("token counts HEAD", a.length, "CUR", b.length);
let i = 0;
while (i < Math.min(a.length, b.length)) {
  if (a[i] !== b[i]) {
    const line = cur.slice(0, 0); // placeholder
    console.log("first token-kind divergence at index", i, ": HEAD", ts.SyntaxKind[a[i]], "CUR", ts.SyntaxKind[b[i]]);
    // find position of nth token in cur
    const s = ts.createScanner(ts.ScriptTarget.ES2022, false, ts.LanguageVariant.JSX, cur);
    let pos = 0;
    for (let t = 0; t <= i; t++) { pos = s.getTokenPos(); s.scan(); }
    const { line: l, character } = ts.getLineAndCharacterOfPosition(ts.createSourceFile("x", cur, 11, false, ts.ScriptKind.TSX), pos);
    console.log("at CUR L" + (l + 1) + ":" + (character + 1) + "  text: " + JSON.stringify(cur.slice(pos, pos + 100)));
    break;
  }
  i++;
}
if (i === Math.min(a.length, b.length)) console.log("prefix identical for", i, "tokens; extra CUR tokens:", ts.SyntaxKind[b[i]]);
