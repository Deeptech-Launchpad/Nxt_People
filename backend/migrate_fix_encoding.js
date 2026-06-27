/* ── Fix double-encoded (mojibake) text in stored data ────────────────────
 *  Some rows were written by older code that contained mojibake string
 *  literals (e.g. feed icons/dashes), so the corruption lives in the DB. This
 *  repairs those rows in place using the same per-run UTF-8 reversal applied to
 *  the source files. Idempotent — clean rows are left untouched.
 *
 *  Run once:  node backend/migrate_fix_encoding.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');

// ── Per-run mojibake fixer (self-contained) ──────────────────────────────
const SPECIALS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SPECIAL_TO_BYTE = {'€':0x80,'‚':0x82,'ƒ':0x83,'„':0x84,'…':0x85,'†':0x86,'‡':0x87,'ˆ':0x88,'‰':0x89,'Š':0x8A,'‹':0x8B,'Œ':0x8C,'Ž':0x8E,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,'˜':0x98,'™':0x99,'š':0x9A,'›':0x9B,'œ':0x9C,'ž':0x9E,'Ÿ':0x9F};
const isMoji = (ch) => { const cp = ch.codePointAt(0); return (cp >= 0x80 && cp <= 0xFF) || SPECIALS.includes(ch); };
function toBytes(str){ const out=[]; for(const ch of str){ const cp=ch.codePointAt(0); if(cp<=0xFF) out.push(cp); else if(SPECIAL_TO_BYTE[ch]!==undefined) out.push(SPECIAL_TO_BYTE[ch]); else return null;} return Buffer.from(out); }
function decodeOnce(str){ const b=toBytes(str); if(!b) return null; return b.toString('utf8'); }
const MARK = /[ÃÂÄÅÆÇÈÉÊÐÑÞãâðñ]/;
function fixRun(run){ let cur=run; for(let i=0;i<6;i++){ if(!MARK.test(cur)) break; const dec=decodeOnce(cur); if(dec===null||dec.includes('�')||dec===cur) break; cur=dec; } return cur; }
const LOSSY = [['Ã¢â‚¬â€œ','–'],['Ã¢â‚¬â€','—'],['â‚¬Ã¢â€','—']];
function fixText(s){
  if (typeof s !== 'string' || !s) return s;
  let out='',run='';
  for (const ch of s){ if(isMoji(ch)) run+=ch; else { if(run){out+=fixRun(run);run='';} out+=ch; } }
  if (run) out+=fixRun(run);
  for (const [bad, good] of LOSSY) out = out.split(bad).join(good);
  return out;
}

// Table → text columns to repair. Add more here if a future scan finds them.
const TARGETS = [
  ['feeds', ['title', 'body', 'icon']],
];

async function migrate() {
  let totalFixed = 0;
  for (const [table, cols] of TARGETS) {
    // Only proceed if the table exists.
    const exists = await pool.query(`SELECT to_regclass($1) AS t`, [`public.${table}`]);
    if (!exists.rows[0].t) { console.log(`• ${table}: table not present, skipping`); continue; }

    const rows = await pool.query(`SELECT id, ${cols.map(c => `"${c}"`).join(', ')} FROM "${table}"`);
    let fixed = 0;
    for (const row of rows.rows) {
      const updates = [];
      const params = [];
      let i = 1;
      for (const c of cols) {
        const orig = row[c];
        const next = fixText(orig);
        if (next !== orig) { updates.push(`"${c}" = $${i++}`); params.push(next); }
      }
      if (updates.length) {
        params.push(row.id);
        await pool.query(`UPDATE "${table}" SET ${updates.join(', ')} WHERE id = $${i}`, params);
        fixed++;
      }
    }
    totalFixed += fixed;
    console.log(`✅ ${table}: repaired ${fixed} row(s)`);
  }
  console.log(`\n✅ Encoding migration complete. ${totalFixed} row(s) repaired.`);
  process.exit(0);
}

migrate().catch(e => { console.error('❌ Encoding migration failed:', e); process.exit(1); });
